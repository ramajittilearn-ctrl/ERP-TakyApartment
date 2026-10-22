import { describe, expect, it } from "vitest";
import { createFixtures } from "../src/demo/fixtures";
import {
  addExpense,
  issueInvoice,
  recordPayment,
  saveRoom,
  saveSettings,
} from "../src/demo/commands";
import {
  calculateBill,
  invoiceBalance,
  invoiceTotal,
  parseAmount,
  summarizeMonth,
} from "../src/demo/finance";
import { baht, type MeterDraft } from "../src/demo/model";

const meters: MeterDraft = {
  rent: baht(3500),
  waterOld: 120,
  waterNew: 130,
  electricOld: 1250,
  electricNew: 1350,
  waterRate: baht(20),
  electricRate: baht(8),
  commonFee: baht(100),
  discount: baht(0),
};
describe("billing amounts and validation", () => {
  it("calculates exact line items and a 4,600-baht bill", () => {
    const result = calculateBill(meters);
    expect(result).toEqual({
      ok: true,
      value: [
        { label: "ค่าเช่าห้อง", quantity: 1, unitPrice: 350000 },
        { label: "ค่าน้ำ", quantity: 10, unitPrice: 2000 },
        { label: "ค่าไฟ", quantity: 100, unitPrice: 800 },
        { label: "ค่าส่วนกลาง", quantity: 1, unitPrice: 10000 },
      ],
    });
    if (result.ok)
      expect(
        result.value.reduce((sum, l) => sum + l.quantity * l.unitPrice, 0),
      ).toBe(460000);
  });
  it.each([NaN, Infinity, -1, 1.5, 100000000])(
    "rejects invalid reading %s",
    (reading) =>
      expect(calculateBill({ ...meters, waterNew: reading }).ok).toBe(false),
  );
  it("rejects lower readings and a discount greater than the invoice", () => {
    expect(calculateBill({ ...meters, waterNew: 110 })).toMatchObject({
      ok: false,
      error: "มิเตอร์ปัจจุบันต้องไม่ต่ำกว่าครั้งก่อน",
    });
    expect(calculateBill({ ...meters, discount: baht(5000) }).ok).toBe(false);
  });
  it.each(["", "0", "-1", "1.001", "NaN", "1e5", "Infinity"])(
    "rejects invalid money %s",
    (input) => expect(parseAmount(input).ok).toBe(false),
  );
  it("parses decimal money as integer satang", () =>
    expect(parseAmount("100.25")).toEqual({ ok: true, value: 10025 }));
});

describe("coherent demo financial state", () => {
  it("matches the reference totals and excludes deposits and pending transfers", () => {
    const state = createFixtures();
    expect(summarizeMonth(state, "2026-10")).toEqual({
      billed: 5250000,
      received: 4800000,
      outstanding: 450000,
      opex: 670000,
      capex: 1800000,
      operatingCash: 4130000,
      netCash: 2330000,
    });
    expect(state.leases.reduce((sum, l) => sum + l.deposit, 0)).toBe(8400000);
    expect(
      summarizeMonth(
        {
          ...state,
          payments: state.payments.filter((p) => p.status !== "pending"),
        },
        "2026-10",
      ),
    ).toEqual(summarizeMonth(state, "2026-10"));
    expect(state.invoices.every((i) => invoiceTotal(i) > 0)).toBe(true);
  });
  it("records a partial payment and updates balance and receipts exactly once", () => {
    const state = createFixtures();
    const invoice = state.invoices.find((i) => i.id === "inv-2026-10-102");
    expect(invoice).toBeDefined();
    if (!invoice) throw new Error("missing fixture");
    const draft = {
      invoiceId: invoice.id,
      amount: "500.25",
      method: "transfer" as const,
      date: "2026-10-15",
      reference: "TEST-PARTIAL",
    };
    const result = recordPayment(state, draft);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.error);
    expect(invoiceBalance(result.value, invoice)).toBe(99975);
    expect(summarizeMonth(result.value, "2026-10")).toMatchObject({
      received: 4850025,
      outstanding: 399975,
    });
    expect(recordPayment(result.value, draft)).toMatchObject({
      ok: false,
      error: "เลขอ้างอิงนี้ถูกใช้แล้ว กรุณาตรวจสอบรายการซ้ำ",
    });
    expect(state.payments).toHaveLength(73);
  });
  it("rejects over-allocation, future dates and missing references", () => {
    const state = createFixtures();
    const draft = {
      invoiceId: "inv-2026-10-102",
      amount: "1500.01",
      method: "cash" as const,
      date: "2026-10-15",
      reference: "OVER",
    };
    expect(recordPayment(state, draft)).toMatchObject({
      ok: false,
      error: "ยอดชำระเกินยอดค้างของใบแจ้งหนี้",
    });
    expect(
      recordPayment(state, { ...draft, amount: "1", date: "2026-10-16" }).ok,
    ).toBe(false);
    expect(
      recordPayment(state, { ...draft, amount: "1", reference: " " }).ok,
    ).toBe(false);
  });
  it("freezes issued line amounts, prevents duplicate monthly invoices and keeps deposit separate", () => {
    const state = createFixtures();
    const issued = issueInvoice(state, {
      room: "101",
      month: "2026-11",
      meters,
    });
    expect(issued.ok).toBe(true);
    if (!issued.ok) throw new Error(issued.error);
    expect(summarizeMonth(issued.value, "2026-11")).toMatchObject({
      billed: 460000,
      outstanding: 460000,
      received: 0,
    });
    expect(
      issueInvoice(issued.value, { room: "101", month: "2026-11", meters }).ok,
    ).toBe(false);
    const changed = saveSettings(issued.value, {
      ...state.settings,
      waterRate: baht(25),
    });
    if (!changed.ok) throw new Error(changed.error);
    expect(
      changed.value.invoices
        .find((i) => i.month === "2026-11")
        ?.lines.find((l) => l.label === "ค่าน้ำ")?.unitPrice,
    ).toBe(2000);
  });
  it("classifies OPEX and CAPEX separately in cash flow", () => {
    const state = createFixtures();
    const result = addExpense(state, {
      date: "2026-10-15",
      title: "Demo service",
      vendor: "Example",
      category: "บริการ",
      kind: "OPEX",
      amount: "100",
      method: "cash",
      note: "",
    });
    if (!result.ok) throw new Error(result.error);
    expect(summarizeMonth(result.value, "2026-10")).toMatchObject({
      opex: 680000,
      capex: 1800000,
      netCash: 2320000,
    });
  });
  it("keeps occupied rooms tied to leases and preserves contracted rent", () => {
    const state = createFixtures();
    expect(
      saveRoom(state, { number: "101", rent: "4000", status: "vacant" }).ok,
    ).toBe(false);
    const result = saveRoom(state, {
      number: "101",
      rent: "4000",
      status: "occupied",
    });
    if (!result.ok) throw new Error(result.error);
    expect(result.value.rooms.find((r) => r.number === "101")?.rent).toBe(
      400000,
    );
    expect(result.value.leases.find((l) => l.room === "101")?.rent).toBe(
      350000,
    );
  });
});
