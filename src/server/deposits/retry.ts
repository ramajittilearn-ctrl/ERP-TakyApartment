import { Prisma } from "@prisma/client";
import { z } from "zod";

const retryableState = z.enum(["40001", "40P01"]);
const directSqlError = z.object({ code: retryableState });
const adapterSqlError = z.object({
  driverAdapterError: z.object({
    name: z.literal("DriverAdapterError"),
    cause: z.object({
      kind: z.literal("TransactionWriteConflict"),
      originalCode: retryableState,
    }),
  }),
});

export function isRetryableDepositTransaction(error: unknown): boolean {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError)) return false;
  if (error.code === "P2034") return true;
  if (error.code !== "P2010") return false;
  return (
    directSqlError.safeParse(error.meta).success ||
    adapterSqlError.safeParse(error.meta).success
  );
}
