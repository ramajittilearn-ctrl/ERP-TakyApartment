import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { db } from "../db";
import { AppError } from "../errors";
import type { Actor } from "../services";
import { acquireSourceGate } from "../invoices/gate";
import {
  depositDocumentInput,
  depositEntryDtoSchema,
  depositLedgerDtoSchema,
  depositLedgerInput,
  depositSnapshotSchema,
  reviewDepositInput,
  receiptDepositInput,
  refundDepositInput,
  deductionDepositInput,
  reversalDepositInput,
  type DepositLedgerDto,
  type DepositEntryDto,
  type DepositDataQualityIssue,
} from "./contracts";
import { depositFingerprint, depositTotals } from "./domain";
import { isRetryableDepositTransaction } from "./retry";
export type DepositEvidenceVerifier = (
  tx: Prisma.TransactionClient,
  input: { leaseId: string; evidenceId: string },
) => Promise<{ evidenceId: string; attachmentId: string }>;
const json = (value: unknown): Prisma.InputJsonValue =>
  JSON.parse(JSON.stringify(value));
function fail(code: string, message: string, status = 409): never {
  throw new AppError(status, code, message);
}
async function authorize(
  tx: Pick<Prisma.TransactionClient, "user">,
  actor: Actor,
  admin = false,
) {
  const current = await tx.user.findUnique({ where: { id: actor.id } });
  if (
    !current ||
    current.disabled ||
    current.role !== actor.role ||
    (admin && current.role !== "ADMIN")
  )
    fail("FORBIDDEN", "Deposit permission denied", 403);
  return current;
}
const include = { reversal: true } satisfies Prisma.DepositEntryInclude;
type EntryRow = Prisma.DepositEntryGetPayload<{ include: typeof include }>;
function presented(row: EntryRow): DepositEntryDto {
  return depositEntryDtoSchema.parse({
    id: row.id,
    leaseId: row.leaseId,
    sequence: row.sequence,
    kind: row.kind,
    postedById: row.postedById,
    reason: row.reason,
    evidenceId: row.evidenceId,
    method: row.method,
    receivingAccountKey: row.receivingAccountKey,
    externalReference: row.externalReference,
    payeeName: row.payeeName,
    destination: row.destination,
    reverseOfId: row.reverseOfId,
    documentNumber: row.documentNumber,
    snapshotSha256: row.snapshotSha256,
    amount: row.amount.toFixed(2),
    occurredAt: row.occurredAt.toISOString(),
    postedAt: row.postedAt.toISOString(),
    documentSnapshot: depositSnapshotSchema.parse(row.documentSnapshot),
    reversedBy: row.reversal[0]
      ? {
          id: row.reversal[0].id,
          documentNumber: row.reversal[0].documentNumber,
          postedAt: row.reversal[0].postedAt.toISOString(),
        }
      : null,
  });
}
async function ledger(
  tx: Prisma.TransactionClient,
  leaseId: string,
  offset = 0,
  limit = 50,
): Promise<DepositLedgerDto> {
  const lease = await tx.lease.findUnique({ where: { id: leaseId } });
  if (!lease || lease.isDemo)
    fail("LEASE_NOT_FOUND", "Non-demo lease required", 404);
  const account = await tx.depositAccount.findUnique({ where: { leaseId } });
  const entries = await tx.depositEntry.findMany({
    where: { leaseId },
    include,
    orderBy: { sequence: "asc" },
  });
  const legacy = await tx.securityDeposit.findMany({
    where: { leaseId },
    orderBy: [{ occurredAt: "asc" }, { id: "asc" }],
  });
  const dataQualityIssues: DepositDataQualityIssue[] = [];
  if (!lease.deposit.isFinite()) {
    dataQualityIssues.push({
      code: "NON_FINITE_CONTRACTUAL_REQUIREMENT",
      rawAmount: lease.deposit.toString(),
    });
  }
  for (const row of legacy) {
    if (!row.amount.isFinite()) {
      dataQualityIssues.push({
        code: "NON_FINITE_LEGACY_AMOUNT",
        legacyDepositId: row.id,
        rawAmount: row.amount.toString(),
      });
    }
  }
  const legacySum = (kind: "RECEIVED" | "REFUNDED" | "DEDUCTED") => {
    const rows = legacy.filter((row) => row.kind === kind);
    if (rows.some((row) => !row.amount.isFinite())) return null;
    return rows
      .reduce((sum, row) => sum.add(row.amount), new Prisma.Decimal(0))
      .toFixed(2);
  };
  return depositLedgerDtoSchema.parse({
    leaseId,
    contractualRequirement: lease.deposit.isFinite()
      ? lease.deposit.toFixed(2)
      : null,
    dataQualityIssues,
    account: account
      ? {
          version: account.version,
          reviewState: account.reviewState,
          reviewedById: account.reviewedById,
          legacyDigest: account.legacyDigest,
          reviewReason: account.reviewReason,
          evidenceId: account.evidenceId,
          reviewedAt: account.reviewedAt?.toISOString() ?? null,
          openingAmount: account.openingAmount?.toFixed(2) ?? null,
        }
      : {
          version: 0,
          reviewState: "UNREVIEWED",
          reviewedById: null,
          reviewedAt: null,
          legacyDigest: null,
          reviewReason: null,
          evidenceId: null,
          openingAmount: null,
        },
    unverifiedLegacy: {
      rows: legacy.map((row) => ({
        id: row.id,
        leaseId: row.leaseId,
        kind: row.kind,
        amount: row.amount.toFixed(2),
        occurredAt: row.occurredAt.toISOString(),
        isDemo: row.isDemo,
        createdAt: row.createdAt.toISOString(),
        updatedAt: row.updatedAt.toISOString(),
      })),
      count: legacy.length,
      grossReceived: legacySum("RECEIVED"),
      grossRefunded: legacySum("REFUNDED"),
      grossDeducted: legacySum("DEDUCTED"),
    },
    items: entries.slice(offset, offset + limit).map(presented),
    total: entries.length,
    offset,
    limit,
    totals: depositTotals(
      entries.map((row) => ({
        id: row.id,
        kind: z
          .enum(["RECEIPT", "REFUND", "DEDUCTION", "REVERSAL", "OPENING"])
          .parse(row.kind),
        amount: row.amount.toFixed(2),
        reverseOfId: row.reverseOfId,
      })),
    ),
    asOfPostedAt: new Date().toISOString(),
  });
}
async function lockAccount(
  tx: Prisma.TransactionClient,
  leaseId: string,
  expectedVersion: number,
) {
  await tx.$queryRaw`SELECT id FROM "Lease" WHERE id=${leaseId}::uuid FOR UPDATE`;
  const lease = await tx.lease.findUnique({
    where: { id: leaseId },
    include: { tenant: true, room: true },
  });
  if (!lease || lease.isDemo || lease.tenant.isDemo)
    fail("LEASE_NOT_FOUND", "Non-demo lease and tenant required", 404);
  if (!(await tx.depositAccount.findUnique({ where: { leaseId } })))
    await tx.depositAccount.create({ data: { leaseId } });
  await tx.$queryRaw`SELECT "leaseId" FROM "DepositAccount" WHERE "leaseId"=${leaseId}::uuid FOR UPDATE`;
  const account = await tx.depositAccount.findUniqueOrThrow({
    where: { leaseId },
  });
  if (account.version !== expectedVersion)
    fail("STALE_VERSION", "Deposit changed; reload before retrying");
  return { lease, account };
}
async function legacyDigest(tx: Prisma.TransactionClient, leaseId: string) {
  await tx.$queryRaw`SELECT id FROM "SecurityDeposit" WHERE "leaseId"=${leaseId}::uuid ORDER BY id FOR SHARE`;
  const rows = await tx.$queryRaw<
    { digest: string }[]
  >`SELECT deposit_legacy_digest(${leaseId}::uuid) AS digest`;
  if (!rows[0]) throw new Error("Legacy digest unavailable");
  return rows[0].digest;
}
async function nextNumber(tx: Prisma.TransactionClient, at: Date) {
  const month = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Bangkok",
    year: "numeric",
    month: "2-digit",
  })
    .format(at)
    .replace("-", "");
  if (!(await tx.depositDocumentCounter.findUnique({ where: { month } })))
    await tx.depositDocumentCounter.create({ data: { month, nextValue: 1 } });
  await tx.$queryRaw`SELECT month FROM "DepositDocumentCounter" WHERE month=${month} FOR UPDATE`;
  const counter = await tx.depositDocumentCounter.findUniqueOrThrow({
    where: { month },
  });
  if (counter.nextValue > 999999)
    fail("NUMBER_EXHAUSTED", "Deposit document series exhausted");
  await tx.depositDocumentCounter.update({
    where: { month },
    data: { nextValue: { increment: 1 } },
  });
  return `DEP-${month}-${String(counter.nextValue).padStart(6, "0")}`;
}
export function createDepositService(verifyEvidence: DepositEvidenceVerifier) {
  async function command(
    actor: Actor,
    operation: string,
    data: {
      leaseId: string;
      expectedVersion: number;
      evidenceId: string;
      commandKey: string;
    },
    run: (tx: Prisma.TransactionClient) => Promise<void>,
  ): Promise<DepositLedgerDto> {
    for (let attempt = 0; ; attempt++)
      try {
        return await db.$transaction(
          async (tx) => {
            await acquireSourceGate(tx);
            await authorize(tx, actor, true);
            await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${"deposit:" + actor.id + ":" + data.commandKey},0))`;
            const prior = await tx.depositCommand.findUnique({
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
                prior.requestFingerprint !== depositFingerprint(data)
              )
                fail(
                  "IDEMPOTENCY_CONFLICT",
                  "Deposit command key already used",
                );
              return depositLedgerDtoSchema.parse(prior.result);
            }
            await tx.$executeRaw`SELECT pg_advisory_xact_lock(73422194)`;
            await run(tx);
            const result = await ledger(tx, data.leaseId);
            await tx.auditLog.create({
              data: {
                actorId: actor.id,
                action: operation,
                entity: "deposits",
                entityId: data.leaseId,
                metadata: json({ request: data, result }),
              },
            });
            await tx.depositCommand.create({
              data: {
                actorId: actor.id,
                commandKey: data.commandKey,
                operation,
                requestFingerprint: depositFingerprint(data),
                result: json(result),
              },
            });
            return result;
          },
          {
            isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
            timeout: 20000,
          },
        );
      } catch (error) {
        if (attempt < 2 && isRetryableDepositTransaction(error)) continue;
        throw error;
      }
  }
  type EntryInput = {
    leaseId: string;
    sequence: number;
    kind: string;
    amount: string;
    occurredAt: string;
    reason: string;
    evidenceId: string;
    method?: string;
    receivingAccountKey?: string;
    externalReference?: string;
    payeeName?: string;
    destination?: string;
    reverseOfId?: string;
  };
  async function entry(
    tx: Prisma.TransactionClient,
    actor: Actor,
    input: EntryInput,
  ) {
    await verifyEvidence(tx, {
      leaseId: input.leaseId,
      evidenceId: input.evidenceId,
    });
    const clock = await tx.$queryRaw<
      { now: Date }[]
    >`SELECT CURRENT_TIMESTAMP AS now`;
    const now = clock[0]?.now;
    if (!now) throw new Error("Database time unavailable");
    if (new Date(input.occurredAt).getTime() > now.getTime() + 300000)
      fail(
        "FUTURE_OCCURRENCE",
        "Deposit occurrence cannot be in the future",
        422,
      );
    const documentNumber = await nextNumber(tx, now);
    const row = {
      id: randomUUID(),
      leaseId: input.leaseId,
      sequence: input.sequence,
      kind: input.kind,
      amount: input.amount,
      occurredAt: input.occurredAt,
      reason: input.reason,
      evidenceId: input.evidenceId,
      postedById: actor.id,
      postedAt: now.toISOString(),
      method: input.method ?? null,
      receivingAccountKey: input.receivingAccountKey ?? null,
      externalReference: input.externalReference ?? null,
      payeeName: input.payeeName ?? null,
      destination: input.destination ?? null,
      reverseOfId: input.reverseOfId ?? null,
      documentNumber,
    };
    const snapshots = await tx.$queryRaw<
      { snapshot: unknown; hash: string }[]
    >`SELECT s AS snapshot,encode(sha256(convert_to(s::text,'UTF8')),'hex') AS hash FROM (SELECT deposit_snapshot(jsonb_populate_record(NULL::"DepositEntry",${JSON.stringify(row)}::jsonb)) AS s) q`;
    const snapshot = snapshots[0];
    if (!snapshot) throw new Error("Deposit snapshot unavailable");
    await tx.depositEntry.create({
      data: {
        ...row,
        occurredAt: new Date(row.occurredAt),
        postedAt: now,
        documentSnapshot: json(depositSnapshotSchema.parse(snapshot.snapshot)),
        snapshotSha256: snapshot.hash,
      },
    });
  }
  async function reviewed(
    tx: Prisma.TransactionClient,
    data: { leaseId: string; expectedVersion: number },
  ) {
    const locked = await lockAccount(tx, data.leaseId, data.expectedVersion);
    if (locked.account.reviewState !== "REVIEWED")
      fail(
        "REVIEW_REQUIRED",
        "Review historical deposit liability before posting",
      );
    if (locked.account.legacyDigest !== (await legacyDigest(tx, data.leaseId)))
      fail(
        "LEGACY_CHANGED",
        "Legacy deposit history changed; reviewed reconciliation required",
      );
    if (locked.lease.status === "DRAFT")
      fail("LEASE_NOT_ACTIVE", "Draft lease cannot post deposits");
    return locked;
  }
  return {
    reviewDepositAccount(actor: Actor, raw: unknown) {
      const data = reviewDepositInput.parse(raw);
      return command(actor, "deposit.review", data, async (tx) => {
        const { account, lease } = await lockAccount(
          tx,
          data.leaseId,
          data.expectedVersion,
        );
        if (account.reviewState !== "UNREVIEWED")
          fail("ALREADY_REVIEWED", "Opening review is immutable");
        if (lease.status === "DRAFT")
          fail("LEASE_NOT_ACTIVE", "Draft lease cannot review deposits");
        const digest = await legacyDigest(tx, data.leaseId);
        await verifyEvidence(tx, {
          leaseId: data.leaseId,
          evidenceId: data.evidenceId,
        });
        const clocks = await tx.$queryRaw<
          { now: Date }[]
        >`SELECT CURRENT_TIMESTAMP AS now`;
        const now = clocks[0]?.now;
        if (!now) throw new Error("Database time unavailable");
        await tx.depositAccount.update({
          where: { leaseId: data.leaseId },
          data: {
            version: 1,
            reviewState: "REVIEWED",
            reviewedById: actor.id,
            reviewedAt: now,
            legacyDigest: digest,
            reviewReason: data.reason,
            evidenceId: data.evidenceId,
            openingAmount: data.openingAmount,
          },
        });
        if (data.openingAmount !== "0.00")
          await entry(tx, actor, {
            leaseId: data.leaseId,
            sequence: 1,
            kind: "OPENING",
            amount: data.openingAmount,
            occurredAt: now.toISOString(),
            reason: data.reason,
            evidenceId: data.evidenceId,
          });
      });
    },
    recordDepositReceipt(actor: Actor, raw: unknown) {
      const data = receiptDepositInput.parse(raw);
      return command(actor, "deposit.receipt", data, async (tx) => {
        const { account, lease } = await reviewed(tx, data);
        if (lease.status !== "ACTIVE")
          fail(
            "LEASE_NOT_ACTIVE",
            "Only active leases receive deposit top-ups",
          );
        await entry(tx, actor, {
          ...data,
          sequence: account.version + 1,
          kind: "RECEIPT",
        });
      });
    },
    recordDepositRefund(actor: Actor, raw: unknown) {
      const data = refundDepositInput.parse(raw);
      return command(actor, "deposit.refund", data, async (tx) => {
        const { account } = await reviewed(tx, data);
        await entry(tx, actor, {
          ...data,
          sequence: account.version + 1,
          kind: "REFUND",
          externalReference:
            data.method === "BANK_TRANSFER"
              ? data.outgoingReference
              : undefined,
        });
      });
    },
    recordDepositDeduction(actor: Actor, raw: unknown) {
      const data = deductionDepositInput.parse(raw);
      return command(actor, "deposit.deduction", data, async (tx) => {
        const { account } = await reviewed(tx, data);
        await entry(tx, actor, {
          ...data,
          sequence: account.version + 1,
          kind: "DEDUCTION",
        });
      });
    },
    reverseDepositEntry(actor: Actor, raw: unknown) {
      const data = reversalDepositInput.parse(raw);
      return command(actor, "deposit.reverse", data, async (tx) => {
        const { account } = await reviewed(tx, data);
        await tx.$queryRaw`SELECT id FROM "DepositEntry" WHERE id=${data.entryId}::uuid FOR UPDATE`;
        const original = await tx.depositEntry.findUnique({
          where: { id: data.entryId },
          include,
        });
        if (
          !original ||
          original.leaseId !== data.leaseId ||
          original.kind === "REVERSAL" ||
          original.reversal.length
        )
          fail(
            "INVALID_REVERSAL",
            "Select an unreversed original deposit entry",
          );
        await entry(tx, actor, {
          leaseId: data.leaseId,
          sequence: account.version + 1,
          kind: "REVERSAL",
          amount: original.amount.toFixed(2),
          occurredAt: data.occurredAt,
          reason: data.reason,
          evidenceId: data.evidenceId,
          reverseOfId: original.id,
        });
      });
    },
    getLeaseDepositLedger(actor: Actor, raw: unknown) {
      const data = depositLedgerInput.parse(raw);
      return db.$transaction(
        async (tx) => {
          await authorize(tx, actor);
          return ledger(tx, data.leaseId, data.offset, data.limit);
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
      );
    },
    getDepositDocument(actor: Actor, raw: unknown) {
      const data = depositDocumentInput.parse(raw);
      return db.$transaction(
        async (tx) => {
          await authorize(tx, actor);
          const row = await tx.depositEntry.findUnique({
            where: { id: data.entryId },
            include,
          });
          if (!row)
            fail("DEPOSIT_ENTRY_NOT_FOUND", "Deposit entry not found", 404);
          const hashes = await tx.$queryRaw<
            { hash: string }[]
          >`SELECT encode(sha256(convert_to("documentSnapshot"::text,'UTF8')),'hex') AS hash FROM "DepositEntry" WHERE id=${row.id}::uuid`;
          if (hashes[0]?.hash !== row.snapshotSha256)
            fail("SNAPSHOT_INVALID", "Deposit snapshot integrity failed");
          return presented(row);
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
      );
    },
  };
}
