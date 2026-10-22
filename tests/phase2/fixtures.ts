import { expect, type APIRequestContext } from "@playwright/test";
import { z } from "zod";
import {
  leaseSchema,
  roomSchema,
  tenantSchema,
  type LiveLease,
  type LiveRoom,
  type LiveTenant,
} from "@/features/live/contracts";

async function getResponseData(
  request: APIRequestContext,
  path: string,
): Promise<unknown> {
  const response = await request.get(path);
  expect(response.status()).toBe(200);
  return response.json();
}

export async function getRooms(
  request: APIRequestContext,
): Promise<LiveRoom[]> {
  return z
    .object({ data: z.array(roomSchema) })
    .parse(await getResponseData(request, "/api/v1/rooms/")).data;
}

export async function getLeases(
  request: APIRequestContext,
): Promise<LiveLease[]> {
  return z
    .object({ data: z.array(leaseSchema) })
    .parse(await getResponseData(request, "/api/v1/leases/")).data;
}

export async function getTenants(
  request: APIRequestContext,
): Promise<LiveTenant[]> {
  return z
    .object({ data: z.array(tenantSchema) })
    .parse(await getResponseData(request, "/api/v1/tenants/")).data;
}

export function availableRooms(rooms: LiveRoom[]): LiveRoom[] {
  return rooms.filter(
    (room) =>
      room.status === "AVAILABLE" &&
      !room.leases.some((lease) => lease.status === "ACTIVE"),
  );
}
