import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client } from "pg";
import { db } from "../../src/server/db";
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
  configureDuePolicy,
  prepareDraft,
  issueInvoice,
} from "../../src/server/invoices";
import { createPayment, confirmPayment } from "../../src/server/payments";

const key = () => randomUUID();
let client: Client;
let fixture: Awaited<ReturnType<typeof createFixture>>;
async function createFixture() {
  const admin = await db.user.create({
    data: {
      username: `finite-${key()}`,
      email: `${key()}@synthetic.invalid`,
      name: "Synthetic finite operator",
      role: "ADMIN",
      passwordHash: "unusable-synthetic-hash",
    },
  });
  const property = await db.property.create({
    data: {
      code: `FIN-${key().replaceAll("-", "").slice(0, 24)}`,
      name: "Synthetic finite property",
    },
  });
  const floor = await db.floor.create({
    data: {
      propertyId: property.id,
      number: 1,
      name: "Synthetic finite floor",
    },
  });
  const room = await db.room.create({
    data: { floorId: floor.id, number: "FIN-101", rent: "1000.00" },
  });
  const tenant = await db.tenant.create({
    data: { name: "Synthetic finite tenant", isDemo: false },
  });
  const lease = await db.lease.create({
    data: {
      number: `FIN-${key().replaceAll("-", "").slice(0, 24)}`,
      roomId: room.id,
      tenantId: tenant.id,
      startDate: new Date("2026-01-01"),
      endDate: new Date("2026-12-31"),
      rent: "1000.00",
      deposit: "0.00",
      status: "ACTIVE",
      isDemo: false,
    },
  });
  const period = await createBillingPeriod(admin, {
    propertyId: property.id,
    month: "2026-02",
  });
  await configureDuePolicy(admin, {
    propertyId: property.id,
    expectedVersion: 0,
    offsetDays: 5,
    commandKey: key(),
  });
  for (const kind of ["WATER", "ELECTRICITY"] as const) {
    const rate = await createUtilityRate(admin, {
      propertyId: property.id,
      kind,
      effectiveFrom: "2026-01-01",
      unitPrice: "20.0000",
    });
    await approveBillingRate(admin, {
      billingPeriodId: period.id,
      kind,
      utilityRateId: rate.id,
      reason: "Synthetic finite fixture",
    });
    await approveBillingConsumption(admin, {
      billingPeriodId: period.id,
      leaseId: lease.id,
      kind,
      reason: "Synthetic finite fixture",
      evidence: ["synthetic-only"],
      source: {
        kind: "ESTIMATE",
        quantity: "1.000",
        sourceContext: "Synthetic finite fixture",
      },
    });
  }
  await closeBillingPeriod(admin, period.id);
  const draft = await prepareDraft(admin, {
    billingPeriodId: period.id,
    leaseId: lease.id,
    commandKey: key(),
  });
  const invoice = await issueInvoice(admin, {
    invoiceId: draft.id,
    expectedVersion: draft.version,
    commandKey: key(),
  });
  return { admin, lease, invoice };
}
beforeAll(async () => {
  const configured = process.env.DATABASE_URL;
  if (!configured)
    throw new Error("Explicit isolated finite-payment test database required");
  const url = new URL(configured);
  if (
    url.hostname !== "127.0.0.1" ||
    !/^taky_payment_test_[a-z0-9_]+$/.test(url.pathname.slice(1)) ||
    url.search ||
    url.hash
  )
    throw new Error("Isolated loopback payment database required");
  client = new Client({
    connectionString: configured,
    connectionTimeoutMillis: 10000,
    query_timeout: 15000,
  });
  await client.connect();
  const actual = (
    await client.query(
      "SELECT current_database() AS database,current_user AS role",
    )
  ).rows[0];
  expect(actual).toEqual({
    database: url.pathname.slice(1),
    role: decodeURIComponent(url.username),
  });
  const migrations = (
    await client.query(
      'SELECT migration_name FROM "_prisma_migrations" WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL ORDER BY migration_name',
    )
  ).rows.map((row) => row.migration_name);
  expect(migrations).toHaveLength(16);
  expect(migrations.at(-1)).toBe("202610240002_payment_finite_amounts");
  fixture = await createFixture();
});
afterAll(async () => {
  await client?.end();
  await db.$disconnect();
});
async function rawPayment(amount: string) {
  const id = key();
  await client.query(
    'INSERT INTO "Payment" (id,reference,"leaseId",amount,method,status,"receivedAt","updatedAt","legacyUnmapped","isDemo","methodCode",version,"recordedById") VALUES ($1,$2,$3,$4::numeric,\'CASH\',\'PENDING\',now(),now(),false,false,\'CASH\',1,$5)',
    [id, `FINITE-${id}`, fixture.lease.id, amount, fixture.admin.id],
  );
  return id;
}
async function rollback(work: () => Promise<void>) {
  await client.query("BEGIN");
  try {
    await work();
  } finally {
    await client.query("ROLLBACK");
  }
}
describe("finite payment database boundary", () => {
  it.each(["0.01", "100.00", "999999999999.99"])(
    "retains finite pending amount %s",
    async (amount) => {
      await rollback(async () => {
        const id = await rawPayment(amount);
        await client.query("SET CONSTRAINTS ALL IMMEDIATE");
        expect(
          (
            await client.query(
              'SELECT amount::text AS amount FROM "Payment" WHERE id=$1',
              [id],
            )
          ).rows[0]?.amount,
        ).toBe(amount);
      });
    },
  );
  it("rejects NaN at the named payment constraint", async () => {
    await rollback(async () => {
      await expect(rawPayment("NaN")).rejects.toMatchObject({
        code: "23514",
        constraint: "Payment_managed_amount_finite",
      });
    });
  });
  it.each(["Infinity", "-Infinity"])(
    "retains the numeric typmod rejection of %s",
    async (amount) => {
      await rollback(async () => {
        await expect(rawPayment(amount)).rejects.toMatchObject({
          code: "22003",
        });
      });
    },
  );
  it("rejects NaN allocation for an otherwise eligible managed invoice and payment", async () => {
    await rollback(async () => {
      const paymentId = await rawPayment("100.00");
      await expect(
        client.query(
          'INSERT INTO "PaymentAllocation" (id,"paymentId","invoiceId",amount,"updatedAt") VALUES ($1,$2,$3,\'NaN\'::numeric,now())',
          [key(), paymentId, fixture.invoice.id],
        ),
      ).rejects.toMatchObject({
        code: "23514",
        constraint: "Allocation_amount_finite",
      });
    });
  });
  it("preserves a real finite confirmation, receipt and explicit allocation", async () => {
    const pending = await createPayment(fixture.admin, {
      leaseId: fixture.lease.id,
      amount: "0.30",
      method: "CASH",
      receivedAt: "2026-10-24T10:00:00+07:00",
      commandKey: key(),
    });
    const confirmed = await confirmPayment(fixture.admin, {
      paymentId: pending.id,
      expectedVersion: pending.version,
      allocations: [
        {
          invoiceId: fixture.invoice.id,
          expectedVersion: fixture.invoice.version,
          amount: "0.30",
        },
      ],
      commandKey: key(),
    });
    expect(confirmed.status).toBe("CONFIRMED");
    expect(confirmed.amount).toBe("0.30");
    expect(confirmed.allocations.map((value) => value.amount)).toEqual([
      "0.30",
    ]);
    expect(confirmed.receipt).toBeTruthy();
  });
  it("keeps both checks validated and all trigger states origin-enabled", async () => {
    const constraints = await client.query(
      "SELECT conname,convalidated FROM pg_constraint WHERE conname=ANY($1::text[]) ORDER BY conname",
      [["Payment_managed_amount_finite", "Allocation_amount_finite"]],
    );
    expect(constraints.rows).toEqual([
      { conname: "Allocation_amount_finite", convalidated: true },
      { conname: "Payment_managed_amount_finite", convalidated: true },
    ]);
    expect(
      (
        await client.query(
          "SELECT count(*)::int AS count FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND t.tgenabled<>'O'",
        )
      ).rows[0]?.count,
    ).toBe(0);
  });
});
