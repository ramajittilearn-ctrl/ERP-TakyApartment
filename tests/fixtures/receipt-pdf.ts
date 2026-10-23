import {
  receiptDtoSchema,
  type ReceiptDto,
} from "../../src/server/payments/contracts";
import { fingerprint } from "../../src/server/payments/domain";

function id(value: number) {
  return `00000000-0000-4000-8000-${String(value).padStart(12, "0")}`;
}

export function receiptPdfFixture(): ReceiptDto {
  const snapshot = {
    schemaVersion: "receipt.v1",
    paymentId: id(1),
    reference: "PAY-SYNTHETIC-RECORD",
    amount: "0.30",
    method: "BANK_TRANSFER",
    receivedAt: "2026-10-22T18:01:02.000Z",
    externalReference: "SYNTHETIC-BANK-REFERENCE",
    issuedAt: "2026-10-22T18:05:06.000Z",
    issuedBy: { id: id(2), name: "เจ้าหน้าที่ สมมติ / Synthetic operator" },
    number: "REC-202610-0042",
    invoices: [1, 2].map((value) => ({
      invoiceId: id(value + 10),
      number: `INV-SYNTHETIC-${value}`,
      frozenLeaseId: id(3),
      frozenTenantId: id(4),
      labels: {
        property: "ที่พักสมมติ / Synthetic residence m³",
        propertyAddress: "99 ถนนสมมติ กรุงเทพมหานคร / Synthetic address",
        room: `A-20${value}`,
        tenant: "ผู้เช่าสมมติ / Synthetic tenant",
        leaseNumber: "LEASE-SYNTHETIC-204",
      },
      finalTotal: value === 1 ? "1000.10" : "2000.20",
      allocatedAmount: value === 1 ? "0.10" : "0.20",
    })),
  };
  return receiptDtoSchema.parse({
    id: id(5),
    number: snapshot.number,
    paymentId: snapshot.paymentId,
    fingerprint: fingerprint(snapshot),
    snapshot,
    cancellation: null,
  });
}

export function receiptPdfCases(): Record<string, ReceiptDto> {
  const normal = receiptPdfFixture();
  const cancelled = structuredClone(normal);
  cancelled.cancellation = {
    id: id(6),
    reversalId: id(7),
    actorId: id(8),
    createdAt: "2026-10-23T19:01:02.000Z",
    reason: "ยกเลิกรายการสมมติ / Synthetic reversal reason",
  };
  const long = structuredClone(cancelled);
  long.snapshot.invoices[0].labels.propertyAddress =
    "ที่อยู่สมมติสำหรับทดสอบการตัดบรรทัดและแบ่งหน้ากระดาษ ".repeat(80) +
    " ADDRESS-END";
  long.snapshot.invoices[0].labels.tenant =
    "ผู้เช่าสมมติ".repeat(80) + " TENANT-END";
  if (long.cancellation)
    long.cancellation.reason = "เหตุผลสมมติ".repeat(80) + " REASON-END";
  long.fingerprint = fingerprint(long.snapshot);
  const hundred = receiptPdfFixture();
  hundred.snapshot.amount = "100.00";
  hundred.snapshot.invoices = Array.from({ length: 100 }, (_, index) => ({
    ...structuredClone(normal.snapshot.invoices[0]),
    invoiceId: id(index + 100),
    number: `INV-SYNTHETIC-${String(index + 1).padStart(3, "0")}`,
    allocatedAmount: "1.00",
  }));
  hundred.fingerprint = fingerprint(hundred.snapshot);
  const maximum = receiptPdfFixture();
  maximum.snapshot.amount = "999999999999.99";
  maximum.snapshot.invoices = [
    {
      ...maximum.snapshot.invoices[0],
      finalTotal: "999999999999.99",
      allocatedAmount: "999999999999.99",
    },
  ];
  maximum.fingerprint = fingerprint(maximum.snapshot);
  return { normal, cancelled, long, hundred, maximum };
}
