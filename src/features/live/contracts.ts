import { z } from "zod";
const base = { id: z.uuid() };
export const propertySchema = z.object({
  ...base,
  code: z.string(),
  name: z.string(),
  address: z.string(),
});
export const floorSchema = z.object({
  ...base,
  propertyId: z.uuid(),
  number: z.number(),
  name: z.string(),
});
export const tenantSchema = z.object({
  ...base,
  name: z.string(),
  phone: z.string(),
  email: z.string(),
  address: z.string(),
  notes: z.string(),
  isDemo: z.boolean(),
});
const roomBase = z.object({
  ...base,
  floorId: z.uuid(),
  number: z.string(),
  rent: z.string(),
  status: z.enum(["AVAILABLE", "RESERVED", "MAINTENANCE"]),
  notes: z.string(),
});
const leaseBase = z.object({
  ...base,
  number: z.string(),
  roomId: z.uuid(),
  tenantId: z.uuid(),
  startDate: z.string(),
  endDate: z.string(),
  rent: z.string(),
  deposit: z.string(),
  status: z.enum(["DRAFT", "ACTIVE", "ENDED", "CANCELLED"]),
  isDemo: z.boolean(),
});
export const roomSchema = roomBase.extend({
  floor: floorSchema,
  leases: z.array(leaseBase.extend({ tenant: tenantSchema })),
});
export const leaseSchema = leaseBase.extend({
  room: roomBase,
  tenant: tenantSchema,
});
export const workspaceSchema = z.object({
  rooms: z.array(roomSchema),
  tenants: z.array(tenantSchema),
  leases: z.array(leaseSchema),
  floors: z.array(floorSchema),
  properties: z.array(propertySchema),
});
export type LiveWorkspace = z.infer<typeof workspaceSchema>;
export type LiveRoom = z.infer<typeof roomSchema>;
export type LiveTenant = z.infer<typeof tenantSchema>;
export type LiveLease = z.infer<typeof leaseSchema>;
