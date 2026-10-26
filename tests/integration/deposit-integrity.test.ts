import { afterAll, beforeAll, expect, it } from "vitest";
import { db } from "../../src/server/db";
import {
  attestDepositTestDatabase,
  createDepositTestFixture,
  depositFinancialState,
  depositTestAt,
  depositTestConnection,
  depositTestKey,
  depositTestService as service,
  rawDepositReceipt,
  withDepositFault,
} from "../helpers/deposit-core";

beforeAll(attestDepositTestDatabase);
afterAll(() => db.$disconnect());

it.each(["audit", "counter", "command", "entry"] as const)(
  "rolls back all provisional deposit writes after injected %s failure, then retries the exact key once",
  async (point) => {
    const f = await createDepositTestFixture("0.00");
    const data = {
      ...f.base,
      expectedVersion: 1,
      commandKey: depositTestKey(),
      amount: "1.25",
      occurredAt: depositTestAt(),
      verified: true,
      method: "CASH",
    };
    const before = await depositFinancialState(f);
    await withDepositFault(f, point, async () => {
      await expect(service.recordDepositReceipt(f.admin, data)).rejects.toThrow(
        `Synthetic deposit ${point} failure`,
      );
      expect(await depositFinancialState(f)).toEqual(before);
    });
    const first = await service.recordDepositReceipt(f.admin, data);
    expect(first.account.version).toBe(2);
    expect(first.total).toBe(1);
    expect(first.totals.heldLiability).toBe("1.25");
    const committed = await depositFinancialState(f);
    expect(await service.recordDepositReceipt(f.admin, data)).toEqual(first);
    expect(await depositFinancialState(f)).toEqual(committed);
    expect(committed.entries).toHaveLength(1);
    expect(
      committed.commands.filter((row) => row.operation === "deposit.receipt"),
    ).toHaveLength(1);
    expect(
      committed.audits.filter((row) => row.action === "deposit.receipt"),
    ).toHaveLength(1);
  },
);

it.each(["DISABLED", "DEMOTED"] as const)(
  "rechecks current actor before replay when administrator becomes %s",
  async (mode) => {
    const f = await createDepositTestFixture("0.00");
    const data = {
      ...f.base,
      expectedVersion: 1,
      commandKey: depositTestKey(),
      amount: "1.00",
      occurredAt: depositTestAt(),
      verified: true,
      method: "CASH",
    };
    await service.recordDepositReceipt(f.admin, data);
    const before = await depositFinancialState(f);
    await db.user.update({
      where: { id: f.admin.id },
      data: mode === "DISABLED" ? { disabled: true } : { role: "STAFF" },
    });
    await expect(
      service.recordDepositReceipt(f.admin, data),
    ).rejects.toMatchObject({ code: "FORBIDDEN", status: 403 });
    expect(await depositFinancialState(f)).toEqual(before);
  },
);

it.each(["OPENING", "RECEIPT", "REFUND", "DEDUCTION"] as const)(
  "preserves the original %s snapshot and reconciles its full reversal bucket",
  async (kind) => {
    const f = await createDepositTestFixture(
      kind === "RECEIPT" ? "0.00" : "10.00",
    );
    let ledger = await service.getLeaseDepositLedger(f.staff, {
      leaseId: f.lease.id,
    });
    if (kind !== "OPENING") {
      const data = {
        ...f.base,
        expectedVersion: 1,
        commandKey: depositTestKey(),
        amount: kind === "RECEIPT" ? "10.00" : "2.00",
        occurredAt: depositTestAt(),
      };
      if (kind === "RECEIPT")
        ledger = await service.recordDepositReceipt(f.admin, {
          ...data,
          verified: true,
          method: "CASH",
        });
      else if (kind === "REFUND")
        ledger = await service.recordDepositRefund(f.admin, {
          ...data,
          settlementReviewed: true,
          method: "CASH",
          payeeName: "Synthetic refund payee",
        });
      else
        ledger = await service.recordDepositDeduction(f.admin, {
          ...data,
          verified: true,
        });
    }
    const target = ledger.items.find((row) => row.kind === kind);
    if (!target) throw new Error("Synthetic reversal target missing");
    const original = await service.getDepositDocument(f.staff, {
      entryId: target.id,
    });
    const reversed = await service.reverseDepositEntry(f.admin, {
      ...f.base,
      expectedVersion: ledger.account.version,
      commandKey: depositTestKey(),
      entryId: target.id,
      occurredAt: depositTestAt(),
      verified: true,
    });
    expect(reversed.totals.heldLiability).toBe(
      kind === "OPENING" || kind === "RECEIPT" ? "0.00" : "10.00",
    );
    const bucket = {
      OPENING: "reversedOpening",
      RECEIPT: "reversedReceipts",
      REFUND: "reversedRefunds",
      DEDUCTION: "reversedDeductions",
    } as const;
    expect(reversed.totals[bucket[kind]]).toBe(target.amount);
    await db.user.update({
      where: { id: f.admin.id },
      data: { name: "Renamed current synthetic operator" },
    });
    await db.tenant.update({
      where: { id: f.tenant.id },
      data: { name: "Renamed current synthetic tenant" },
    });
    await db.room.update({
      where: { id: f.room.id },
      data: { number: "RENAMED" },
    });
    const after = await service.getDepositDocument(f.staff, {
      entryId: target.id,
    });
    expect(after.documentSnapshot).toEqual(original.documentSnapshot);
    expect(after.snapshotSha256).toBe(original.snapshotSha256);
    expect(after.amount).toBe(original.amount);
    expect(after.reversedBy).not.toBeNull();
  },
);

it.each(["OPENING", "RECEIPT"] as const)(
  "rejects a %s reversal that would make held liability negative",
  async (kind) => {
    const f = await createDepositTestFixture(
      kind === "OPENING" ? "10.00" : "0.00",
    );
    let ledger = await service.getLeaseDepositLedger(f.staff, {
      leaseId: f.lease.id,
    });
    if (kind === "RECEIPT")
      ledger = await service.recordDepositReceipt(f.admin, {
        ...f.base,
        expectedVersion: 1,
        commandKey: depositTestKey(),
        amount: "10.00",
        occurredAt: depositTestAt(),
        verified: true,
        method: "CASH",
      });
    const target = ledger.items.find((row) => row.kind === kind);
    if (!target) throw new Error("Synthetic original missing");
    await service.recordDepositDeduction(f.admin, {
      ...f.base,
      expectedVersion: ledger.account.version,
      commandKey: depositTestKey(),
      amount: "3.00",
      occurredAt: depositTestAt(),
      verified: true,
    });
    const before = await depositFinancialState(f);
    await expect(
      service.reverseDepositEntry(f.admin, {
        ...f.base,
        expectedVersion: ledger.account.version + 1,
        commandKey: depositTestKey(),
        entryId: target.id,
        occurredAt: depositTestAt(),
        verified: true,
      }),
    ).rejects.toThrow();
    expect(await depositFinancialState(f)).toEqual(before);
  },
);

it("accepts a finite authoritative raw receipt positive control through all deferred guards", async () => {
  const f = await createDepositTestFixture("0.00");
  const { client } = await depositTestConnection();
  const before = await depositFinancialState(f);
  try {
    await client.query("BEGIN");
    await rawDepositReceipt(client, f);
    await client.query("SET CONSTRAINTS ALL IMMEDIATE");
    expect(
      (
        await client.query(
          'SELECT version FROM "DepositAccount" WHERE "leaseId"=$1',
          [f.lease.id],
        )
      ).rows[0]?.version,
    ).toBe(2);
  } finally {
    await client.query("ROLLBACK");
    await client.end();
  }
  expect(await depositFinancialState(f)).toEqual(before);
});

it.each(["NaN", "Infinity", "-Infinity", "-0.01", "0.00"])(
  "rejects raw entry amount %s with complete database rollback",
  async (amount) => {
    const f = await createDepositTestFixture("0.00");
    const before = await depositFinancialState(f);
    const { client } = await depositTestConnection();
    try {
      await client.query("BEGIN");
      await expect(rawDepositReceipt(client, f, { amount })).rejects.toThrow();
    } finally {
      await client.query("ROLLBACK");
      await client.end();
    }
    expect(await depositFinancialState(f)).toEqual(before);
  },
);

it.each([
  "CROSS_LEASE_EVIDENCE",
  "INVALID_ACTOR",
  "SKIPPED_SEQUENCE",
  "FORGED_SNAPSHOT",
  "FORGED_HASH",
] as const)("rejects raw %s with complete database rollback", async (kind) => {
  const f = await createDepositTestFixture("0.00");
  const other =
    kind === "CROSS_LEASE_EVIDENCE"
      ? await createDepositTestFixture("0.00")
      : null;
  const before = await depositFinancialState(f);
  const changes =
    kind === "CROSS_LEASE_EVIDENCE"
      ? { evidenceId: other?.evidence.id }
      : kind === "INVALID_ACTOR"
        ? { postedById: f.staff.id }
        : kind === "SKIPPED_SEQUENCE"
          ? { sequence: 99 }
          : kind === "FORGED_HASH"
            ? { snapshotSha256: "0".repeat(64) }
            : {
                documentSnapshot: {
                  format: "taky.deposit.v1",
                  amount: "999.00",
                },
              };
  const { client } = await depositTestConnection();
  try {
    await client.query("BEGIN");
    await expect(rawDepositReceipt(client, f, changes)).rejects.toThrow();
  } finally {
    await client.query("ROLLBACK");
    await client.end();
  }
  expect(await depositFinancialState(f)).toEqual(before);
});

it("rejects a skipped raw account version and duplicate raw reversal without retained partial state", async () => {
  const f = await createDepositTestFixture("0.00");
  let before = await depositFinancialState(f);
  await expect(
    db.$executeRaw`UPDATE "DepositAccount" SET version=version+2 WHERE "leaseId"=${f.lease.id}::uuid`,
  ).rejects.toThrow();
  expect(await depositFinancialState(f)).toEqual(before);
  const received = await service.recordDepositReceipt(f.admin, {
    ...f.base,
    expectedVersion: 1,
    commandKey: depositTestKey(),
    amount: "1.00",
    occurredAt: depositTestAt(),
    verified: true,
    method: "CASH",
  });
  const original = received.items[0];
  await service.reverseDepositEntry(f.admin, {
    ...f.base,
    expectedVersion: 2,
    commandKey: depositTestKey(),
    entryId: original.id,
    occurredAt: depositTestAt(),
    verified: true,
  });
  before = await depositFinancialState(f);
  const { client } = await depositTestConnection();
  try {
    await client.query("BEGIN");
    await expect(
      rawDepositReceipt(client, f, {
        kind: "REVERSAL",
        method: null,
        reverseOfId: original.id,
      }),
    ).rejects.toThrow();
  } finally {
    await client.query("ROLLBACK");
    await client.end();
  }
  expect(await depositFinancialState(f)).toEqual(before);
});
