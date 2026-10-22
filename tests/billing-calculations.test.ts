import { describe, expect, it } from "vitest";
import {
  calculateBillingPreview,
  calculateRawUtilityCharge,
  roundBillingAmountHalfUp,
} from "../src/server/billing/calculations";
import type {
  BillingCalculationInput,
  BillingConsumption,
  BillingCalculationResult,
  BillingReading,
  BillingUtilityKind,
} from "../src/server/billing/contracts";

const approval = {
  id: "approval-1",
  approverId: "admin-1",
  approverRole: "ADMIN",
  approvedAt: "2026-10-19T01:00:00.000Z",
};
function fixture(
  startsOn = "2026-10-01",
  endsOn = "2026-10-31",
): BillingCalculationInput {
  function reading(kind: BillingUtilityKind, current: boolean): BillingReading {
    return {
      id: `${kind}-${current ? "current" : "previous"}`,
      version: "reading-v1",
      propertyId: "property-1",
      roomId: "room-1",
      meterId: `${kind}-meter`,
      kind,
      billingPeriodId: current ? "period-1" : "prior-period",
      value: current ? "20.000" : "10.000",
      readOn: current ? endsOn : "2023-12-31",
      status: "CONFIRMED",
    };
  }
  return {
    propertyId: "property-1",
    period: {
      id: "period-1",
      propertyId: "property-1",
      startsOn,
      endsOn,
      status: "OPEN",
      version: "period-v1",
    },
    lease: {
      id: "lease-1",
      propertyId: "property-1",
      roomId: "room-1",
      tenantId: "tenant-1",
      version: "lease-v1",
      rent: "1000.01",
      startsOn: "2024-01-01",
      endsOn: "2028-12-31",
    },
    utilities: (["WATER", "ELECTRICITY"] satisfies BillingUtilityKind[]).map(
      (kind) => ({
        kind,
        rate: {
          id: `${kind}-rate`,
          propertyId: "property-1",
          billingPeriodId: "period-1",
          kind,
          value: "1.0000",
          effectiveFrom: "2024-01-01",
          nextEffectiveFrom: null,
          approval: { ...approval, id: `${kind}-selection` },
        },
        consumption: {
          kind: "ACTUAL",
          previous: reading(kind, false),
          current: reading(kind, true),
          quantity: "10.000",
        },
      }),
    ),
    validationIssues: [],
  };
}
function utility(
  input: BillingCalculationInput,
  kind: BillingUtilityKind = "WATER",
) {
  const value = input.utilities.find((entry) => entry.kind === kind);
  if (!value) throw new Error("Fixture utility missing");
  return value;
}
function complete(result: BillingCalculationResult) {
  expect(result.issues).toEqual([]);
  if (result.status !== "COMPLETE")
    throw new Error(JSON.stringify(result.issues));
  return result;
}
function fails(input: unknown, code: string) {
  const result = calculateBillingPreview(input);
  expect(result.status).toBe("INCOMPLETE");
  expect(result.readyToClose).toBe(false);
  expect(result.totals).toBeNull();
  expect(result.issues.map((issue) => issue.code)).toContain(code);
  return result;
}
function estimate(quantity = "10.000") {
  return {
    kind: "ESTIMATE",
    quantity,
    reason: "Access unavailable",
    evidence: ["tenant-report:1"],
    sourceContext: "Last confirmed reading and prior use reviewed",
    approval: { ...approval },
  } satisfies NonNullable<ReturnType<typeof utility>["consumption"]>;
}
function replacement(input: BillingCalculationInput) {
  const water = utility(input);
  if (water.consumption?.kind !== "ACTUAL")
    throw new Error("Fixture actual missing");
  const original = water.consumption;
  return {
    kind: "REPLACEMENT",
    segments: [
      {
        verification: "READINGS",
        meterId: "meter-old",
        replacementIds: ["replacement-1"],
        previous: {
          ...original.previous,
          id: "old-start",
          meterId: "meter-old",
          value: "10.000",
        },
        current: {
          ...original.current,
          id: "old-end",
          meterId: "meter-old",
          readOn: "2026-10-15",
          value: "12.000",
        },
        quantity: "1.500",
        reason: "Verified old meter eligible share",
        evidence: ["photo:old"],
        approval: { ...approval },
      },
      {
        verification: "READINGS",
        meterId: "meter-new",
        replacementIds: ["replacement-1"],
        previous: {
          ...original.previous,
          id: "new-start",
          meterId: "meter-new",
          readOn: "2026-10-15",
          value: "0.000",
        },
        current: {
          ...original.current,
          id: "new-end",
          meterId: "meter-new",
          value: "3.000",
        },
        quantity: "2.500",
        reason: "Verified new meter eligible share",
        evidence: ["photo:new"],
        approval: { ...approval },
      },
    ],
  } satisfies NonNullable<ReturnType<typeof utility>["consumption"]>;
}

function evidenceReplacement(input: BillingCalculationInput) {
  const sources = replacement(input);
  return {
    kind: "REPLACEMENT",
    segments: [
      sources.segments[0],
      {
        verification: "ADMIN_EVIDENCE",
        meterId: "meter-new",
        replacementIds: ["replacement-1"],
        sourceReadings: [sources.segments[1].previous],
        startsOn: "2026-10-15",
        endsOn: "2026-10-31",
        quantity: "2.500",
        reason:
          "ADMIN verified new meter final photo against canonical opening",
        evidence: ["photo:new-final-2.500"],
        approval: { ...approval },
      },
    ],
  } satisfies BillingConsumption;
}

describe("exact billing arithmetic", () => {
  it.each([
    ["1005", "1000", "1.01"],
    ["-1005", "1000", "-1.01"],
    ["5", "1000", "0.01"],
    ["-5", "1000", "-0.01"],
    ["-4", "1000", "0.00"],
    ["1004", "1000", "1.00"],
  ])(
    "rounds signed rational %s/%s HALF_UP",
    (numerator, denominator, expected) => {
      expect(roundBillingAmountHalfUp(numerator, denominator)).toBe(expected);
    },
  );
  it("preserves the full DECIMAL(14,3) by DECIMAL(14,4) product above default Decimal precision", () => {
    expect(
      calculateRawUtilityCharge({
        quantity: "99999999999.999",
        unitRate: "9999999999.9999",
      }),
    ).toEqual({
      numerator: "9999999999999800000000000001",
      denominator: "10000000",
      decimal: "999999999999980000000.0000001",
    });
  });
  it("rejects precision beyond the input column scales", () => {
    expect(() =>
      calculateRawUtilityCharge({ quantity: "1.0001", unitRate: "1" }),
    ).toThrow(RangeError);
    expect(() =>
      calculateRawUtilityCharge({ quantity: "1", unitRate: "1.00001" }),
    ).toThrow(RangeError);
  });
  it("rounds only the exact aggregate and exposes the display reconciliation", () => {
    const input = fixture();
    input.lease.rent = "0.01";
    for (const row of input.utilities) if (row.rate) row.rate.value = "0.0005";
    const result = complete(calculateBillingPreview(input));
    expect(result.lines.map((line) => line.displayAmount)).toEqual([
      "0.01",
      "0.01",
      "0.01",
    ]);
    expect(result.totals).toEqual({
      rawTotal: { numerator: "1", denominator: "50", decimal: "0.02" },
      finalTotal: "0.02",
      displayLineTotal: "0.03",
      reconciliationDelta: "-0.01",
    });
  });
  it("blocks a final amount outside DECIMAL(14,2)", () => {
    const input = fixture();
    const water = utility(input);
    water.consumption = estimate("99999999999.999");
    if (water.rate) water.rate.value = "9999999999.9999";
    fails(input, "AMOUNT_OUT_OF_RANGE");
  });
});

describe("contractual rent and period prerequisites", () => {
  it.each([
    ["2024-02-01", "2024-02-29", 20, 29, "100001", "145", "689.66"],
    ["2025-02-01", "2025-02-28", 19, 28, "1900019", "2800", "678.58"],
  ])(
    "uses inclusive occupancy in %s",
    (
      start,
      end,
      occupiedDays,
      periodDays,
      numerator,
      denominator,
      rentDisplay,
    ) => {
      const input = fixture(start, end);
      input.lease.startsOn = `${start.slice(0, 7)}-10`;
      const result = complete(calculateBillingPreview(input));
      expect(result.snapshot.rentProration).toMatchObject({
        occupiedDays,
        periodDays,
      });
      expect(result.lines[0]).toMatchObject({
        rawAmount: { numerator, denominator },
        displayAmount: rentDisplay,
      });
    },
  );
  it("caps occupancy at the inclusive lease end", () => {
    const input = fixture();
    input.lease.startsOn = "2026-10-10";
    input.lease.endsOn = "2026-10-10";
    const result = complete(calculateBillingPreview(input));
    expect(result.snapshot.rentProration.occupiedDays).toBe(1);
    expect(result.lines[0].rawAmount).toMatchObject({
      numerator: "100001",
      denominator: "3100",
    });
  });
  it.each(["0", "0.00"])("blocks zero contractual rent %s", (rent) => {
    const input = fixture();
    input.lease.rent = rent;
    fails(input, "ZERO_RENT");
  });
  it("rejects partial month, non-overlap and invalid lease ranges", () => {
    const input = fixture();
    input.period.startsOn = "2026-10-02";
    fails(input, "INVALID_PERIOD");
    input.period.startsOn = "2026-10-01";
    input.lease.startsOn = "2026-11-01";
    fails(input, "NO_OCCUPANCY");
    input.lease.endsOn = "2026-09-30";
    fails(input, "INVALID_LEASE_DATES");
  });
  it("carries upstream ambiguity as a blocking issue without exposing a partial total", () => {
    const input = fixture();
    input.validationIssues = [
      {
        code: "OVERLAPPING_LEASES",
        path: "lease",
        message: "Room has overlapping leases",
      },
    ];
    fails(input, "OVERLAPPING_LEASES");
  });
  it("returns structured malformed-input errors", () => {
    const input = fixture();
    fails(
      { ...input, period: { ...input.period, endsOn: "2026-02-30" } },
      "INPUT_INVALID",
    );
    fails({ ...input, lease: { ...input.lease, rent: 1000 } }, "INPUT_INVALID");
  });
});

describe("separate rate selection and source validation", () => {
  it("permits either overlapping mid-month rate with independent utility prices", () => {
    const input = fixture();
    const water = utility(input);
    const electricity = utility(input, "ELECTRICITY");
    if (water.rate) {
      water.rate.effectiveFrom = "2026-10-15";
      water.rate.value = "2.1234";
    }
    if (electricity.rate) {
      electricity.rate.nextEffectiveFrom = "2026-10-15";
      electricity.rate.value = "3.4567";
    }
    const result = complete(calculateBillingPreview(input));
    expect(result.lines.map((line) => line.rawAmount.decimal)).toEqual([
      "1000.01",
      "21.234",
      "34.567",
    ]);
    expect(result.totals.finalTotal).toBe("1055.81");
  });
  it.each(["expired", "future", "invalid interval"])(
    "rejects a %s rate",
    (mode) => {
      const input = fixture();
      const rate = utility(input).rate;
      if (!rate) throw new Error("Missing rate fixture");
      if (mode === "expired") rate.nextEffectiveFrom = "2026-10-01";
      if (mode === "future") rate.effectiveFrom = "2026-11-01";
      if (mode === "invalid interval")
        rate.nextEffectiveFrom = rate.effectiveFrom;
      fails(
        input,
        mode === "invalid interval"
          ? "INVALID_RATE_INTERVAL"
          : "RATE_NOT_ELIGIBLE",
      );
    },
  );
  it("blocks missing or duplicated utilities, rates and consumption", () => {
    const input = fixture();
    input.utilities = [];
    fails(input, "MISSING_UTILITY");
    const duplicate = fixture();
    duplicate.utilities.push({ ...utility(duplicate) });
    fails(duplicate, "DUPLICATE_UTILITY");
    const missing = fixture();
    utility(missing).rate = null;
    utility(missing).consumption = null;
    fails(missing, "MISSING_RATE");
    fails(missing, "MISSING_CONSUMPTION");
  });
  it("denies non-admin approvals and wrong rate scope", () => {
    const input = fixture();
    const water = utility(input);
    if (!water.rate) throw new Error("Missing rate fixture");
    water.rate.approval.approverRole = "STAFF";
    fails(input, "ADMIN_APPROVAL_REQUIRED");
    water.rate.billingPeriodId = "other-period";
    water.rate.propertyId = "other-property";
    fails(input, "RATE_SCOPE_MISMATCH");
    input.lease.propertyId = "other-property";
    fails(input, "PROPERTY_SCOPE_MISMATCH");
  });
  it.each([
    "cross meter",
    "scope",
    "draft",
    "dates",
    "period",
    "quantity",
    "negative",
    "duplicate",
  ])("blocks invalid actual source: %s", (mode) => {
    const input = fixture();
    const consumption = utility(input).consumption;
    if (consumption?.kind !== "ACTUAL")
      throw new Error("Missing actual fixture");
    const expected: Record<string, string> = {
      "cross meter": "CROSS_METER_READING",
      scope: "READING_SCOPE_MISMATCH",
      draft: "READING_NOT_CONFIRMED",
      dates: "INVALID_READING_DATES",
      period: "READING_PERIOD_MISMATCH",
      quantity: "ACTUAL_QUANTITY_MISMATCH",
      negative: "NEGATIVE_USAGE",
      duplicate: "DUPLICATE_READING",
    };
    if (mode === "cross meter") consumption.current.meterId = "other-meter";
    if (mode === "scope") consumption.current.roomId = "other-room";
    if (mode === "draft") consumption.current.status = "DRAFT";
    if (mode === "dates")
      consumption.previous.readOn = consumption.current.readOn;
    if (mode === "period") consumption.current.billingPeriodId = "other-period";
    if (mode === "quantity") consumption.quantity = "9.000";
    if (mode === "negative") consumption.current.value = "9.000";
    if (mode === "duplicate") consumption.current.id = consumption.previous.id;
    fails(input, expected[mode]);
  });
});

describe("approved estimates and independently verified physical segments", () => {
  it("keeps estimates identifiable with reason, evidence and actor provenance", () => {
    const input = fixture();
    utility(input).consumption = estimate("1.234");
    const result = complete(calculateBillingPreview(input));
    expect(result.snapshot.source.utilities[0].consumption).toEqual(
      estimate("1.234"),
    );
    expect(result.lines[1].rawAmount.decimal).toBe("1.234");
  });
  it("rejects combined actual/estimate payloads, missing evidence, excess precision and negative consumption", () => {
    const input = fixture();
    const water = utility(input);
    fails(
      {
        ...input,
        utilities: [
          { ...water, consumption: { ...estimate(), previous: {} } },
          utility(input, "ELECTRICITY"),
        ],
      },
      "INPUT_INVALID",
    );
    water.consumption = estimate();
    water.consumption.evidence = [];
    fails(input, "INPUT_INVALID");
    water.consumption = estimate("1.0001");
    fails(input, "INPUT_INVALID");
    water.consumption = estimate("-1.000");
    fails(input, "INPUT_INVALID");
    water.consumption = estimate();
    water.consumption.approval.approverRole = "STAFF";
    fails(input, "ADMIN_APPROVAL_REQUIRED");
  });
  it("sums separately approved quantities from independent replacement meters", () => {
    const input = fixture();
    utility(input).consumption = replacement(input);
    const result = complete(calculateBillingPreview(input));
    expect(result.lines[1].rawAmount.decimal).toBe("4");
    expect(result.snapshot.source.utilities[0].consumption?.kind).toBe(
      "REPLACEMENT",
    );
  });

  it("bills a canonical old final and new opening with separately approved external evidence", () => {
    const input = fixture();
    utility(input).consumption = evidenceReplacement(input);
    const result = complete(calculateBillingPreview(input));
    expect(result.lines[1].rawAmount.decimal).toBe("4");
    const saved = result.snapshot.source.utilities[0].consumption;
    expect(saved?.kind).toBe("REPLACEMENT");
    if (saved?.kind !== "REPLACEMENT")
      throw new Error("Missing replacement snapshot");
    const evidenceSegment = saved.segments.find(
      (segment) => segment.verification === "ADMIN_EVIDENCE",
    );
    expect(evidenceSegment).toMatchObject({
      verification: "ADMIN_EVIDENCE",
      quantity: "2.500",
      sourceReadings: [{ id: "new-start", value: "0.000" }],
      evidence: ["photo:new-final-2.500"],
    });
    expect(evidenceSegment).not.toHaveProperty("current");
  });
  it("permits an explicitly approved zero evidence quantity without creating a reading", () => {
    const input = fixture();
    const consumption = evidenceReplacement(input);
    const segment = consumption.segments[1];
    segment.quantity = "0.000";
    utility(input).consumption = consumption;
    expect(
      complete(calculateBillingPreview(input)).lines[1].rawAmount.decimal,
    ).toBe("1.5");
  });
  it.each([
    "date range",
    "lease dates",
    "scope",
    "confirmation",
    "meter",
    "role",
    "source date",
    "duplicate source",
  ])("blocks invalid approved external evidence: %s", (mode) => {
    const input = fixture();
    const consumption = evidenceReplacement(input);
    const segment = consumption.segments[1];
    if (segment.verification !== "ADMIN_EVIDENCE")
      throw new Error("Fixture evidence segment missing");
    if (mode === "date range") segment.endsOn = "2026-11-01";
    if (mode === "lease dates") input.lease.startsOn = "2026-10-16";
    if (mode === "scope") segment.sourceReadings[0].roomId = "wrong-room";
    if (mode === "confirmation") segment.sourceReadings[0].status = "DRAFT";
    if (mode === "meter") segment.sourceReadings[0].meterId = "wrong-meter";
    if (mode === "role") segment.approval.approverRole = "STAFF";
    if (mode === "source date") segment.sourceReadings[0].readOn = "2026-11-01";
    if (mode === "duplicate source")
      segment.sourceReadings.push({ ...segment.sourceReadings[0] });
    utility(input).consumption = consumption;
    const codes: Record<string, string> = {
      "date range": "INVALID_SEGMENT_DATES",
      "lease dates": "INVALID_SEGMENT_DATES",
      scope: "READING_SCOPE_MISMATCH",
      confirmation: "READING_NOT_CONFIRMED",
      meter: "SEGMENT_METER_MISMATCH",
      role: "ADMIN_APPROVAL_REQUIRED",
      "source date": "INVALID_READING_DATES",
      "duplicate source": "DUPLICATE_READING",
    };
    fails(input, codes[mode]);
  });
  it("requires canonical source evidence and explicit quantity on every external segment", () => {
    const input = fixture();
    const consumption = evidenceReplacement(input);
    const segment = consumption.segments[1];
    if (segment.verification !== "ADMIN_EVIDENCE")
      throw new Error("Fixture evidence segment missing");
    segment.sourceReadings = [];
    utility(input).consumption = consumption;
    fails(input, "INPUT_INVALID");
    segment.sourceReadings = [replacement(fixture()).segments[1].previous];
    fails(
      {
        ...input,
        utilities: input.utilities.map((entry) =>
          entry.kind === "WATER"
            ? {
                ...entry,
                consumption: {
                  ...consumption,
                  segments: consumption.segments.map(
                    ({ quantity: omittedQuantity, ...rest }) => {
                      expect(omittedQuantity).toBeDefined();
                      return rest;
                    },
                  ),
                },
              }
            : entry,
        ),
      },
      "INPUT_INVALID",
    );
  });
  it("blocks aggregate replacement consumption outside DECIMAL(14,3)", () => {
    const input = fixture();
    const consumption = replacement(input);
    for (const segment of consumption.segments) {
      segment.quantity = "99999999999.999";
      segment.previous.value = "0.000";
      segment.current.value = "99999999999.999";
    }
    utility(input).consumption = consumption;
    fails(input, "QUANTITY_OUT_OF_RANGE");
  });
  it("rejects quantities exceeding verified use, duplicate meter allocations, duplicate sources and wrong segment meters", () => {
    const input = fixture();
    const segments = replacement(input);
    utility(input).consumption = segments;
    segments.segments[0].quantity = "2.001";
    fails(input, "REPLACEMENT_QUANTITY_EXCEEDS_VERIFIED");
    segments.segments[0].quantity = "1.500";
    segments.segments.push({ ...segments.segments[0] });
    fails(input, "DUPLICATE_METER_SEGMENT");
    fails(input, "DUPLICATE_READING");
    segments.segments.pop();
    segments.segments[0].meterId = "unrelated-meter";
    fails(input, "SEGMENT_METER_MISMATCH");
  });
});

describe("deterministic preview snapshot", () => {
  it("detaches caller inputs and canonicalizes utility and physical segment ordering", () => {
    const input = fixture();
    utility(input).consumption = replacement(input);
    const first = complete(calculateBillingPreview(input));
    input.utilities.reverse();
    const consumption = utility(input).consumption;
    if (consumption?.kind === "REPLACEMENT") consumption.segments.reverse();
    const second = complete(calculateBillingPreview(input));
    expect(first.snapshot).toEqual(second.snapshot);
    expect(first.snapshot.fingerprint).toMatch(/^[0-9a-f]{64}$/);
    input.lease.rent = "9999.99";
    expect(first.snapshot.source.lease.rent).toBe("1000.01");
    expect(
      complete(calculateBillingPreview(input)).snapshot.fingerprint,
    ).not.toBe(first.snapshot.fingerprint);
  });
  it("keeps the snapshot detached from mutable result presentation fields", () => {
    const result = complete(calculateBillingPreview(fixture()));
    const originalSnapshot = structuredClone(result.snapshot);
    result.lines[0].displayAmount = "0.00";
    result.totals.finalTotal = "0.00";
    expect(result.snapshot).toEqual(originalSnapshot);
  });
  it("records rate/reading versions and never claims a closed preview is ready for issuance", () => {
    const input = fixture();
    input.period.status = "CLOSED";
    const result = complete(calculateBillingPreview(input));
    expect(result.readyToClose).toBe(true);
    expect(result.eligibleForFutureIssuance).toBe(false);
    expect(result.futureIssuanceReasons).toEqual(["SOURCE_FREEZE_MISSING"]);
    expect(result.snapshot.purpose).toBe("PREVIEW_ONLY");
    const current = utility(input).consumption;
    if (current?.kind === "ACTUAL") current.current.version = "v2";
    expect(
      complete(calculateBillingPreview(input)).snapshot.fingerprint,
    ).not.toBe(result.snapshot.fingerprint);
  });
});

describe("explicit actual-source selection", () => {
  it("preserves reason and evidence and rejects a STAFF selection", () => {
    const input = fixture();
    const consumption = utility(input).consumption;
    if (consumption?.kind !== "ACTUAL")
      throw new Error("Expected actual fixture");
    consumption.selection = {
      approval: { ...approval },
      reason: "Actual source supersedes unissued estimate",
      evidence: ["operator-check:1"],
    };
    expect(
      complete(calculateBillingPreview(input)).snapshot.source.utilities[0]
        .consumption,
    ).toMatchObject({
      selection: { reason: "Actual source supersedes unissued estimate" },
    });
    consumption.selection.approval.approverRole = "STAFF";
    fails(input, "ADMIN_APPROVAL_REQUIRED");
  });
});

describe("snapshot JSON round trip", () => {
  it("keeps its fingerprint when omitted optional metadata is serialized", () => {
    const input = fixture();
    const consumption = utility(input).consumption;
    if (consumption?.kind !== "ACTUAL")
      throw new Error("Expected actual fixture");
    consumption.selection = undefined;
    const first = complete(calculateBillingPreview(input));
    const second = complete(
      calculateBillingPreview(JSON.parse(JSON.stringify(input))),
    );
    expect(first.snapshot.fingerprint).toBe(second.snapshot.fingerprint);
  });
});

describe("missing contractual lease terms", () => {
  it("rejects an unspecified lease end instead of inventing an open-ended contract", () => {
    const input = fixture();
    fails(
      { ...input, lease: { ...input.lease, endsOn: null } },
      "INPUT_INVALID",
    );
  });
});

describe("ADMIN-approved actual quantities allocated to partial leases", () => {
  function allocated() {
    const input = fixture();
    input.lease.startsOn = "2026-10-15";
    const row = utility(input);
    const actual = row.consumption;
    if (actual?.kind !== "ACTUAL") throw new Error("Expected actual fixture");
    const source: Extract<BillingConsumption, { kind: "ALLOCATED_ACTUAL" }> = {
      kind: "ALLOCATED_ACTUAL",
      previous: actual.previous,
      current: actual.current,
      quantity: "3.125",
      reason: "Verified tenant turnover allocation",
      evidence: ["turnover-record:1"],
      approval: { ...approval },
    };
    row.consumption = source;
    return { input, source };
  }
  it("calculates the explicitly approved quantity and preserves its provenance", () => {
    const { input } = allocated();
    const value = complete(calculateBillingPreview(input));
    expect(
      value.lines.find((line) => line.kind === "WATER")?.rawAmount,
    ).toEqual({ numerator: "25", denominator: "8", decimal: "3.125" });
    expect(value.snapshot.source.utilities[0].consumption).toMatchObject({
      kind: "ALLOCATED_ACTUAL",
      quantity: "3.125",
      evidence: ["turnover-record:1"],
    });
  });
  it("rejects quantity above verified same-meter usage", () => {
    const { input, source } = allocated();
    source.quantity = "10.001";
    fails(input, "ALLOCATION_EXCEEDS_VERIFIED");
  });
  it("rejects STAFF approval", () => {
    const { input, source } = allocated();
    source.approval.approverRole = "STAFF";
    fails(input, "ADMIN_APPROVAL_REQUIRED");
  });
  it("requires supporting evidence", () => {
    const { input, source } = allocated();
    source.evidence = [];
    fails(input, "INPUT_INVALID");
  });
  it("retains physical meter identity protection", () => {
    const { input, source } = allocated();
    source.current.meterId = "different-physical-meter";
    fails(input, "CROSS_METER_READING");
  });
  it("rejects a measurement ending before the lease starts", () => {
    const { input, source } = allocated();
    source.current.readOn = "2026-10-14";
    fails(input, "ALLOCATION_SOURCE_BEFORE_OCCUPANCY");
  });
  it("rejects a measurement starting after the lease ends", () => {
    const { input, source } = allocated();
    input.lease.startsOn = "2026-10-01";
    input.lease.endsOn = "2026-10-10";
    source.previous.readOn = "2026-10-11";
    fails(input, "ALLOCATION_SOURCE_AFTER_OCCUPANCY");
  });
});
