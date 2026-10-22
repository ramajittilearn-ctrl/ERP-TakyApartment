import { describe, expect, it } from "vitest";
import {
  expiringWithin30Days,
  sumMoney,
} from "../src/features/live/lease-summary";
describe("persistent lease summaries", () => {
  it("adds database decimal strings exactly, including fractional baht", () => {
    expect(sumMoney(["3500.25", "0.10", "0.20"])).toBe("3500.55");
    expect(sumMoney(["999999999999.99", "0.01"])).toBe("1000000000000.00");
    expect(sumMoney([])).toBe("0.00");
  });
  it("includes the 30-day boundary but excludes overdue and ended leases", () => {
    expect(
      expiringWithin30Days(
        { status: "ACTIVE", endDate: "2026-11-15T00:00:00Z" },
        "2026-10-16",
      ),
    ).toBe(true);
    expect(
      expiringWithin30Days(
        { status: "ACTIVE", endDate: "2026-11-16T00:00:00Z" },
        "2026-10-16",
      ),
    ).toBe(false);
    expect(
      expiringWithin30Days(
        { status: "ACTIVE", endDate: "2026-10-15T00:00:00Z" },
        "2026-10-16",
      ),
    ).toBe(false);
    expect(
      expiringWithin30Days(
        { status: "ENDED", endDate: "2026-10-20T00:00:00Z" },
        "2026-10-16",
      ),
    ).toBe(false);
  });
});
