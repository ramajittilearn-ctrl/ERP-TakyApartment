import { z } from "zod";
import {
  deductionDepositInput,
  receiptDepositInput,
  refundDepositInput,
  reversalDepositInput,
  reviewDepositInput,
} from "../../server/deposits/contracts";

export type DepositOperation =
  "review" | "receipts" | "deductions" | "refunds" | "reverse";
export const depositLabels = {
  OPENING: "ยอดตั้งต้นที่ทบทวนแล้ว",
  RECEIPT: "รับเงินประกัน",
  REFUND: "คืนเงินประกัน",
  DEDUCTION: "หักเงินประกัน",
  REVERSAL: "กลับรายการ",
};
export const operationLabels: Record<DepositOperation, string> = {
  review: "ทบทวนยอดตั้งต้น",
  receipts: "รับเงินประกัน",
  deductions: "หักเงินประกัน",
  refunds: "คืนเงินประกัน",
  reverse: "กลับรายการเต็มจำนวน",
};
export function depositAmount(input: string, allowZero = false) {
  if (!/^(?:0|[1-9]\d{0,11})(?:\.\d{1,2})?$/.test(input))
    throw new Error(
      "ระบุจำนวนเงินเป็นทศนิยมไม่เกิน 2 ตำแหน่ง ไม่ใช้เครื่องหมายคั่นหรือเลขยกกำลัง",
    );
  const [whole, fraction = ""] = input.split(".");
  const result = `${whole}.${fraction.padEnd(2, "0")}`;
  if (!allowZero && result === "0.00")
    throw new Error("จำนวนเงินต้องมากกว่าศูนย์");
  return result;
}
export function depositMoneyLabel(value: string | null) {
  if (value === null) return "ไม่สามารถยืนยันยอดได้";
  const [whole, fraction] = value.split(".");
  return `${whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",")}.${fraction} บาท`;
}
export function depositTime(value: string) {
  return new Intl.DateTimeFormat("th-TH", {
    timeZone: "Asia/Bangkok",
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}
export function depositNow() {
  return new Date(Date.now() + 7 * 3600000).toISOString().slice(0, 16);
}
export function depositOccurredAt(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value))
    throw new Error("ระบุวันและเวลาให้ครบ");
  const date = new Date(`${value}:00Z`);
  if (
    !Number.isFinite(date.getTime()) ||
    date.toISOString().slice(0, 16) !== value
  )
    throw new Error("วันหรือเวลาไม่ถูกต้อง");
  return `${value}:00+07:00`;
}
export type DepositDraft = {
  amount: string;
  occurredAt: string;
  reason: string;
  evidenceId: string;
  method: "CASH" | "BANK_TRANSFER";
  receivingAccountKey: string;
  externalReference: string;
  payeeName: string;
  outgoingReference: string;
  destination: string;
  verified: boolean;
};
export function depositCommand(
  operation: DepositOperation,
  draft: DepositDraft,
  identity: {
    leaseId: string;
    expectedVersion: number;
    commandKey: string;
    entryId?: string;
  },
) {
  if (!draft.verified)
    throw new Error(
      "ต้องยืนยันว่าได้ตรวจสอบเงินหรือการชำระบัญชีและหลักฐานแล้ว",
    );
  const base = {
    leaseId: identity.leaseId,
    expectedVersion: identity.expectedVersion,
    commandKey: identity.commandKey,
    evidenceId: draft.evidenceId,
    reason: draft.reason,
  };
  if (operation === "review")
    return reviewDepositInput.parse({
      ...base,
      openingAmount: depositAmount(draft.amount, true),
      verified: true,
    });
  if (operation === "reverse")
    return reversalDepositInput.parse({
      ...base,
      entryId: identity.entryId,
      occurredAt: depositOccurredAt(draft.occurredAt),
      verified: true,
    });
  const movement = {
    ...base,
    amount: depositAmount(draft.amount),
    occurredAt: depositOccurredAt(draft.occurredAt),
  };
  if (operation === "deductions")
    return deductionDepositInput.parse({ ...movement, verified: true });
  if (operation === "receipts")
    return receiptDepositInput.parse(
      draft.method === "CASH"
        ? { ...movement, verified: true, method: "CASH" }
        : {
            ...movement,
            verified: true,
            method: "BANK_TRANSFER",
            receivingAccountKey: draft.receivingAccountKey,
            externalReference: draft.externalReference,
          },
    );
  return refundDepositInput.parse(
    draft.method === "CASH"
      ? {
          ...movement,
          settlementReviewed: true,
          method: "CASH",
          payeeName: draft.payeeName,
        }
      : {
          ...movement,
          settlementReviewed: true,
          method: "BANK_TRANSFER",
          payeeName: draft.payeeName,
          outgoingReference: draft.outgoingReference,
          destination: draft.destination,
        },
  );
}
export function commandTransport(
  operation: DepositOperation,
  command:
    | z.infer<typeof reviewDepositInput>
    | z.infer<typeof receiptDepositInput>
    | z.infer<typeof refundDepositInput>
    | z.infer<typeof deductionDepositInput>
    | z.infer<typeof reversalDepositInput>,
) {
  if (operation === "reverse") {
    const parsed = reversalDepositInput.parse(command);
    const { entryId, ...body } = parsed;
    return { path: `/api/v1/deposit-entries/${entryId}/reverse/`, body };
  }
  const { leaseId, ...body } = command;
  return { path: `/api/v1/leases/${leaseId}/deposits/${operation}/`, body };
}
