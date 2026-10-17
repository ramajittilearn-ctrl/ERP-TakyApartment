import { Prisma, type Role } from "@prisma/client";
import { db } from "./db";
import { AppError } from "./errors";
import { deleteRecord } from "./repository";
import {
  floorInput,
  leaseInput,
  propertyInput,
  roomInput,
  tenantInput,
  type Resource,
} from "./validation";

export type Actor = { id: string; role: Role; name: string; username: string };
export function authorize(
  actor: Actor,
  resource: Resource,
  operation: "read" | "write" | "delete",
) {
  if (operation === "read") return;
  if (
    actor.role !== "ADMIN" &&
    (operation === "delete" ||
      ["properties", "floors", "rooms"].includes(resource))
  )
    throw new AppError(403, "FORBIDDEN", "เฉพาะผู้ดูแลระบบเท่านั้น");
}
export async function saveRecord(
  actor: Actor,
  resource: Resource,
  input: unknown,
  id?: string,
) {
  authorize(actor, resource, "write");
  return db.$transaction(
    async (tx) => {
      const record = await (async () => {
        switch (resource) {
          case "properties": {
            const data = propertyInput.parse(input);
            return id
              ? tx.property.update({ where: { id }, data })
              : tx.property.create({ data });
          }
          case "floors": {
            const data = floorInput.parse(input);
            return id
              ? tx.floor.update({ where: { id }, data })
              : tx.floor.create({ data });
          }
          case "rooms": {
            const data = roomInput.parse(input);
            if (id) {
              await tx.$queryRaw`SELECT id FROM "Room" WHERE id = ${id}::uuid FOR UPDATE`;
              const occupied = await tx.lease.count({
                where: { roomId: id, status: "ACTIVE" },
              });
              if (occupied && data.status === "MAINTENANCE")
                throw new AppError(
                  409,
                  "OCCUPIED",
                  "ห้องมีสัญญาที่ใช้งานอยู่ ไม่สามารถเปลี่ยนเป็นซ่อมบำรุง",
                );
            }
            return id
              ? tx.room.update({ where: { id }, data })
              : tx.room.create({ data });
          }
          case "tenants": {
            const data = tenantInput.parse(input);
            if (
              id &&
              (await tx.lease.count({
                where: { tenantId: id, isDemo: !data.isDemo },
              }))
            )
              throw new AppError(
                409,
                "DEMO_MISMATCH",
                "เปลี่ยนสถานะข้อมูลตัวอย่างไม่ได้เมื่อมีสัญญาอ้างอิง",
              );
            return id
              ? tx.tenant.update({ where: { id }, data })
              : tx.tenant.create({ data });
          }
          case "leases": {
            const value = leaseInput.parse(input);
            await tx.$queryRaw`SELECT id FROM "Room" WHERE id = ${value.roomId}::uuid FOR UPDATE`;
            const room = await tx.room.findUniqueOrThrow({
              where: { id: value.roomId },
            });
            const tenant = await tx.tenant.findUniqueOrThrow({
              where: { id: value.tenantId },
            });
            if (value.status === "ACTIVE" && room.status === "MAINTENANCE")
              throw new AppError(
                409,
                "MAINTENANCE",
                "ห้องอยู่ระหว่างซ่อมบำรุง",
              );
            if (tenant.isDemo !== value.isDemo)
              throw new AppError(
                422,
                "DEMO_MISMATCH",
                "ข้อมูลสัญญาและผู้เช่าต้องมีสถานะข้อมูลตัวอย่างตรงกัน",
              );
            if (id) {
              const previous = await tx.lease.findUniqueOrThrow({
                where: { id },
              });
              if (
                previous.status !== "DRAFT" &&
                (previous.roomId !== value.roomId ||
                  previous.tenantId !== value.tenantId)
              )
                throw new AppError(
                  409,
                  "LEASE_HISTORY",
                  "สัญญาที่เริ่มใช้งานแล้วเปลี่ยนห้องหรือผู้เช่าไม่ได้",
                );
              if (
                ["ENDED", "CANCELLED"].includes(previous.status) &&
                value.status !== previous.status
              )
                throw new AppError(
                  409,
                  "LEASE_HISTORY",
                  "ไม่สามารถเปิดสัญญาที่สิ้นสุดแล้วอีกครั้ง",
                );
              if (previous.status === "ACTIVE" && value.status === "DRAFT")
                throw new AppError(
                  409,
                  "LEASE_HISTORY",
                  "ไม่สามารถย้อนสัญญาที่ใช้งานแล้วเป็นฉบับร่าง",
                );
            }
            const data = {
              ...value,
              startDate: new Date(value.startDate),
              endDate: new Date(value.endDate),
            };
            return id
              ? tx.lease.update({ where: { id }, data })
              : tx.lease.create({ data });
          }
        }
      })();
      await tx.auditLog.create({
        data: {
          actorId: actor.id,
          action: id ? "UPDATE" : "CREATE",
          entity: resource,
          entityId: record.id,
        },
      });
      return record;
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
  );
}
export async function removeRecord(
  actor: Actor,
  resource: Resource,
  id: string,
) {
  authorize(actor, resource, "delete");
  return db.$transaction(
    async (tx) => {
      if (resource === "leases") {
        const lease = await tx.lease.findUniqueOrThrow({ where: { id } });
        if (lease.status !== "DRAFT")
          throw new AppError(
            409,
            "LEASE_HISTORY",
            "ลบได้เฉพาะสัญญาฉบับร่าง กรุณาเปลี่ยนสถานะเพื่อเก็บประวัติ",
          );
      }
      await deleteRecord(tx, resource, id);
      await tx.auditLog.create({
        data: {
          actorId: actor.id,
          action: "DELETE",
          entity: resource,
          entityId: id,
        },
      });
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
  );
}
