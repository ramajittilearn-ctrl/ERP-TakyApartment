import { z } from "zod";
import {
  satangSchema,
  type DemoState,
  type Invoice,
  type InvoiceLine,
  type MeterDraft,
  type Result,
  type Satang,
} from "./model";

export function parseAmount(value: string): Result<Satang> {
  if (!/^\d+(\.\d{1,2})?$/.test(value.trim()))
    return {
      ok: false,
      error: "กรุณาระบุจำนวนเงินให้ถูกต้อง ไม่เกิน 2 ตำแหน่งทศนิยม",
    };
  const result = satangSchema.safeParse(Math.round(Number(value) * 100));
  if (!result.success || result.data <= 0)
    return {
      ok: false,
      error: "จำนวนเงินต้องมากกว่า 0 และอยู่ในช่วงที่รองรับ",
    };
  return { ok: true, value: result.data };
}

export function calculateBill(draft: MeterDraft): Result<InvoiceLine[]> {
  const readings = [
    draft.waterOld,
    draft.waterNew,
    draft.electricOld,
    draft.electricNew,
  ];
  if (
    readings.some(
      (value) =>
        !Number.isFinite(value) ||
        value < 0 ||
        value > 99999999 ||
        !Number.isInteger(value),
    )
  )
    return {
      ok: false,
      error: "กรุณากรอกเลขมิเตอร์เป็นจำนวนเต็มตั้งแต่ 0 ถึง 99,999,999",
    };
  if (draft.waterNew < draft.waterOld || draft.electricNew < draft.electricOld)
    return { ok: false, error: "มิเตอร์ปัจจุบันต้องไม่ต่ำกว่าครั้งก่อน" };
  const lines: InvoiceLine[] = [
    { label: "ค่าเช่าห้อง", quantity: 1, unitPrice: draft.rent },
    {
      label: "ค่าน้ำ",
      quantity: draft.waterNew - draft.waterOld,
      unitPrice: draft.waterRate,
    },
    {
      label: "ค่าไฟ",
      quantity: draft.electricNew - draft.electricOld,
      unitPrice: draft.electricRate,
    },
    { label: "ค่าส่วนกลาง", quantity: 1, unitPrice: draft.commonFee },
  ];
  if (draft.discount > 0)
    lines.push({ label: "ส่วนลด", quantity: -1, unitPrice: draft.discount });
  const total = lineTotal(lines);
  if (!Number.isSafeInteger(total) || total <= 0)
    return {
      ok: false,
      error: "ยอดรวมต้องมากกว่า 0 กรุณาตรวจสอบส่วนลดและอัตราค่าบริการ",
    };
  return { ok: true, value: lines };
}

export function lineTotal(lines: InvoiceLine[]): number {
  return lines.reduce(
    (sum, line) => sum + Math.round(line.quantity * line.unitPrice),
    0,
  );
}
export function invoiceTotal(invoice: Invoice): number {
  return lineTotal(invoice.lines);
}
export function paymentTotal(payment: DemoState["payments"][number]): number {
  return payment.allocations.reduce((sum, a) => sum + a.amount, 0);
}
export function invoicePaid(state: DemoState, invoice: Invoice): number {
  return state.payments
    .filter((p) => p.status === "confirmed")
    .flatMap((p) => p.allocations)
    .filter((a) => a.invoiceId === invoice.id)
    .reduce((sum, a) => sum + a.amount, 0);
}
export function invoiceBalance(state: DemoState, invoice: Invoice): number {
  return invoiceTotal(invoice) - invoicePaid(state, invoice);
}
export function invoiceStatus(state: DemoState, invoice: Invoice) {
  const balance = invoiceBalance(state, invoice);
  if (balance === 0) return "paid";
  if (invoicePaid(state, invoice) > 0) return "partial";
  return "unpaid";
}
export function summarizeMonth(state: DemoState, month: string) {
  const invoices = state.invoices.filter((i) => i.month === month);
  const billed = invoices.reduce((sum, i) => sum + invoiceTotal(i), 0);
  const received = state.payments
    .filter((p) => p.status === "confirmed" && p.date.startsWith(month))
    .reduce((sum, p) => sum + paymentTotal(p), 0);
  const outstanding = invoices.reduce(
    (sum, i) => sum + invoiceBalance(state, i),
    0,
  );
  const expenses = state.expenses.filter((e) => e.date.startsWith(month));
  const opex = expenses
    .filter((e) => e.kind === "OPEX")
    .reduce((sum, e) => sum + e.amount, 0);
  const capex = expenses
    .filter((e) => e.kind === "CAPEX")
    .reduce((sum, e) => sum + e.amount, 0);
  return {
    billed,
    received,
    outstanding,
    opex,
    capex,
    operatingCash: received - opex,
    netCash: received - opex - capex,
  };
}
export function tenantForRoom(state: DemoState, room: string) {
  const lease = state.leases.find(
    (l) => l.room === room && l.status === "active",
  );
  return state.tenants.find((t) => t.id === lease?.tenantId);
}
export function roomOutstanding(
  state: DemoState,
  room: string,
  month: string,
): number {
  return state.invoices
    .filter((i) => i.room === room && i.month === month)
    .reduce((sum, i) => sum + invoiceBalance(state, i), 0);
}
export const validDate = z.iso.date();
export const validMonth = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/);
