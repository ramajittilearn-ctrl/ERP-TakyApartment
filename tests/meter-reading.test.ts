import { describe, expect, it } from "vitest";
import {
  calculateConsumption,
  calculateReplacementConsumption,
  canonicalReading,
  assertReadingDateNotFuture,
  todayInBangkok,
} from "../src/server/meter";

describe("Stage 3B exact meter calculations", () => {
  it("preserves three-place physical precision", () => {
    expect(canonicalReading("100.125")).toBe("100.125");
    expect(canonicalReading("100")).toBe("100.000");
    expect(
      calculateConsumption({
        previousReading: "999999.999",
        currentReading: "1000000.001",
      }),
    ).toBe("0.002");
  });

  it("rejects negative usage, invalid input, excess scale, and overflow", () => {
    expect(() =>
      calculateConsumption({
        previousReading: "2.000",
        currentReading: "1.999",
      }),
    ).toThrowError(expect.objectContaining({ code: "NEGATIVE_USAGE" }));
    for (const invalid of [
      "",
      "-1",
      "1e3",
      "1.0001",
      "NaN",
      "100000000000.000",
    ])
      expect(() => canonicalReading(invalid)).toThrow();
  });

  it("keeps replacement identities separate", () => {
    expect(
      calculateReplacementConsumption({
        previousOldMeterReading: "900.000",
        finalOldMeterReading: "910.250",
        initialNewMeterReading: "3.125",
      }),
    ).toEqual({
      oldMeterConsumption: "10.250",
      newMeterOpeningReading: "3.125",
    });
  });

  it("uses the Bangkok calendar date and rejects future reading dates", () => {
    const nearMidnightUtc = new Date("2026-10-18T18:30:00.000Z");
    expect(todayInBangkok(nearMidnightUtc)).toBe("2026-10-19");
    expect(assertReadingDateNotFuture("2026-10-18", nearMidnightUtc)).toBe(
      "2026-10-18",
    );
    expect(() =>
      assertReadingDateNotFuture("2026-10-20", nearMidnightUtc),
    ).toThrowError(expect.objectContaining({ code: "FUTURE_READING_DATE" }));
  });
});
