import { Prisma, type Role } from "@prisma/client";
import { db } from "./db";
import { AppError } from "./errors";
import { deleteRecord } from "./repository";
import { saveLease } from "./lease-service";
import {
  floorInput,
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
              if (occupied && data.status !== "AVAILABLE")
                throw new AppError(
                  409,
                  "OCCUPIED",
                  "ห้องมีสัญญาที่ใช้งานอยู่ ต้องสิ้นสุดสัญญาก่อนเปลี่ยนสถานะห้อง",
                );
              const previous = await tx.room.findUniqueOrThrow({
                where: { id },
              });
              if (
                previous.number !== data.number ||
                previous.floorId !== data.floorId
              )
                throw new AppError(
                  409,
                  "ROOM_IDENTITY",
                  "ใช้ห้องที่มีอยู่แล้ว ไม่สามารถเปลี่ยนเลขห้องหรือชั้น",
                );
            }
            return id
              ? tx.room.update({ where: { id }, data })
              : tx.room.create({ data });
          }
          case "tenants": {
            const { assignment, ...data } = tenantInput.parse(input);
            if (id)
              await tx.$queryRaw`SELECT id FROM "Tenant" WHERE id = ${id}::uuid FOR UPDATE`;
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
            const tenant = id
              ? tx.tenant.update({ where: { id }, data })
              : tx.tenant.create({ data });
            const saved = await tenant;
            if (assignment) {
              const active = await tx.lease.findMany({
                where: { tenantId: saved.id, status: "ACTIVE" },
              });
              if (active.length > 1 || active[0]?.id !== assignment.leaseId)
                throw new AppError(
                  409,
                  "ASSIGNMENT_CHANGED",
                  "สัญญาปัจจุบันเปลี่ยนแปลง กรุณาโหลดข้อมูลใหม่หรือจัดการในหน้าสัญญา",
                );
              const previous = active[0];
              let leaseId: string | undefined = previous?.id;
              if (previous && previous.roomId !== assignment.roomId) {
                if (
                  !assignment.previousEndDate ||
                  assignment.previousEndDate <
                    previous.startDate.toISOString().slice(0, 10) ||
                  assignment.previousEndDate >= assignment.startDate ||
                  assignment.previousEndDate >
                    previous.endDate.toISOString().slice(0, 10)
                )
                  throw new AppError(
                    422,
                    "TRANSFER_DATES",
                    "ย้ายห้องต้องระบุวันสิ้นสุดสัญญาเดิมภายในช่วงสัญญาและก่อนวันเริ่มสัญญาใหม่",
                  );
                await tx.$queryRaw`SELECT id FROM "Room" WHERE id = ${previous.roomId}::uuid FOR UPDATE`;
                await tx.lease.update({
                  where: { id: previous.id },
                  data: {
                    status: "ENDED",
                    endDate: new Date(assignment.previousEndDate),
                  },
                });
                await tx.auditLog.create({
                  data: {
                    actorId: actor.id,
                    action: "END_FOR_TRANSFER",
                    entity: "leases",
                    entityId: previous.id,
                  },
                });
                leaseId = undefined;
              } else if (assignment.previousEndDate) {
                throw new AppError(
                  422,
                  "TRANSFER_DATES",
                  "วันสิ้นสุดสัญญาเดิมใช้เฉพาะเมื่อย้ายห้อง",
                );
              }
              const lease = await saveLease(
                tx,
                {
                  number: assignment.number,
                  roomId: assignment.roomId,
                  tenantId: saved.id,
                  startDate: assignment.startDate,
                  endDate: assignment.endDate,
                  rent: assignment.rent,
                  deposit: assignment.deposit,
                  status: "ACTIVE",
                  isDemo: saved.isDemo,
                },
                leaseId,
              );
              await tx.auditLog.create({
                data: {
                  actorId: actor.id,
                  action: leaseId ? "UPDATE" : "CREATE",
                  entity: "leases",
                  entityId: lease.id,
                },
              });
            }
            return saved;
          }
          case "leases": {
            return saveLease(tx, input, id);
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
      if (resource === "rooms") {
        const room = await tx.room.findUniqueOrThrow({
          where: { id },
          include: { floor: { include: { property: true } } },
        });
        if (
          room.floor.property.code === "TAKY" &&
          /^(10[1-5]|20[1-5]|30[1-5])$/.test(room.number)
        )
          throw new AppError(
            409,
            "SEEDED_ROOM",
            "เก็บห้องพักหลักทั้ง 15 ห้องไว้ กรุณาเปลี่ยนสถานะห้องแทนการลบ",
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
