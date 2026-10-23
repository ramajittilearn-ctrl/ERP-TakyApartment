import { randomBytes, randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { db } from "../../src/server/db";
import { tokenHash } from "../../src/server/auth";
import type { Actor } from "../../src/server/services";
import {
  paymentDtoSchema,
  receiptDtoSchema,
} from "../../src/server/payments/contracts";
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

const cookie = vi.hoisted((): { token?: string } => ({}));
// Only the Next request cookie boundary is replaced. Authentication and all financial services are real.
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
  "@/server/payments/query",
  async () => import("../../src/server/payments/query"),
);
import {
  POST as create,
  GET as list,
} from "../../src/app/api/v1/payments/route";
import { GET as detail } from "../../src/app/api/v1/payments/[id]/route";
import { POST as confirm } from "../../src/app/api/v1/payments/[id]/confirm/route";
import { POST as cancel } from "../../src/app/api/v1/payments/[id]/cancel/route";
import { POST as reverse } from "../../src/app/api/v1/payments/[id]/reverse/route";
import { GET as receipt } from "../../src/app/api/v1/receipts/[id]/route";
import { GET as balances } from "../../src/app/api/v1/outstanding-balances/route";

const origin = "http://payment-routes.synthetic.invalid";
const key = () => randomUUID();
const context = (id: string) => ({ params: Promise.resolve({ id }) });
let admin: Actor, staff: Actor;
let adminToken: string, staffToken: string;
let leaseId: string;
let invoice: Awaited<ReturnType<typeof issueInvoice>>;
async function user(role: "ADMIN" | "STAFF") {
  return db.user.create({
    data: {
      username: `route-${key()}`,
      email: `${key()}@synthetic.invalid`,
      name: `Synthetic route ${role}`,
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
function request(body: unknown) {
  return new Request(`${origin}/api/v1/payments`, {
    method: "POST",
    headers: { origin, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}
async function data(response: Response, status = 200): Promise<unknown> {
  expect(response.status).toBe(status);
  expect(response.headers.get("cache-control")).toBe("no-store");
  const body: unknown = await response.json();
  expect(body).toHaveProperty("data");
  if (typeof body !== "object" || body === null || !("data" in body))
    throw new Error("Missing response envelope");
  return body.data;
}
async function denied(response: Response, status: number, code: string) {
  expect(response.status).toBe(status);
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(await response.json()).toMatchObject({ error: { code } });
}
function pendingBody(commandKey: string = key(), amount = "100.00") {
  return {
    leaseId,
    amount,
    method: "BANK_TRANSFER",
    receivedAt: "2026-10-23T10:00:00+07:00",
    externalReference: key(),
    receivingAccountKey: "synthetic-route-bank",
    commandKey,
  };
}
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
  if (!process.env.SESSION_SECRET || process.env.SESSION_SECRET.length < 32)
    throw new Error("Explicit synthetic SESSION_SECRET required");
  vi.stubEnv("APP_ORIGIN", origin);
  admin = await user("ADMIN");
  staff = await user("STAFF");
  adminToken = await session(admin.id);
  staffToken = await session(staff.id);
  const property = await db.property.create({
    data: {
      code: `R${key()}`,
      name: "Synthetic route fixture",
      address: "Synthetic address",
    },
  });
  const floor = await db.floor.create({
    data: { propertyId: property.id, number: 1, name: "Synthetic" },
  });
  const room = await db.room.create({
    data: { floorId: floor.id, number: "101", rent: "1000" },
  });
  const tenant = await db.tenant.create({
    data: { name: "Synthetic route tenant", isDemo: false },
  });
  const lease = await db.lease.create({
    data: {
      number: `R${key()}`,
      roomId: room.id,
      tenantId: tenant.id,
      startDate: new Date("2026-01-01"),
      endDate: new Date("2026-12-31"),
      rent: "1000.00",
      deposit: "0",
      status: "ACTIVE",
      isDemo: false,
    },
  });
  leaseId = lease.id;
  const period = await createBillingPeriod(admin, {
    propertyId: property.id,
    month: "2026-02",
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
      reason: "Synthetic test rate",
    });
    await approveBillingConsumption(admin, {
      billingPeriodId: period.id,
      leaseId,
      kind,
      reason: "Synthetic test estimate",
      evidence: ["synthetic-only"],
      source: {
        kind: "ESTIMATE",
        quantity: "1.000",
        sourceContext: "Synthetic route fixture",
      },
    });
  }
  await closeBillingPeriod(admin, period.id);
  await configureDuePolicy(admin, {
    propertyId: property.id,
    offsetDays: 5,
    expectedVersion: 0,
    commandKey: key(),
  });
  const draft = await prepareDraft(staff, {
    billingPeriodId: period.id,
    leaseId,
    commandKey: key(),
  });
  invoice = await issueInvoice(admin, {
    invoiceId: draft.id,
    expectedVersion: draft.version,
    commandKey: key(),
  });
});
afterAll(async () => {
  vi.unstubAllEnvs();
  await db.$disconnect();
});

describe("payment route PostgreSQL with genuine stored sessions", () => {
  it("performs partial settlement, historical replay, receipt reads and full reversal through HTTP wrappers", async () => {
    cookie.token = staffToken;
    const body = pendingBody();
    const pending = paymentDtoSchema.parse(
      await data(await create(request(body)), 201),
    );
    expect(pending).toMatchObject({
      status: "PENDING",
      amount: "100.00",
      recordedById: staff.id,
    });
    const command = {
      expectedVersion: pending.version,
      commandKey: key(),
      allocations: [
        {
          invoiceId: invoice.id,
          expectedVersion: invoice.version,
          amount: "100.00",
        },
      ],
    };
    await denied(
      await confirm(request(command), context(pending.id)),
      403,
      "FORBIDDEN",
    );
    cookie.token = adminToken;
    const settled = paymentDtoSchema.parse(
      await data(await confirm(request(command), context(pending.id))),
    );
    expect(settled.status).toBe("CONFIRMED");
    expect(settled.receipt).not.toBeNull();
    expect(
      paymentDtoSchema.parse(
        await data(await confirm(request(command), context(pending.id))),
      ),
    ).toEqual(settled);
    await denied(
      await confirm(
        request({ ...command, expectedVersion: settled.version }),
        context(pending.id),
      ),
      409,
      "IDEMPOTENCY_CONFLICT",
    );
    await denied(
      await reverse(
        request({
          expectedVersion: pending.version,
          commandKey: key(),
          reason: "Stale transition",
        }),
        context(pending.id),
      ),
      409,
      "STALE_VERSION",
    );
    cookie.token = staffToken;
    expect(
      paymentDtoSchema.parse(await data(await create(request(body)), 201)),
    ).toEqual(pending);
    expect(
      paymentDtoSchema.parse(
        await data(await detail(new Request(origin), context(pending.id))),
      ),
    ).toEqual(settled);
    const paymentList = await data(
      await list(
        new Request(
          `${origin}/api/v1/payments?leaseId=${leaseId}&status=CONFIRMED&limit=10`,
        ),
      ),
    );
    expect(paymentList).toMatchObject({
      scope: "managed-only",
      items: [settled],
      offset: 0,
      limit: 10,
    });
    const balanceResponse = await data(
      await balances(
        new Request(`${origin}/api/v1/outstanding-balances?leaseId=${leaseId}`),
      ),
    );
    expect(balanceResponse).toMatchObject({
      scope: "managed-only",
      items: [
        {
          invoiceId: invoice.id,
          finalTotal: "1040.00",
          activePaid: "100.00",
          outstanding: "940.00",
        },
      ],
    });
    if (!settled.receipt) throw new Error("Missing confirmed receipt");
    const originalReceipt = receiptDtoSchema.parse(
      await data(
        await receipt(new Request(origin), context(settled.receipt.id)),
      ),
    );
    expect(originalReceipt.snapshot.amount).toBe("100.00");
    expect(originalReceipt.cancellation).toBeNull();
    cookie.token = adminToken;
    const reversed = paymentDtoSchema.parse(
      await data(
        await reverse(
          request({
            expectedVersion: settled.version,
            commandKey: key(),
            reason: "Synthetic full reversal",
          }),
          context(pending.id),
        ),
      ),
    );
    expect(reversed.status).toBe("REVERSED");
    const cancelledReceipt = receiptDtoSchema.parse(
      await data(
        await receipt(new Request(origin), context(settled.receipt.id)),
      ),
    );
    expect(cancelledReceipt.snapshot).toEqual(originalReceipt.snapshot);
    expect(cancelledReceipt.fingerprint).toBe(originalReceipt.fingerprint);
    expect(cancelledReceipt.cancellation?.reversalId).toBe(
      reversed.reversal?.id,
    );
    expect(
      await data(await balances(new Request(`${origin}?leaseId=${leaseId}`))),
    ).toMatchObject({
      items: [{ activePaid: "0.00", outstanding: "1040.00" }],
    });
    expect(await db.payment.count({ where: { id: pending.id } })).toBe(1);
    expect(await db.receipt.count({ where: { paymentId: pending.id } })).toBe(
      1,
    );
    expect(
      await db.paymentCommand.count({
        where: { actorId: staff.id, commandKey: body.commandKey },
      }),
    ).toBe(1);
    expect(
      await db.paymentCommand.count({
        where: { actorId: admin.id, commandKey: command.commandKey },
      }),
    ).toBe(1);
    expect(
      await db.auditLog.count({
        where: { entityId: pending.id, action: "CREATE_PAYMENT" },
      }),
    ).toBe(1);
    expect(
      await db.auditLog.count({
        where: { entityId: pending.id, action: "CONFIRM_PAYMENT" },
      }),
    ).toBe(1);
  });
  it("cancels pending entries as ADMIN and denies STAFF cancellation/reversal", async () => {
    cookie.token = staffToken;
    const pending = paymentDtoSchema.parse(
      await data(await create(request(pendingBody())), 201),
    );
    const body = {
      expectedVersion: pending.version,
      commandKey: key(),
      reason: "Duplicate synthetic entry",
    };
    await denied(
      await cancel(request(body), context(pending.id)),
      403,
      "FORBIDDEN",
    );
    await denied(
      await reverse(request(body), context(pending.id)),
      403,
      "FORBIDDEN",
    );
    cookie.token = adminToken;
    const cancelled = paymentDtoSchema.parse(
      await data(await cancel(request(body), context(pending.id))),
    );
    expect(cancelled).toMatchObject({
      status: "CANCELLED",
      receipt: null,
      allocations: [],
    });
    expect(await db.receipt.count({ where: { paymentId: pending.id } })).toBe(
      0,
    );
  });
  it("retains commandKey case and actor-scoped identity", async () => {
    const commandKey = `CaseSensitive-${key()}`;
    const first = pendingBody(commandKey);
    cookie.token = staffToken;
    const a = paymentDtoSchema.parse(
      await data(await create(request(first)), 201),
    );
    const b = paymentDtoSchema.parse(
      await data(
        await create(request(pendingBody(commandKey.toLowerCase()))),
        201,
      ),
    );
    cookie.token = adminToken;
    const c = paymentDtoSchema.parse(
      await data(await create(request(pendingBody(commandKey))), 201),
    );
    expect(new Set([a.id, b.id, c.id]).size).toBe(3);
    expect(
      await db.paymentCommand.count({
        where: { commandKey: { in: [commandKey, commandKey.toLowerCase()] } },
      }),
    ).toBe(3);
  });
  it("rejects expired genuine sessions before replay", async () => {
    cookie.token = staffToken;
    const body = pendingBody();
    await data(await create(request(body)), 201);
    cookie.token = await session(staff.id, true);
    await denied(await create(request(body)), 401, "UNAUTHENTICATED");
    await denied(await list(new Request(origin)), 401, "UNAUTHENTICATED");
  });
  it("rejects a disabled user with a genuine unexpired session before replay", async () => {
    const operator = await user("STAFF");
    cookie.token = await session(operator.id);
    const body = pendingBody();
    await data(await create(request(body)), 201);
    await db.user.update({
      where: { id: operator.id },
      data: { disabled: true },
    });
    await denied(await create(request(body)), 401, "UNAUTHENTICATED");
    await denied(
      await detail(new Request(origin), context(key())),
      401,
      "UNAUTHENTICATED",
    );
  });
  it("denies confirmation replay after ADMIN demotion despite its stored successful command", async () => {
    const operator = await user("ADMIN");
    const token = await session(operator.id);
    cookie.token = staffToken;
    const pending = paymentDtoSchema.parse(
      await data(await create(request(pendingBody())), 201),
    );
    cookie.token = token;
    const body = {
      expectedVersion: pending.version,
      commandKey: key(),
      allocations: [
        {
          invoiceId: invoice.id,
          expectedVersion: invoice.version,
          amount: "100.00",
        },
      ],
    };
    await data(await confirm(request(body), context(pending.id)));
    await db.user.update({
      where: { id: operator.id },
      data: { role: "STAFF" },
    });
    await denied(
      await confirm(request(body), context(pending.id)),
      403,
      "FORBIDDEN",
    );
    expect(
      await db.paymentCommand.count({
        where: { actorId: operator.id, commandKey: body.commandKey },
      }),
    ).toBe(1);
  });
});
