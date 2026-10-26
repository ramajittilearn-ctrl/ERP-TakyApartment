import { Prisma } from "@prisma/client";
import { db } from "../db";
import { AppError } from "../errors";
import type { Actor } from "../services";

export async function listDepositLeases(
  actor: Actor,
  page: { offset: number; limit: number },
) {
  return db.$transaction(
    async (tx) => {
      const current = await tx.user.findUnique({ where: { id: actor.id } });
      if (!current || current.disabled || current.role !== actor.role)
        throw new AppError(403, "FORBIDDEN", "ไม่มีสิทธิ์อ่านข้อมูลเงินประกัน");
      const where = { isDemo: false, tenant: { isDemo: false } };
      const total = await tx.lease.count({ where });
      const items = await tx.lease.findMany({
        where,
        select: {
          id: true,
          number: true,
          status: true,
          tenant: { select: { name: true } },
          room: { select: { number: true } },
        },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        skip: page.offset,
        take: page.limit,
      });
      return { items, total, ...page };
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
  );
}
