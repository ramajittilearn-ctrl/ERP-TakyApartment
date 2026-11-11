import { createHash, randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { db } from "../db";
import { AppError } from "../errors";
import type { Actor } from "../services";
import { collectBillingPreview } from "../billing/service";
import { calculateBillingPreview } from "../billing/calculations";
import type {
  BillingCalculationInput,
  BillingPreviewSnapshot,
} from "../billing/contracts";
import type { InvoicePdfDocument } from "./pdf";
import { acquireCloseGate, acquireSourceGate } from "./gate";
import {
  duePolicyDtoSchema,
  duePolicyInput,
  prepareDraftInput,
  refreshDraftInput,
  updateDraftInput,
  issueInvoiceInput,
  voidInvoiceInput,
  reviseInvoiceInput,
  invoiceListInput,
  invoiceId,
  invoiceSnapshotSchema,
  invoiceLabelsSchema,
  dueProvenanceSchema,
  invoiceDtoSchema,
  invoiceOptionsSchema,
  type InvoiceDto,
  type DueProvenance,
} from "./contracts";
const day = (value: Date) => value.toISOString().slice(0, 10);
export function canonicalFingerprint(value: unknown): string {
  function canonical(v: unknown): unknown {
    if (Array.isArray(v)) return v.map(canonical);
    if (v !== null && typeof v === "object")
      return Object.fromEntries(
        Object.entries(v)
          .filter(([, x]) => x !== undefined)
          .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
          .map(([k, x]) => [k, canonical(x)]),
      );
    return v;
  }
  return createHash("sha256")
    .update(JSON.stringify(canonical(value)))
    .digest("hex");
}
function json(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value));
}
function fail(code: string, message: string, status = 409): never {
  throw new AppError(status, code, message);
}
function authorize(actor: Actor, admin = false) {
  if (actor.role !== "ADMIN" && (admin || actor.role !== "STAFF"))
    fail("FORBIDDEN", "ไม่มีสิทธิ์ดำเนินการใบแจ้งหนี้", 403);
}
const invoiceInclude = {
  frozenLease: true,
  correction: true,
  nextInvoice: { select: { id: true } },
} satisfies Prisma.InvoiceInclude;
type InvoiceRow = Prisma.InvoiceGetPayload<{ include: typeof invoiceInclude }>;
function dto(row: InvoiceRow): InvoiceDto {
  return invoiceDtoSchema.parse({
    id: row.id,
    number: row.number,
    leaseId: row.leaseId,
    billingPeriodId: row.billingPeriodId,
    frozenLeaseId: row.frozenLeaseId,
    period: day(row.period),
    dueDate: row.dueDate ? day(row.dueDate) : null,
    dueProvenance:
      row.dueProvenance === null
        ? null
        : dueProvenanceSchema.parse(row.dueProvenance),
    status: row.status,
    revision: row.revision,
    version: row.version,
    finalTotal: row.finalTotal?.toFixed(2) ?? null,
    notes: row.notes,
    fingerprint: row.fingerprint,
    previousInvoiceId: row.previousInvoiceId,
    nextInvoiceId: row.nextInvoice?.id ?? null,
    issuedAt: row.issuedAt?.toISOString() ?? null,
    issuedById: row.issuedById,
    voidedAt: row.voidedAt?.toISOString() ?? null,
    voidedById: row.voidedById,
    voidReason: row.voidReason,
    managed: row.billingPeriodId !== null,
    labels: row.frozenLease
      ? invoiceLabelsSchema.parse(row.frozenLease.labels)
      : null,
    snapshot:
      row.snapshot === null ? null : invoiceSnapshotSchema.parse(row.snapshot),
    correction: row.correction
      ? {
          id: row.correction.id,
          reason: row.correction.reason,
          evidence: row.correction.evidence,
          approvedById: row.correction.approvedById,
          approvedAt: row.correction.approvedAt.toISOString(),
          differences: row.correction.differences,
        }
      : null,
  });
}
async function audit(
  tx: Prisma.TransactionClient,
  actor: Actor,
  action: string,
  entityId: string,
  metadata: unknown,
) {
  await tx.auditLog.create({
    data: {
      actorId: actor.id,
      action,
      entity: "invoices",
      entityId,
      metadata: json(metadata),
    },
  });
}
async function retry<T>(run: () => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await run();
    } catch (error) {
      const conflict =
        error instanceof Prisma.PrismaClientKnownRequestError &&
        (error.code === "P2034" || error.code === "P2002");
      if (!conflict || attempt >= 2) throw error;
    }
  }
}
async function command(
  actor: Actor,
  operation: string,
  data: { commandKey: string },
  run: (tx: Prisma.TransactionClient) => Promise<unknown>,
): Promise<unknown> {
  const parseResult = (value: unknown) =>
    operation === "CONFIGURE_DUE_POLICY"
      ? duePolicyDtoSchema.parse(value)
      : invoiceDtoSchema.parse(value);
  const fingerprint = canonicalFingerprint(data);
  return retry(() =>
    db.$transaction(
      async (tx) => {
        await acquireSourceGate(tx);
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${actor.id + ":" + data.commandKey}, 0))`;
        const prior = await tx.invoiceCommand.findUnique({
          where: {
            actorId_commandKey: {
              actorId: actor.id,
              commandKey: data.commandKey,
            },
          },
        });
        if (prior) {
          if (
            prior.operation !== operation ||
            prior.requestFingerprint !== fingerprint
          )
            fail("IDEMPOTENCY_CONFLICT", "รหัสคำสั่งนี้ใช้กับคำขออื่นแล้ว");
          return parseResult(prior.result);
        }
        const result = parseResult(await run(tx));
        await tx.invoiceCommand.create({
          data: {
            actorId: actor.id,
            commandKey: data.commandKey,
            operation,
            requestFingerprint: fingerprint,
            result: json(result),
          },
        });
        return result;
      },
      {
        isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted,
        timeout: 20000,
      },
    ),
  );
}
async function lockPeriod(tx: Prisma.TransactionClient, id: string) {
  await tx.$queryRaw`SELECT id FROM "BillingPeriod" WHERE id=${id}::uuid FOR UPDATE`;
  const period = await tx.billingPeriod.findUnique({
    where: { id },
    include: { freeze: true },
  });
  if (!period) fail("PERIOD_NOT_FOUND", "ไม่พบรอบเรียกเก็บ", 404);
  if (period.status !== "CLOSED" || !period.freeze)
    fail("PERIOD_NOT_FROZEN", "ต้องปิดรอบพร้อมข้อมูลที่ตรวจสอบและตรึงแล้ว");
  return { ...period, freeze: period.freeze };
}
async function lockedInvoice(
  tx: Prisma.TransactionClient,
  id: string,
  version: number,
) {
  const reference = await tx.invoice.findUnique({
    where: { id },
    select: { billingPeriodId: true, leaseId: true },
  });
  if (!reference) fail("INVOICE_NOT_FOUND", "ไม่พบใบแจ้งหนี้", 404);
  if (!reference.billingPeriodId)
    fail(
      "LEGACY_MAPPING_REQUIRED",
      "ประวัติเดิมต้องตรวจสอบการเชื่อมโยงก่อนใช้งาน",
    );
  await lockPeriod(tx, reference.billingPeriodId);
  await tx.$queryRaw`SELECT id FROM "Lease" WHERE id=${reference.leaseId}::uuid FOR UPDATE`;
  await tx.$queryRaw`SELECT id FROM "Invoice" WHERE id=${id}::uuid FOR UPDATE`;
  const row = await tx.invoice.findUniqueOrThrow({
    where: { id },
    include: invoiceInclude,
  });
  if (row.version !== version)
    fail("STALE_VERSION", "ข้อมูลเปลี่ยนแล้ว กรุณาโหลดใหม่");
  return row;
}
function verifiedSnapshot(
  value: unknown,
  fingerprint: string | null,
): BillingPreviewSnapshot {
  const parsed = invoiceSnapshotSchema.safeParse(value);
  if (!parsed.success)
    fail("SNAPSHOT_INVALID", "ข้อมูลตรึงไม่ครบหรือรูปแบบไม่ถูกต้อง");
  const calculated = calculateBillingPreview(parsed.data.source);
  if (
    !calculated.complete ||
    calculated.snapshot.fingerprint !== fingerprint ||
    canonicalFingerprint(calculated.snapshot) !==
      canonicalFingerprint(parsed.data)
  )
    fail("SNAPSHOT_MISMATCH", "ข้อมูลและผลคำนวณที่ตรึงไม่ตรงกัน");
  return calculated.snapshot;
}
function dueFromPolicy(
  periodEnd: Date,
  policy: { propertyId: string; version: number; offsetDays: number } | null,
): DueProvenance | null {
  if (!policy) return null;
  const date = new Date(periodEnd);
  date.setUTCDate(date.getUTCDate() + policy.offsetDays);
  return {
    kind: "POLICY",
    propertyId: policy.propertyId,
    version: policy.version,
    offsetDays: policy.offsetDays,
    anchor: day(periodEnd),
    dueDate: day(date),
  };
}
async function materialize(
  tx: Prisma.TransactionClient,
  id: string,
  snapshot: BillingPreviewSnapshot,
) {
  await tx.invoiceItem.deleteMany({ where: { invoiceId: id } });
  for (const line of snapshot.lines) {
    // The item amount is a reference display amount; finalTotal comes only from raw aggregation.
    const utility = snapshot.source.utilities.find((u) => u.kind === line.kind);
    const quantity =
      line.kind === "RENT"
        ? "1"
        : utility?.consumption?.kind === "REPLACEMENT"
          ? utility.consumption.segments
              .reduce((sum, s) => sum.plus(s.quantity), new Prisma.Decimal(0))
              .toFixed(3)
          : (utility?.consumption?.quantity ?? "0");
    await tx.invoiceItem.create({
      data: {
        invoiceId: id,
        description:
          line.kind === "RENT"
            ? `RENT (${snapshot.rentProration.occupiedDays}/${snapshot.rentProration.periodDays} days)`
            : line.kind,
        quantity,
        unitPrice:
          line.kind === "RENT"
            ? line.displayAmount
            : (utility?.rate?.value ?? "0"),
        amount: line.displayAmount,
      },
    });
  }
}
async function number(tx: Prisma.TransactionClient, period: Date) {
  const month = day(period).slice(0, 7).replace("-", "");
  await tx.invoiceMonthCounter.upsert({
    where: { month },
    create: { month, value: 0 },
    update: {},
  });
  await tx.$queryRaw`SELECT month FROM "InvoiceMonthCounter" WHERE month=${month} FOR UPDATE`;
  const counter = await tx.invoiceMonthCounter.findUniqueOrThrow({
    where: { month },
  });
  if (counter.value >= 9999)
    fail("NUMBER_EXHAUSTED", "เลขใบแจ้งหนี้เดือนนี้ครบ 9999 แล้ว");
  const next = await tx.invoiceMonthCounter.update({
    where: { month },
    data: { value: { increment: 1 } },
  });
  return `INV-${month}-${String(next.value).padStart(4, "0")}`;
}
export async function closeAndFreezeBillingPeriod(
  actor: Actor,
  idInput: unknown,
) {
  authorize(actor, true);
  const id = invoiceId.parse(idInput);
  return retry(() =>
    db.$transaction(
      async (tx) => {
        await acquireCloseGate(tx);
        await tx.$queryRaw`SELECT id FROM "BillingPeriod" WHERE id=${id}::uuid FOR UPDATE`;
        const period = await tx.billingPeriod.findUnique({
          where: { id },
        });
        if (!period) fail("PERIOD_NOT_FOUND", "ไม่พบรอบเรียกเก็บ", 404);
        if (period.status === "CLOSED") return period;
        const preview = await collectBillingPreview(tx, id);
        const incomplete = preview.results.filter((r) => !r.result.complete);
        if (incomplete.length)
          fail(
            "BILLING_INPUTS_INCOMPLETE",
            `ข้อมูลเรียกเก็บไม่ครบ: ${incomplete.map((r) => r.leaseId + ":" + r.result.issues.map((i) => i.code).join(",")).join("; ")}`,
            422,
          );
        const closedAt = new Date();
        const freeze = await tx.billingPeriodFreeze.create({
          data: {
            billingPeriodId: id,
            schemaVersion: "3C-3.1",
            closedById: actor.id,
            closedAt,
            leaseCount: preview.results.length,
            fingerprint: canonicalFingerprint(
              preview.results.map((r) => ({
                leaseId: r.leaseId,
                fingerprint: r.result.complete
                  ? r.result.snapshot.fingerprint
                  : null,
              })),
            ),
          },
        });
        for (const row of preview.results) {
          if (!row.result.complete)
            fail("BILLING_INPUTS_INCOMPLETE", "ข้อมูลเรียกเก็บไม่ครบ", 422);
          const lease = await tx.lease.findUniqueOrThrow({
            where: { id: row.leaseId },
            include: {
              tenant: true,
              room: { include: { floor: { include: { property: true } } } },
            },
          });
          await tx.billingFreezeLease.create({
            data: {
              freezeId: freeze.id,
              leaseId: lease.id,
              roomId: lease.roomId,
              tenantId: lease.tenantId,
              labels: {
                property: lease.room.floor.property.name,
                propertyAddress: lease.room.floor.property.address,
                room: lease.room.number,
                tenant: lease.tenant.name,
                leaseNumber: lease.number,
              },
              snapshot: json(row.result.snapshot),
              fingerprint: row.result.snapshot.fingerprint,
            },
          });
        }
        const closed = await tx.billingPeriod.update({
          where: { id },
          data: { status: "CLOSED", closedAt, closedById: actor.id },
        });
        await tx.auditLog.create({
          data: {
            actorId: actor.id,
            action: "CLOSE",
            entity: "billing_periods",
            entityId: id,
            metadata: {
              freezeId: freeze.id,
              leaseCount: preview.results.length,
              fingerprint: freeze.fingerprint,
            },
          },
        });
        return closed;
      },
      {
        isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted,
        timeout: 20000,
      },
    ),
  );
}
export async function configureDuePolicy(actor: Actor, input: unknown) {
  authorize(actor, true);
  const data = duePolicyInput.parse(input);
  return command(actor, "CONFIGURE_DUE_POLICY", data, async (tx) => {
    await tx.$queryRaw`SELECT id FROM "Property" WHERE id=${data.propertyId}::uuid FOR UPDATE`;
    if (!(await tx.property.findUnique({ where: { id: data.propertyId } })))
      fail("PROPERTY_NOT_FOUND", "ไม่พบอาคาร", 404);
    const previous = await tx.propertyDuePolicy.findUnique({
      where: { propertyId: data.propertyId },
    });
    if ((previous?.version ?? 0) !== data.expectedVersion)
      fail("STALE_VERSION", "การตั้งค่าเปลี่ยนแล้ว กรุณาโหลดใหม่");
    const policy = await tx.propertyDuePolicy.upsert({
      where: { propertyId: data.propertyId },
      create: {
        propertyId: data.propertyId,
        offsetDays: data.offsetDays,
        version: 1,
        configuredById: actor.id,
      },
      update: {
        offsetDays: data.offsetDays,
        version: { increment: 1 },
        configuredById: actor.id,
        configuredAt: new Date(),
      },
    });
    const result = {
      propertyId: policy.propertyId,
      offsetDays: policy.offsetDays,
      version: policy.version,
    };
    await audit(tx, actor, "CONFIGURE_DUE_POLICY", data.propertyId, {
      before: previous
        ? { offsetDays: previous.offsetDays, version: previous.version }
        : null,
      after: result,
    });
    return result;
  });
}
export async function prepareDraft(actor: Actor, input: unknown) {
  authorize(actor);
  const data = prepareDraftInput.parse(input);
  const result = await command(actor, "PREPARE_DRAFT", data, async (tx) => {
    const period = await lockPeriod(tx, data.billingPeriodId);
    await tx.$queryRaw`SELECT id FROM "Lease" WHERE id=${data.leaseId}::uuid FOR UPDATE`;
    const history = await tx.invoice.findMany({
      where: {
        leaseId: data.leaseId,
        period: { gte: period.startsOn, lte: period.endsOn },
      },
      orderBy: { revision: "desc" },
      include: invoiceInclude,
    });
    if (history.some((row) => !row.billingPeriodId))
      fail(
        "LEGACY_MAPPING_REQUIRED",
        "พบใบแจ้งหนี้เดิมที่ยังไม่ได้ตรวจสอบการเชื่อมโยง",
      );
    const active = history.find((row) => row.status !== "VOID");
    if (active) return dto(active);
    if (history.length)
      fail(
        "INVOICE_HISTORY_REQUIRES_REVISION",
        "ประวัติเดิมต้องใช้กระบวนการแก้ไขที่เชื่อมโยง",
      );
    const frozen = await tx.billingFreezeLease.findUnique({
      where: {
        freezeId_leaseId: { freezeId: period.freeze.id, leaseId: data.leaseId },
      },
    });
    if (!frozen) fail("LEASE_NOT_FROZEN", "ไม่พบสัญญานี้ในข้อมูลตรึง");
    const snapshot = verifiedSnapshot(frozen.snapshot, frozen.fingerprint);
    const provenance = dueFromPolicy(
      period.endsOn,
      await tx.propertyDuePolicy.findUnique({
        where: { propertyId: period.propertyId },
      }),
    );
    const created = await tx.invoice.create({
      data: {
        leaseId: data.leaseId,
        period: period.startsOn,
        billingPeriodId: period.id,
        frozenLeaseId: frozen.id,
        status: "DRAFT",
        snapshot: json(snapshot),
        fingerprint: snapshot.fingerprint,
        finalTotal: snapshot.totals.finalTotal,
        dueDate: provenance ? new Date(provenance.dueDate) : null,
        dueProvenance: provenance ? json(provenance) : Prisma.DbNull,
      },
      include: invoiceInclude,
    });
    await materialize(tx, created.id, snapshot);
    await audit(tx, actor, "PREPARE_DRAFT", created.id, {
      leaseId: data.leaseId,
      billingPeriodId: period.id,
      fingerprint: snapshot.fingerprint,
    });
    return dto(created);
  });
  return invoiceDtoSchema.parse(result);
}
export async function refreshDraft(actor: Actor, input: unknown) {
  authorize(actor);
  const data = refreshDraftInput.parse(input);
  const result = await command(actor, "REFRESH_DRAFT", data, async (tx) => {
    const row = await lockedInvoice(tx, data.invoiceId, data.expectedVersion);
    if (row.status !== "DRAFT") fail("INVOICE_STATE", "เฉพาะฉบับร่างเท่านั้น");
    if (!row.frozenLease) fail("SNAPSHOT_INVALID", "ไม่พบข้อมูลตรึง");
    const snapshot = verifiedSnapshot(
      row.frozenLease.snapshot,
      row.frozenLease.fingerprint,
    );
    const period = await tx.billingPeriod.findUniqueOrThrow({
      where: { id: row.billingPeriodId ?? "" },
    });
    const oldDue = row.dueProvenance
      ? dueProvenanceSchema.parse(row.dueProvenance)
      : null;
    const provenance =
      oldDue?.kind === "OVERRIDE"
        ? oldDue
        : dueFromPolicy(
            period.endsOn,
            await tx.propertyDuePolicy.findUnique({
              where: { propertyId: period.propertyId },
            }),
          );
    const updated = await tx.invoice.update({
      where: { id: row.id },
      data: {
        snapshot: json(snapshot),
        fingerprint: snapshot.fingerprint,
        finalTotal: snapshot.totals.finalTotal,
        dueDate: provenance ? new Date(provenance.dueDate) : null,
        dueProvenance: provenance ? json(provenance) : Prisma.DbNull,
        version: { increment: 1 },
      },
      include: invoiceInclude,
    });
    await materialize(tx, row.id, snapshot);
    await audit(tx, actor, "REFRESH_DRAFT", row.id, {
      beforeVersion: row.version,
      afterVersion: updated.version,
      dueProvenance: provenance,
    });
    return dto(updated);
  });
  return invoiceDtoSchema.parse(result);
}
export async function updateDraft(actor: Actor, input: unknown) {
  authorize(actor);
  const data = updateDraftInput.parse(input);
  if (data.dueOverride !== undefined) authorize(actor, true);
  const result = await command(actor, "UPDATE_DRAFT", data, async (tx) => {
    const row = await lockedInvoice(tx, data.invoiceId, data.expectedVersion);
    if (row.status !== "DRAFT") fail("INVOICE_STATE", "เฉพาะฉบับร่างเท่านั้น");
    let due: DueProvenance | null | undefined;
    if (data.dueOverride)
      due = { kind: "OVERRIDE", actorId: actor.id, ...data.dueOverride };
    else if (data.dueOverride === null) {
      const period = await tx.billingPeriod.findUniqueOrThrow({
        where: { id: row.billingPeriodId ?? "" },
      });
      due = dueFromPolicy(
        period.endsOn,
        await tx.propertyDuePolicy.findUnique({
          where: { propertyId: period.propertyId },
        }),
      );
    }
    const updated = await tx.invoice.update({
      where: { id: row.id },
      data: {
        ...(data.notes === undefined ? {} : { notes: data.notes }),
        ...(due === undefined
          ? {}
          : {
              dueDate: due ? new Date(due.dueDate) : null,
              dueProvenance: due ? json(due) : Prisma.DbNull,
            }),
        version: { increment: 1 },
      },
      include: invoiceInclude,
    });
    await audit(
      tx,
      actor,
      data.dueOverride !== undefined ? "OVERRIDE_INVOICE_DUE" : "UPDATE_DRAFT",
      row.id,
      {
        beforeVersion: row.version,
        afterVersion: updated.version,
        dueProvenance: due ?? null,
      },
    );
    return dto(updated);
  });
  return invoiceDtoSchema.parse(result);
}
async function issue(
  tx: Prisma.TransactionClient,
  actor: Actor,
  row: InvoiceRow,
) {
  if (row.status !== "DRAFT")
    fail("INVOICE_STATE", "ออกได้เฉพาะใบแจ้งหนี้ฉบับร่าง");
  const snapshot = verifiedSnapshot(row.snapshot, row.fingerprint);
  if (!row.frozenLease) fail("SNAPSHOT_INVALID", "ไม่พบข้อมูลตรึง");
  const authoritative = row.correction
    ? verifiedSnapshot(row.correction.snapshot, row.correction.fingerprint)
    : verifiedSnapshot(row.frozenLease.snapshot, row.frozenLease.fingerprint);
  if (canonicalFingerprint(authoritative) !== canonicalFingerprint(snapshot))
    fail("SNAPSHOT_MISMATCH", "ฉบับร่างไม่ตรงกับข้อมูลที่อนุมัติ");
  if (!row.dueDate || !row.dueProvenance)
    fail(
      "DUE_POLICY_REQUIRED",
      "กำหนดนโยบายวันครบกำหนดหรือวันที่อนุมัติก่อนออก",
    );
  const due = dueProvenanceSchema.parse(row.dueProvenance);
  if (due.dueDate !== day(row.dueDate))
    fail("DUE_DATE_MISMATCH", "วันครบกำหนดไม่ตรงกับหลักฐาน");
  if (row.finalTotal?.toFixed(2) !== snapshot.totals.finalTotal)
    fail("TOTAL_MISMATCH", "ยอดรวมไม่ตรงกับผลคำนวณ");
  await materialize(tx, row.id, snapshot);
  const issued = await tx.invoice.update({
    where: { id: row.id },
    data: {
      status: "ISSUED",
      number: await number(tx, row.period),
      issuedAt: new Date(),
      issuedById: actor.id,
      version: { increment: 1 },
    },
    include: invoiceInclude,
  });
  await audit(tx, actor, "ISSUE_INVOICE", row.id, {
    number: issued.number,
    leaseId: row.leaseId,
    billingPeriodId: row.billingPeriodId,
    fingerprint: row.fingerprint,
    finalTotal: snapshot.totals.finalTotal,
    dueProvenance: due,
  });
  return dto(issued);
}
export async function issueInvoice(actor: Actor, input: unknown) {
  authorize(actor, true);
  const data = issueInvoiceInput.parse(input);
  return invoiceDtoSchema.parse(
    await command(actor, "ISSUE_INVOICE", data, async (tx) =>
      issue(
        tx,
        actor,
        await lockedInvoice(tx, data.invoiceId, data.expectedVersion),
      ),
    ),
  );
}
async function assertNoActivePayments(
  tx: Prisma.TransactionClient,
  invoiceId: string,
) {
  if (
    await tx.paymentAllocation.findFirst({
      where: { invoiceId, payment: { status: "CONFIRMED" } },
    })
  )
    fail(
      "INVOICE_HAS_PAYMENTS",
      "Reverse active payments before voiding or revising the invoice",
    );
}
export async function voidInvoice(actor: Actor, input: unknown) {
  authorize(actor, true);
  const data = voidInvoiceInput.parse(input);
  return invoiceDtoSchema.parse(
    await command(actor, "VOID_INVOICE", data, async (tx) => {
      const row = await lockedInvoice(tx, data.invoiceId, data.expectedVersion);
      await assertNoActivePayments(tx, row.id);
      if (row.status !== "ISSUED")
        fail("INVOICE_STATE", "ยกเลิกได้เฉพาะใบแจ้งหนี้ที่ออกแล้ว");
      const updated = await tx.invoice.update({
        where: { id: row.id },
        data: {
          status: "VOID",
          voidedAt: new Date(),
          voidedById: actor.id,
          voidReason: data.reason,
          version: { increment: 1 },
        },
        include: invoiceInclude,
      });
      await audit(tx, actor, "VOID_INVOICE", row.id, {
        reason: data.reason,
        number: row.number,
      });
      return dto(updated);
    }),
  );
}
function quantityMilli(value: string): bigint {
  const [whole, fraction = ""] = value.split(".");
  return BigInt(whole) * 1000n + BigInt(fraction.padEnd(3, "0"));
}
type Reservation = {
  leaseId: string;
  roomId: string;
  kind: string;
  meterId: string;
  sourceKey: string;
  quantity: bigint;
  cap: bigint;
};
function reservations(snapshot: BillingPreviewSnapshot): Reservation[] {
  const rows: Reservation[] = [];
  for (const utility of snapshot.source.utilities) {
    const source = utility.consumption;
    if (!source || source.kind === "ESTIMATE") continue;
    const push = (
      meterId: string,
      key: string,
      quantity: string,
      cap: bigint,
    ) =>
      rows.push({
        leaseId: snapshot.source.lease.id,
        roomId: snapshot.source.lease.roomId,
        kind: utility.kind,
        meterId,
        sourceKey: key,
        quantity: quantityMilli(quantity),
        cap,
      });
    if (source.kind === "ACTUAL" || source.kind === "ALLOCATED_ACTUAL")
      push(
        source.current.meterId,
        source.previous.id + ":" + source.current.id,
        source.quantity,
        quantityMilli(source.current.value) -
          quantityMilli(source.previous.value),
      );
    else
      for (const segment of source.segments) {
        if (segment.verification === "READINGS")
          push(
            segment.meterId,
            segment.previous.id + ":" + segment.current.id,
            segment.quantity,
            quantityMilli(segment.current.value) -
              quantityMilli(segment.previous.value),
          );
        else
          push(
            segment.meterId,
            "EVIDENCE:" +
              segment.sourceReadings
                .map((r) => r.id)
                .sort()
                .join(":"),
            segment.quantity,
            quantityMilli(segment.quantity),
          );
      }
  }
  return rows;
}
async function validateReservations(
  tx: Prisma.TransactionClient,
  frozen: NonNullable<InvoiceRow["frozenLease"]>,
  candidate: BillingPreviewSnapshot,
) {
  const all = await tx.billingFreezeLease.findMany({
    where: { freezeId: frozen.freezeId },
    orderBy: { leaseId: "asc" },
  });
  const originals = all.flatMap((row) =>
    reservations(verifiedSnapshot(row.snapshot, row.fingerprint)),
  );
  const current: Reservation[] = [];
  const occupancy: BillingPreviewSnapshot[] = [];
  for (const row of all) {
    if (row.id === frozen.id) {
      occupancy.push(candidate);
      current.push(...reservations(candidate));
      continue;
    }
    const last = await tx.invoice.findFirst({
      where: { frozenLeaseId: row.id, correctionId: { not: null } },
      orderBy: { revision: "desc" },
      include: { correction: true },
    });
    const source = last?.correction
      ? verifiedSnapshot(last.correction.snapshot, last.correction.fingerprint)
      : verifiedSnapshot(row.snapshot, row.fingerprint);
    occupancy.push(source);
    current.push(...reservations(source));
  }
  for (const snapshot of occupancy) {
    if (
      occupancy.some(
        (other) =>
          other.source.lease.id !== snapshot.source.lease.id &&
          other.source.lease.roomId === snapshot.source.lease.roomId &&
          other.rentProration.occupiedStartsOn <=
            snapshot.rentProration.occupiedEndsOn &&
          other.rentProration.occupiedEndsOn >=
            snapshot.rentProration.occupiedStartsOn,
      )
    )
      fail(
        "OVERLAPPING_OCCUPANCY",
        "ช่วงเข้าพักที่แก้ไขซ้อนกับสัญญาในข้อมูลตรึง",
        422,
      );
  }
  for (const row of current) {
    const group = current.filter(
      (r) =>
        r.roomId === row.roomId &&
        r.kind === row.kind &&
        r.meterId === row.meterId,
    );
    if (group.some((r) => r.sourceKey !== row.sourceKey))
      fail(
        "INCOMPATIBLE_ROOM_SOURCES",
        "แหล่งการใช้มิเตอร์ในห้องไม่ตรงกัน",
        422,
      );
    const frozenGroup = originals.filter(
      (r) =>
        r.roomId === row.roomId &&
        r.kind === row.kind &&
        r.meterId === row.meterId,
    );
    // Evidence-only physical segments keep the originally approved room ceiling.
    const cap = row.sourceKey.startsWith("EVIDENCE:")
      ? frozenGroup.reduce((sum, r) => sum + r.quantity, 0n)
      : row.cap;
    if (group.reduce((sum, r) => sum + r.quantity, 0n) > cap)
      fail(
        "ALLOCATION_EXCEEDS_VERIFIED",
        "ยอดจัดสรรรวมทุกสัญญาเกินการใช้ที่ตรวจสอบแล้ว",
        422,
      );
  }
}
async function correctionSnapshot(
  tx: Prisma.TransactionClient,
  actor: Actor,
  row: InvoiceRow,
  data: ReturnType<typeof reviseInvoiceInput.parse>,
) {
  if (!row.frozenLease) fail("SNAPSHOT_INVALID", "ไม่พบข้อมูลตรึง");
  const original = verifiedSnapshot(row.snapshot, row.fingerprint);
  const source: BillingCalculationInput = structuredClone(original.source);
  const approval = {
    id: randomUUID(),
    approverId: actor.id,
    approverRole: actor.role,
    approvedAt: new Date().toISOString(),
  };
  const period = await tx.billingPeriod.findUniqueOrThrow({
    where: { id: source.period.id },
  });
  if (data.correction.useCurrentContract) {
    const lease = await tx.lease.findUniqueOrThrow({
      where: { id: row.leaseId },
      include: { room: { include: { floor: true } } },
    });
    if (
      lease.roomId !== source.lease.roomId ||
      lease.tenantId !== source.lease.tenantId ||
      lease.room.floor.propertyId !== source.propertyId ||
      !["ACTIVE", "ENDED"].includes(lease.status) ||
      lease.startDate > period.endsOn ||
      lease.endDate < period.startsOn
    )
      fail("CORRECTION_SCOPE", "สัญญาปัจจุบันไม่อยู่ในขอบเขตเดิม", 422);
    if (
      lease.rent.toFixed(2) !== source.lease.rent ||
      day(lease.startDate) !== source.lease.startsOn ||
      day(lease.endDate) !== source.lease.endsOn
    ) {
      source.lease = {
        ...source.lease,
        rent: lease.rent.toFixed(2),
        startsOn: day(lease.startDate),
        endsOn: day(lease.endDate),
        version: canonicalFingerprint({
          id: lease.id,
          rent: lease.rent.toFixed(2),
          startsOn: day(lease.startDate),
          endsOn: day(lease.endDate),
          updatedAt: lease.updatedAt.toISOString(),
        }),
      };
    }
  }
  for (const change of data.correction.utilities) {
    const utility = source.utilities.find((u) => u.kind === change.kind);
    if (!utility || !utility.rate || !utility.consumption)
      fail("CORRECTION_SOURCE_MISSING", "ไม่พบแหล่งคำนวณเดิม", 422);
    if (change.utilityRateId && change.utilityRateId !== utility.rate.id) {
      const rate = await tx.utilityRate.findUnique({
        where: { id: change.utilityRateId },
      });
      if (
        !rate ||
        rate.propertyId !== source.propertyId ||
        rate.kind !== change.kind
      )
        fail("CORRECTION_RATE_SCOPE", "อัตราค่าใช้จ่ายไม่ตรงขอบเขต", 422);
      const next = await tx.utilityRate.findFirst({
        where: {
          propertyId: rate.propertyId,
          kind: rate.kind,
          effectiveFrom: { gt: rate.effectiveFrom },
        },
        orderBy: { effectiveFrom: "asc" },
      });
      if (
        rate.effectiveFrom > period.endsOn ||
        (next && next.effectiveFrom <= period.startsOn)
      )
        fail("RATE_NOT_ELIGIBLE", "อัตราไม่มีผลในรอบเรียกเก็บนี้", 422);
      utility.rate = {
        ...utility.rate,
        id: rate.id,
        value: rate.unitPrice.toFixed(4),
        effectiveFrom: day(rate.effectiveFrom),
        nextEffectiveFrom: next ? day(next.effectiveFrom) : null,
        approval,
      };
    }
    const consumption = utility.consumption;
    if (change.segmentQuantities) {
      if (consumption.kind !== "REPLACEMENT" || change.quantity !== undefined)
        fail(
          "CORRECTION_SEGMENT_REQUIRED",
          "จัดสรรตามมิเตอร์จริงทีละส่วนเท่านั้น",
          422,
        );
      if (
        new Set(change.segmentQuantities.map((s) => s.meterId)).size !==
        change.segmentQuantities.length
      )
        fail("DUPLICATE_SEGMENT", "มิเตอร์ซ้ำในคำขอ", 422);
      for (const item of change.segmentQuantities) {
        const segment = consumption.segments.find(
          (s) => s.meterId === item.meterId,
        );
        if (!segment)
          fail(
            "CORRECTION_SOURCE_SCOPE",
            "มิเตอร์ไม่อยู่ในแหล่งข้อมูลเดิม",
            422,
          );
        if (new Prisma.Decimal(segment.quantity).equals(item.quantity))
          continue;
        segment.quantity = item.quantity;
        segment.approval = approval;
        segment.reason = data.reason;
        segment.evidence = data.evidence;
      }
    }
    if (
      change.quantity !== undefined &&
      !(
        consumption.kind !== "REPLACEMENT" &&
        new Prisma.Decimal(consumption.quantity).equals(change.quantity) &&
        !(
          consumption.kind === "ACTUAL" &&
          (source.lease.startsOn > source.period.startsOn ||
            source.lease.endsOn < source.period.endsOn)
        )
      )
    ) {
      if (consumption.kind === "REPLACEMENT")
        fail(
          "CORRECTION_SEGMENT_REQUIRED",
          "ต้องระบุปริมาณแยกตามมิเตอร์จริง",
          422,
        );
      if (consumption.kind === "ACTUAL")
        utility.consumption = {
          kind: "ALLOCATED_ACTUAL",
          previous: consumption.previous,
          current: consumption.current,
          quantity: change.quantity,
          approval,
          reason: data.reason,
          evidence: data.evidence,
        };
      else
        utility.consumption = {
          ...consumption,
          quantity: change.quantity,
          approval,
          reason: data.reason,
          evidence: data.evidence,
        };
    }
  }
  const occupiedStart =
    source.lease.startsOn > source.period.startsOn
      ? source.lease.startsOn
      : source.period.startsOn;
  const occupiedEnd =
    source.lease.endsOn < source.period.endsOn
      ? source.lease.endsOn
      : source.period.endsOn;
  for (const utility of source.utilities) {
    const consumption = utility.consumption;
    if (
      consumption?.kind === "ACTUAL" &&
      (occupiedStart > source.period.startsOn ||
        occupiedEnd < source.period.endsOn)
    )
      fail(
        "OCCUPANCY_ALLOCATION_REQUIRED",
        "สัญญาไม่เต็มเดือนต้องอนุมัติปริมาณต่อสัญญาโดยชัดเจน",
        422,
      );
    if (consumption?.kind === "REPLACEMENT")
      for (const segment of consumption.segments) {
        if (
          segment.verification === "READINGS" &&
          (segment.current.readOn < occupiedStart ||
            segment.previous.readOn > occupiedEnd)
        )
          fail(
            "CORRECTION_SOURCE_OUTSIDE_OCCUPANCY",
            "ช่วงการใช้มิเตอร์ไม่ทับกับช่วงเข้าพักที่แก้ไข",
            422,
          );
      }
  }
  const calculated = calculateBillingPreview(source);
  if (!calculated.complete)
    fail(
      "CORRECTION_INVALID",
      calculated.issues.map((i) => i.code + ": " + i.message).join("; "),
      422,
    );
  if (
    canonicalFingerprint(calculated.snapshot.source) ===
    canonicalFingerprint(original.source)
  )
    fail("CORRECTION_UNCHANGED", "ไม่มีข้อมูลเรียกเก็บที่เปลี่ยนแปลง", 422);
  await validateReservations(tx, row.frozenLease, calculated.snapshot);
  return { approval, original, replacement: calculated.snapshot };
}
export async function reviseInvoice(actor: Actor, input: unknown) {
  authorize(actor, true);
  const data = reviseInvoiceInput.parse(input);
  return invoiceDtoSchema.parse(
    await command(actor, "REVISE_INVOICE", data, async (tx) => {
      const row = await lockedInvoice(tx, data.invoiceId, data.expectedVersion);
      await assertNoActivePayments(tx, row.id);
      if (row.status !== "ISSUED")
        fail("INVOICE_STATE", "แก้ไขได้เฉพาะใบแจ้งหนี้ที่ออกแล้ว");
      if (await tx.invoice.findUnique({ where: { previousInvoiceId: row.id } }))
        fail("REVISION_EXISTS", "มีฉบับแก้ไขแล้ว");
      const { approval, original, replacement } = await correctionSnapshot(
        tx,
        actor,
        row,
        data,
      );
      const correction = await tx.invoiceCorrection.create({
        data: {
          id: approval.id,
          approvedAt: new Date(approval.approvedAt),
          originalInvoiceId: row.id,
          frozenLeaseId: row.frozenLeaseId ?? "",
          approvedById: actor.id,
          reason: data.reason,
          evidence: json(data.evidence),
          snapshot: json(replacement),
          fingerprint: replacement.fingerprint,
          differences: json({
            before: {
              fingerprint: original.fingerprint,
              source: original.source,
              totals: original.totals,
            },
            after: {
              fingerprint: replacement.fingerprint,
              source: replacement.source,
              totals: replacement.totals,
            },
          }),
        },
      });
      await tx.invoice.update({
        where: { id: row.id },
        data: {
          status: "VOID",
          voidedAt: new Date(),
          voidedById: actor.id,
          voidReason: data.reason,
          version: { increment: 1 },
        },
      });
      const draft = await tx.invoice.create({
        data: {
          leaseId: row.leaseId,
          period: row.period,
          billingPeriodId: row.billingPeriodId,
          frozenLeaseId: row.frozenLeaseId,
          correctionId: correction.id,
          previousInvoiceId: row.id,
          revision: row.revision + 1,
          status: "DRAFT",
          snapshot: json(replacement),
          fingerprint: replacement.fingerprint,
          finalTotal: replacement.totals.finalTotal,
          dueDate: row.dueDate,
          dueProvenance: row.dueProvenance ?? Prisma.DbNull,
          notes: row.notes,
        },
        include: invoiceInclude,
      });
      const issued = await issue(tx, actor, draft);
      await audit(tx, actor, "REVISE_INVOICE", row.id, {
        reason: data.reason,
        evidence: data.evidence,
        originalNumber: row.number,
        replacementId: issued.id,
        replacementNumber: issued.number,
        correctionId: correction.id,
        beforeFingerprint: original.fingerprint,
        afterFingerprint: replacement.fingerprint,
      });
      return issued;
    }),
  );
}
export async function listInvoices(actor: Actor, input: unknown) {
  authorize(actor);
  const query = invoiceListInput.parse(input);
  const rows = await db.invoice.findMany({
    where: {
      ...(query.billingPeriodId
        ? { billingPeriodId: query.billingPeriodId }
        : {}),
      ...(query.roomId ? { lease: { roomId: query.roomId } } : {}),
      ...(query.leaseId ? { leaseId: query.leaseId } : {}),
      ...(query.status ? { status: query.status } : {}),
    },
    include: invoiceInclude,
    orderBy: [{ period: "desc" }, { createdAt: "desc" }, { id: "asc" }],
    take: 500,
  });
  return rows.map(dto);
}
export async function getInvoice(actor: Actor, input: unknown) {
  authorize(actor);
  const id = invoiceId.parse(input);
  const row = await db.invoice.findUnique({
    where: { id },
    include: invoiceInclude,
  });
  if (!row) fail("INVOICE_NOT_FOUND", "ไม่พบใบแจ้งหนี้", 404);
  return dto(row);
}
export async function getInvoicePdfDocument(
  actor: Actor,
  input: unknown,
): Promise<InvoicePdfDocument> {
  const invoice = await getInvoice(actor, input);
  if (invoice.status === "DRAFT" || !invoice.managed)
    fail("PDF_UNAVAILABLE", "ดาวน์โหลดได้เฉพาะใบแจ้งหนี้ที่ออกแล้ว", 409);
  const snapshot = invoice.snapshot;
  if (
    !snapshot ||
    !invoice.number ||
    !invoice.issuedAt ||
    !invoice.dueDate ||
    !invoice.labels ||
    invoice.fingerprint !== snapshot.fingerprint ||
    invoice.finalTotal !== snapshot.totals.finalTotal
  )
    fail("PDF_SNAPSHOT_INVALID", "ข้อมูลใบแจ้งหนี้ฉบับจริงไม่ครบถ้วน", 409);

  const lines = snapshot.lines.map((line) => {
    if (line.kind === "RENT")
      return {
        kind: line.kind,
        quantity: `${snapshot.rentProration.occupiedDays}/${snapshot.rentProration.periodDays}`,
        unit: "วัน",
        rate: snapshot.source.lease.rent,
        amount: line.displayAmount,
      };
    const utility = snapshot.source.utilities.find(
      (source) => source.kind === line.kind,
    );
    const consumption = utility?.consumption;
    const quantity = !consumption
      ? "0.000"
      : consumption.kind === "REPLACEMENT"
        ? consumption.segments.map((segment) => segment.quantity).join(" + ")
        : consumption.quantity;
    return {
      kind: line.kind,
      quantity,
      unit: line.kind === "WATER" ? "m³" : "kWh",
      rate: utility?.rate?.value ?? null,
      amount: line.displayAmount,
    };
  });

  return {
    invoiceNumber: invoice.number,
    status: invoice.status,
    periodStart: snapshot.source.period.startsOn,
    periodEnd: snapshot.source.period.endsOn,
    issuedDate: invoice.issuedAt.slice(0, 10),
    dueDate: invoice.dueDate,
    revision: invoice.revision,
    property: {
      name: invoice.labels.property,
      address: invoice.labels.propertyAddress ?? "",
    },
    tenant: {
      name: invoice.labels.tenant,
      room: invoice.labels.room,
      leaseReference: invoice.labels.leaseNumber ?? null,
    },
    lines,
    reconciliationDelta: snapshot.totals.reconciliationDelta,
    total: snapshot.totals.finalTotal,
    voidedAt: invoice.voidedAt?.slice(0, 10) ?? null,
    voidReason: invoice.voidReason,
  };
}
export async function getInvoiceHistory(actor: Actor, input: unknown) {
  authorize(actor);
  const invoice = await getInvoice(actor, input);
  return (
    await db.invoice.findMany({
      where: { leaseId: invoice.leaseId, period: new Date(invoice.period) },
      include: invoiceInclude,
      orderBy: [{ revision: "asc" }, { createdAt: "asc" }],
    })
  ).map(dto);
}
export async function invoiceOptions(actor: Actor) {
  authorize(actor);
  const [properties, periods, rates] = await Promise.all([
    db.property.findMany({
      include: { duePolicy: true },
      orderBy: { code: "asc" },
    }),
    db.billingPeriod.findMany({
      include: { freeze: { include: { leases: true } } },
      orderBy: [{ startsOn: "desc" }, { id: "asc" }],
    }),
    db.utilityRate.findMany({
      orderBy: [
        { propertyId: "asc" },
        { kind: "asc" },
        { effectiveFrom: "asc" },
      ],
    }),
  ]);
  return invoiceOptionsSchema.parse({
    properties: properties.map((p) => ({
      id: p.id,
      name: p.name,
      duePolicy: p.duePolicy
        ? { offsetDays: p.duePolicy.offsetDays, version: p.duePolicy.version }
        : null,
    })),
    periods: periods.map((p) => ({
      id: p.id,
      propertyId: p.propertyId,
      startsOn: day(p.startsOn),
      endsOn: day(p.endsOn),
      status: p.status,
      freezeId: p.freeze?.id ?? null,
      candidates:
        p.freeze?.leases.map((l) => ({
          leaseId: l.leaseId,
          roomId: l.roomId,
          room: invoiceLabelsSchema.parse(l.labels).room,
          tenant: invoiceLabelsSchema.parse(l.labels).tenant,
        })) ?? [],
    })),
    rates: rates.map((r) => {
      const next = rates.find(
        (n) =>
          n.propertyId === r.propertyId &&
          n.kind === r.kind &&
          n.effectiveFrom > r.effectiveFrom,
      );
      return {
        id: r.id,
        propertyId: r.propertyId,
        kind: r.kind,
        value: r.unitPrice.toFixed(4),
        effectiveFrom: day(r.effectiveFrom),
        nextEffectiveFrom: next ? day(next.effectiveFrom) : null,
      };
    }),
  });
}
