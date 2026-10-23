import { describe, expect, it } from "vitest";
import {
  createPaymentInput,
  confirmPaymentInput,
  positivePaymentMoney,
  receiptSnapshotSchema,
} from "../src/server/payments/contracts";
import {
  outstanding,
  fingerprint,
  bangkokDay,
  receiptMonth,
  receiptNumber,
  verifiedReceipt,
} from "../src/server/payments/domain";
const id = "11111111-1111-4111-8111-111111111111";
const base = {
  leaseId: id,
  amount: "1.00",
  method: "CASH",
  receivedAt: "2026-10-01T10:00:00+07:00",
  commandKey: "synthetic-key",
};
describe("managed payment boundaries and exact money", () => {
  it.each(["0.00", "1", "1.001", "01.00", "-1.00", "1e2", "1000000000000.00"])(
    "rejects invalid amount %s",
    (amount) =>
      expect(positivePaymentMoney.safeParse(amount).success).toBe(false),
  );
  it("retains twelve integer digits without Number arithmetic", () => {
    expect(positivePaymentMoney.parse("999999999999.99")).toBe(
      "999999999999.99",
    );
    expect(outstanding("999999999999.99", "999999999999.98", "ISSUED")).toBe(
      "0.01",
    );
    expect(outstanding("0.30", "0.10", "ISSUED")).toBe("0.20");
    expect(outstanding("0.30", "0.30", "ISSUED")).toBe("0.00");
    expect(outstanding("0.30", "0.00", "VOID")).toBe("0.00");
    expect(() => outstanding("0.30", "0.31", "ISSUED")).toThrow();
  });
  it("rejects bank payments without both identities and cash with bank identity", () => {
    expect(createPaymentInput.parse(base).method).toBe("CASH");
    expect(
      createPaymentInput.safeParse({
        ...base,
        method: "BANK_TRANSFER",
        externalReference: "bank-1",
      }).success,
    ).toBe(false);
    expect(
      createPaymentInput.safeParse({ ...base, externalReference: "bank-1" })
        .success,
    ).toBe(false);
    expect(
      createPaymentInput.parse({
        ...base,
        method: "BANK_TRANSFER",
        externalReference: " Ref ",
        receivingAccountKey: " Account ",
      }),
    ).toMatchObject({
      externalReference: "Ref",
      receivingAccountKey: "Account",
    });
  });
  it("rejects forged financial fields, timezone-free dates and duplicate allocations", () => {
    expect(
      createPaymentInput.safeParse({ ...base, status: "CONFIRMED" }).success,
    ).toBe(false);
    expect(
      createPaymentInput.safeParse({
        ...base,
        receivedAt: "2026-10-01T10:00:00",
      }).success,
    ).toBe(false);
    expect(
      confirmPaymentInput.safeParse({
        paymentId: id,
        expectedVersion: 1,
        commandKey: "synthetic-key",
        allocations: [
          { invoiceId: id, amount: "1.00", expectedVersion: 1 },
          { invoiceId: id, amount: "1.00", expectedVersion: 1 },
        ],
      }).success,
    ).toBe(false);
  });
  it("normalizes UUID casing before checking duplicate invoice IDs", () => {
    const mixed = "abcdefab-abcd-4abc-8abc-abcdefabcdef";
    expect(
      confirmPaymentInput.safeParse({
        paymentId: id,
        expectedVersion: 1,
        commandKey: "synthetic-key",
        allocations: [
          { invoiceId: mixed, expectedVersion: 1, amount: "1.00" },
          {
            invoiceId: mixed.toUpperCase(),
            expectedVersion: 1,
            amount: "1.00",
          },
        ],
      }).success,
    ).toBe(false);
  });
  it("uses the Bangkok calendar at UTC day and month boundaries", () => {
    expect(bangkokDay(new Date("2026-09-30T16:59:59.999Z"))).toBe("2026-09-30");
    expect(bangkokDay(new Date("2026-09-30T17:00:00.000Z"))).toBe("2026-10-01");
    expect(receiptMonth(new Date("2026-09-30T17:00:00.000Z"))).toBe("202610");
    expect(receiptNumber("202610", 1)).toBe("REC-202610-0001");
    expect(receiptNumber("202610", 9999)).toBe("REC-202610-9999");
    expect(() => receiptNumber("202610", 10000)).toThrow();
    expect(() => receiptNumber("202613", 1)).toThrow();
  });
  it("canonicalizes keys, preserves array order and detects immutable snapshot edits", () => {
    expect(fingerprint({ b: 1, a: { y: 2, x: 3 } })).toBe(
      fingerprint({ a: { x: 3, y: 2 }, b: 1 }),
    );
    expect(fingerprint([1, 2])).not.toBe(fingerprint([2, 1]));
    const snapshot = receiptSnapshotSchema.parse({
      schemaVersion: "receipt.v1",
      paymentId: id,
      reference: "PAY-synthetic",
      amount: "1.00",
      method: "CASH",
      receivedAt: "2026-10-01T00:00:00.000Z",
      externalReference: null,
      issuedAt: "2026-10-01T00:00:00.000Z",
      issuedBy: { id, name: "Synthetic issuer" },
      number: "REC-202610-0001",
      invoices: [
        {
          invoiceId: id,
          number: "INV-202610-0001",
          frozenLeaseId: id,
          frozenTenantId: id,
          labels: { property: "Synthetic", tenant: "Synthetic", room: "T01" },
          finalTotal: "1.00",
          allocatedAmount: "1.00",
        },
      ],
    });
    expect(verifiedReceipt(snapshot, fingerprint(snapshot))).toEqual(snapshot);
    expect(() =>
      verifiedReceipt({ ...snapshot, amount: "2.00" }, fingerprint(snapshot)),
    ).toThrow();
  });
});
