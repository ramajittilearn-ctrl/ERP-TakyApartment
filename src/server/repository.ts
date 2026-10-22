import type { Prisma } from "@prisma/client";
import { db } from "./db";
import type { Resource } from "./validation";

export const roomInclude = {
  floor: { include: { property: true } },
  leases: { where: { status: "ACTIVE" }, include: { tenant: true } },
} satisfies Prisma.RoomInclude;
export const leaseInclude = {
  room: { include: { floor: true } },
  tenant: true,
} satisfies Prisma.LeaseInclude;
export function listRecords(resource: Resource) {
  switch (resource) {
    case "properties":
      return db.property.findMany({ orderBy: { code: "asc" }, take: 1000 });
    case "floors":
      return db.floor.findMany({
        include: { property: true },
        orderBy: { number: "asc" },
        take: 1000,
      });
    case "rooms":
      return db.room.findMany({
        include: roomInclude,
        orderBy: { number: "asc" },
        take: 1000,
      });
    case "tenants":
      return db.tenant.findMany({
        include: { leases: { include: { room: true } } },
        orderBy: { name: "asc" },
        take: 1000,
      });
    case "leases":
      return db.lease.findMany({
        include: leaseInclude,
        orderBy: { createdAt: "desc" },
        take: 1000,
      });
  }
}
export function getRecord(resource: Resource, id: string) {
  switch (resource) {
    case "properties":
      return db.property.findUniqueOrThrow({ where: { id } });
    case "floors":
      return db.floor.findUniqueOrThrow({
        where: { id },
        include: { property: true },
      });
    case "rooms":
      return db.room.findUniqueOrThrow({ where: { id }, include: roomInclude });
    case "tenants":
      return db.tenant.findUniqueOrThrow({
        where: { id },
        include: { leases: { include: { room: true } } },
      });
    case "leases":
      return db.lease.findUniqueOrThrow({
        where: { id },
        include: leaseInclude,
      });
  }
}
export function deleteRecord(
  tx: Prisma.TransactionClient,
  resource: Resource,
  id: string,
) {
  switch (resource) {
    case "properties":
      return tx.property.delete({ where: { id } });
    case "floors":
      return tx.floor.delete({ where: { id } });
    case "rooms":
      return tx.room.delete({ where: { id } });
    case "tenants":
      return tx.tenant.delete({ where: { id } });
    case "leases":
      return tx.lease.delete({ where: { id } });
  }
}
