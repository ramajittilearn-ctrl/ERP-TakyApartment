// Display contract only. Phase 2.6 does not derive or persist payment status.
export const paymentStatusLabels = {
  PAID: "ชำระแล้ว",
  UNPAID: "ยังไม่ชำระ",
  PARTIAL: "ชำระบางส่วน",
  OVERDUE: "ค้างชำระ",
  UNAVAILABLE: "Not Available — Phase 3",
} as const;
export type PaymentDisplayStatus = keyof typeof paymentStatusLabels;
