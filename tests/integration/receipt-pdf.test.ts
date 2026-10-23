import { randomBytes, randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { db } from "../../src/server/db";
import { tokenHash } from "../../src/server/auth";
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
  configureDuePolicy,
  prepareDraft,
  issueInvoice,
} from "../../src/server/invoices";
import {
  createPayment,
  confirmPayment,
  getReceipt,
  reversePayment,
} from "../../src/server/payments";

const cookie = vi.hoisted((): { token?: string } => ({}));
// Real stored sessions, permissions, finance and PDF renderer; only Next's cookie transport is replaced.
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) =>
      name === "taky_session" && cookie.token
        ? { value: cookie.token }
        : undefined,
  }),
}));
vi.mock("@/server/http", async () => import("../../src/server/http"));
vi.mock("@/server/payments", async () => import("../../src/server/payments"));
vi.mock(
  "@/server/payments/pdf",
  async () => import("../../src/server/payments/pdf"),
);
import { GET } from "../../src/app/api/v1/receipts/[id]/pdf/route";

const key = () => randomUUID();
let admin: Actor, staff: Actor;
let adminToken: string, staffToken: string;
let propertyId: string, tenantId: string;
let confirmed: Awaited<ReturnType<typeof confirmPayment>>;
let receiptId: string;

async function createUser(role: "ADMIN" | "STAFF") {
  return db.user.create({
    data: {
      username: `receipt-pdf-${key()}`,
      email: `${key()}@synthetic.invalid`,
      name: `Synthetic PDF ${role}`,
      role,
      passwordHash: "synthetic-not-a-password",
    },
  });
}
async function session(userId: string, expired = false) {
  const token = randomBytes(32).toString("hex");
  await db.session.create({
    data: {
      userId,
      tokenHash: tokenHash(token),
      expiresAt: new Date(Date.now() + (expired ? -60000 : 3600000)),
    },
  });
  return token;
}
function request(id = receiptId, query = "") {
  return GET(
    new Request(
      `http://receipt-pdf.synthetic.invalid/api/v1/receipts/${id}/pdf/${query}`,
    ),
    { params: Promise.resolve({ id }) },
  );
}
beforeAll(async () => {
  const url = process.env.DATABASE_URL;
  if (
    !url ||
    !/^taky_payment_test_[a-z0-9_]+$/.test(new URL(url).pathname.slice(1))
  )
    throw new Error(
      "Explicit isolated synthetic payment test database required",
    );
  const identity = await db.$queryRaw<
    { name: string }[]
  >`SELECT current_database() AS name`;
  expect(identity[0]?.name).toBe(new URL(url).pathname.slice(1));
  if (!process.env.SESSION_SECRET || process.env.SESSION_SECRET.length < 32)
    throw new Error("Explicit synthetic SESSION_SECRET required");
  admin = await createUser("ADMIN");
  staff = await createUser("STAFF");
  adminToken = await session(admin.id);
  staffToken = await session(staff.id);
  const property = await db.property.create({
    data: {
      code: `PDF-${key()}`,
      name: "ที่พักสมมติ / Frozen synthetic property",
      address: "Frozen synthetic address",
    },
  });
  propertyId = property.id;
  const floor = await db.floor.create({
    data: { propertyId, number: 1, name: "Synthetic PDF" },
  });
  const room = await db.room.create({
    data: { floorId: floor.id, number: "PDF-101", rent: "1000" },
  });
  const tenant = await db.tenant.create({
    data: { name: "ผู้เช่าสมมติ / Frozen synthetic tenant", isDemo: false },
  });
  tenantId = tenant.id;
  const lease = await db.lease.create({
    data: {
      number: `PDF-${key()}`,
      roomId: room.id,
      tenantId,
      startDate: new Date("2026-01-01"),
      endDate: new Date("2026-12-31"),
      rent: "1000.00",
      deposit: "0",
      status: "ACTIVE",
      isDemo: false,
    },
  });
  await configureDuePolicy(admin, {
    propertyId,
    offsetDays: 5,
    expectedVersion: 0,
    commandKey: key(),
  });
  const rates = [];
  for (const kind of ["WATER", "ELECTRICITY"] as const) {
    const rate = await createUtilityRate(admin, {
      propertyId,
      kind,
      effectiveFrom: "2026-01-01",
      unitPrice: "20.0000",
    });
    rates.push({ kind, id: rate.id });
  }
  const invoices = [];
  for (const month of ["2026-02", "2026-03"]) {
    const period = await createBillingPeriod(admin, { propertyId, month });
    for (const rate of rates) {
      await approveBillingRate(admin, {
        billingPeriodId: period.id,
        kind: rate.kind,
        utilityRateId: rate.id,
        reason: "Synthetic receipt fixture",
      });
      await approveBillingConsumption(admin, {
        billingPeriodId: period.id,
        leaseId: lease.id,
        kind: rate.kind,
        reason: "Synthetic receipt estimate",
        evidence: ["synthetic-only"],
        source: {
          kind: "ESTIMATE",
          quantity: "1.000",
          sourceContext: "Synthetic receipt fixture",
        },
      });
    }
    await closeBillingPeriod(admin, period.id);
    const draft = await prepareDraft(staff, {
      billingPeriodId: period.id,
      leaseId: lease.id,
      commandKey: key(),
    });
    invoices.push(
      await issueInvoice(admin, {
        invoiceId: draft.id,
        expectedVersion: draft.version,
        commandKey: key(),
      }),
    );
  }
  const pending = await createPayment(staff, {
    leaseId: lease.id,
    amount: "0.30",
    method: "BANK_TRANSFER",
    receivedAt: "2026-10-22T18:01:02+00:00",
    externalReference: `SYNTHETIC-${key()}`,
    receivingAccountKey: "SYNTHETIC-ACCOUNT",
    commandKey: key(),
  });
  confirmed = await confirmPayment(admin, {
    paymentId: pending.id,
    expectedVersion: pending.version,
    commandKey: key(),
    allocations: invoices.map((invoice, index) => ({
      invoiceId: invoice.id,
      expectedVersion: invoice.version,
      amount: index === 0 ? "0.10" : "0.20",
    })),
  });
  if (!confirmed.receipt)
    throw new Error("Confirmed synthetic receipt missing");
  receiptId = confirmed.receipt.id;
});
afterAll(async () => {
  await db.$disconnect();
});

describe("receipt PDF route with genuine PostgreSQL sessions", () => {
  it("exports frozen receipt facts and separately appends reversal cancellation without read mutations", async () => {
    const before = await getReceipt(admin, receiptId);
    const receiptCount = await db.receipt.count();
    const counterBefore = await db.receiptMonthCounter.findMany({
      orderBy: { month: "asc" },
    });
    cookie.token = staffToken;
    const normal = await request();
    expect(normal.status).toBe(200);
    expect(normal.headers.get("content-type")).toBe("application/pdf");
    expect(normal.headers.get("cache-control")).toBe(
      "private, no-store, max-age=0",
    );
    const originalPdf = Buffer.from(await normal.arrayBuffer());
    expect(originalPdf.subarray(0, 5).toString()).toBe("%PDF-");
    await db.tenant.update({
      where: { id: tenantId },
      data: { name: "CURRENT tenant renamed" },
    });
    await db.property.update({
      where: { id: propertyId },
      data: { name: "CURRENT property renamed", address: "CURRENT address" },
    });
    await db.user.update({
      where: { id: admin.id },
      data: { name: "CURRENT operator renamed" },
    });
    expect(await getReceipt(staff, receiptId)).toEqual(before);
    cookie.token = adminToken;
    const renamed = await request(receiptId, "?download=1");
    expect(renamed.status).toBe(200);
    expect(renamed.headers.get("content-disposition")).toContain("attachment;");
    await reversePayment(admin, {
      paymentId: confirmed.id,
      expectedVersion: confirmed.version,
      reason: "Synthetic PDF cancellation",
      commandKey: key(),
    });
    const after = await getReceipt(admin, receiptId);
    expect(after.snapshot).toEqual(before.snapshot);
    expect(after.fingerprint).toBe(before.fingerprint);
    expect(after.cancellation?.reason).toBe("Synthetic PDF cancellation");
    const reversed = await request();
    expect(reversed.status).toBe(200);
    expect(await db.receipt.count()).toBe(receiptCount);
    expect(
      await db.receiptMonthCounter.findMany({ orderBy: { month: "asc" } }),
    ).toEqual(counterBefore);
    await mkdir("evidence/receipt-pdf/database-artifacts", { recursive: true });
    await writeFile(
      "evidence/receipt-pdf/database-artifacts/original.pdf",
      originalPdf,
    );
    await writeFile(
      "evidence/receipt-pdf/database-artifacts/live-renamed.pdf",
      Buffer.from(await renamed.arrayBuffer()),
    );
    await writeFile(
      "evidence/receipt-pdf/database-artifacts/cancelled.pdf",
      Buffer.from(await reversed.arrayBuffer()),
    );
    await writeFile(
      "evidence/receipt-pdf/database-artifacts/receipts.json",
      JSON.stringify({ before, after }, null, 2),
    );
  });
  it("enforces real session expiry and disabled user, while an ADMIN demoted to STAFF retains allowed read access", async () => {
    cookie.token = undefined;
    expect((await request()).status).toBe(401);
    cookie.token = await session(staff.id, true);
    expect((await request()).status).toBe(401);
    cookie.token = staffToken;
    await db.user.update({ where: { id: staff.id }, data: { disabled: true } });
    expect((await request()).status).toBe(401);
    await db.user.update({
      where: { id: staff.id },
      data: { disabled: false },
    });
    cookie.token = adminToken;
    await db.user.update({ where: { id: admin.id }, data: { role: "STAFF" } });
    expect((await request()).status).toBe(200);
    expect((await request(key())).status).toBe(404);
    expect((await request("bad-id")).status).toBe(422);
    expect((await request(receiptId, "?download=1&download=1")).status).toBe(
      422,
    );
  });
});
