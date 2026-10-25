import { setTimeout as delay } from "node:timers/promises";
import type { Client } from "pg";
import { afterAll, beforeAll, expect, it } from "vitest";
import { db } from "../../src/server/db";
import { createPayment, cancelPendingPayment } from "../../src/server/payments";
import {
  attestDepositTestDatabase,
  createDepositTestFixture,
  depositFinancialState,
  depositTestAt,
  depositTestConnection,
  depositTestKey,
  depositTestService as service,
  rawPendingPayment,
  type DepositTestFixture,
} from "../helpers/deposit-core";

beforeAll(attestDepositTestDatabase);
afterAll(() => db.$disconnect());
const sourceGate = 73422193;
const bankGate = 73422194;
async function gateLocks(client: Client, key: number) {
  return (
    await client.query(
      "SELECT pid,mode,granted FROM pg_locks WHERE locktype='advisory' AND classid=0 AND objid=$1::oid AND objsubid=1 AND database=(SELECT oid FROM pg_database WHERE datname=current_database())",
      [key],
    )
  ).rows;
}
async function waitFor(check: () => Promise<boolean>, state: string) {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    if (await check()) return;
    await delay(20);
  }
  throw new Error(
    `Required synthetic database state was not observed: ${state}`,
  );
}
function tracked(promise: Promise<unknown>) {
  return promise.then(
    (value) => ({ status: "fulfilled" as const, value }),
    (reason: unknown) => ({ status: "rejected" as const, reason }),
  );
}
function bankReceipt(
  f: DepositTestFixture,
  identity: { account: string; reference: string },
) {
  return service.recordDepositReceipt(f.admin, {
    ...f.base,
    expectedVersion: 1,
    commandKey: depositTestKey(),
    amount: "1.00",
    occurredAt: depositTestAt(),
    verified: true,
    method: "BANK_TRANSFER",
    receivingAccountKey: identity.account,
    externalReference: identity.reference,
  });
}
function pendingPayment(
  f: DepositTestFixture,
  identity: { account: string; reference: string },
) {
  return createPayment(f.staff, {
    leaseId: f.lease.id,
    amount: "1.00",
    receivedAt: depositTestAt(),
    method: "BANK_TRANSFER",
    receivingAccountKey: identity.account,
    externalReference: identity.reference,
    commandKey: depositTestKey(),
  });
}
async function activeClaims(identity: { account: string; reference: string }) {
  return {
    payments: await db.payment.count({
      where: {
        legacyUnmapped: false,
        status: { in: ["PENDING", "CONFIRMED"] },
        receivingAccountKey: identity.account,
        externalReference: identity.reference,
      },
    }),
    deposits: await db.depositEntry.count({
      where: {
        kind: "RECEIPT",
        method: "BANK_TRANSFER",
        receivingAccountKey: identity.account,
        externalReference: identity.reference,
        reversal: { none: {} },
      },
    }),
  };
}

it.each(["PAYMENT_FIRST", "DEPOSIT_FIRST"] as const)(
  "permits exactly one active service bank claim in %s arrival order",
  async (order) => {
    const f = await createDepositTestFixture("0.00");
    const identity = { account: "synthetic-bank", reference: depositTestKey() };
    const holder = await depositTestConnection();
    const observer = await depositTestConnection();
    try {
      await holder.client.query("BEGIN");
      await holder.client.query("SELECT pg_advisory_xact_lock_shared($1)", [
        sourceGate,
      ]);
      await holder.client.query("SELECT pg_advisory_xact_lock($1)", [bankGate]);
      const first = tracked(
        order === "PAYMENT_FIRST"
          ? pendingPayment(f, identity)
          : bankReceipt(f, identity),
      );
      await waitFor(
        async () =>
          (await gateLocks(observer.client, bankGate)).filter(
            (row) => !row.granted,
          ).length === 1,
        "first service waits for bank admission",
      );
      const second = tracked(
        order === "PAYMENT_FIRST"
          ? bankReceipt(f, identity)
          : pendingPayment(f, identity),
      );
      await waitFor(
        async () =>
          (await gateLocks(observer.client, bankGate)).filter(
            (row) => !row.granted,
          ).length === 2,
        "both services wait for bank admission",
      );
      await holder.client.query("COMMIT");
      const outcomes = await Promise.all([first, second]);
      expect(outcomes.map((row) => row.status)).toEqual([
        "fulfilled",
        "rejected",
      ]);
      const claims = await activeClaims(identity);
      expect(claims.payments + claims.deposits).toBe(1);
      expect(claims).toEqual(
        order === "PAYMENT_FIRST"
          ? { payments: 1, deposits: 0 }
          : { payments: 0, deposits: 1 },
      );
      const ledger = await service.getLeaseDepositLedger(f.staff, {
        leaseId: f.lease.id,
      });
      expect(ledger.totals.heldLiability).toBe(
        order === "PAYMENT_FIRST" ? "0.00" : "1.00",
      );
      const state = await depositFinancialState(f);
      expect(
        state.commands.filter((row) => row.operation === "deposit.receipt"),
      ).toHaveLength(claims.deposits);
      expect(
        state.audits.filter((row) => row.action === "deposit.receipt"),
      ).toHaveLength(claims.deposits);
    } finally {
      await holder.client.query("ROLLBACK");
      await holder.client.end();
      await observer.client.end();
    }
  },
);

it.each(["DIRECT_FIRST", "SERVICE_FIRST"] as const)(
  "serializes a READ COMMITTED direct Payment claim versus deposit service in %s order",
  async (order) => {
    const f = await createDepositTestFixture("0.00");
    const identity = { account: "synthetic-bank", reference: depositTestKey() };
    const holder = await depositTestConnection(),
      direct = await depositTestConnection(),
      observer = await depositTestConnection();
    const raw = async () => {
      await direct.client.query("BEGIN ISOLATION LEVEL READ COMMITTED");
      try {
        const id = await rawPendingPayment(direct.client, f, identity);
        await direct.client.query("COMMIT");
        return id;
      } catch (error) {
        await direct.client.query("ROLLBACK");
        throw error;
      }
    };
    try {
      await holder.client.query("BEGIN");
      await holder.client.query("SELECT pg_advisory_xact_lock_shared($1)", [
        sourceGate,
      ]);
      await holder.client.query("SELECT pg_advisory_xact_lock($1)", [bankGate]);
      const first = tracked(
        order === "DIRECT_FIRST" ? raw() : bankReceipt(f, identity),
      );
      await waitFor(
        async () =>
          (await gateLocks(observer.client, bankGate)).filter(
            (row) => !row.granted,
          ).length === 1,
        "first supported writer waits for bank admission",
      );
      const second = tracked(
        order === "DIRECT_FIRST" ? bankReceipt(f, identity) : raw(),
      );
      await waitFor(
        async () =>
          (await gateLocks(observer.client, bankGate)).filter(
            (row) => !row.granted,
          ).length === 2,
        "both supported writers wait for bank admission",
      );
      await holder.client.query("COMMIT");
      const outcomes = await Promise.all([first, second]);
      expect(outcomes.map((row) => row.status)).toEqual([
        "fulfilled",
        "rejected",
      ]);
      const claims = await activeClaims(identity);
      expect(claims).toEqual(
        order === "DIRECT_FIRST"
          ? { payments: 1, deposits: 0 }
          : { payments: 0, deposits: 1 },
      );
      expect(
        (await service.getLeaseDepositLedger(f.staff, { leaseId: f.lease.id }))
          .totals.heldLiability,
      ).toBe(order === "DIRECT_FIRST" ? "0.00" : "1.00");
    } finally {
      await holder.client.query("ROLLBACK");
      await holder.client.end();
      await direct.client.end();
      await observer.client.end();
    }
  },
);

it("releases a reversed deposit identity and a cancelled pending Payment identity without erasing history", async () => {
  const f = await createDepositTestFixture("0.00");
  const identity = { account: "synthetic-bank", reference: depositTestKey() };
  const captured = await bankReceipt(f, identity);
  const original = captured.items.find((row) => row.kind === "RECEIPT");
  if (!original) throw new Error("Synthetic bank receipt missing");
  await expect(pendingPayment(f, identity)).rejects.toThrow();
  await service.reverseDepositEntry(f.admin, {
    ...f.base,
    expectedVersion: 2,
    commandKey: depositTestKey(),
    entryId: original.id,
    occurredAt: depositTestAt(),
    verified: true,
  });
  await pendingPayment(f, identity);
  expect(await activeClaims(identity)).toEqual({ payments: 1, deposits: 0 });
  expect(
    (await service.getDepositDocument(f.staff, { entryId: original.id }))
      .snapshotSha256,
  ).toBe(original.snapshotSha256);
  const other = await createDepositTestFixture("0.00");
  const secondIdentity = {
    account: "synthetic-bank",
    reference: depositTestKey(),
  };
  const pending = await pendingPayment(other, secondIdentity);
  await expect(bankReceipt(other, secondIdentity)).rejects.toThrow();
  await cancelPendingPayment(other.admin, {
    paymentId: pending.id,
    expectedVersion: pending.version,
    commandKey: depositTestKey(),
    reason: "Synthetic duplicate claim cancellation",
  });
  await bankReceipt(other, secondIdentity);
  expect(await activeClaims(secondIdentity)).toEqual({
    payments: 0,
    deposits: 1,
  });
});

it("allows one duplicate reversal and one of receipt reversal versus spend without partial commits", async () => {
  const f = await createDepositTestFixture("0.00");
  const receipt = await service.recordDepositReceipt(f.admin, {
    ...f.base,
    expectedVersion: 1,
    commandKey: depositTestKey(),
    amount: "10.00",
    occurredAt: depositTestAt(),
    verified: true,
    method: "CASH",
  });
  const target = receipt.items[0];
  const reversal = {
    ...f.base,
    expectedVersion: 2,
    entryId: target.id,
    occurredAt: depositTestAt(),
    verified: true,
  };
  const results = await Promise.allSettled([
    service.reverseDepositEntry(f.admin, {
      ...reversal,
      commandKey: depositTestKey(),
    }),
    service.reverseDepositEntry(f.admin, {
      ...reversal,
      commandKey: depositTestKey(),
    }),
  ]);
  expect(results.filter((row) => row.status === "fulfilled")).toHaveLength(1);
  const ledger = await service.getLeaseDepositLedger(f.staff, {
    leaseId: f.lease.id,
  });
  expect(ledger.items.filter((row) => row.kind === "REVERSAL")).toHaveLength(1);
  expect(ledger.account.version).toBe(3);
  expect(ledger.totals.heldLiability).toBe("0.00");
  const g = await createDepositTestFixture("0.00");
  const incoming = await service.recordDepositReceipt(g.admin, {
    ...g.base,
    expectedVersion: 1,
    commandKey: depositTestKey(),
    amount: "10.00",
    occurredAt: depositTestAt(),
    verified: true,
    method: "CASH",
  });
  const collision = await Promise.allSettled([
    service.reverseDepositEntry(g.admin, {
      ...g.base,
      expectedVersion: 2,
      commandKey: depositTestKey(),
      entryId: incoming.items[0].id,
      occurredAt: depositTestAt(),
      verified: true,
    }),
    service.recordDepositDeduction(g.admin, {
      ...g.base,
      expectedVersion: 2,
      commandKey: depositTestKey(),
      amount: "7.00",
      occurredAt: depositTestAt(),
      verified: true,
    }),
  ]);
  expect(collision.filter((row) => row.status === "fulfilled")).toHaveLength(1);
  const final = await service.getLeaseDepositLedger(g.staff, {
    leaseId: g.lease.id,
  });
  expect(final.total).toBe(2);
  expect(final.account.version).toBe(3);
  expect(["0.00", "3.00"]).toContain(final.totals.heldLiability);
});

it("replays a concurrent identical reversal key as one entry, version, command and audit", async () => {
  const f = await createDepositTestFixture("10.00");
  const opening = (
    await service.getLeaseDepositLedger(f.staff, { leaseId: f.lease.id })
  ).items[0];
  const data = {
    ...f.base,
    expectedVersion: 1,
    commandKey: depositTestKey(),
    entryId: opening.id,
    occurredAt: depositTestAt(),
    verified: true,
  };
  const [a, b] = await Promise.all([
    service.reverseDepositEntry(f.admin, data),
    service.reverseDepositEntry(f.admin, data),
  ]);
  expect(a).toEqual(b);
  const state = await depositFinancialState(f);
  expect(a.account.version).toBe(2);
  expect(state.entries.filter((row) => row.kind === "REVERSAL")).toHaveLength(
    1,
  );
  expect(
    state.commands.filter((row) => row.operation === "deposit.reverse"),
  ).toHaveLength(1);
  expect(
    state.audits.filter((row) => row.action === "deposit.reverse"),
  ).toHaveLength(1);
});

it.each(["DIRECT_FIRST", "SERVICE_FIRST"] as const)(
  "queues supported writers before bank/entity locks while source close waits in %s order",
  async (order) => {
    const f = await createDepositTestFixture("0.00");
    const identity = { account: "synthetic-bank", reference: depositTestKey() };
    const holder = await depositTestConnection(),
      closer = await depositTestConnection(),
      direct = await depositTestConnection(),
      observer = await depositTestConnection();
    let closeHeld: Promise<unknown> | undefined;
    try {
      await holder.client.query("BEGIN");
      await holder.client.query("SELECT pg_advisory_xact_lock_shared($1)", [
        sourceGate,
      ]);
      await holder.client.query("SELECT pg_advisory_xact_lock($1)", [bankGate]);
      await closer.client.query("BEGIN");
      closeHeld = closer.client.query("SELECT pg_advisory_xact_lock($1)", [
        sourceGate,
      ]);
      await waitFor(
        async () =>
          (await gateLocks(observer.client, sourceGate)).some(
            (row) =>
              row.pid === closer.pid &&
              !row.granted &&
              row.mode === "ExclusiveLock",
          ),
        "exclusive source close queues behind holder",
      );
      const raw = async () => {
        await direct.client.query("BEGIN ISOLATION LEVEL READ COMMITTED");
        try {
          const result = await rawPendingPayment(direct.client, f, identity);
          await direct.client.query("COMMIT");
          return result;
        } catch (error) {
          await direct.client.query("ROLLBACK");
          throw error;
        }
      };
      const differentIdentity = {
        account: identity.account,
        reference: depositTestKey(),
      };
      const first = tracked(
        order === "DIRECT_FIRST" ? raw() : bankReceipt(f, differentIdentity),
      );
      await waitFor(
        async () =>
          (await gateLocks(observer.client, sourceGate)).filter(
            (row) => !row.granted && row.mode === "ShareLock",
          ).length === 1,
        "first writer waits at shared source admission",
      );
      const second = tracked(
        order === "DIRECT_FIRST" ? bankReceipt(f, differentIdentity) : raw(),
      );
      await waitFor(
        async () =>
          (await gateLocks(observer.client, sourceGate)).filter(
            (row) => !row.granted && row.mode === "ShareLock",
          ).length === 2,
        "both writers wait at shared source admission",
      );
      const waiting = (await gateLocks(observer.client, sourceGate))
        .filter((row) => !row.granted && row.mode === "ShareLock")
        .map((row) => Number(row.pid));
      expect(waiting).toContain(direct.pid);
      expect(
        (await gateLocks(observer.client, bankGate)).every(
          (row) => row.pid === holder.pid && row.granted,
        ),
      ).toBe(true);
      expect(
        (
          await observer.client.query(
            "SELECT count(*)::int AS count FROM pg_locks WHERE pid=ANY($1::int[]) AND locktype='tuple'",
            [waiting],
          )
        ).rows[0]?.count,
      ).toBe(0);
      expect(
        await db.depositEntry.count({ where: { leaseId: f.lease.id } }),
      ).toBe(0);
      expect(await db.payment.count({ where: { leaseId: f.lease.id } })).toBe(
        0,
      );
      await holder.client.query("COMMIT");
      await closeHeld;
      expect(
        (await gateLocks(observer.client, sourceGate)).some(
          (row) =>
            row.pid === closer.pid &&
            row.granted &&
            row.mode === "ExclusiveLock",
        ),
      ).toBe(true);
      expect(
        (await gateLocks(observer.client, bankGate)).some((row) =>
          waiting.includes(Number(row.pid)),
        ),
      ).toBe(false);
      await closer.client.query("COMMIT");
      const results = await Promise.all([first, second]);
      expect(results.map((row) => row.status)).toEqual([
        "fulfilled",
        "fulfilled",
      ]);
      expect(await activeClaims(identity)).toEqual({
        payments: 1,
        deposits: 0,
      });
      expect(await activeClaims(differentIdentity)).toEqual({
        payments: 0,
        deposits: 1,
      });
      const state = await depositFinancialState(f);
      expect(state.entries).toHaveLength(1);
      expect(
        state.commands.filter((row) => row.operation === "deposit.receipt"),
      ).toHaveLength(1);
      expect(
        state.audits.filter((row) => row.action === "deposit.receipt"),
      ).toHaveLength(1);
      expect(
        (await service.getLeaseDepositLedger(f.staff, { leaseId: f.lease.id }))
          .totals.heldLiability,
      ).toBe("1.00");
    } finally {
      await holder.client.query("ROLLBACK");
      await closer.client.query("ROLLBACK");
      if (closeHeld) await closeHeld.catch(() => {});
      await holder.client.end();
      await closer.client.end();
      await direct.client.end();
      await observer.client.end();
    }
  },
);
