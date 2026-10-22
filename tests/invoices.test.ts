import { describe, expect, it } from "vitest";
import {
  duePolicyInput,
  updateDraftInput,
  reviseInvoiceInput,
  invoiceListInput,
} from "../src/server/invoices/contracts";
import { canonicalFingerprint } from "../src/server/invoices/service";
const id = "11111111-1111-4111-8111-111111111111";
describe("invoice boundary contracts", () => {
  it("requires explicit due policy without silently choosing days", () => {
    expect(
      duePolicyInput.safeParse({
        propertyId: id,
        expectedVersion: 0,
        commandKey: "test-key",
      }).success,
    ).toBe(false);
    expect(
      duePolicyInput.parse({
        propertyId: id,
        offsetDays: 0,
        expectedVersion: 0,
        commandKey: "test-key",
      }).offsetDays,
    ).toBe(0);
  });
  it.each([-1, 366, 1.5])(
    "rejects unsupported policy offset %s",
    (offsetDays) => {
      expect(
        duePolicyInput.safeParse({
          propertyId: id,
          offsetDays,
          expectedVersion: 0,
          commandKey: "test-key",
        }).success,
      ).toBe(false);
    },
  );
  it("rejects caller totals and unsupported actual reconciliation inputs", () => {
    const base = {
      invoiceId: id,
      expectedVersion: 1,
      commandKey: "test-key",
      reason: "Correct documented typo",
      evidence: ["record:1"],
    };
    expect(
      reviseInvoiceInput.safeParse({
        ...base,
        correction: { finalTotal: "1.00" },
      }).success,
    ).toBe(false);
    expect(
      reviseInvoiceInput.safeParse({
        ...base,
        correction: { utilities: [{ kind: "WATER", currentReadingId: id }] },
      }).success,
    ).toBe(false);
  });
  it("requires revision evidence and a nonempty supported correction", () => {
    const base = {
      invoiceId: id,
      expectedVersion: 1,
      commandKey: "test-key",
      reason: "Correction",
      evidence: ["record:1"],
    };
    expect(
      reviseInvoiceInput.safeParse({ ...base, correction: {} }).success,
    ).toBe(false);
    expect(
      reviseInvoiceInput.safeParse({
        ...base,
        evidence: [],
        correction: { useCurrentContract: true },
      }).success,
    ).toBe(false);
  });
  it("rejects duplicate utility changes and nondecimal quantities", () => {
    const base = {
      invoiceId: id,
      expectedVersion: 1,
      commandKey: "test-key",
      reason: "Correction",
      evidence: ["record:1"],
    };
    expect(
      reviseInvoiceInput.safeParse({
        ...base,
        correction: {
          utilities: [
            { kind: "WATER", quantity: "1" },
            { kind: "WATER", quantity: "2" },
          ],
        },
      }).success,
    ).toBe(false);
    expect(
      reviseInvoiceInput.safeParse({
        ...base,
        correction: { utilities: [{ kind: "WATER", quantity: 1 }] },
      }).success,
    ).toBe(false);
  });
  it("rejects invalid override dates and missing reasons", () => {
    const base = { invoiceId: id, expectedVersion: 1, commandKey: "test-key" };
    expect(
      updateDraftInput.safeParse({
        ...base,
        dueOverride: { dueDate: "2026-02-30", reason: "x" },
      }).success,
    ).toBe(false);
    expect(
      updateDraftInput.safeParse({
        ...base,
        dueOverride: { dueDate: "2026-03-01", reason: " " },
      }).success,
    ).toBe(false);
  });
  it("rejects extra filters and normalizes fingerprints deterministically", () => {
    expect(invoiceListInput.safeParse({ unexpected: true }).success).toBe(
      false,
    );
    expect(canonicalFingerprint({ b: 2, a: { z: "1", x: undefined } })).toBe(
      canonicalFingerprint({ a: { z: "1" }, b: 2 }),
    );
    expect(canonicalFingerprint({ a: "1" })).not.toBe(
      canonicalFingerprint({ a: "2" }),
    );
  });
});
