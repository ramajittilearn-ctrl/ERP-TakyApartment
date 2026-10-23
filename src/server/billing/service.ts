import { createHash, randomUUID } from "node:crypto";
import { Prisma, type BillingPeriod, type MeterKind } from "@prisma/client";
import { db } from "../db";
import { acquireSourceGate } from "../invoices/gate";
import { AppError } from "../errors";
import type { Actor } from "../services";
import { calculateBillingPreview } from "./calculations";
import { validateRoomAllocation } from "./allocation";
import {
  billingConsumptionSchema,
  billingReadingSchema,
  type BillingApproval,
  type BillingCalculationInput,
  type BillingConsumption,
  type BillingReading,
  type BillingValidationIssue,
} from "./contracts";
import {
  consumptionApprovalInput,
  previewInput,
  rateSelectionInput,
} from "./validation";

const serializable = {
  isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
};
const day = (value: Date) => value.toISOString().slice(0, 10);
const meterInclude = {
  room: { include: { floor: true } },
} satisfies Prisma.UtilityMeterInclude;
const readingInclude = {
  meter: { include: meterInclude },
  previousReading: { include: { meter: { include: meterInclude } } },
} satisfies Prisma.MeterReadingInclude;
type ReadingRecord = Prisma.MeterReadingGetPayload<{
  include: typeof readingInclude;
}>;
type LeaseRecord = Prisma.LeaseGetPayload<{
  include: { room: { include: { floor: true } } };
}>;

function authorize(actor: Actor, admin = false) {
  if (!(actor.role === "ADMIN" || (!admin && actor.role === "STAFF")))
    throw new AppError(403, "FORBIDDEN", "ไม่มีสิทธิ์ดำเนินการข้อมูลเรียกเก็บ");
}
function invalid(code: string, message: string): never {
  throw new AppError(422, code, message);
}
async function openPeriod(tx: Prisma.TransactionClient, id: string) {
  await tx.$queryRaw`SELECT id FROM "BillingPeriod" WHERE id = ${id}::uuid FOR UPDATE`;
  const period = await tx.billingPeriod.findUnique({ where: { id } });
  if (!period) throw new AppError(404, "PERIOD_NOT_FOUND", "ไม่พบรอบเรียกเก็บ");
  if (period.status !== "OPEN")
    throw new AppError(409, "PERIOD_CLOSED", "รอบเรียกเก็บปิดแล้ว");
  return period;
}
function readingSource(
  row: ReadingRecord | NonNullable<ReadingRecord["previousReading"]>,
): BillingReading {
  if (
    !row.readingDate ||
    (!row.billingPeriodId && row.type !== "OPENING") ||
    !row.confirmedAt ||
    !row.confirmedById
  )
    invalid(
      "LEGACY_READING_UNVERIFIED",
      "ประวัติมิเตอร์ยังไม่มีวันที่หรือรอบที่ตรวจสอบแล้ว",
    );
  if (!row.meter.activeFrom)
    invalid(
      "METER_LIFECYCLE_UNVERIFIED",
      "ยังไม่ได้ตรวจสอบวันที่เริ่มใช้งานมิเตอร์",
    );
  if (
    row.readingDate < row.meter.activeFrom ||
    (row.meter.activeUntil && row.readingDate > row.meter.activeUntil)
  )
    invalid(
      "READING_OUTSIDE_METER_LIFECYCLE",
      "วันที่อ่านอยู่นอกช่วงใช้งานมิเตอร์",
    );
  return {
    id: row.id,
    version: row.updatedAt.toISOString(),
    propertyId: row.meter.room.floor.propertyId,
    roomId: row.meter.roomId,
    meterId: row.meterId,
    kind: row.meter.kind,
    billingPeriodId: row.billingPeriodId,
    value: row.value.toFixed(3),
    readOn: day(row.readingDate),
    status: row.status,
  };
}
function actualSource(
  row: ReadingRecord,
): Extract<BillingConsumption, { kind: "ACTUAL" }> {
  if (
    row.status !== "CONFIRMED" ||
    row.type === "OPENING" ||
    !row.previousReading ||
    row.consumption === null
  )
    invalid(
      "ACTUAL_CONSUMPTION_UNAVAILABLE",
      "ต้องมีปริมาณใช้จริงและค่าอ่านก่อนหน้าที่รับรองแล้ว",
    );
  if (row.previousReading.meterId !== row.meterId)
    invalid("CROSS_METER_READING", "ห้ามหักค่าอ่านระหว่างมิเตอร์คนละตัว");
  if (!row.value.minus(row.previousReading.value).equals(row.consumption))
    invalid("ACTUAL_QUANTITY_MISMATCH", "ปริมาณใช้ไม่ตรงกับค่าอ่านที่รับรอง");
  return {
    kind: "ACTUAL",
    current: readingSource(row),
    previous: readingSource(row.previousReading),
    quantity: row.consumption.toFixed(3),
  };
}
async function currentReading(tx: Prisma.TransactionClient, id: string) {
  const row = await tx.meterReading.findUnique({
    where: { id },
    include: readingInclude,
  });
  if (!row) invalid("READING_NOT_FOUND", "ไม่พบหลักฐานค่าอ่านมิเตอร์");
  return row;
}
function leaseSource(lease: LeaseRecord) {
  return {
    id: lease.id,
    propertyId: lease.room.floor.propertyId,
    roomId: lease.roomId,
    tenantId: lease.tenantId,
    version: leaseVersion(lease),
    rent: lease.rent.toFixed(2),
    startsOn: day(lease.startDate),
    endsOn: day(lease.endDate),
  };
}
function leaseVersion(lease: LeaseRecord) {
  return createHash("sha256")
    .update(
      JSON.stringify({
        id: lease.id,
        roomId: lease.roomId,
        tenantId: lease.tenantId,
        propertyId: lease.room.floor.propertyId,
        rent: lease.rent.toFixed(2),
        startsOn: day(lease.startDate),
        endsOn: day(lease.endDate),
        status: lease.status,
        updatedAt: lease.updatedAt.toISOString(),
      }),
    )
    .digest("hex")
    .slice(0, 40);
}
async function eligibleLease(
  tx: Prisma.TransactionClient,
  period: BillingPeriod,
  leaseId: string,
) {
  const lease = await tx.lease.findUnique({
    where: { id: leaseId },
    include: { room: { include: { floor: true } } },
  });
  if (
    !lease ||
    lease.room.floor.propertyId !== period.propertyId ||
    !["ACTIVE", "ENDED"].includes(lease.status) ||
    lease.startDate > period.endsOn ||
    lease.endDate < period.startsOn
  )
    invalid("LEASE_NOT_ELIGIBLE", "สัญญาไม่อยู่ในอาคารหรือช่วงเรียกเก็บนี้");
  if (
    await tx.lease.count({
      where: {
        id: { not: lease.id },
        roomId: lease.roomId,
        status: { in: ["ACTIVE", "ENDED"] },
        startDate: {
          lte: lease.endDate < period.endsOn ? lease.endDate : period.endsOn,
        },
        endDate: {
          gte:
            lease.startDate > period.startsOn
              ? lease.startDate
              : period.startsOn,
        },
      },
    })
  )
    invalid("OVERLAPPING_OCCUPANCY", "มีช่วงเข้าพักซ้อนกันในห้องเดียวกัน");
  return lease;
}
async function selectedRate(
  tx: Prisma.TransactionClient,
  period: BillingPeriod,
  kind: MeterKind,
) {
  const selection = await tx.billingRateSelection.findFirst({
    where: { billingPeriodId: period.id, kind },
    orderBy: { revision: "desc" },
    include: { utilityRate: true },
  });
  if (!selection) return null;
  const rate = selection.utilityRate;
  const next = await tx.utilityRate.findFirst({
    where: {
      propertyId: rate.propertyId,
      kind: rate.kind,
      effectiveFrom: { gt: rate.effectiveFrom },
    },
    orderBy: { effectiveFrom: "asc" },
  });
  return {
    id: rate.id,
    propertyId: rate.propertyId,
    billingPeriodId: period.id,
    kind: rate.kind,
    value: rate.unitPrice.toFixed(4),
    effectiveFrom: day(rate.effectiveFrom),
    nextEffectiveFrom: next ? day(next.effectiveFrom) : null,
    approval: {
      id: selection.id,
      approverId: selection.approvedById,
      approverRole: "ADMIN",
      approvedAt: selection.approvedAt.toISOString(),
    },
  };
}

export async function approveBillingRate(actor: Actor, input: unknown) {
  authorize(actor, true);
  const data = rateSelectionInput.parse(input);
  return db.$transaction(async (tx) => {
    await acquireSourceGate(tx);
    const period = await openPeriod(tx, data.billingPeriodId);
    const rate = await tx.utilityRate.findUnique({
      where: { id: data.utilityRateId },
    });
    if (
      !rate ||
      rate.propertyId !== period.propertyId ||
      rate.kind !== data.kind
    )
      invalid(
        "RATE_SCOPE_MISMATCH",
        "อัตราต้องตรงกับอาคารและประเภทสาธารณูปโภค",
      );
    const next = await tx.utilityRate.findFirst({
      where: {
        propertyId: period.propertyId,
        kind: data.kind,
        effectiveFrom: { gt: rate.effectiveFrom },
      },
      orderBy: { effectiveFrom: "asc" },
    });
    if (
      rate.effectiveFrom > period.endsOn ||
      (next && next.effectiveFrom <= period.startsOn)
    )
      invalid(
        "RATE_NOT_ELIGIBLE",
        "อัตราต้องมีผลอย่างน้อยหนึ่งวันในรอบเรียกเก็บ",
      );
    const previous = await tx.billingRateSelection.findFirst({
      where: { billingPeriodId: period.id, kind: data.kind },
      orderBy: { revision: "desc" },
    });
    const record = await tx.billingRateSelection.create({
      data: {
        ...data,
        approvedById: actor.id,
        revision: (previous?.revision ?? 0) + 1,
      },
    });
    await tx.auditLog.create({
      data: {
        actorId: actor.id,
        action: "APPROVE_RATE",
        entity: "billing_rate_selections",
        entityId: record.id,
        metadata: {
          billingPeriodId: period.id,
          kind: data.kind,
          beforeSelectionId: previous?.id ?? null,
          rateId: rate.id,
          unitPrice: rate.unitPrice.toFixed(4),
          effectiveFrom: day(rate.effectiveFrom),
          nextEffectiveFrom: next ? day(next.effectiveFrom) : null,
          reason: data.reason,
        },
      },
    });
    return {
      selectionId: record.id,
      revision: record.revision,
      ...(await selectedRate(tx, period, data.kind)),
    };
  }, serializable);
}

export async function listBillingRateSelections(actor: Actor, input: unknown) {
  authorize(actor);
  const { billingPeriodId } = previewInput.parse(input);
  return db.$transaction(async (tx) => {
    const period = await tx.billingPeriod.findUnique({
      where: { id: billingPeriodId },
    });
    if (!period)
      throw new AppError(404, "PERIOD_NOT_FOUND", "ไม่พบรอบเรียกเก็บ");
    const selections = await tx.billingRateSelection.findMany({
      where: { billingPeriodId },
      include: { utilityRate: true },
      orderBy: [{ kind: "asc" }, { revision: "asc" }],
    });
    return Promise.all(
      selections.map(async (selection) => {
        const next = await tx.utilityRate.findFirst({
          where: {
            propertyId: selection.utilityRate.propertyId,
            kind: selection.kind,
            effectiveFrom: { gt: selection.utilityRate.effectiveFrom },
          },
          orderBy: { effectiveFrom: "asc" },
        });
        return {
          id: selection.id,
          billingPeriodId: selection.billingPeriodId,
          kind: selection.kind,
          utilityRateId: selection.utilityRateId,
          reason: selection.reason,
          revision: selection.revision,
          approvedAt: selection.approvedAt.toISOString(),
          approvedById: selection.approvedById,
          rate: {
            unitPrice: selection.utilityRate.unitPrice.toFixed(4),
            effectiveFrom: day(selection.utilityRate.effectiveFrom),
            nextEffectiveFrom: next ? day(next.effectiveFrom) : null,
          },
        };
      }),
    );
  });
}

async function replacementRecords(
  tx: Prisma.TransactionClient,
  period: BillingPeriod,
  roomId: string,
  kind: MeterKind,
) {
  return tx.meterReplacement.findMany({
    where: {
      roomId,
      kind,
      replacementDate: { gte: period.startsOn, lte: period.endsOn },
    },
    orderBy: [{ replacementDate: "asc" }, { id: "asc" }],
  });
}
async function actualReadings(
  tx: Prisma.TransactionClient,
  periodId: string,
  roomId: string,
  kind: MeterKind,
) {
  return tx.meterReading.findMany({
    where: {
      billingPeriodId: periodId,
      status: "CONFIRMED",
      type: { not: "OPENING" },
      meter: { roomId, kind },
    },
    include: readingInclude,
    orderBy: { id: "asc" },
  });
}

async function validateActualAllocation(
  tx: Prisma.TransactionClient,
  period: BillingPeriod,
  lease: LeaseRecord,
  row: ReadingRecord,
) {
  if (lease.startDate > period.startsOn || lease.endDate < period.endsOn)
    invalid(
      "OCCUPANCY_ALLOCATION_REQUIRED",
      "ปริมาณใช้ทั้งห้องยังไม่ได้แบ่งให้ช่วงเข้าพักบางเดือน",
    );
  return validateActualPeriodSpan(tx, period, row);
}
async function validateActualPeriodSpan(
  tx: Prisma.TransactionClient,
  period: BillingPeriod,
  row: ReadingRecord,
) {
  const previous = row.previousReading;
  if (
    previous?.type === "OPENING" &&
    previous.readingDate &&
    previous.readingDate >= period.startsOn &&
    previous.readingDate <= period.endsOn
  )
    return;
  const previousPeriod = previous?.billingPeriodId
    ? await tx.billingPeriod.findUnique({
        where: { id: previous.billingPeriodId },
      })
    : null;
  if (
    !previousPeriod ||
    !previous?.readingDate ||
    previous.readingDate < previousPeriod.startsOn ||
    previous.readingDate > previousPeriod.endsOn ||
    previousPeriod.endsOn.valueOf() + 86_400_000 !== period.startsOn.valueOf()
  )
    invalid(
      "ACTUAL_PERIOD_ALLOCATION_REQUIRED",
      "ค่าอ่านครอบคลุมหลายรอบ ต้องมีการจัดสรรปริมาณที่รับรองก่อน",
    );
}

async function validateLeaseAllocations(
  tx: Prisma.TransactionClient,
  period: BillingPeriod,
  lease: LeaseRecord,
  kind: MeterKind,
  source: Extract<BillingConsumption, { kind: "ALLOCATED_ACTUAL" }>,
  verifiedQuantity: string,
) {
  const rows = await tx.billingConsumptionApproval.findMany({
    where: {
      billingPeriodId: period.id,
      kind,
      leaseId: { not: lease.id },
      lease: {
        roomId: lease.roomId,
        status: { in: ["ACTIVE", "ENDED"] },
        startDate: { lte: period.endsOn },
        endDate: { gte: period.startsOn },
      },
    },
    orderBy: { revision: "desc" },
  });
  const quantities = [{ leaseId: lease.id, quantity: source.quantity }];
  const seen = new Set<string>();
  for (const row of rows) {
    if (seen.has(row.leaseId)) continue;
    seen.add(row.leaseId);
    const parsed = billingConsumptionSchema.safeParse(row.sourceData);
    if (!parsed.success)
      invalid("APPROVAL_DATA_INVALID", "ข้อมูลรับรองไม่ครบถ้วน");
    const other = parsed.data;
    if (
      (other.kind === "ACTUAL" || other.kind === "ALLOCATED_ACTUAL") &&
      other.current.id === source.current.id
    )
      quantities.push({ leaseId: row.leaseId, quantity: other.quantity });
  }
  const issues = validateRoomAllocation({
    verifiedQuantity,
    allocations: quantities,
  });
  if (issues.length) invalid(issues[0].code, issues[0].message);
}

export async function approveBillingConsumption(actor: Actor, input: unknown) {
  authorize(actor, true);
  const data = consumptionApprovalInput.parse(input);
  return db.$transaction(async (tx) => {
    await acquireSourceGate(tx);
    const period = await openPeriod(tx, data.billingPeriodId);
    const lease = await eligibleLease(tx, period, data.leaseId);
    const replacements = await replacementRecords(
      tx,
      period,
      lease.roomId,
      data.kind,
    );
    const previous = await tx.billingConsumptionApproval.findFirst({
      where: { billingPeriodId: period.id, leaseId: lease.id, kind: data.kind },
      orderBy: { revision: "desc" },
    });
    const id = randomUUID();
    const approvedAt = new Date();
    const approval: BillingApproval = {
      id,
      approverId: actor.id,
      approverRole: actor.role,
      approvedAt: approvedAt.toISOString(),
    };
    let source: BillingConsumption;
    if (data.source.kind === "ALLOCATED_ACTUAL") {
      if (replacements.length)
        invalid(
          "REPLACEMENT_APPROVAL_REQUIRED",
          "ต้องรับรองปริมาณแยกตามมิเตอร์ที่เปลี่ยน",
        );
      const row = await currentReading(tx, data.source.currentReadingId);
      const actual = actualSource(row);
      await validateActualPeriodSpan(tx, period, row);
      source = {
        kind: "ALLOCATED_ACTUAL",
        current: actual.current,
        previous: actual.previous,
        quantity: data.source.quantity,
        reason: data.reason,
        evidence: data.evidence,
        approval,
      };
      await validateLeaseAllocations(
        tx,
        period,
        lease,
        data.kind,
        source,
        actual.quantity,
      );
    } else if (data.source.kind === "ACTUAL") {
      const priorSource = previous
        ? billingConsumptionSchema.parse(previous.sourceData)
        : null;
      if (
        !priorSource ||
        priorSource.kind === "REPLACEMENT" ||
        replacements.length
      )
        invalid(
          "ACTUAL_SELECTION_NOT_ALLOWED",
          "รับรองค่าใช้จริงแทนค่าประมาณได้เฉพาะรอบเปิดที่ไม่มีการเปลี่ยนมิเตอร์",
        );
      const row = await currentReading(tx, data.source.currentReadingId);
      await validateActualAllocation(tx, period, lease, row);
      source = {
        ...actualSource(row),
        selection: { approval, reason: data.reason, evidence: data.evidence },
      };
    } else if (data.source.kind === "ESTIMATE") {
      if (replacements.length)
        invalid(
          "REPLACEMENT_APPROVAL_REQUIRED",
          "กรุณารับรองปริมาณใช้แยกตามมิเตอร์ที่เปลี่ยน",
        );
      if ((await actualReadings(tx, period.id, lease.roomId, data.kind)).length)
        invalid(
          "ACTUAL_ESTIMATE_CONFLICT",
          "มีค่าอ่านจริงแล้ว ไม่สามารถใช้ค่าประมาณซ้ำ",
        );
      source = {
        ...data.source,
        reason: data.reason,
        evidence: data.evidence,
        approval,
      };
    } else {
      if (!replacements.length)
        invalid("REPLACEMENT_NOT_FOUND", "ไม่พบประวัติเปลี่ยนมิเตอร์ในรอบนี้");
      const segments: Extract<
        BillingConsumption,
        { kind: "REPLACEMENT" }
      >["segments"] = [];
      for (const segment of data.source.segments) {
        if (segment.verification === "READINGS") {
          const row = await currentReading(tx, segment.currentReadingId);
          const actual = actualSource(row);
          segments.push({
            verification: "READINGS",
            meterId: row.meterId,
            replacementIds: replacements
              .filter(
                (r) =>
                  r.oldMeterId === row.meterId || r.newMeterId === row.meterId,
              )
              .map((r) => r.id),
            current: actual.current,
            previous: actual.previous,
            quantity: segment.quantity,
            reason: data.reason,
            evidence: data.evidence,
            approval,
          });
        } else {
          const meter = await tx.utilityMeter.findUnique({
            where: { id: segment.meterId },
          });
          if (
            !meter ||
            meter.roomId !== lease.roomId ||
            meter.kind !== data.kind ||
            !meter.activeFrom ||
            segment.startsOn < day(meter.activeFrom) ||
            (meter.activeUntil && segment.endsOn > day(meter.activeUntil))
          )
            invalid(
              "METER_SEGMENT_INVALID",
              "ช่วงปริมาณใช้ไม่ตรงกับอายุหรือประเภทมิเตอร์",
            );
          const startsOn = [
            day(period.startsOn),
            day(lease.startDate),
            day(meter.activeFrom),
          ]
            .sort()
            .at(-1);
          const endsOn = [
            day(period.endsOn),
            day(lease.endDate),
            ...(meter.activeUntil ? [day(meter.activeUntil)] : []),
          ].sort()[0];
          if (segment.startsOn !== startsOn || segment.endsOn !== endsOn)
            invalid(
              "SEGMENT_COVERAGE_INCOMPLETE",
              "หลักฐานต้องครอบคลุมช่วงมิเตอร์ที่เรียกเก็บทั้งหมด",
            );
          const sourceReadings = [];
          for (const readingId of segment.sourceReadingIds)
            sourceReadings.push(
              readingSource(await currentReading(tx, readingId)),
            );
          segments.push({
            verification: "ADMIN_EVIDENCE",
            meterId: segment.meterId,
            startsOn: segment.startsOn,
            endsOn: segment.endsOn,
            quantity: segment.quantity,
            replacementIds: replacements
              .filter(
                (r) => r.oldMeterId === meter.id || r.newMeterId === meter.id,
              )
              .map((r) => r.id),
            sourceReadings,
            reason: data.reason,
            evidence: data.evidence,
            approval,
          });
        }
      }
      source = { kind: "REPLACEMENT", segments };
      const expectedMeters = new Set(
        replacements.flatMap((r) => [r.oldMeterId, r.newMeterId]),
      );
      if (
        segments.length !== expectedMeters.size ||
        segments.some((s) => !expectedMeters.has(s.meterId))
      )
        invalid(
          "REPLACEMENT_SEGMENTS_INCOMPLETE",
          "ต้องรับรองปริมาณครบทุกมิเตอร์ในประวัติการเปลี่ยน",
        );
      const otherApprovals = await tx.billingConsumptionApproval.findMany({
        where: {
          billingPeriodId: period.id,
          kind: data.kind,
          leaseId: { not: lease.id },
          lease: { roomId: lease.roomId },
        },
        orderBy: { revision: "desc" },
      });
      const seen = new Set<string>();
      for (const other of otherApprovals) {
        if (seen.has(other.leaseId)) continue;
        seen.add(other.leaseId);
        const parsed = billingConsumptionSchema.parse(other.sourceData);
        if (
          parsed.kind === "REPLACEMENT" &&
          parsed.segments.some((s) => expectedMeters.has(s.meterId))
        )
          invalid(
            "SEGMENT_ALREADY_ALLOCATED",
            "ปริมาณมิเตอร์นี้ถูกจัดสรรให้สัญญาอื่นแล้ว ต้องมีหลักฐานแบ่งช่วงที่ชัดเจน",
          );
      }
    }
    source = billingConsumptionSchema.parse(source);
    const utilityRate = await selectedRate(tx, period, data.kind);
    const sourceCheck = calculateBillingPreview({
      propertyId: period.propertyId,
      period: {
        id: period.id,
        propertyId: period.propertyId,
        startsOn: day(period.startsOn),
        endsOn: day(period.endsOn),
        status: period.status,
        version: period.updatedAt.toISOString(),
      },
      lease: leaseSource(lease),
      utilities: [{ kind: data.kind, rate: utilityRate, consumption: source }],
    });
    const sourceIssues = sourceCheck.issues.filter((issue) =>
      issue.path.startsWith(`utilities.${data.kind}.consumption`),
    );
    if (sourceIssues.length)
      invalid(
        sourceIssues[0].code,
        sourceIssues.map((issue) => issue.message).join("; "),
      );
    const record = await tx.billingConsumptionApproval.create({
      data: {
        id,
        billingPeriodId: period.id,
        leaseId: lease.id,
        leaseVersion: leaseVersion(lease),
        kind: data.kind,
        revision: (previous?.revision ?? 0) + 1,
        sourceData: source,
        approvedById: actor.id,
        approvedAt,
      },
    });
    await tx.auditLog.create({
      data: {
        actorId: actor.id,
        action: "APPROVE_CONSUMPTION",
        entity: "billing_consumption",
        entityId: id,
        metadata: {
          billingPeriodId: period.id,
          leaseId: lease.id,
          kind: data.kind,
          beforeApprovalId: previous?.id ?? null,
          source,
          reason: data.reason,
        },
      },
    });
    return { id: record.id, revision: record.revision, source };
  }, serializable);
}

function validationIssue(error: unknown, path: string): BillingValidationIssue {
  if (error instanceof AppError)
    return { code: error.code, path, message: error.message };
  throw error;
}
async function consumptionForPreview(
  tx: Prisma.TransactionClient,
  period: BillingPeriod,
  lease: LeaseRecord,
  kind: MeterKind,
): Promise<BillingConsumption | null> {
  const record = await tx.billingConsumptionApproval.findFirst({
    where: { billingPeriodId: period.id, leaseId: lease.id, kind },
    orderBy: { revision: "desc" },
  });
  const readings = await actualReadings(tx, period.id, lease.roomId, kind);
  const replacements = await replacementRecords(tx, period, lease.roomId, kind);
  if (record) {
    if (record.leaseVersion !== leaseVersion(lease))
      invalid(
        "APPROVED_LEASE_STALE",
        "สัญญาเปลี่ยนหลังรับรอง ต้องตรวจสอบข้อมูลใหม่",
      );
    const parsedSource = billingConsumptionSchema.safeParse(record.sourceData);
    if (!parsedSource.success)
      invalid("APPROVAL_DATA_INVALID", "ข้อมูลรับรองไม่ครบถ้วน");
    const source = parsedSource.data;
    const approvals =
      source.kind === "ESTIMATE" || source.kind === "ALLOCATED_ACTUAL"
        ? [source.approval]
        : source.kind === "REPLACEMENT"
          ? source.segments.map((s) => s.approval)
          : source.selection
            ? [source.selection.approval]
            : [];
    if (
      !approvals.length ||
      approvals.some(
        (approval) =>
          approval.id !== record.id ||
          approval.approverId !== record.approvedById ||
          approval.approvedAt !== record.approvedAt.toISOString() ||
          approval.approverRole !== "ADMIN",
      )
    )
      invalid(
        "APPROVAL_PROVENANCE_INVALID",
        "ข้อมูลผู้รับรองไม่ตรงกับประวัติอนุมัติ",
      );
    if (source.kind === "ESTIMATE" && (readings.length || replacements.length))
      invalid(
        "ACTUAL_ESTIMATE_CONFLICT",
        "ค่าประมาณและค่าอ่านจริงหรือการเปลี่ยนมิเตอร์ขัดกัน ต้องตรวจสอบก่อนเรียกเก็บ",
      );
    if (source.kind === "REPLACEMENT") {
      const meterIds = new Set(
        replacements.flatMap((r) => [r.oldMeterId, r.newMeterId]),
      );
      if (
        source.segments.length !== meterIds.size ||
        source.segments.some((s) => !meterIds.has(s.meterId))
      )
        invalid(
          "REPLACEMENT_SOURCE_CHANGED",
          "ข้อมูลเปลี่ยนมิเตอร์ต่างจากข้อมูลที่รับรอง",
        );
      for (const segment of source.segments) {
        if (
          segment.replacementIds.some(
            (id) =>
              !replacements.some(
                (r) =>
                  r.id === id &&
                  (r.oldMeterId === segment.meterId ||
                    r.newMeterId === segment.meterId),
              ),
          )
        )
          invalid(
            "REPLACEMENT_SOURCE_CHANGED",
            "ไม่พบประวัติเปลี่ยนมิเตอร์ที่รับรอง",
          );
        const referenced =
          segment.verification === "READINGS"
            ? [segment.previous, segment.current]
            : segment.sourceReadings;
        for (const saved of referenced) {
          const current = readingSource(await currentReading(tx, saved.id));
          if (
            JSON.stringify(billingReadingSchema.parse(current)) !==
            JSON.stringify(saved)
          )
            invalid(
              "APPROVED_SOURCE_STALE",
              "หลักฐานค่าอ่านเปลี่ยนหลังรับรอง ต้องรับรองข้อมูลใหม่ในรอบที่ยังเปิด",
            );
        }
      }
    }
    if (source.kind === "ACTUAL" || source.kind === "ALLOCATED_ACTUAL") {
      if (
        replacements.length ||
        readings.length !== 1 ||
        readings[0].id !== source.current.id
      )
        invalid("ACTUAL_SOURCE_CHANGED", "ข้อมูลใช้จริงต่างจากข้อมูลที่รับรอง");
      if (source.kind === "ACTUAL")
        await validateActualAllocation(tx, period, lease, readings[0]);
      else await validateActualPeriodSpan(tx, period, readings[0]);
      const current = actualSource(readings[0]);
      if (
        JSON.stringify(billingReadingSchema.parse(current.current)) !==
          JSON.stringify(source.current) ||
        JSON.stringify(billingReadingSchema.parse(current.previous)) !==
          JSON.stringify(source.previous) ||
        (source.kind === "ACTUAL" && current.quantity !== source.quantity)
      )
        invalid(
          "APPROVED_SOURCE_STALE",
          "ค่าอ่านเปลี่ยนหลังรับรอง ต้องรับรองข้อมูลใหม่",
        );
      if (source.kind === "ALLOCATED_ACTUAL")
        await validateLeaseAllocations(
          tx,
          period,
          lease,
          kind,
          source,
          current.quantity,
        );
    }
    return source;
  }
  if (replacements.length)
    invalid(
      "REPLACEMENT_APPROVAL_REQUIRED",
      "ยังไม่ได้รับรองปริมาณใช้ของมิเตอร์ที่เปลี่ยน",
    );
  if (!readings.length) return null;
  if (readings.length !== 1)
    invalid(
      "AMBIGUOUS_CONSUMPTION",
      "มีปริมาณใช้หลายรายการโดยไม่มีการรับรองแบ่งช่วง",
    );
  await validateActualAllocation(tx, period, lease, readings[0]);
  const source = actualSource(readings[0]);
  return source;
}

export async function collectBillingPreview(
  tx: Prisma.TransactionClient,
  billingPeriodId: string,
) {
  const period = await tx.billingPeriod.findUnique({
    where: { id: billingPeriodId },
  });
  if (!period) throw new AppError(404, "PERIOD_NOT_FOUND", "ไม่พบรอบเรียกเก็บ");
  const leases = await tx.lease.findMany({
    where: {
      room: { floor: { propertyId: period.propertyId } },
      status: { in: ["ACTIVE", "ENDED"] },
      startDate: { lte: period.endsOn },
      endDate: { gte: period.startsOn },
    },
    include: { room: { include: { floor: true } } },
    orderBy: [{ roomId: "asc" }, { startDate: "asc" }, { id: "asc" }],
  });
  const results = [];
  for (const lease of leases) {
    const issues: BillingValidationIssue[] = [];
    if (
      leases.some(
        (other) =>
          other.id !== lease.id &&
          other.roomId === lease.roomId &&
          other.startDate <= lease.endDate &&
          other.endDate >= lease.startDate,
      )
    )
      issues.push({
        code: "OVERLAPPING_OCCUPANCY",
        path: "lease",
        message: "มีช่วงเข้าพักซ้อนกันในห้องเดียวกัน",
      });
    const utilities: BillingCalculationInput["utilities"] = [];
    for (const kind of ["WATER", "ELECTRICITY"] satisfies MeterKind[]) {
      let consumption: BillingConsumption | null = null;
      try {
        consumption = await consumptionForPreview(tx, period, lease, kind);
      } catch (error) {
        issues.push(validationIssue(error, `utilities.${kind}.consumption`));
      }
      utilities.push({
        kind,
        rate: await selectedRate(tx, period, kind),
        consumption,
      });
    }
    results.push({
      leaseId: lease.id,
      roomId: lease.roomId,
      result: calculateBillingPreview({
        propertyId: period.propertyId,
        period: {
          id: period.id,
          propertyId: period.propertyId,
          startsOn: day(period.startsOn),
          endsOn: day(period.endsOn),
          status: period.status,
          version: period.updatedAt.toISOString(),
        },
        lease: leaseSource(lease),
        utilities,
        validationIssues: issues,
      }),
    });
  }
  return {
    billingPeriodId: period.id,
    propertyId: period.propertyId,
    periodStatus: period.status,
    sourceSet: "PREVIEW_ONLY",
    productionDataGate: "F06_NOT_VERIFIED",
    issues: leases.length
      ? []
      : [
          {
            code: "NO_ELIGIBLE_LEASES",
            path: "leases",
            message: "ไม่พบสัญญาที่เรียกเก็บได้ในรอบนี้",
          },
        ],
    complete: results.length > 0 && results.every((row) => row.result.complete),
    readyToClose:
      results.length > 0 && results.every((row) => row.result.readyToClose),
    eligibleForFutureIssuance: false,
    results,
  };
}
export async function getBillingPreview(actor: Actor, input: unknown) {
  authorize(actor);
  const query = previewInput.parse(input);
  return db.$transaction(
    async (tx) => {
      await tx.$executeRaw`SET TRANSACTION READ ONLY`;
      return collectBillingPreview(tx, query.billingPeriodId);
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
  );
}
