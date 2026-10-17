import type { Prisma } from "@prisma/client";
import { AppError } from "./errors";
import { leaseInput } from "./validation";

export async function saveLease(
  tx: Prisma.TransactionClient,
  input: unknown,
  id?: string,
) {
  const value = leaseInput.parse(input);
  await tx.$queryRaw`SELECT id FROM "Tenant" WHERE id = ${value.tenantId}::uuid FOR UPDATE`;
  await tx.$queryRaw`SELECT id FROM "Room" WHERE id = ${value.roomId}::uuid FOR UPDATE`;
  const room = await tx.room.findUniqueOrThrow({ where: { id: value.roomId } });
  const tenant = await tx.tenant.findUniqueOrThrow({
    where: { id: value.tenantId },
  });
  if (value.status === "ACTIVE" && room.status !== "AVAILABLE")
    throw new AppError(
      409,
      "ROOM_UNAVAILABLE",
      "ห้องจองหรือซ่อมบำรุง กรุณาเปลี่ยนสถานะห้องก่อนทำสัญญา",
    );
  if (tenant.isDemo !== value.isDemo)
    throw new AppError(
      422,
      "DEMO_MISMATCH",
      "ข้อมูลสัญญาและผู้เช่าต้องมีสถานะข้อมูลตัวอย่างตรงกัน",
    );
  if (id) {
    const previous = await tx.lease.findUniqueOrThrow({ where: { id } });
    if (
      previous.status !== "DRAFT" &&
      (previous.roomId !== value.roomId || previous.tenantId !== value.tenantId)
    )
      throw new AppError(
        409,
        "LEASE_HISTORY",
        "สัญญาที่เริ่มใช้งานแล้วเปลี่ยนห้องหรือผู้เช่าไม่ได้",
      );
    if (
      (["ENDED", "CANCELLED"].includes(previous.status) &&
        value.status !== previous.status) ||
      (previous.status === "ACTIVE" && value.status === "DRAFT")
    )
      throw new AppError(
        409,
        "LEASE_HISTORY",
        "ไม่สามารถย้อนสถานะสัญญาที่เริ่มใช้งานแล้ว",
      );
  }
  if (
    value.status === "ACTIVE" &&
    (await tx.lease.count({
      where: {
        roomId: value.roomId,
        status: "ACTIVE",
        ...(id ? { id: { not: id } } : {}),
      },
    }))
  )
    throw new AppError(
      409,
      "OCCUPIED",
      "ห้องนี้มีสัญญาที่ใช้งานอยู่ กรุณาโหลดข้อมูลใหม่",
    );
  const data = {
    ...value,
    startDate: new Date(value.startDate),
    endDate: new Date(value.endDate),
  };
  return id
    ? tx.lease.update({ where: { id }, data })
    : tx.lease.create({ data });
}
