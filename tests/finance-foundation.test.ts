import { describe, expect, it } from "vitest";
import {
  calculateProratedRent,
  calculateUsageCharge,
} from "../src/server/finance/calculations";

describe("Stage 3A exact calculations", () => {
  it.each([
    ["2026-02-01", "2026-02-28"],
    ["2028-02-01", "2028-02-29"],
    ["2026-04-01", "2026-04-30"],
    ["2026-01-01", "2026-01-31"],
  ])("keeps full-month rent exact for %s", (start, end) => {
    expect(
      calculateProratedRent({
        monthlyRent: "7500.00",
        leaseStartsOn: start,
        leaseEndsOn: end,
        periodStartsOn: start,
        periodEndsOn: end,
      }).amount,
    ).toBe("7500.00");
  });

  it("counts inclusive occupancy and rounds once with ROUND_HALF_UP", () => {
    expect(
      calculateProratedRent({
        monthlyRent: "7500.00",
        leaseStartsOn: "2026-02-10",
        leaseEndsOn: "2026-12-31",
        periodStartsOn: "2026-02-01",
        periodEndsOn: "2026-02-28",
      }),
    ).toMatchObject({ occupiedDays: 19, periodDays: 28, amount: "5089.29" });
  });

  it("rejects no overlap, invalid dates, and excess money scale", () => {
    expect(() =>
      calculateProratedRent({
        monthlyRent: "1.005",
        leaseStartsOn: "2026-02-01",
        leaseEndsOn: "2026-02-28",
        periodStartsOn: "2026-02-01",
        periodEndsOn: "2026-02-28",
      }),
    ).toThrow();
    expect(() =>
      calculateProratedRent({
        monthlyRent: "1.00",
        leaseStartsOn: "2026-02-30",
        leaseEndsOn: "2026-03-01",
        periodStartsOn: "2026-02-01",
        periodEndsOn: "2026-02-28",
      }),
    ).toThrow();
    expect(() =>
      calculateProratedRent({
        monthlyRent: "1.00",
        leaseStartsOn: "2026-03-01",
        leaseEndsOn: "2026-03-31",
        periodStartsOn: "2026-02-01",
        periodEndsOn: "2026-02-28",
      }),
    ).toThrow();
  });

  it("calculates usage exactly and rejects chronology or excess scales", () => {
    expect(
      calculateUsageCharge({
        previousReading: "100.125",
        currentReading: "103.125",
        unitRate: "8.3350",
      }),
    ).toEqual({
      usage: "3.000",
      unitRate: "8.3350",
      unroundedAmount: "25.005",
      amount: "25.01",
    });
    expect(() =>
      calculateUsageCharge({
        previousReading: "2",
        currentReading: "1",
        unitRate: "8",
      }),
    ).toThrow();
    expect(() =>
      calculateUsageCharge({
        previousReading: "1.0001",
        currentReading: "2",
        unitRate: "8",
      }),
    ).toThrow();
    expect(() =>
      calculateUsageCharge({
        previousReading: "1",
        currentReading: "2",
        unitRate: "8.00001",
      }),
    ).toThrow();
  });
});
