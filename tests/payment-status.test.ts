import { expect, it } from "vitest";
import { paymentStatusLabels } from "../src/features/live/payment-status";
it.each([
  ["PAID", "ชำระแล้ว"],
  ["UNPAID", "ยังไม่ชำระ"],
  ["PARTIAL", "ชำระบางส่วน"],
  ["OVERDUE", "ค้างชำระ"],
  ["UNAVAILABLE", "Not Available — Phase 3"],
] as const)(
  "defines the future %s display without fabricating payment data",
  (status, label) => {
    expect(paymentStatusLabels[status]).toBe(label);
  },
);
