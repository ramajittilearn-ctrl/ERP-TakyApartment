import { z } from "zod";

export const satangSchema = z
  .number()
  .int()
  .nonnegative()
  .max(Number.MAX_SAFE_INTEGER)
  .brand<"Satang">();
export type Satang = z.infer<typeof satangSchema>;
export function baht(value: number): Satang {
  return satangSchema.parse(Math.round(value * 100));
}
export type Result<T> = { ok: true; value: T } | { ok: false; error: string };
export type RoomStatus = "occupied" | "vacant" | "maintenance";
export type Room = {
  number: string;
  floor: number;
  rent: Satang;
  status: RoomStatus;
};
export type Tenant = {
  id: string;
  name: string;
  phone: string;
  email: string;
  address: string;
};
export type Lease = {
  id: string;
  room: string;
  tenantId: string;
  start: string;
  end: string;
  rent: Satang;
  deposit: Satang;
  status: "active" | "ended";
};
export type InvoiceLine = {
  label: string;
  quantity: number;
  unitPrice: Satang;
};
export type Invoice = {
  id: string;
  number: string;
  room: string;
  month: string;
  date: string;
  dueDate: string;
  lines: InvoiceLine[];
};
export type Payment = {
  id: string;
  date: string;
  method: "transfer" | "cash" | "qr";
  status: "confirmed" | "pending" | "reversed";
  reference: string;
  allocations: { invoiceId: string; amount: Satang }[];
};
export type Expense = {
  id: string;
  date: string;
  title: string;
  vendor: string;
  category: string;
  kind: "OPEX" | "CAPEX";
  amount: Satang;
  method: "transfer" | "cash";
  note: string;
};
export type Ticket = {
  id: string;
  date: string;
  room: string;
  issue: string;
  priority: "high" | "medium" | "low";
  status: "pending" | "in-progress" | "resolved";
  assignee: string;
};
export type Settings = {
  waterRate: Satang;
  electricRate: Satang;
  commonFee: Satang;
  propertyName: string;
  phone: string;
};
export type DemoState = {
  rooms: Room[];
  tenants: Tenant[];
  leases: Lease[];
  invoices: Invoice[];
  payments: Payment[];
  expenses: Expense[];
  tickets: Ticket[];
  settings: Settings;
};
export type MeterDraft = {
  rent: Satang;
  waterOld: number;
  waterNew: number;
  electricOld: number;
  electricNew: number;
  waterRate: Satang;
  electricRate: Satang;
  commonFee: Satang;
  discount: Satang;
};
export type PaymentDraft = {
  invoiceId: string;
  amount: string;
  method: Payment["method"];
  date: string;
  reference: string;
};
export type ExpenseDraft = Omit<Expense, "id" | "amount"> & { amount: string };
export type TicketDraft = Omit<Ticket, "id" | "date" | "status">;
export type BillDraft = { room: string; month: string; meters: MeterDraft };
export const DEMO_TODAY = "2026-10-15";
export const DEFAULT_MONTH = "2026-10";
export const months = [
  "2026-05",
  "2026-06",
  "2026-07",
  "2026-08",
  "2026-09",
  "2026-10",
];
