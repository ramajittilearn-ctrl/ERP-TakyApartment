import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { Prisma } from "@prisma/client";
import { fingerprint, receiptMonth } from "../../src/server/payments/domain";
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
  voidInvoice,
  reviseInvoice,
} from "../../src/server/invoices";
import {
  createPayment,
  confirmPayment,
  cancelPendingPayment,
  reversePayment,
  getPayment,
  getReceipt,
  listOutstandingBalances,
  listPayments,
} from "../../src/server/payments";
let admin: Actor, staff: Actor;
const key = () => randomUUID();
beforeAll(async () => {
  const configured = process.env.DATABASE_URL;
  if (
    !configured ||
    !/^taky_payment_test_[a-z0-9_]+$/.test(
      new URL(configured).pathname.slice(1),
    )
  )
    throw new Error("Fresh isolated synthetic payment database required");
  const identity = await db.$queryRaw<
    { name: string }[]
  >`SELECT current_database() AS name`;
  expect(identity[0]?.name).toBe(new URL(configured).pathname.slice(1));
  admin = await db.user.create({
    data: {
      username: `payment-admin-${key()}`,
      email: `${key()}@synthetic.invalid`,
      name: "Synthetic Admin",
      passwordHash: "not-a-password",
      role: "ADMIN",
    },
  });
  staff = await db.user.create({
    data: {
      username: `payment-staff-${key()}`,
      email: `${key()}@synthetic.invalid`,
      name: "Synthetic Staff",
      passwordHash: "not-a-password",
      role: "STAFF",
    },
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
    data: { name: "Historical tenant", isDemo: false },
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
      isDemo: false,
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

async function payment(
  f: Awaited<ReturnType<typeof fixture>>,
  amount = "100.00",
  method: "CASH" | "BANK_TRANSFER" = "CASH",
) {
  return createPayment(staff, {
    leaseId: f.lease.id,
    amount,
    method,
    receivedAt: "2026-10-23T10:00:00+07:00",
    ...(method === "BANK_TRANSFER"
      ? { externalReference: key(), receivingAccountKey: "synthetic-bank" }
      : {}),
    commandKey: key(),
  });
}
async function confirm(
  p: Awaited<ReturnType<typeof payment>>,
  invoice: Awaited<ReturnType<typeof issued>>,
  amount = p.amount,
  extra = {},
) {
  return confirmPayment(admin, {
    paymentId: p.id,
    expectedVersion: p.version,
    allocations: [
      { invoiceId: invoice.id, expectedVersion: invoice.version, amount },
    ],
    commandKey: key(),
    ...extra,
  });
}

async function directConfirmation(
  p: Awaited<ReturnType<typeof payment>>,
  invoice: Awaited<ReturnType<typeof issued>>,
  mutate?: (snapshot: Record<string, unknown>) => void,
  paymentMutation: {
    legacyUnmapped?: boolean;
    isDemo?: boolean;
    externalReference?: string;
    receivingAccountKey?: string;
  } = {},
) {
  const source = await db.invoice.findUniqueOrThrow({
    where: { id: invoice.id },
    include: { frozenLease: true },
  });
  if (!source.frozenLease) throw new Error("Missing synthetic frozen lease");
  const issuedAt = new Date();
  const month = receiptMonth(issuedAt);
  const counter = await db.$queryRaw<
    { value: number }[]
  >`INSERT INTO "ReceiptMonthCounter" (month,value) VALUES (${month},1) ON CONFLICT (month) DO UPDATE SET value="ReceiptMonthCounter".value+1 RETURNING value`;
  let number = `REC-${month}-${String(counter[0]?.value).padStart(4, "0")}`;
  const snapshot: Record<string, unknown> = {
    schemaVersion: "receipt.v1",
    paymentId: p.id,
    reference: p.reference,
    amount: p.amount,
    method: p.method,
    receivedAt: p.receivedAt,
    externalReference: p.externalReference,
    issuedAt: issuedAt.toISOString(),
    issuedBy: { id: admin.id, name: admin.name },
    number,
    invoices: [
      {
        invoiceId: invoice.id,
        number: invoice.number,
        frozenLeaseId: source.frozenLease.id,
        frozenTenantId: source.frozenLease.tenantId,
        labels: source.frozenLease.labels,
        finalTotal: invoice.finalTotal,
        allocatedAmount: p.amount,
      },
    ],
  };
  mutate?.(snapshot);
  if (typeof snapshot.number === "string") number = snapshot.number;
  return async () =>
    db.$transaction(
      async (tx) => {
        await tx.$executeRaw`INSERT INTO "PaymentAllocation" (id,"paymentId","invoiceId",amount,"createdAt","updatedAt") VALUES (${key()}::uuid,${p.id}::uuid,${invoice.id}::uuid,${p.amount}::numeric,now(),now())`;
        await tx.$executeRaw`INSERT INTO "Receipt" (id,number,"paymentId","issuedAt","issuedById","snapshotVersion",snapshot,fingerprint) VALUES (${key()}::uuid,${number},${p.id}::uuid,${issuedAt},${admin.id}::uuid,'receipt.v1',${JSON.stringify(snapshot)}::jsonb,${fingerprint(snapshot)})`;
        await tx.$executeRaw`UPDATE "Payment" SET status='CONFIRMED',version=version+1,"confirmedById"=${admin.id}::uuid,"confirmedAt"=${issuedAt},"legacyUnmapped"=${paymentMutation.legacyUnmapped ?? false},"isDemo"=${paymentMutation.isDemo ?? false},"externalReference"=${paymentMutation.externalReference ?? p.externalReference},"receivingAccountKey"=${paymentMutation.receivingAccountKey ?? p.receivingAccountKey} WHERE id=${p.id}::uuid`;
      },
      { timeout: 15000 },
    );
}
describe("Stage 3D managed payment lifecycle", () => {
  it("confirms partial and full settlements, preserves pending balance, then reverses and voids immutable history", async () => {
    const f = await closed();
    const invoice = await issued(f);
    const p = await payment(f);
    expect(p.receipt).toBeNull();
    expect(p.allocations).toEqual([]);
    const balance = () =>
      listOutstandingBalances(staff, { leaseId: f.lease.id });
    expect((await balance()).items[0]?.outstanding).toBe(invoice.finalTotal);
    const first = await confirm(p, invoice);
    expect(first.status).toBe("CONFIRMED");
    expect(first.receipt).not.toBeNull();
    expect((await balance()).items[0]?.outstanding).toBe(
      new Prisma.Decimal(invoice.finalTotal ?? "0").minus("100").toFixed(2),
    );
    await expect(
      voidInvoice(admin, {
        invoiceId: invoice.id,
        expectedVersion: invoice.version,
        reason: "Synthetic void",
        commandKey: key(),
      }),
    ).rejects.toMatchObject({ code: "INVOICE_HAS_PAYMENTS" });
    await expect(
      reviseInvoice(admin, {
        invoiceId: invoice.id,
        expectedVersion: invoice.version,
        reason: "Synthetic revision",
        evidence: ["synthetic"],
        correction: { useCurrentContract: true },
        commandKey: key(),
      }),
    ).rejects.toMatchObject({ code: "INVOICE_HAS_PAYMENTS" });
    const receipt = await getReceipt(staff, first.receipt?.id ?? "");
    const reversed = await reversePayment(admin, {
      paymentId: first.id,
      expectedVersion: first.version,
      reason: "Synthetic correction",
      commandKey: key(),
    });
    expect(reversed.status).toBe("REVERSED");
    const cancelled = await getReceipt(staff, receipt.id);
    expect(cancelled.snapshot).toEqual(receipt.snapshot);
    expect(cancelled.number).toBe(receipt.number);
    expect(cancelled.cancellation?.reversalId).toBe(reversed.reversal?.id);
    expect(reversed.allocations).toEqual(first.allocations);
    expect((await balance()).items[0]?.outstanding).toBe(invoice.finalTotal);
    const full = await payment(f, invoice.finalTotal ?? "0.00");
    const fullConfirmed = await confirm(full, invoice);
    expect((await balance()).items[0]?.outstanding).toBe("0.00");
    await reversePayment(admin, {
      paymentId: full.id,
      expectedVersion: fullConfirmed.version,
      reason: "Synthetic final reverse",
      commandKey: key(),
    });
    await voidInvoice(admin, {
      invoiceId: invoice.id,
      expectedVersion: invoice.version,
      reason: "Synthetic void after reversal",
      commandKey: key(),
    });
    expect((await balance()).items[0]?.outstanding).toBe("0.00");
    expect((await getReceipt(staff, receipt.id)).snapshot).toEqual(
      receipt.snapshot,
    );
  });
  it("keeps same-key replay stable after transition and rejects changed bodies or operations", async () => {
    const f = await closed();
    const invoice = await issued(f);
    const input = {
      leaseId: f.lease.id,
      amount: "1.00",
      method: "CASH",
      receivedAt: "2026-10-23T10:00:00+07:00",
      commandKey: key(),
    };
    const [a, b] = await Promise.all([
      createPayment(staff, input),
      createPayment(staff, input),
    ]);
    expect(a).toEqual(b);
    const confirmation = {
      paymentId: a.id,
      expectedVersion: a.version,
      allocations: [
        {
          invoiceId: invoice.id,
          expectedVersion: invoice.version,
          amount: a.amount,
        },
      ],
      commandKey: key(),
    };
    const [confirmed, replay] = await Promise.all([
      confirmPayment(admin, confirmation),
      confirmPayment(admin, confirmation),
    ]);
    expect(confirmed).toEqual(replay);
    expect(await db.receipt.count({ where: { paymentId: a.id } })).toBe(1);
    expect(await createPayment(staff, input)).toEqual(a);
    const adminInput = { ...input, commandKey: key() };
    const adminDraft = await createPayment(admin, adminInput);
    await expect(
      cancelPendingPayment(admin, {
        paymentId: adminDraft.id,
        expectedVersion: adminDraft.version,
        reason: "Synthetic operation mismatch",
        commandKey: adminInput.commandKey,
      }),
    ).rejects.toMatchObject({ code: "IDEMPOTENCY_CONFLICT" });
    const actorScoped = await createPayment(admin, input);
    expect(actorScoped.id).not.toBe(a.id);
    await expect(
      createPayment(staff, { ...input, amount: "2.00" }),
    ).rejects.toMatchObject({ code: "IDEMPOTENCY_CONFLICT" });
    await expect(
      cancelPendingPayment(staff, {
        paymentId: a.id,
        expectedVersion: 1,
        reason: "Synthetic",
        commandKey: input.commandKey,
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
  it("rejects STAFF transitions, disabled actors, stale versions and demo leases", async () => {
    const f = await closed();
    const invoice = await issued(f);
    const p = await payment(f);
    const args = {
      paymentId: p.id,
      expectedVersion: p.version,
      reason: "Synthetic",
      commandKey: key(),
    };
    await expect(cancelPendingPayment(staff, args)).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    await expect(reversePayment(staff, args)).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    await expect(
      confirmPayment(staff, {
        paymentId: p.id,
        expectedVersion: 1,
        allocations: [
          {
            invoiceId: invoice.id,
            expectedVersion: invoice.version,
            amount: p.amount,
          },
        ],
        commandKey: key(),
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      cancelPendingPayment(admin, { ...args, expectedVersion: 2 }),
    ).rejects.toMatchObject({ code: "STALE_VERSION" });
    await db.user.update({ where: { id: staff.id }, data: { disabled: true } });
    await expect(getPayment(staff, p.id)).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    await db.user.update({
      where: { id: staff.id },
      data: { disabled: false },
    });
    await db.tenant.update({
      where: { id: f.tenant.id },
      data: { isDemo: true },
    });
    await expect(payment(f)).rejects.toMatchObject({
      code: "LEGACY_MAPPING_REQUIRED",
    });
  });
  it("enforces exact allocation sums, same lease and simultaneous invoice caps", async () => {
    const f = await closed();
    const invoice = await issued(f);
    const p = await payment(f, "600.00", "BANK_TRANSFER");
    const q = await payment(f, "600.00", "BANK_TRANSFER");
    await expect(confirm(p, invoice, "599.99")).rejects.toMatchObject({
      code: "PAYMENT_NOT_FULLY_ALLOCATED",
    });
    const other = await closed();
    const otherInvoice = await issued(other);
    await expect(confirm(p, otherInvoice)).rejects.toMatchObject({
      code: "INVOICE_NOT_PAYABLE",
    });
    const results = await Promise.allSettled([
      confirm(p, invoice),
      confirm(q, invoice, undefined, {
        duplicateOverrideReason: "Synthetic race review",
      }),
    ]);
    expect(results.filter((x) => x.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((x) => x.status === "rejected")).toHaveLength(1);
    const balance = (
      await listOutstandingBalances(admin, { leaseId: f.lease.id })
    ).items[0];
    expect(balance?.activePaid).toBe("600.00");
  });
  it("requires audited cash duplicate review and releases cancelled bank reference", async () => {
    const f = await closed();
    const invoice = await issued(f);
    const p = await payment(f);
    await confirm(p, invoice);
    const q = await payment(f);
    await expect(confirm(q, invoice)).rejects.toMatchObject({
      code: "CASH_DUPLICATE_REVIEW_REQUIRED",
    });
    const confirmed = await confirm(q, invoice, undefined, {
      duplicateOverrideReason: "Synthetic distinct cash collection",
    });
    expect(confirmed.status).toBe("CONFIRMED");
    const audit = await db.auditLog.findFirstOrThrow({
      where: { entityId: q.id, action: "CASH_DUPLICATE_OVERRIDE" },
    });
    expect(audit.metadata).toMatchObject({ candidateIds: [p.id] });
    const input = {
      leaseId: f.lease.id,
      amount: "1.00",
      method: "BANK_TRANSFER",
      receivedAt: "2026-10-23T10:00:00+07:00",
      externalReference: `ref-${key()}`,
      receivingAccountKey: "synthetic",
      commandKey: key(),
    };
    const bank = await createPayment(staff, input);
    await expect(
      createPayment(staff, { ...input, commandKey: key() }),
    ).rejects.toMatchObject({ code: "DUPLICATE_PAYMENT_REFERENCE" });
    await cancelPendingPayment(admin, {
      paymentId: bank.id,
      expectedVersion: 1,
      reason: "Synthetic cancellation",
      commandKey: key(),
    });
    const replacement = await createPayment(staff, {
      ...input,
      commandKey: key(),
    });
    expect(replacement.status).toBe("PENDING");
    const settled = await confirm(replacement, invoice);
    await reversePayment(admin, {
      paymentId: settled.id,
      expectedVersion: settled.version,
      reason: "Synthetic bank reversal",
      commandKey: key(),
    });
    expect(
      (await createPayment(staff, { ...input, commandKey: key() })).status,
    ).toBe("PENDING");
    expect(
      (
        await createPayment(staff, {
          ...input,
          receivingAccountKey: "synthetic-other-account",
          commandKey: key(),
        })
      ).status,
    ).toBe("PENDING");
    expect(
      (
        await createPayment(staff, {
          ...input,
          externalReference: input.externalReference.toUpperCase(),
          commandKey: key(),
        })
      ).status,
    ).toBe("PENDING");
    const boundary = await createPayment(staff, {
      leaseId: f.lease.id,
      amount: p.amount,
      method: "CASH",
      receivedAt: "2026-10-23T17:00:00.000Z",
      commandKey: key(),
    });
    expect((await confirm(boundary, invoice)).status).toBe("CONFIRMED");
  });
  it("serializes pending cancellation versus confirmation and receipts across leases", async () => {
    const f = await closed();
    const invoice = await issued(f);
    const p = await payment(f);
    const result = await Promise.allSettled([
      confirm(p, invoice),
      cancelPendingPayment(admin, {
        paymentId: p.id,
        expectedVersion: 1,
        reason: "Synthetic race",
        commandKey: key(),
      }),
    ]);
    expect(result.filter((x) => x.status === "fulfilled")).toHaveLength(1);
    const rows = [await closed(), await closed()];
    const invoices = [await issued(rows[0]), await issued(rows[1])];
    const payments = [await payment(rows[0]), await payment(rows[1])];
    const confirmed = await Promise.all(
      payments.map((p, i) => {
        const inv = invoices[i];
        if (!inv) throw new Error("Missing fixture");
        return confirm(p, inv);
      }),
    );
    expect(new Set(confirmed.map((p) => p.receipt?.number)).size).toBe(2);
  });
  it("rejects direct mutation, scope toggles, orphan children and incomplete final confirmation", async () => {
    const f = await closed();
    const invoice = await issued(f);
    const p = await payment(f);
    const confirmed = await confirm(p, invoice);
    await expect(
      db.payment.update({
        where: { id: p.id },
        data: { legacyUnmapped: true },
      }),
    ).rejects.toThrow();
    await expect(
      db.payment.update({
        where: { id: p.id },
        data: {
          status: "REVERSED",
          version: 3,
          reversedAt: new Date(),
          externalReference: "forged",
        },
      }),
    ).rejects.toThrow();
    await expect(
      db.paymentAllocation.updateMany({
        where: { paymentId: p.id },
        data: { amount: "99.00" },
      }),
    ).rejects.toThrow();
    await expect(
      db.receipt.update({
        where: { id: confirmed.receipt?.id },
        data: { fingerprint: "0".repeat(64) },
      }),
    ).rejects.toThrow();
    await expect(db.payment.delete({ where: { id: p.id } })).rejects.toThrow();
    const pending = await payment(f);
    for (const mutation of [{ legacyUnmapped: true }, { isDemo: true }]) {
      const direct = await directConfirmation(
        pending,
        invoice,
        undefined,
        mutation,
      );
      await expect(direct()).rejects.toThrow();
      expect((await getPayment(admin, pending.id)).status).toBe("PENDING");
    }
    const bankPending = await payment(f, "102.00", "BANK_TRANSFER");
    const editedAccount = await directConfirmation(
      bankPending,
      invoice,
      undefined,
      { receivingAccountKey: "synthetic-forged-account" },
    );
    await expect(editedAccount()).rejects.toThrow();
    const editedReference = await directConfirmation(
      bankPending,
      invoice,
      (snapshot) => {
        snapshot.externalReference = "synthetic-forged-reference";
      },
      { externalReference: "synthetic-forged-reference" },
    );
    await expect(editedReference()).rejects.toThrow();
    expect((await getPayment(admin, bankPending.id)).status).toBe("PENDING");
    await expect(
      db.payment.update({
        where: { id: pending.id },
        data: {
          status: "CONFIRMED",
          version: 2,
          confirmedById: admin.id,
          confirmedAt: new Date(),
        },
      }),
    ).rejects.toThrow();
    await expect(
      db.paymentReversal.create({
        data: {
          paymentId: p.id,
          actorId: admin.id,
          reason: "Orphan synthetic reversal",
        },
      }),
    ).rejects.toThrow();
    expect((await getPayment(admin, p.id)).status).toBe("CONFIRMED");
  });
  it("settles multiple invoices on one lease with explicit amounts", async () => {
    const f = await closed();
    const first = await issued(f);
    const period = await createBillingPeriod(admin, {
      propertyId: f.property.id,
      month: "2026-03",
    });
    for (const kind of ["WATER", "ELECTRICITY"] as const) {
      const rate = await db.utilityRate.findFirstOrThrow({
        where: { propertyId: f.property.id, kind },
      });
      await approveBillingRate(admin, {
        billingPeriodId: period.id,
        kind,
        utilityRateId: rate.id,
        reason: "Synthetic rate",
      });
      await approveBillingConsumption(admin, {
        billingPeriodId: period.id,
        leaseId: f.lease.id,
        kind,
        reason: "Synthetic estimate",
        evidence: ["synthetic"],
        source: {
          kind: "ESTIMATE",
          quantity: "1.000",
          sourceContext: "Synthetic",
        },
      });
    }
    await closeBillingPeriod(admin, period.id);
    const draft = await prepareDraft(staff, {
      billingPeriodId: period.id,
      leaseId: f.lease.id,
      commandKey: key(),
    });
    const second = await issueInvoice(admin, {
      invoiceId: draft.id,
      expectedVersion: draft.version,
      commandKey: key(),
    });
    const p = await payment(f, "300.00");
    const confirmed = await confirmPayment(admin, {
      paymentId: p.id,
      expectedVersion: 1,
      allocations: [
        {
          invoiceId: first.id,
          expectedVersion: first.version,
          amount: "100.00",
        },
        {
          invoiceId: second.id,
          expectedVersion: second.version,
          amount: "200.00",
        },
      ],
      commandKey: key(),
    });
    expect(confirmed.allocations).toHaveLength(2);
    const receipt = await getReceipt(admin, confirmed.receipt?.id ?? "");
    expect(
      receipt.snapshot.invoices.map((x) => x.allocatedAmount).sort(),
    ).toEqual(["100.00", "200.00"]);
  });
  it.each([
    "after-allocation",
    "after-receipt",
    "after-audit",
    "after-command",
  ])("rolls back all financial rows and numbering %s", async (stage) => {
    const f = await closed();
    const invoice = await issued(f);
    const p = await payment(f);
    const month = receiptMonth(new Date());
    const before = await db.receiptMonthCounter.findUnique({
      where: { month },
    });
    const table =
      stage === "after-allocation"
        ? "Receipt"
        : stage === "after-receipt"
          ? "AuditLog"
          : "PaymentCommand";
    const column =
      table === "Receipt"
        ? 'NEW."paymentId"'
        : table === "AuditLog"
          ? 'NEW."entityId"'
          : "(NEW.result->>'id')::uuid";
    await db.$executeRawUnsafe(
      `CREATE FUNCTION payment_test_fail() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Synthetic payment failure'; END $$`,
    );
    const declaration =
      stage === "after-command"
        ? `CREATE CONSTRAINT TRIGGER payment_test_failure AFTER INSERT ON "${table}" DEFERRABLE INITIALLY DEFERRED`
        : `CREATE TRIGGER payment_test_failure BEFORE INSERT ON "${table}"`;
    await db.$executeRawUnsafe(
      `${declaration} FOR EACH ROW WHEN (${column}='${p.id}'::uuid) EXECUTE FUNCTION payment_test_fail()`,
    );
    try {
      await expect(confirm(p, invoice)).rejects.toThrow();
    } finally {
      await db.$executeRawUnsafe(
        `DROP TRIGGER payment_test_failure ON "${table}"`,
      );
      await db.$executeRawUnsafe("DROP FUNCTION payment_test_fail()");
    }
    expect((await getPayment(admin, p.id)).status).toBe("PENDING");
    expect(
      await db.paymentAllocation.count({ where: { paymentId: p.id } }),
    ).toBe(0);
    expect(await db.receipt.count({ where: { paymentId: p.id } })).toBe(0);
    expect(
      await db.auditLog.count({
        where: { entityId: p.id, action: "CONFIRM_PAYMENT" },
      }),
    ).toBe(0);
    expect(
      await db.paymentCommand.count({
        where: {
          operation: "CONFIRM_PAYMENT",
          result: { path: ["id"], equals: p.id },
        },
      }),
    ).toBe(0);
    expect(
      await db.receiptMonthCounter.findUnique({ where: { month } }),
    ).toEqual(before);
  });
  it("rejects a correctly hashed receipt with false tenant/allocation content at commit", async () => {
    const f = await closed();
    const invoice = await issued(f);
    const p = await payment(f);
    const direct = await directConfirmation(p, invoice, (snapshot) => {
      snapshot.invoices = [
        {
          invoiceId: key(),
          number: "INV-202602-9999",
          frozenLeaseId: key(),
          frozenTenantId: key(),
          labels: {
            property: "Synthetic false property",
            tenant: "Synthetic wrong tenant",
            room: "wrong",
          },
          finalTotal: "999.00",
          allocatedAmount: "100.00",
        },
      ];
    });
    await expect(direct()).rejects.toThrow();
    expect((await getPayment(admin, p.id)).status).toBe("PENDING");
    expect(await db.receipt.count({ where: { paymentId: p.id } })).toBe(0);
  });
  it("prevents direct SQL concurrent confirmations exceeding an invoice cap", async () => {
    const f = await closed();
    const invoice = await issued(f);
    const p = await payment(f, "600.00");
    const q = await payment(f, "600.00");
    const a = await directConfirmation(p, invoice);
    const b = await directConfirmation(q, invoice);
    const result = await Promise.allSettled([a(), b()]);
    expect(result.filter((x) => x.status === "fulfilled")).toHaveLength(1);
    expect(result.filter((x) => x.status === "rejected")).toHaveLength(1);
    expect(
      (await listOutstandingBalances(admin, { leaseId: f.lease.id })).items[0]
        ?.activePaid,
    ).toBe("600.00");
  });
  it("keeps direct SQL confirmation versus direct VOID mutually exclusive", async () => {
    const f = await closed();
    const invoice = await issued(f);
    const p = await payment(f);
    const direct = await directConfirmation(p, invoice);
    const result = await Promise.allSettled([
      direct(),
      db.$executeRaw`UPDATE "Invoice" SET status='VOID',version=version+1,"voidedById"=${admin.id}::uuid,"voidedAt"=now(),"voidReason"='Synthetic direct SQL race' WHERE id=${invoice.id}::uuid`,
    ]);
    expect(result.filter((x) => x.status === "fulfilled")).toHaveLength(1);
    const final = await db.invoice.findUniqueOrThrow({
      where: { id: invoice.id },
    });
    const pay = await getPayment(admin, p.id);
    expect(final.status === "VOID" && pay.status === "CONFIRMED").toBe(false);
  });
  it("rejects confirmation after void or revision won first without losing pending draft", async () => {
    const f = await closed();
    const invoice = await issued(f);
    const p = await payment(f);
    await voidInvoice(admin, {
      invoiceId: invoice.id,
      expectedVersion: invoice.version,
      reason: "Synthetic void first",
      commandKey: key(),
    });
    await expect(confirm(p, invoice)).rejects.toMatchObject({
      code: "INVOICE_NOT_PAYABLE",
    });
    expect((await getPayment(admin, p.id)).status).toBe("PENDING");
    const g = await closed();
    const original = await issued(g);
    const q = await payment(g);
    await db.lease.update({
      where: { id: g.lease.id },
      data: { rent: "1001.00" },
    });
    await reviseInvoice(admin, {
      invoiceId: original.id,
      expectedVersion: original.version,
      reason: "Synthetic revision first",
      evidence: ["synthetic contract correction"],
      correction: { useCurrentContract: true },
      commandKey: key(),
    });
    await expect(confirm(q, original)).rejects.toMatchObject({
      code: "INVOICE_NOT_PAYABLE",
    });
    expect((await getPayment(admin, q.id)).status).toBe("PENDING");
  });
  it("rejects receipt suffix 0000 and matches SQL canonical SHA for Thai text", async () => {
    const sample = {
      z: ["ภาษาไทย", '"\\\n', null],
      a: { second: "2.00", first: true },
    };
    const hash = await db.$queryRaw<
      { hash: string }[]
    >`SELECT encode(sha256(convert_to(payment_canonical_json(${JSON.stringify(sample)}::jsonb),'UTF8')),'hex') AS hash`;
    expect(hash[0]?.hash).toBe(fingerprint(sample));
    const f = await closed();
    const invoice = await issued(f);
    const p = await payment(f);
    const direct = await directConfirmation(p, invoice, (snapshot) => {
      if (typeof snapshot.number !== "string")
        throw new Error("Missing number");
      snapshot.number = snapshot.number.slice(0, -4) + "0000";
    });
    await expect(direct()).rejects.toThrow();
    expect((await getPayment(admin, p.id)).status).toBe("PENDING");
  });
  it("preserves legacy rows as read-only and excludes their amounts from managed reads", async () => {
    const historical = await db.payment.findMany({
      where: { legacyUnmapped: true },
    });
    expect(historical).toHaveLength(3);
    for (const row of historical) {
      expect(row.method).toBe("historical-cheque");
      expect(row.methodCode).toBeNull();
      expect(row.amount.toFixed(2)).toBe("123.45");
      await expect(getPayment(admin, row.id)).rejects.toMatchObject({
        code: "PAYMENT_NOT_FOUND",
      });
      await expect(
        db.payment.update({
          where: { id: row.id },
          data: { legacyUnmapped: false, version: 2 },
        }),
      ).rejects.toThrow();
      await expect(
        db.payment.delete({ where: { id: row.id } }),
      ).rejects.toThrow();
      await expect(
        db.paymentReversal.create({
          data: {
            paymentId: row.id,
            reason: "Synthetic legacy forgery",
            actorId: admin.id,
          },
        }),
      ).rejects.toThrow();
    }
    const leaseId = historical[0]?.leaseId;
    if (!leaseId) throw new Error("Missing legacy fixture");
    expect((await listPayments(admin, { leaseId })).items).toEqual([]);
    expect((await listOutstandingBalances(admin, { leaseId })).items).toEqual(
      [],
    );
  });
  it("retains receipt issuer display name after rename and reversal", async () => {
    const f = await closed();
    const invoice = await issued(f);
    const p = await payment(f);
    const confirmed = await confirm(p, invoice);
    const receipt = await getReceipt(admin, confirmed.receipt?.id ?? "");
    await db.user.update({
      where: { id: admin.id },
      data: { name: "Synthetic renamed admin" },
    });
    try {
      await reversePayment(admin, {
        paymentId: p.id,
        expectedVersion: confirmed.version,
        reason: "Synthetic historical rename",
        commandKey: key(),
      });
      expect((await getReceipt(admin, receipt.id)).snapshot).toEqual(
        receipt.snapshot,
      );
    } finally {
      await db.user.update({
        where: { id: admin.id },
        data: { name: admin.name },
      });
    }
  });
  it("rejects standalone orphan receipt and mismatched cancellation links", async () => {
    const f = await closed();
    const invoice = await issued(f);
    const p = await payment(f);
    const q = await payment(f, "101.00");
    const a = await confirm(p, invoice);
    const b = await confirm(q, invoice);
    await expect(
      db.$transaction(async (tx) => {
        const reversal = await tx.paymentReversal.create({
          data: {
            paymentId: p.id,
            actorId: admin.id,
            reason: "Synthetic mismatched reversal",
          },
        });
        await tx.receiptCancellation.create({
          data: {
            receiptId: b.receipt?.id ?? "",
            reversalId: reversal.id,
            actorId: admin.id,
            reason: reversal.reason,
          },
        });
      }),
    ).rejects.toThrow();
    const receipt = await getReceipt(admin, a.receipt?.id ?? "");
    const pending = await payment(f, "102.00");
    const month = receiptMonth(new Date());
    const counter = await db.$queryRaw<
      { value: number }[]
    >`INSERT INTO "ReceiptMonthCounter" (month,value) VALUES (${month},1) ON CONFLICT (month) DO UPDATE SET value="ReceiptMonthCounter".value+1 RETURNING value`;
    const number = `REC-${month}-${String(counter[0]?.value).padStart(4, "0")}`;
    const issuedAt = new Date();
    const snapshot = {
      ...receipt.snapshot,
      paymentId: pending.id,
      reference: pending.reference,
      amount: pending.amount,
      number,
      issuedAt: issuedAt.toISOString(),
    };
    await expect(
      db.receipt.create({
        data: {
          paymentId: pending.id,
          number,
          issuedById: admin.id,
          issuedAt,
          snapshotVersion: "receipt.v1",
          snapshot,
          fingerprint: fingerprint(snapshot),
        },
      }),
    ).rejects.toThrow();
    expect((await getPayment(admin, p.id)).status).toBe("CONFIRMED");
    expect((await getPayment(admin, q.id)).status).toBe("CONFIRMED");
    expect((await getPayment(admin, pending.id)).receipt).toBeNull();
  });
  it("fails monthly sequence exhaustion without changing payment or allocations", async () => {
    const f = await closed();
    const invoice = await issued(f);
    const p = await payment(f);
    await db.$executeRaw`INSERT INTO "ReceiptMonthCounter" (month,value) VALUES ('209912',9999) ON CONFLICT (month) DO NOTHING`;
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2099-12-01T00:00:00.000Z"));
    try {
      await expect(confirm(p, invoice)).rejects.toMatchObject({
        code: "RECEIPT_SEQUENCE_EXHAUSTED",
      });
    } finally {
      vi.useRealTimers();
    }
    expect((await getPayment(admin, p.id)).status).toBe("PENDING");
    expect(
      await db.paymentAllocation.count({ where: { paymentId: p.id } }),
    ).toBe(0);
  });
  it("proves global managed-payment invariants with live database queries", async () => {
    const violations = await db.$queryRaw<
      { count: bigint }[]
    >`SELECT count(*) AS count FROM "Payment" p WHERE NOT p."legacyUnmapped" AND NOT p."isDemo" AND ((p.status IN ('CONFIRMED','REVERSED') AND ((SELECT coalesce(sum(a.amount),0) FROM "PaymentAllocation" a WHERE a."paymentId"=p.id)<>p.amount OR (SELECT count(*) FROM "Receipt" r WHERE r."paymentId"=p.id)<>1)) OR (p.status='REVERSED' AND (SELECT count(*) FROM "PaymentReversal" v JOIN "ReceiptCancellation" c ON c."reversalId"=v.id JOIN "Receipt" r ON r.id=c."receiptId" AND r."paymentId"=p.id WHERE v."paymentId"=p.id)<>1))`;
    expect(violations[0]?.count).toBe(0n);
    const invalid = await db.$queryRaw<
      { count: bigint }[]
    >`SELECT count(*) AS count FROM "Invoice" i WHERE i.status='VOID' AND EXISTS(SELECT 1 FROM "PaymentAllocation" a JOIN "Payment" p ON p.id=a."paymentId" WHERE a."invoiceId"=i.id AND p.status='CONFIRMED')`;
    expect(invalid[0]?.count).toBe(0n);
    const caps = await db.$queryRaw<
      { count: bigint }[]
    >`SELECT count(*) AS count FROM (SELECT i.id,i."finalTotal",coalesce(sum(a.amount) FILTER (WHERE p.status='CONFIRMED' AND NOT p."legacyUnmapped" AND NOT p."isDemo"),0) AS paid FROM "Invoice" i LEFT JOIN "PaymentAllocation" a ON a."invoiceId"=i.id LEFT JOIN "Payment" p ON p.id=a."paymentId" WHERE i."billingPeriodId" IS NOT NULL AND NOT i."isDemo" GROUP BY i.id) q WHERE q.paid<0 OR q.paid>q."finalTotal"`;
    expect(caps[0]?.count).toBe(0n);
    const unissued = await db.$queryRaw<
      { count: bigint }[]
    >`SELECT count(*) AS count FROM "Payment" p WHERE NOT p."legacyUnmapped" AND p.status IN ('PENDING','CANCELLED') AND (EXISTS(SELECT 1 FROM "Receipt" r WHERE r."paymentId"=p.id) OR EXISTS(SELECT 1 FROM "PaymentAllocation" a WHERE a."paymentId"=p.id))`;
    expect(unissued[0]?.count).toBe(0n);
  });
});
