import { Prisma } from "@prisma/client";
import { z } from "zod";
import { db } from "../db";
import { AppError } from "../errors";
import type { Actor } from "../services";
import { acquireSourceGate } from "../invoices/gate";
import {
  createExpenseInput,
  postExpenseInput,
  cancelExpenseInput,
  reverseExpenseInput,
  createExpenseCategoryInput,
  setExpenseCategoryActiveInput,
  expenseListInput,
  expenseId,
  expenseDtoSchema,
  categoryDtoSchema,
  type ExpenseDto,
  type CategoryDto,
  type ExpenseListDto,
} from "./contracts";
import { expenseFingerprint } from "./domain";
function fail(code: string, message: string, status = 409): never {
  throw new AppError(status, code, message);
}
const jsonValue = (value: unknown): Prisma.InputJsonValue =>
  JSON.parse(JSON.stringify(value));
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
    fail("FORBIDDEN", "Expense permission denied", 403);
}
type ExpenseRow = Awaited<ReturnType<typeof db.expense.findFirstOrThrow>>;
function dto(row: ExpenseRow, possibleDuplicateCount = 0): ExpenseDto {
  const common = {
    possibleDuplicateCount,
    id: row.id,
    propertyId: row.propertyId,
    categoryId: row.categoryId,
    description: row.description,
    vendor: row.vendor,
    amount: row.amount.toFixed(2),
    occurredAt: row.occurredAt.toISOString().slice(0, 10),
    method: row.method,
    note: row.note,
    categoryName: row.categoryNameSnapshot,
    categoryKind: row.categoryKindSnapshot,
    version: row.version,
    recordedById: row.recordedById,
    createdAt: row.createdAt.toISOString(),
    correctionOfId: row.correctionOfId,
  };
  switch (row.status) {
    case "PENDING":
      return expenseDtoSchema.parse({ ...common, status: row.status });
    case "POSTED":
      return expenseDtoSchema.parse({
        ...common,
        status: row.status,
        postedById: row.postedById,
        postedAt: row.postedAt?.toISOString(),
      });
    case "CANCELLED":
      return expenseDtoSchema.parse({
        ...common,
        status: row.status,
        cancelledById: row.cancelledById,
        cancelledAt: row.cancelledAt?.toISOString(),
        cancelReason: row.cancelReason,
      });
    case "REVERSED":
      return expenseDtoSchema.parse({
        ...common,
        status: row.status,
        postedById: row.postedById,
        postedAt: row.postedAt?.toISOString(),
        reversedById: row.reversedById,
        reversedAt: row.reversedAt?.toISOString(),
        reverseReason: row.reverseReason,
      });
    case null:
      return fail("LEGACY_MAPPING_REQUIRED", "Legacy expense is not managed");
  }
}
async function presented(tx: Prisma.TransactionClient, row: ExpenseRow) {
  const count =
    row.status === "PENDING" || row.status === "POSTED"
      ? await tx.expense.count({
          where: {
            id: { not: row.id },
            legacyUnmapped: false,
            isDemo: false,
            propertyId: row.propertyId,
            vendor: row.vendor,
            occurredAt: row.occurredAt,
            amount: row.amount,
            status: { in: ["PENDING", "POSTED"] },
          },
        })
      : 0;
  return dto(row, count);
}
async function command<T extends ExpenseDto | CategoryDto>(
  actor: Actor,
  operation: string,
  data: { commandKey: string },
  admin: boolean,
  schema: z.ZodType<T>,
  run: (
    tx: Prisma.TransactionClient,
  ) => Promise<{ result: T; before?: ExpenseDto | CategoryDto }>,
): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await db.$transaction(
        async (tx) => {
          await acquireSourceGate(tx);
          await authorize(tx, actor, admin);
          await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${"expense:" + actor.id + ":" + data.commandKey},0))`;
          const prior = await tx.expenseCommand.findUnique({
            where: {
              actorId_commandKey: {
                actorId: actor.id,
                commandKey: data.commandKey,
              },
            },
          });
          const fingerprint = expenseFingerprint(data);
          if (prior) {
            if (
              prior.operation !== operation ||
              prior.requestFingerprint !== fingerprint
            )
              fail(
                "IDEMPOTENCY_CONFLICT",
                "Command key already used for another request",
              );
            return schema.parse(prior.result);
          }
          const { result, before } = await run(tx);
          await tx.auditLog.create({
            data: {
              actorId: actor.id,
              action: operation,
              entity: operation.startsWith("expense.category")
                ? "expense-categories"
                : "expenses",
              entityId: result.id,
              metadata: jsonValue({
                commandKey: data.commandKey,
                requestFingerprint: fingerprint,
                request: data,
                before: before ?? null,
                after: result,
              }),
            },
          });
          await tx.expenseCommand.create({
            data: {
              actorId: actor.id,
              commandKey: data.commandKey,
              operation,
              requestFingerprint: fingerprint,
              result: jsonValue(result),
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
        if (
          (error.code === "P2034" ||
            (error.code === "P2010" &&
              ["40P01", "40001"].includes(String(error.meta?.code)))) &&
          attempt < 2
        )
          continue;
        if (error.code === "P2002")
          fail(
            "DUPLICATE_EXPENSE_CATEGORY",
            "Expense category name already exists",
          );
      }
      throw error;
    }
  }
}
async function lockCategory(
  tx: Prisma.TransactionClient,
  id: string,
  active = true,
) {
  await tx.$queryRaw`SELECT id FROM "ExpenseCategory" WHERE id=${id}::uuid FOR UPDATE`;
  const category = await tx.expenseCategory.findUnique({ where: { id } });
  if (!category) fail("CATEGORY_NOT_FOUND", "Expense category not found", 404);
  if (active && !category.active)
    fail("INACTIVE_CATEGORY", "Expense category is inactive");
  return category;
}
async function lockExpense(
  tx: Prisma.TransactionClient,
  id: string,
  version: number,
  activeCategory = false,
) {
  const plan = await tx.expense.findUnique({ where: { id } });
  if (!plan || plan.legacyUnmapped || plan.isDemo)
    fail("EXPENSE_NOT_FOUND", "Managed expense not found", 404);
  await lockCategory(tx, plan.categoryId, activeCategory);
  await tx.$queryRaw`SELECT id FROM "Expense" WHERE id=${id}::uuid FOR UPDATE`;
  const row = await tx.expense.findUniqueOrThrow({ where: { id } });
  if (row.version !== version)
    fail("STALE_VERSION", "Expense was changed; reload before retrying");
  return row;
}
export async function createExpense(actor: Actor, input: unknown) {
  const data = createExpenseInput.parse(input);
  return command(
    actor,
    "expense.create",
    data,
    false,
    expenseDtoSchema,
    async (tx) => {
      const category = await lockCategory(tx, data.categoryId);
      if (!(await tx.property.findUnique({ where: { id: data.propertyId } })))
        fail("PROPERTY_NOT_FOUND", "Property not found", 404);
      if (data.correctionOfId) {
        const original = await tx.expense.findUnique({
          where: { id: data.correctionOfId },
        });
        if (
          !original ||
          original.legacyUnmapped ||
          original.propertyId !== data.propertyId ||
          !["CANCELLED", "REVERSED"].includes(original.status ?? "")
        )
          fail(
            "INVALID_CORRECTION",
            "Correction must refer to a terminal expense on the same property",
          );
      }
      const row = await tx.expense.create({
        data: {
          propertyId: data.propertyId,
          categoryId: data.categoryId,
          description: data.description,
          vendor: data.vendor,
          amount: data.amount,
          occurredAt: new Date(data.occurredAt + "T00:00:00Z"),
          method: data.method,
          note: data.note ?? null,
          correctionOfId: data.correctionOfId,
          legacyUnmapped: false,
          isDemo: false,
          status: "PENDING",
          version: 1,
          recordedById: actor.id,
          categoryNameSnapshot: category.name,
          categoryKindSnapshot: category.kind,
        },
      });
      return { result: await presented(tx, row) };
    },
  );
}
export async function postExpense(actor: Actor, input: unknown) {
  const data = postExpenseInput.parse(input);
  return command(
    actor,
    "expense.post",
    data,
    true,
    expenseDtoSchema,
    async (tx) => {
      const row = await lockExpense(
        tx,
        data.expenseId,
        data.expectedVersion,
        true,
      );
      if (row.status !== "PENDING")
        fail("INVALID_TRANSITION", "Only pending expenses can be posted");
      return {
        before: dto(row),
        result: dto(
          await tx.expense.update({
            where: { id: row.id },
            data: {
              status: "POSTED",
              version: { increment: 1 },
              postedAt: new Date(),
              postedById: actor.id,
            },
          }),
        ),
      };
    },
  );
}
export async function cancelExpense(actor: Actor, input: unknown) {
  const data = cancelExpenseInput.parse(input);
  return command(
    actor,
    "expense.cancel",
    data,
    true,
    expenseDtoSchema,
    async (tx) => {
      const row = await lockExpense(tx, data.expenseId, data.expectedVersion);
      if (row.status !== "PENDING")
        fail("INVALID_TRANSITION", "Only pending expenses can be cancelled");
      return {
        before: dto(row),
        result: dto(
          await tx.expense.update({
            where: { id: row.id },
            data: {
              status: "CANCELLED",
              version: { increment: 1 },
              cancelledAt: new Date(),
              cancelledById: actor.id,
              cancelReason: data.reason,
            },
          }),
        ),
      };
    },
  );
}
export async function reverseExpense(actor: Actor, input: unknown) {
  const data = reverseExpenseInput.parse(input);
  return command(
    actor,
    "expense.reverse",
    data,
    true,
    expenseDtoSchema,
    async (tx) => {
      const row = await lockExpense(tx, data.expenseId, data.expectedVersion);
      if (row.status !== "POSTED")
        fail("INVALID_TRANSITION", "Only posted expenses can be reversed");
      return {
        before: dto(row),
        result: dto(
          await tx.expense.update({
            where: { id: row.id },
            data: {
              status: "REVERSED",
              version: { increment: 1 },
              reversedAt: new Date(),
              reversedById: actor.id,
              reverseReason: data.reason,
            },
          }),
        ),
      };
    },
  );
}
export async function createExpenseCategory(actor: Actor, input: unknown) {
  const data = createExpenseCategoryInput.parse(input);
  return command(
    actor,
    "expense.category.create",
    data,
    true,
    categoryDtoSchema,
    async (tx) => ({
      result: categoryDtoSchema.parse(
        await tx.expenseCategory.create({
          data: {
            name: data.name,
            kind: data.kind,
            createdById: actor.id,
            changedById: actor.id,
          },
          select: {
            id: true,
            name: true,
            kind: true,
            active: true,
            version: true,
          },
        }),
      ),
    }),
  );
}
export async function setExpenseCategoryActive(actor: Actor, input: unknown) {
  const data = setExpenseCategoryActiveInput.parse(input);
  return command(
    actor,
    "expense.category.set-active",
    data,
    true,
    categoryDtoSchema,
    async (tx) => {
      const row = await lockCategory(tx, data.categoryId, false);
      if (row.version !== data.expectedVersion)
        fail("STALE_VERSION", "Category changed; reload before retrying");
      if (row.active === data.active)
        fail("INVALID_TRANSITION", "Category already has this active state");
      return {
        before: categoryDtoSchema.parse({
          id: row.id,
          name: row.name,
          kind: row.kind,
          active: row.active,
          version: row.version,
        }),
        result: categoryDtoSchema.parse(
          await tx.expenseCategory.update({
            where: { id: row.id },
            data: {
              active: data.active,
              version: { increment: 1 },
              changedById: actor.id,
            },
            select: {
              id: true,
              name: true,
              kind: true,
              active: true,
              version: true,
            },
          }),
        ),
      };
    },
  );
}
export async function listExpenseCategories(actor: Actor) {
  return db.$transaction(async (tx) => {
    await authorize(tx, actor);
    return z.array(categoryDtoSchema).parse(
      await tx.expenseCategory.findMany({
        orderBy: [{ name: "asc" }, { id: "asc" }],
        select: {
          id: true,
          name: true,
          kind: true,
          active: true,
          version: true,
        },
      }),
    );
  });
}
export async function getExpense(actor: Actor, id: unknown) {
  const parsed = expenseId.parse(id);
  return db.$transaction(async (tx) => {
    await authorize(tx, actor);
    const row = await tx.expense.findFirst({
      where: { id: parsed, legacyUnmapped: false, isDemo: false },
    });
    if (!row) fail("EXPENSE_NOT_FOUND", "Managed expense not found", 404);
    return presented(tx, row);
  });
}
export async function listExpenses(
  actor: Actor,
  input: unknown,
): Promise<ExpenseListDto> {
  const data = expenseListInput.parse(input);
  return db.$transaction(
    async (tx) => {
      await authorize(tx, actor);
      const where: Prisma.ExpenseWhereInput = {
        legacyUnmapped: false,
        isDemo: false,
        propertyId: data.propertyId,
        categoryId: data.categoryId,
        categoryKindSnapshot: data.kind,
        status: data.status,
        occurredAt: {
          ...(data.from ? { gte: new Date(data.from + "T00:00:00Z") } : {}),
          ...(data.to ? { lte: new Date(data.to + "T00:00:00Z") } : {}),
        },
        ...(data.query
          ? {
              OR: [
                { description: { contains: data.query, mode: "insensitive" } },
                { vendor: { contains: data.query, mode: "insensitive" } },
              ],
            }
          : {}),
      };
      const rows = await tx.expense.findMany({
        where,
        orderBy: [
          { occurredAt: "desc" },
          { createdAt: "desc" },
          { id: "desc" },
        ],
        skip: data.offset,
        take: data.limit,
      });
      const groups = await tx.expense.groupBy({
        by: ["categoryKindSnapshot"],
        where: { AND: [where, { status: "POSTED" }] },
        _sum: { amount: true },
      });
      let opex = new Prisma.Decimal(0),
        capex = new Prisma.Decimal(0);
      for (const group of groups)
        if (group.categoryKindSnapshot === "OPEX")
          opex = group._sum.amount ?? opex;
        else if (group.categoryKindSnapshot === "CAPEX")
          capex = group._sum.amount ?? capex;
      return {
        scope: "managed-only",
        items: await Promise.all(rows.map((row) => presented(tx, row))),
        offset: data.offset,
        limit: data.limit,
        total: await tx.expense.count({ where }),
        excludedLegacyCount: await tx.expense.count({
          where: { legacyUnmapped: true, propertyId: data.propertyId },
        }),
        totals: {
          opex: opex.toFixed(2),
          capex: capex.toFixed(2),
          total: opex.plus(capex).toFixed(2),
        },
      };
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
  );
}
