import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { db } from "../db";
import { AppError } from "../errors";
import type { Actor } from "../services";
import { acquireSourceGate } from "../invoices/gate";
import {
  invoiceLabelsSchema,
  invoiceSnapshotSchema,
} from "../invoices/contracts";
import { calculateBillingPreview } from "../billing/calculations";
import {
  createPaymentInput,
  confirmPaymentInput,
  cancelPaymentInput,
  paymentListInput,
  balanceListInput,
  paymentDtoSchema,
  receiptDtoSchema,
  balanceDtoSchema,
  receiptSnapshotSchema,
  type PaymentDto,
  type PaymentListDto,
  type BalanceListDto,
} from "./contracts";
import {
  fingerprint,
  bangkokDay,
  receiptMonth,
  receiptNumber,
  outstanding,
  verifiedReceipt,
} from "./domain";
function fail(code: string, message: string, status = 409): never {
  throw new AppError(status, code, message);
}
function json(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value));
}
async function authorize(
  client: Pick<Prisma.TransactionClient, "user">,
  actor: Actor,
  admin = false,
) {
  const user = await client.user.findUnique({ where: { id: actor.id } });
  if (
    !user ||
    user.disabled ||
    user.role !== actor.role ||
    (admin && user.role !== "ADMIN")
  )
    fail("FORBIDDEN", "Payment permission denied", 403);
  return user;
}
const include = {
  allocations: { orderBy: { invoiceId: "asc" } },
  receipt: true,
  reversal: true,
} satisfies Prisma.PaymentInclude;
type Row = Prisma.PaymentGetPayload<{ include: typeof include }>;
function dto(row: Row): PaymentDto {
  return paymentDtoSchema.parse({
    id: row.id,
    reference: row.reference,
    leaseId: row.leaseId,
    amount: row.amount.toFixed(2),
    method: row.methodCode,
    status: row.status,
    version: row.version,
    receivedAt: row.receivedAt.toISOString(),
    createdAt: row.createdAt.toISOString(),
    recordedById: row.recordedById,
    confirmedAt: row.confirmedAt?.toISOString() ?? null,
    confirmedById: row.confirmedById,
    cancelledAt: row.cancelledAt?.toISOString() ?? null,
    cancelledById: row.cancelledById,
    cancelReason: row.cancelReason,
    externalReference: row.externalReference,
    receivingAccountKey: row.receivingAccountKey,
    allocations: row.allocations.map((a) => ({
      invoiceId: a.invoiceId,
      amount: a.amount.toFixed(2),
    })),
    receipt: row.receipt
      ? { id: row.receipt.id, number: row.receipt.number }
      : null,
    reversal: row.reversal
      ? {
          id: row.reversal.id,
          reason: row.reversal.reason,
          actorId: row.reversal.actorId,
          createdAt: row.reversal.createdAt.toISOString(),
        }
      : null,
  });
}
async function command(
  actor: Actor,
  operation: string,
  data: { commandKey: string },
  admin: boolean,
  run: (tx: Prisma.TransactionClient) => Promise<PaymentDto>,
): Promise<PaymentDto> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await db.$transaction(
        async (tx) => {
          await acquireSourceGate(tx);
          await authorize(tx, actor, admin);
          await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${"payment:" + actor.id + ":" + data.commandKey}, 0))`;
          const prior = await tx.paymentCommand.findUnique({
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
              prior.requestFingerprint !== fingerprint(data)
            )
              fail(
                "IDEMPOTENCY_CONFLICT",
                "Command key already used for another request",
              );
            return paymentDtoSchema.parse(prior.result);
          }
          const result = await run(tx);
          await tx.auditLog.create({
            data: {
              actorId: actor.id,
              action: operation,
              entity: "payments",
              entityId: result.id,
              metadata: json({ request: data, result }),
            },
          });
          await tx.paymentCommand.create({
            data: {
              actorId: actor.id,
              commandKey: data.commandKey,
              operation,
              requestFingerprint: fingerprint(data),
              result: json(result),
            },
          });
          return result;
        },
        {
          isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted,
          timeout: 20000,
        },
      );
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError) {
        const transient =
          error.code === "P2034" ||
          (error.code === "P2010" &&
            (error.meta?.code === "40P01" || error.meta?.code === "40001"));
        if (transient && attempt < 2) continue;
        if (error.code === "P2002")
          fail(
            "DUPLICATE_PAYMENT_REFERENCE",
            "Active bank reference already exists",
          );
      }
      throw error;
    }
  }
}
async function lockLease(tx: Prisma.TransactionClient, leaseId: string) {
  await tx.$queryRaw`SELECT id FROM "Lease" WHERE id=${leaseId}::uuid FOR UPDATE`;
  const lease = await tx.lease.findUnique({
    where: { id: leaseId },
    include: { tenant: true },
  });
  if (!lease || lease.isDemo || lease.tenant.isDemo)
    fail("LEGACY_MAPPING_REQUIRED", "A non-demo lease and tenant are required");
  return lease;
}
async function lockedPayment(
  tx: Prisma.TransactionClient,
  paymentId: string,
  expectedVersion: number,
  invoiceIds: string[] = [],
) {
  const plan = await tx.payment.findUnique({
    where: { id: paymentId },
    include,
  });
  if (!plan || plan.legacyUnmapped || plan.isDemo)
    fail("PAYMENT_NOT_FOUND", "Managed payment not found", 404);
  const ids = [
    ...new Set([...invoiceIds, ...plan.allocations.map((a) => a.invoiceId)]),
  ].sort();
  const invoices = await tx.invoice.findMany({
    where: { id: { in: ids } },
    select: { id: true, billingPeriodId: true },
  });
  for (const id of [
    ...new Set(
      invoices.flatMap((i) => (i.billingPeriodId ? [i.billingPeriodId] : [])),
    ),
  ].sort())
    await tx.$queryRaw`SELECT id FROM "BillingPeriod" WHERE id=${id}::uuid FOR UPDATE`;
  await lockLease(tx, plan.leaseId);
  for (const id of ids)
    await tx.$queryRaw`SELECT id FROM "Invoice" WHERE id=${id}::uuid FOR UPDATE`;
  await tx.$queryRaw`SELECT id FROM "Payment" WHERE id=${paymentId}::uuid FOR UPDATE`;
  const row = await tx.payment.findUniqueOrThrow({
    where: { id: paymentId },
    include,
  });
  if (row.version !== expectedVersion || row.version !== plan.version)
    fail("STALE_VERSION", "Payment changed; reload before retrying");
  return row;
}
export async function createPayment(
  actor: Actor,
  input: unknown,
): Promise<PaymentDto> {
  const data = createPaymentInput.parse(input);
  return command(actor, "CREATE_PAYMENT", data, false, async (tx) => {
    await lockLease(tx, data.leaseId);
    return dto(
      await tx.payment.create({
        data: {
          reference: `PAY-${randomUUID()}`,
          leaseId: data.leaseId,
          amount: data.amount,
          method: data.method,
          methodCode: data.method,
          receivedAt: new Date(data.receivedAt),
          recordedById: actor.id,
          legacyUnmapped: false,
          isDemo: false,
          externalReference: data.externalReference ?? null,
          receivingAccountKey: data.receivingAccountKey ?? null,
        },
        include,
      }),
    );
  });
}
async function payableInvoice(tx: Prisma.TransactionClient, id: string) {
  const row = await tx.invoice.findUnique({
    where: { id },
    include: { frozenLease: true },
  });
  if (
    !row ||
    row.isDemo ||
    !row.billingPeriodId ||
    !row.frozenLease ||
    row.status !== "ISSUED" ||
    !row.number ||
    !row.finalTotal ||
    !row.fingerprint
  )
    fail("INVOICE_NOT_PAYABLE", "Invoice is not eligible for allocation");
  if (
    await tx.paymentAllocation.findFirst({
      where: { invoiceId: id, payment: { legacyUnmapped: true } },
    })
  )
    fail("LEGACY_MAPPING_REQUIRED", "Invoice has unmapped historical payments");
  const snapshot = invoiceSnapshotSchema.safeParse(row.snapshot);
  if (!snapshot.success)
    fail("INVOICE_NOT_PAYABLE", "Invalid frozen invoice snapshot");
  const calculated = calculateBillingPreview(snapshot.data.source);
  if (
    !calculated.complete ||
    calculated.snapshot.fingerprint !== row.fingerprint ||
    fingerprint(calculated.snapshot) !== fingerprint(snapshot.data) ||
    row.finalTotal.toFixed(2) !== snapshot.data.totals.finalTotal
  )
    fail("INVOICE_NOT_PAYABLE", "Frozen invoice integrity check failed");
  return {
    ...row,
    frozenLease: row.frozenLease,
    number: row.number,
    finalTotal: row.finalTotal,
  };
}
async function activePaid(
  tx: Pick<Prisma.TransactionClient, "paymentAllocation">,
  invoiceId: string,
) {
  const sum = await tx.paymentAllocation.aggregate({
    where: {
      invoiceId,
      payment: { status: "CONFIRMED", legacyUnmapped: false, isDemo: false },
    },
    _sum: { amount: true },
  });
  return sum._sum.amount ?? new Prisma.Decimal(0);
}
export async function confirmPayment(
  actor: Actor,
  input: unknown,
): Promise<PaymentDto> {
  const parsed = confirmPaymentInput.parse(input);
  const data = {
    ...parsed,
    allocations: [...parsed.allocations].sort((a, b) =>
      a.invoiceId.localeCompare(b.invoiceId),
    ),
  };
  return command(actor, "CONFIRM_PAYMENT", data, true, async (tx) => {
    const row = await lockedPayment(
      tx,
      data.paymentId,
      data.expectedVersion,
      data.allocations.map((a) => a.invoiceId),
    );
    if (row.status !== "PENDING")
      fail("PAYMENT_STATE", "Only pending payments can be confirmed");
    const total = data.allocations.reduce(
      (sum, a) => sum.plus(a.amount),
      new Prisma.Decimal(0),
    );
    if (!total.equals(row.amount))
      fail(
        "PAYMENT_NOT_FULLY_ALLOCATED",
        "Allocations must equal the payment amount",
      );
    if (row.methodCode === "CASH") {
      const candidates = (
        await tx.payment.findMany({
          where: {
            leaseId: row.leaseId,
            amount: row.amount,
            methodCode: "CASH",
            status: "CONFIRMED",
            legacyUnmapped: false,
            isDemo: false,
          },
          select: { id: true, receivedAt: true },
        })
      )
        .filter((p) => bangkokDay(p.receivedAt) === bangkokDay(row.receivedAt))
        .map((p) => p.id);
      if (candidates.length && !data.duplicateOverrideReason)
        fail(
          "CASH_DUPLICATE_REVIEW_REQUIRED",
          "An admin reason is required for likely duplicate cash",
        );
      if (candidates.length)
        await tx.auditLog.create({
          data: {
            actorId: actor.id,
            action: "CASH_DUPLICATE_OVERRIDE",
            entity: "payments",
            entityId: row.id,
            metadata: json({
              candidateIds: candidates,
              reason: data.duplicateOverrideReason,
            }),
          },
        });
    }
    const frozen = [];
    for (const allocation of data.allocations) {
      const invoice = await payableInvoice(tx, allocation.invoiceId);
      if (invoice.version !== allocation.expectedVersion)
        fail("STALE_VERSION", "Invoice changed; reload before retrying");
      if (invoice.leaseId !== row.leaseId)
        fail(
          "INVOICE_NOT_PAYABLE",
          "All allocations must belong to the payment lease",
        );
      if (
        (await activePaid(tx, invoice.id))
          .plus(allocation.amount)
          .gt(invoice.finalTotal)
      )
        fail(
          "ALLOCATION_EXCEEDS_BALANCE",
          "Allocation exceeds invoice outstanding balance",
        );
      frozen.push({
        invoiceId: invoice.id,
        number: invoice.number,
        frozenLeaseId: invoice.frozenLease.id,
        frozenTenantId: invoice.frozenLease.tenantId,
        labels: invoiceLabelsSchema.parse(invoice.frozenLease.labels),
        finalTotal: invoice.finalTotal.toFixed(2),
        allocatedAmount: allocation.amount,
      });
    }
    const issuedAt = new Date();
    const month = receiptMonth(issuedAt);
    const counter = await tx.$queryRaw<
      { value: number }[]
    >`INSERT INTO "ReceiptMonthCounter" (month,value) VALUES (${month},1) ON CONFLICT (month) DO UPDATE SET value="ReceiptMonthCounter".value+1 WHERE "ReceiptMonthCounter".value<9999 RETURNING value`;
    if (!counter[0])
      fail(
        "RECEIPT_SEQUENCE_EXHAUSTED",
        "Receipt sequence exhausted for this month",
      );
    const number = receiptNumber(month, counter[0].value);
    const issuer = await authorize(tx, actor, true);
    const snapshot = receiptSnapshotSchema.parse({
      schemaVersion: "receipt.v1",
      paymentId: row.id,
      reference: row.reference,
      amount: row.amount.toFixed(2),
      method: row.methodCode,
      receivedAt: row.receivedAt.toISOString(),
      externalReference: row.externalReference,
      issuedAt: issuedAt.toISOString(),
      issuedBy: { id: issuer.id, name: issuer.name },
      number,
      invoices: frozen,
    });
    await tx.paymentAllocation.createMany({
      data: data.allocations.map((a) => ({
        paymentId: row.id,
        invoiceId: a.invoiceId,
        amount: a.amount,
      })),
    });
    await tx.receipt.create({
      data: {
        paymentId: row.id,
        number,
        issuedAt,
        issuedById: actor.id,
        snapshotVersion: "receipt.v1",
        snapshot: json(snapshot),
        fingerprint: fingerprint(snapshot),
      },
    });
    return dto(
      await tx.payment.update({
        where: { id: row.id },
        data: {
          status: "CONFIRMED",
          version: { increment: 1 },
          confirmedById: actor.id,
          confirmedAt: issuedAt,
        },
        include,
      }),
    );
  });
}
export async function cancelPendingPayment(
  actor: Actor,
  input: unknown,
): Promise<PaymentDto> {
  const data = cancelPaymentInput.parse(input);
  return command(actor, "CANCEL_PAYMENT", data, true, async (tx) => {
    const row = await lockedPayment(tx, data.paymentId, data.expectedVersion);
    if (row.status !== "PENDING")
      fail("PAYMENT_STATE", "Only pending payments can be cancelled");
    return dto(
      await tx.payment.update({
        where: { id: row.id },
        data: {
          status: "CANCELLED",
          version: { increment: 1 },
          cancelledAt: new Date(),
          cancelledById: actor.id,
          cancelReason: data.reason,
        },
        include,
      }),
    );
  });
}
export async function reversePayment(
  actor: Actor,
  input: unknown,
): Promise<PaymentDto> {
  const data = cancelPaymentInput.parse(input);
  return command(actor, "REVERSE_PAYMENT", data, true, async (tx) => {
    const row = await lockedPayment(tx, data.paymentId, data.expectedVersion);
    if (row.status !== "CONFIRMED" || !row.receipt)
      fail(
        "PAYMENT_STATE",
        "Only confirmed receipted payments can be reversed",
      );
    const reversal = await tx.paymentReversal.create({
      data: { paymentId: row.id, reason: data.reason, actorId: actor.id },
    });
    await tx.receiptCancellation.create({
      data: {
        receiptId: row.receipt.id,
        reversalId: reversal.id,
        reason: data.reason,
        actorId: actor.id,
      },
    });
    return dto(
      await tx.payment.update({
        where: { id: row.id },
        data: {
          status: "REVERSED",
          version: { increment: 1 },
          reversedAt: new Date(),
        },
        include,
      }),
    );
  });
}
export async function getPayment(
  actor: Actor,
  id: string,
): Promise<PaymentDto> {
  await authorize(db, actor);
  const row = await db.payment.findFirst({
    where: { id: z.uuid().parse(id), legacyUnmapped: false, isDemo: false },
    include,
  });
  if (!row) fail("PAYMENT_NOT_FOUND", "Managed payment not found", 404);
  return dto(row);
}
export async function listPayments(
  actor: Actor,
  input: unknown,
): Promise<PaymentListDto> {
  await authorize(db, actor);
  const { offset, limit, ...where } = paymentListInput.parse(input);
  const rows = await db.payment.findMany({
    where: { ...where, legacyUnmapped: false, isDemo: false },
    include,
    orderBy: [{ receivedAt: "desc" }, { id: "asc" }],
    skip: offset,
    take: limit,
  });
  return { scope: "managed-only", items: rows.map(dto), offset, limit };
}
export async function getReceipt(actor: Actor, id: string) {
  await authorize(db, actor);
  const row = await db.receipt.findFirst({
    where: {
      id: z.uuid().parse(id),
      payment: { legacyUnmapped: false, isDemo: false },
    },
    include: { cancellation: true },
  });
  if (!row) fail("PAYMENT_NOT_FOUND", "Receipt not found", 404);
  return receiptDtoSchema.parse({
    id: row.id,
    number: row.number,
    paymentId: row.paymentId,
    fingerprint: row.fingerprint,
    snapshot: verifiedReceipt(row.snapshot, row.fingerprint),
    cancellation: row.cancellation
      ? {
          id: row.cancellation.id,
          reversalId: row.cancellation.reversalId,
          reason: row.cancellation.reason,
          actorId: row.cancellation.actorId,
          createdAt: row.cancellation.createdAt.toISOString(),
        }
      : null,
  });
}
export async function listOutstandingBalances(
  actor: Actor,
  input: unknown,
): Promise<BalanceListDto> {
  await authorize(db, actor);
  const data = balanceListInput.parse(input);
  return db.$transaction(
    async (tx) => {
      const invoices = await tx.invoice.findMany({
        where: {
          ...(data.leaseId ? { leaseId: data.leaseId } : {}),
          billingPeriodId: { not: null },
          isDemo: false,
          status: { in: ["ISSUED", "VOID"] },
          lease: { isDemo: false, tenant: { isDemo: false } },
          allocations: { none: { payment: { legacyUnmapped: true } } },
        },
        include: { frozenLease: true },
        orderBy: [{ dueDate: "asc" }, { id: "asc" }],
        take: data.limit,
        skip: data.offset,
      });
      const items = [];
      for (const invoice of invoices) {
        if (!invoice.frozenLease || !invoice.finalTotal)
          fail("INVOICE_NOT_PAYABLE", "Missing frozen invoice balance source");
        const paid = await activePaid(tx, invoice.id);
        const total = invoice.finalTotal.toFixed(2);
        if (invoice.status !== "ISSUED" && invoice.status !== "VOID")
          fail("INVOICE_NOT_PAYABLE", "Invalid balance state");
        items.push(
          balanceDtoSchema.parse({
            invoiceId: invoice.id,
            number: invoice.number,
            leaseId: invoice.leaseId,
            frozenTenantId: invoice.frozenLease.tenantId,
            labels: invoiceLabelsSchema.parse(invoice.frozenLease.labels),
            dueDate: invoice.dueDate?.toISOString().slice(0, 10),
            status: invoice.status,
            finalTotal: total,
            activePaid: paid.toFixed(2),
            outstanding: outstanding(total, paid.toFixed(2), invoice.status),
          }),
        );
      }
      return {
        scope: "managed-only",
        items,
        offset: data.offset,
        limit: data.limit,
      };
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
  );
}
