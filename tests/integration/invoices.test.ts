import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "../../src/server/db";
import type { Actor } from "../../src/server/services";
import {
  createBillingPeriod,
  createUtilityRate,
  closeBillingPeriod,
} from "../../src/server/finance";
import {
  approveBillingConsumption,
  approveBillingRate,
} from "../../src/server/billing";
import {
  prepareDraft,
  configureDuePolicy,
  issueInvoice,
  updateDraft,
  refreshDraft,
  voidInvoice,
  reviseInvoice,
  getInvoice,
  getInvoicePdfDocument,
  getInvoiceHistory,
} from "../../src/server/invoices";
import {
  registerMeter,
  upsertDraftReading,
  confirmReading,
} from "../../src/server/meter";
import { calculateBillingPreview } from "../../src/server/billing/calculations";
let admin: Actor, staff: Actor;
const key = () => randomUUID();
beforeAll(async () => {
  if (!process.env.DATABASE_URL?.endsWith("/taky_phase2_test"))
    throw new Error("Dedicated test database only");
  const identity = await db.$queryRaw<
    { name: string }[]
  >`SELECT current_database() AS name`;
  expect(identity[0]?.name).toBe("taky_phase2_test");
  admin = await db.user.findUniqueOrThrow({
    where: { username: "test-admin" },
  });
  staff = await db.user.findUniqueOrThrow({
    where: { username: "test-staff" },
  });
});
afterAll(() => db.$disconnect());
async function fixture(
  options: {
    complete?: boolean;
    zero?: boolean;
    month?: string;
    rent?: string;
  } = {},
) {
  const suffix = key();
  const property = await db.property.create({
    data: {
      code: `I${suffix}`,
      name: "Synthetic invoice property",
      address: "99 ถนนสุขุมวิท กรุงเทพมหานคร",
    },
  });
  const floor = await db.floor.create({
    data: { propertyId: property.id, number: 1, name: "Test" },
  });
  const room = await db.room.create({
    data: { floorId: floor.id, number: "101", rent: "9999" },
  });
  const tenant = await db.tenant.create({
    data: { name: "Historical tenant", isDemo: true },
  });
  const lease = await db.lease.create({
    data: {
      number: `I${suffix}`,
      roomId: room.id,
      tenantId: tenant.id,
      startDate: new Date("2026-01-01"),
      endDate: new Date("2026-12-31"),
      rent: options.rent ?? "1000.00",
      deposit: "0",
      status: "ACTIVE",
      isDemo: true,
    },
  });
  const period = await createBillingPeriod(admin, {
    propertyId: property.id,
    month: options.month ?? "2026-02",
  });
  for (const kind of ["WATER", "ELECTRICITY"] as const) {
    const rate = await createUtilityRate(admin, {
      propertyId: property.id,
      kind,
      effectiveFrom: "2026-01-01",
      unitPrice: kind === "WATER" ? "20.0050" : "30.0050",
    });
    if (options.complete !== false) {
      await approveBillingRate(admin, {
        billingPeriodId: period.id,
        kind,
        utilityRateId: rate.id,
        reason: "Selected existing rate",
      });
      await approveBillingConsumption(admin, {
        billingPeriodId: period.id,
        leaseId: lease.id,
        kind,
        reason: "Documented estimate",
        evidence: ["synthetic evidence"],
        source: {
          kind: "ESTIMATE",
          quantity: options.zero ? "0.000" : "1.000",
          sourceContext: "Visit record",
        },
      });
    }
  }
  return { property, floor, room, tenant, lease, period };
}
async function closed(options: Parameters<typeof fixture>[0] = {}) {
  const f = await fixture(options);
  await closeBillingPeriod(admin, f.period.id);
  return f;
}
async function draft(f: Awaited<ReturnType<typeof fixture>>, withDue = true) {
  if (withDue)
    await configureDuePolicy(admin, {
      propertyId: f.property.id,
      offsetDays: 5,
      expectedVersion: 0,
      commandKey: key(),
    });
  return prepareDraft(staff, {
    billingPeriodId: f.period.id,
    leaseId: f.lease.id,
    commandKey: key(),
  });
}
async function issued(f: Awaited<ReturnType<typeof fixture>>) {
  const d = await draft(f);
  return issueInvoice(admin, {
    invoiceId: d.id,
    expectedVersion: d.version,
    commandKey: key(),
  });
}
describe("Stage3C3 invoice persistence and lifecycle", () => {
  it("blocks draft PDF data and enforces the existing invoice read role", async () => {
    const f = await closed();
    const d = await draft(f);
    await expect(getInvoicePdfDocument(staff, d.id)).rejects.toMatchObject({
      code: "PDF_UNAVAILABLE",
    });
    await expect(
      getInvoicePdfDocument(
        { ...staff, role: "TENANT" as typeof staff.role },
        d.id,
      ),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(getInvoicePdfDocument(staff, "not-a-uuid")).rejects.toThrow();
  });
  it("keeps an incomplete period OPEN without freeze/audit and rejects forged empty closure", async () => {
    const f = await fixture({ complete: false });
    await expect(closeBillingPeriod(admin, f.period.id)).rejects.toMatchObject({
      code: "BILLING_INPUTS_INCOMPLETE",
    });
    expect(
      (await db.billingPeriod.findUniqueOrThrow({ where: { id: f.period.id } }))
        .status,
    ).toBe("OPEN");
    expect(
      await db.billingPeriodFreeze.count({
        where: { billingPeriodId: f.period.id },
      }),
    ).toBe(0);
    expect(
      await db.auditLog.count({
        where: { entityId: f.period.id, action: "CLOSE" },
      }),
    ).toBe(0);
    await expect(
      db.$transaction(async (tx) => {
        await tx.billingPeriodFreeze.create({
          data: {
            billingPeriodId: f.period.id,
            schemaVersion: "3C-3.1",
            closedById: admin.id,
            closedAt: new Date(),
            leaseCount: 0,
            fingerprint: "0".repeat(64),
          },
        });
        await tx.billingPeriod.update({
          where: { id: f.period.id },
          data: {
            status: "CLOSED",
            closedAt: new Date(),
            closedById: admin.id,
          },
        });
      }),
    ).rejects.toThrow();
  });
  it("freezes every eligible lease atomically, preserves labels and exact engine parity", async () => {
    const f = await closed();
    const freeze = await db.billingPeriodFreeze.findUniqueOrThrow({
      where: { billingPeriodId: f.period.id },
      include: { leases: true },
    });
    expect(freeze.leaseCount).toBe(1);
    expect(freeze.leases).toHaveLength(1);
    expect(freeze.leases[0]?.labels).toMatchObject({
      property: "Synthetic invoice property",
      propertyAddress: "99 ถนนสุขุมวิท กรุงเทพมหานคร",
      room: "101",
      tenant: "Historical tenant",
      leaseNumber: f.lease.number,
    });
    const d = await draft(f);
    expect(d.finalTotal).toBe("1050.01");
    expect(d.snapshot?.totals.displayLineTotal).toBe("1050.02");
    expect(d.snapshot?.totals.reconciliationDelta).toBe("-0.01");
    if (!d.snapshot) throw new Error("snapshot missing");
    expect(calculateBillingPreview(d.snapshot.source)).toMatchObject({
      complete: true,
      snapshot: d.snapshot,
    });
    await db.tenant.update({
      where: { id: f.tenant.id },
      data: { name: "New live name" },
    });
    expect((await getInvoice(staff, d.id)).labels?.tenant).toBe(
      "Historical tenant",
    );
    expect((await getInvoice(staff, d.id)).labels?.propertyAddress).toBe(
      "99 ถนนสุขุมวิท กรุงเทพมหานคร",
    );
    await expect(
      db.billingFreezeLease.update({
        where: { id: freeze.leases[0].id },
        data: { fingerprint: "0".repeat(64) },
      }),
    ).rejects.toThrow();
  });
  it("builds a stable PDF document from issued snapshots after live records change", async () => {
    const f = await closed();
    const invoice = await issued(f);
    if (!invoice.snapshot || !invoice.number)
      throw new Error("issued snapshot missing");
    const before = await db.invoice.findUniqueOrThrow({
      where: { id: invoice.id },
    });

    await db.property.update({
      where: { id: f.property.id },
      data: { name: "Changed property", address: "Changed property address" },
    });
    await db.tenant.update({
      where: { id: f.tenant.id },
      data: { name: "Changed tenant" },
    });
    await db.room.update({
      where: { id: f.room.id },
      data: { rent: "99999.00" },
    });
    await db.lease.update({
      where: { id: f.lease.id },
      data: { number: `CHG-${key().slice(0, 32)}`, rent: "88888.00" },
    });
    await createUtilityRate(admin, {
      propertyId: f.property.id,
      kind: "WATER",
      effectiveFrom: "2026-03-01",
      unitPrice: "999.0000",
    });

    const first = await getInvoicePdfDocument(staff, invoice.id);
    const second = await getInvoicePdfDocument(staff, invoice.id);
    expect(first).toEqual(second);
    expect(first).toMatchObject({
      invoiceNumber: invoice.number,
      status: "ISSUED",
      property: {
        name: "Synthetic invoice property",
        address: "99 ถนนสุขุมวิท กรุงเทพมหานคร",
      },
      tenant: {
        name: "Historical tenant",
        leaseReference: f.lease.number,
      },
      total: invoice.snapshot.totals.finalTotal,
    });
    expect(first.lines.map((line) => line.amount)).toEqual(
      invoice.snapshot.lines.map((line) => line.displayAmount),
    );
    const after = await db.invoice.findUniqueOrThrow({
      where: { id: invoice.id },
    });
    expect(after).toMatchObject({
      number: before.number,
      version: before.version,
      status: before.status,
      snapshot: before.snapshot,
      fingerprint: before.fingerprint,
      finalTotal: before.finalTotal,
    });
  });
  it("requires due configuration and resolves explicit policy only when refreshed", async () => {
    const f = await closed();
    const d = await draft(f, false);
    expect(d.dueDate).toBeNull();
    await expect(
      issueInvoice(admin, {
        invoiceId: d.id,
        expectedVersion: d.version,
        commandKey: key(),
      }),
    ).rejects.toMatchObject({ code: "DUE_POLICY_REQUIRED" });
    await configureDuePolicy(admin, {
      propertyId: f.property.id,
      offsetDays: 5,
      expectedVersion: 0,
      commandKey: key(),
    });
    await expect(
      issueInvoice(admin, {
        invoiceId: d.id,
        expectedVersion: d.version,
        commandKey: key(),
      }),
    ).rejects.toMatchObject({ code: "DUE_POLICY_REQUIRED" });
    const r = await refreshDraft(staff, {
      invoiceId: d.id,
      expectedVersion: d.version,
      commandKey: key(),
    });
    expect(r.dueDate).toBe("2026-03-05");
    expect(
      (
        await issueInvoice(admin, {
          invoiceId: r.id,
          expectedVersion: r.version,
          commandKey: key(),
        })
      ).status,
    ).toBe("ISSUED");
  });
  it("enforces STAFF draft permissions, ADMIN-only overrides and stale versions", async () => {
    const f = await closed();
    const d = await draft(f);
    for (const run of [
      () =>
        configureDuePolicy(staff, {
          propertyId: f.property.id,
          offsetDays: 1,
          expectedVersion: 1,
          commandKey: key(),
        }),
      () =>
        issueInvoice(staff, {
          invoiceId: d.id,
          expectedVersion: d.version,
          commandKey: key(),
        }),
      () =>
        voidInvoice(staff, {
          invoiceId: d.id,
          expectedVersion: d.version,
          reason: "x",
          commandKey: key(),
        }),
      () =>
        updateDraft(staff, {
          invoiceId: d.id,
          expectedVersion: d.version,
          dueOverride: null,
          commandKey: key(),
        }),
      () =>
        reviseInvoice(staff, {
          invoiceId: d.id,
          expectedVersion: d.version,
          reason: "x",
          evidence: ["x"],
          correction: { useCurrentContract: true },
          commandKey: key(),
        }),
    ])
      await expect(run()).rejects.toMatchObject({ status: 403 });
    const edited = await updateDraft(staff, {
      invoiceId: d.id,
      expectedVersion: d.version,
      notes: "Approved notes",
      commandKey: key(),
    });
    await expect(
      updateDraft(staff, {
        invoiceId: d.id,
        expectedVersion: d.version,
        notes: "Lost update",
        commandKey: key(),
      }),
    ).rejects.toMatchObject({ code: "STALE_VERSION" });
    const override = await updateDraft(admin, {
      invoiceId: edited.id,
      expectedVersion: edited.version,
      dueOverride: { dueDate: "2026-03-10", reason: "Owner agreed date" },
      commandKey: key(),
    });
    expect(override.dueProvenance).toMatchObject({
      kind: "OVERRIDE",
      actorId: admin.id,
      reason: "Owner agreed date",
    });
  });
  it("prepares zero usage utility reference lines and issues without rounding coercion", async () => {
    const f = await closed({ zero: true });
    const d = await draft(f);
    expect(
      await db.invoiceItem.count({ where: { invoiceId: d.id, quantity: "0" } }),
    ).toBe(2);
    expect(
      (
        await issueInvoice(admin, {
          invoiceId: d.id,
          expectedVersion: d.version,
          commandKey: key(),
        })
      ).finalTotal,
    ).toBe("1000.00");
  });
  it("serializes draft races and returns committed command retries without duplicate audit", async () => {
    const f = await closed();
    const command = {
      billingPeriodId: f.period.id,
      leaseId: f.lease.id,
      commandKey: key(),
    };
    const [a, b] = await Promise.all([
      prepareDraft(staff, command),
      prepareDraft(staff, command),
    ]);
    expect(a).toEqual(b);
    expect(await db.invoice.count({ where: { leaseId: f.lease.id } })).toBe(1);
    expect(
      await db.auditLog.count({
        where: { entityId: a.id, action: "PREPARE_DRAFT" },
      }),
    ).toBe(1);
    await expect(
      prepareDraft(staff, { ...command, leaseId: key() }),
    ).rejects.toMatchObject({ code: "IDEMPOTENCY_CONFLICT" });
  });
  it("allocates globally unique canonical-month numbers under simultaneous issue and same-key retry", async () => {
    // Build each independent billing fixture before racing issuance so the
    // contention under test is the invoice-number allocator itself.
    const f = await closed();
    const g = await closed();
    const [a, b] = await Promise.all([draft(f), draft(g)]);
    const command = {
      invoiceId: a.id,
      expectedVersion: a.version,
      commandKey: key(),
    };
    const [ia, ib, retry] = await Promise.all([
      issueInvoice(admin, command),
      issueInvoice(admin, {
        invoiceId: b.id,
        expectedVersion: b.version,
        commandKey: key(),
      }),
      issueInvoice(admin, command),
    ]);
    expect(ia.number).toMatch(/^INV-202602-\d{4}$/);
    expect(ia.number).not.toBe(ib.number);
    expect(retry).toEqual(ia);
    expect(
      await db.auditLog.count({
        where: { entityId: a.id, action: "ISSUE_INVOICE" },
      }),
    ).toBe(1);
  });
  it("rejects direct SQL snapshot/total tampering, duplicate active rows and historical item mutation", async () => {
    const f = await closed();
    const d = await draft(f);
    await expect(
      db.invoice.update({
        where: { id: d.id },
        data: { finalTotal: "1", version: { increment: 1 } },
      }),
    ).rejects.toThrow();
    await expect(
      db.invoice.create({
        data: {
          leaseId: f.lease.id,
          period: new Date(d.period),
          billingPeriodId: f.period.id,
          frozenLeaseId: d.frozenLeaseId,
          snapshot: d.snapshot ?? {},
          fingerprint: d.fingerprint,
          finalTotal: "1050.01",
        },
      }),
    ).rejects.toThrow();
    const i = await issueInvoice(admin, {
      invoiceId: d.id,
      expectedVersion: d.version,
      commandKey: key(),
    });
    await expect(
      db.invoice.update({
        where: { id: i.id },
        data: { notes: "tamper", version: { increment: 1 } },
      }),
    ).rejects.toThrow();
    await expect(db.invoice.delete({ where: { id: i.id } })).rejects.toThrow();
    await expect(
      db.invoiceItem.updateMany({
        where: { invoiceId: i.id },
        data: { amount: "1" },
      }),
    ).rejects.toThrow();
    await expect(
      db.invoiceItem.deleteMany({ where: { invoiceId: i.id } }),
    ).rejects.toThrow();
  });
  it("voids with retained number/history and cannot create a new revision-one root", async () => {
    const f = await closed();
    const i = await issued(f);
    const v = await voidInvoice(admin, {
      invoiceId: i.id,
      expectedVersion: i.version,
      reason: "Cancelled billing",
      commandKey: key(),
    });
    expect(v).toMatchObject({
      status: "VOID",
      number: i.number,
      finalTotal: i.finalTotal,
    });
    expect(await getInvoicePdfDocument(staff, v.id)).toMatchObject({
      status: "VOID",
      invoiceNumber: i.number,
      total: i.snapshot?.totals.finalTotal,
      voidReason: "Cancelled billing",
    });
    await expect(
      updateDraft(admin, {
        invoiceId: v.id,
        expectedVersion: v.version,
        notes: "tamper",
        commandKey: key(),
      }),
    ).rejects.toMatchObject({ code: "INVOICE_STATE" });
    await expect(
      prepareDraft(staff, {
        billingPeriodId: f.period.id,
        leaseId: f.lease.id,
        commandKey: key(),
      }),
    ).rejects.toMatchObject({ code: "INVOICE_HISTORY_REQUIRES_REVISION" });
    expect(await getInvoiceHistory(staff, v.id)).toHaveLength(1);
  });
  it("atomically approves a contract correction, voids original and issues linked immutable replacement", async () => {
    const f = await closed();
    const i = await issued(f);
    await db.lease.update({
      where: { id: f.lease.id },
      data: { rent: "1100.00" },
    });
    const command = {
      invoiceId: i.id,
      expectedVersion: i.version,
      reason: "Contract value correction",
      evidence: ["signed lease"],
      correction: { useCurrentContract: true },
      commandKey: key(),
    };
    const revised = await reviseInvoice(admin, command);
    expect(revised).toMatchObject({
      status: "ISSUED",
      revision: 2,
      previousInvoiceId: i.id,
      finalTotal: "1150.01",
    });
    expect(revised.number).not.toBe(i.number);
    expect(await getInvoice(staff, i.id)).toMatchObject({
      status: "VOID",
      number: i.number,
      finalTotal: "1050.01",
      nextInvoiceId: revised.id,
    });
    expect(await reviseInvoice(admin, command)).toEqual(revised);
    expect(
      await db.invoiceCorrection.count({ where: { originalInvoiceId: i.id } }),
    ).toBe(1);
    expect(await getInvoiceHistory(staff, i.id)).toHaveLength(2);
    await expect(
      db.invoiceCorrection.update({
        where: { id: revised.correction?.id ?? "" },
        data: { reason: "tamper" },
      }),
    ).rejects.toThrow();
  });
  it("does not branch concurrent revisions", async () => {
    const f = await closed();
    const i = await issued(f);
    await db.lease.update({
      where: { id: f.lease.id },
      data: { rent: "1200" },
    });
    const results = await Promise.allSettled(
      [1, 2].map(() =>
        reviseInvoice(admin, {
          invoiceId: i.id,
          expectedVersion: i.version,
          reason: "Correction",
          evidence: ["signed lease"],
          correction: { useCurrentContract: true },
          commandKey: key(),
        }),
      ),
    );
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(await db.invoice.count({ where: { previousInvoiceId: i.id } })).toBe(
      1,
    );
    expect(
      await db.invoice.count({
        where: { leaseId: f.lease.id, status: { not: "VOID" } },
      }),
    ).toBe(1);
  });
  it("rolls back issuance, number and idempotency command when audit insert fails", async () => {
    const f = await closed();
    const d = await draft(f);
    const command = {
      invoiceId: d.id,
      expectedVersion: d.version,
      commandKey: key(),
    };
    const counter = await db.invoiceMonthCounter.findUnique({
      where: { month: "202602" },
    });
    const trigger = `invoice_test_audit_${key().replaceAll("-", "")}`;
    await db.$executeRawUnsafe(
      `CREATE FUNCTION ${trigger}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW."entityId"='${d.id}'::uuid AND NEW.action='ISSUE_INVOICE' THEN RAISE EXCEPTION 'synthetic audit failure'; END IF; RETURN NEW; END $$`,
    );
    await db.$executeRawUnsafe(
      `CREATE TRIGGER ${trigger} BEFORE INSERT ON "AuditLog" FOR EACH ROW EXECUTE FUNCTION ${trigger}()`,
    );
    try {
      await expect(issueInvoice(admin, command)).rejects.toThrow();
      expect(await getInvoice(staff, d.id)).toMatchObject({
        status: "DRAFT",
        number: null,
        version: d.version,
      });
      expect(
        (
          await db.invoiceMonthCounter.findUnique({
            where: { month: "202602" },
          })
        )?.value,
      ).toBe(counter?.value);
      expect(
        await db.invoiceCommand.count({
          where: { actorId: admin.id, commandKey: command.commandKey },
        }),
      ).toBe(0);
    } finally {
      await db.$executeRawUnsafe(`DROP TRIGGER ${trigger} ON "AuditLog"`);
      await db.$executeRawUnsafe(`DROP FUNCTION ${trigger}()`);
    }
  });
  it("rejects counter exhaustion without touching draft and prevents reset/delete", async () => {
    const f = await closed({ month: "2026-11" });
    const d = await draft(f);
    await db.invoiceMonthCounter.upsert({
      where: { month: "202611" },
      create: { month: "202611", value: 9999 },
      update: {},
    });
    await expect(
      issueInvoice(admin, {
        invoiceId: d.id,
        expectedVersion: d.version,
        commandKey: key(),
      }),
    ).rejects.toMatchObject({ code: "NUMBER_EXHAUSTED" });
    expect(await getInvoice(staff, d.id)).toMatchObject({
      status: "DRAFT",
      number: null,
    });
    await expect(
      db.invoiceMonthCounter.update({
        where: { month: "202611" },
        data: { value: 0 },
      }),
    ).rejects.toThrow();
    await expect(
      db.invoiceMonthCounter.delete({ where: { month: "202611" } }),
    ).rejects.toThrow();
  });
  it("freezes an empty eligible set and refuses retrospective freezing of historical CLOSED periods", async () => {
    const suffix = key();
    const property = await db.property.create({
      data: { code: `E${suffix}`, name: "Empty meter-only property" },
    });
    const empty = await createBillingPeriod(admin, {
      propertyId: property.id,
      month: "2026-01",
    });
    const first = await closeBillingPeriod(admin, empty.id);
    expect(await closeBillingPeriod(admin, empty.id)).toEqual(first);
    expect(
      await db.billingPeriodFreeze.findUniqueOrThrow({
        where: { billingPeriodId: empty.id },
      }),
    ).toMatchObject({ leaseCount: 0 });
    await expect(
      prepareDraft(staff, {
        billingPeriodId: empty.id,
        leaseId: key(),
        commandKey: key(),
      }),
    ).rejects.toMatchObject({ code: "LEASE_NOT_FROZEN" });
    const historical = await db.billingPeriod.create({
      data: {
        propertyId: property.id,
        startsOn: new Date("2025-12-01"),
        endsOn: new Date("2025-12-31"),
        status: "CLOSED",
        closedAt: new Date(),
        createdById: admin.id,
        closedById: admin.id,
      },
    });
    await closeBillingPeriod(admin, historical.id);
    expect(
      await db.billingPeriodFreeze.count({
        where: { billingPeriodId: historical.id },
      }),
    ).toBe(0);
    await expect(
      prepareDraft(staff, {
        billingPeriodId: historical.id,
        leaseId: key(),
        commandKey: key(),
      }),
    ).rejects.toMatchObject({ code: "PERIOD_NOT_FROZEN" });
  });
  it("waits for a direct source writer and freezes fresh post-gate labels", async () => {
    const f = await fixture();
    let release = () => {};
    let entered = () => {};
    const held = new Promise<void>((r) => {
      release = r;
    });
    const ready = new Promise<void>((r) => {
      entered = r;
    });
    const writer = db.$transaction(
      async (tx) => {
        await tx.tenant.update({
          where: { id: f.tenant.id },
          data: { name: "Committed before close cutoff" },
        });
        entered();
        await held;
      },
      { timeout: 20000 },
    );
    await ready;
    let closed = false;
    const close = closeBillingPeriod(admin, f.period.id).then((v) => {
      closed = true;
      return v;
    });
    try {
      let waiting = false;
      for (let n = 0; n < 40; n++) {
        const rows = await db.$queryRaw<
          { n: bigint }[]
        >`SELECT count(*) AS n FROM pg_locks WHERE locktype='advisory' AND objid=73422193 AND NOT granted`;
        if (Number(rows[0]?.n) > 0) {
          waiting = true;
          break;
        }
        await new Promise((r) => setTimeout(r, 10));
      }
      expect(waiting).toBe(true);
      expect(closed).toBe(false);
    } finally {
      release();
      await writer;
      await close;
    }
    const frozen = await db.billingFreezeLease.findFirstOrThrow({
      where: { leaseId: f.lease.id },
    });
    expect(frozen.labels).toMatchObject({
      tenant: "Committed before close cutoff",
    });
  });
  it("permits void after original issuer is disabled without changing historical issuer", async () => {
    const f = await closed();
    const d = await draft(f);
    const temporary = await db.user.create({
      data: {
        username: `issuer-${key()}`,
        email: `${key()}@example.test`,
        name: "Temporary issuer",
        passwordHash: "disabled synthetic",
        role: "ADMIN",
      },
    });
    const i = await issueInvoice(temporary, {
      invoiceId: d.id,
      expectedVersion: d.version,
      commandKey: key(),
    });
    await db.user.update({
      where: { id: temporary.id },
      data: { disabled: true, role: "STAFF" },
    });
    const v = await voidInvoice(admin, {
      invoiceId: i.id,
      expectedVersion: i.version,
      reason: "Correct cancellation",
      commandKey: key(),
    });
    expect(v.issuedById).toBe(temporary.id);
    expect(v.voidedById).toBe(admin.id);
  });
  it("retains unprepared and VOID lease reservations and overlays latest corrections under room caps", async () => {
    const f = await fixture({ complete: false });
    await db.lease.update({
      where: { id: f.lease.id },
      data: { status: "ENDED", endDate: new Date("2026-02-14") },
    });
    const tenant = await db.tenant.create({
      data: { name: "Next tenant", isDemo: true },
    });
    const next = await db.lease.create({
      data: {
        number: key(),
        roomId: f.room.id,
        tenantId: tenant.id,
        startDate: new Date("2026-02-15"),
        endDate: new Date("2026-12-31"),
        rent: "1000",
        deposit: "0",
        status: "ACTIVE",
        isDemo: true,
      },
    });
    const prior = await createBillingPeriod(admin, {
      propertyId: f.property.id,
      month: "2026-01",
    });
    const meter = await registerMeter(admin, {
      roomId: f.room.id,
      kind: "WATER",
      serial: key(),
      installedAt: "2026-01-01",
      openingReading: "0",
      reason: "Synthetic test",
    });
    const previous = await upsertDraftReading(staff, {
      meterId: meter.meter.id,
      billingPeriodId: prior.id,
      readingDate: "2026-01-31",
      value: "0",
    });
    await confirmReading(staff, previous.id);
    const current = await upsertDraftReading(staff, {
      meterId: meter.meter.id,
      billingPeriodId: f.period.id,
      readingDate: "2026-02-28",
      value: "10",
    });
    await confirmReading(staff, current.id);
    const rates = await db.utilityRate.findMany({
      where: { propertyId: f.property.id },
    });
    for (const rate of rates)
      await approveBillingRate(admin, {
        billingPeriodId: f.period.id,
        kind: rate.kind,
        utilityRateId: rate.id,
        reason: "Applicable rate",
      });
    for (const lease of [f.lease, next]) {
      await approveBillingConsumption(admin, {
        billingPeriodId: f.period.id,
        leaseId: lease.id,
        kind: "WATER",
        source: {
          kind: "ALLOCATED_ACTUAL",
          currentReadingId: current.id,
          quantity: lease.id === f.lease.id ? "4" : "6",
        },
        reason: "Evidence per lease",
        evidence: ["tenant handover record"],
      });
      await approveBillingConsumption(admin, {
        billingPeriodId: f.period.id,
        leaseId: lease.id,
        kind: "ELECTRICITY",
        source: {
          kind: "ESTIMATE",
          quantity: "1",
          sourceContext: "Approved estimate per lease",
        },
        reason: "Meter inaccessible",
        evidence: ["operator record"],
      });
    }
    await closeBillingPeriod(admin, f.period.id);
    const old = await issued(f);
    const correction = (invoice: typeof old, quantity: string) => ({
      invoiceId: invoice.id,
      expectedVersion: invoice.version,
      reason: "Quantity evidence correction",
      evidence: ["handover note"],
      correction: { utilities: [{ kind: "WATER", quantity }] },
      commandKey: key(),
    });
    await expect(
      reviseInvoice(admin, correction(old, "5")),
    ).rejects.toMatchObject({ code: "ALLOCATION_EXCEEDS_VERIFIED" });
    const nextDraft = await prepareDraft(staff, {
      billingPeriodId: f.period.id,
      leaseId: next.id,
      commandKey: key(),
    });
    const nextIssued = await issueInvoice(admin, {
      invoiceId: nextDraft.id,
      expectedVersion: nextDraft.version,
      commandKey: key(),
    });
    const oldReplacement = await reviseInvoice(admin, correction(old, "3"));
    const nextReplacement = await reviseInvoice(
      admin,
      correction(nextIssued, "7"),
    );
    expect(nextReplacement.status).toBe("ISSUED");
    await voidInvoice(admin, {
      invoiceId: oldReplacement.id,
      expectedVersion: oldReplacement.version,
      reason: "Standalone cancellation retains usage",
      commandKey: key(),
    });
    await expect(
      reviseInvoice(admin, correction(nextReplacement, "8")),
    ).rejects.toMatchObject({ code: "ALLOCATION_EXCEEDS_VERIFIED" });
    expect((await getInvoice(staff, nextReplacement.id)).status).toBe("ISSUED");
  });
  it("stores valid large contractual rent reference lines without decimal overflow", async () => {
    const f = await closed({ rent: "99999999999.00" });
    const d = await draft(f);
    const rent = await db.invoiceItem.findFirstOrThrow({
      where: { invoiceId: d.id, description: { startsWith: "RENT" } },
    });
    expect(rent.unitPrice.toFixed(4)).toBe("99999999999.0000");
    expect(
      (
        await issueInvoice(admin, {
          invoiceId: d.id,
          expectedVersion: d.version,
          commandKey: key(),
        })
      ).finalTotal,
    ).toBe("100000000049.01");
  });
  it("rejects same-rate and unchanged-contract no-op revisions without number or financial writes", async () => {
    const f = await closed();
    const invoice = await issued(f);
    if (!invoice.snapshot) throw new Error("snapshot missing");
    const counts = async () => ({
      invoices: await db.invoice.count({ where: { leaseId: f.lease.id } }),
      corrections: await db.invoiceCorrection.count({
        where: { originalInvoiceId: invoice.id },
      }),
      audits: await db.auditLog.count({ where: { entityId: invoice.id } }),
      counter: (
        await db.invoiceMonthCounter.findUniqueOrThrow({
          where: { month: "202602" },
        })
      ).value,
    });
    const before = await counts();
    const rate = invoice.snapshot.source.utilities.find(
      (u) => u.kind === "WATER",
    )?.rate;
    if (!rate) throw new Error("rate missing");
    for (const correction of [
      { useCurrentContract: true },
      { utilities: [{ kind: "WATER", utilityRateId: rate.id }] },
    ]) {
      const commandKey = key();
      await expect(
        reviseInvoice(admin, {
          invoiceId: invoice.id,
          expectedVersion: invoice.version,
          reason: "Unchanged source selection",
          evidence: ["review record"],
          correction,
          commandKey,
        }),
      ).rejects.toMatchObject({ code: "CORRECTION_UNCHANGED" });
      expect(
        await db.invoiceCommand.count({
          where: { actorId: admin.id, commandKey },
        }),
      ).toBe(0);
    }
    expect(await counts()).toEqual(before);
    expect(await getInvoice(staff, invoice.id)).toMatchObject({
      status: "ISSUED",
      version: invoice.version,
      number: invoice.number,
    });
  });
});
