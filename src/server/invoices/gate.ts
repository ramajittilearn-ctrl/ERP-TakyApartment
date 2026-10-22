import type { Prisma } from "@prisma/client";
// Shared writers enter before entity locks. Close takes the same gate exclusively.
export async function acquireSourceGate(tx: Prisma.TransactionClient) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock_shared(73422193)`;
}
export async function acquireCloseGate(tx: Prisma.TransactionClient) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(73422193)`;
}
