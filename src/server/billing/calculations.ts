import { createHash } from "node:crypto";
import { Prisma } from "@prisma/client";
import {
  billingCalculationInputSchema,
  type BillingApproval,
  type BillingCalculationInput,
  type BillingCalculationResult,
  type BillingLine,
  type BillingPreviewSnapshot,
  type BillingReading,
  type BillingTotals,
  type BillingValidationIssue,
  type ExactAmount,
} from "./contracts";

// Decimal strings are a display approximation when a day denominator repeats.
// Reduced integer fractions remain authoritative through final rounding.
const DisplayDecimal = Prisma.Decimal.clone({
  precision: 80,
  rounding: Prisma.Decimal.ROUND_HALF_UP,
});
type Rational = { numerator: bigint; denominator: bigint };
function rational(numerator: bigint, denominator = 1n): Rational {
  if (denominator === 0n) throw new RangeError("Zero denominator");
  if (denominator < 0n) return rational(-numerator, -denominator);
  let a = numerator < 0n ? -numerator : numerator;
  let b = denominator;
  while (b !== 0n) [a, b] = [b, a % b];
  return { numerator: numerator / a, denominator: denominator / a };
}
function finite(value: string): Rational {
  const [whole, fraction = ""] = value.split(".");
  const negative = value.startsWith("-");
  const digits = `${whole.replace("-", "")}${fraction}`;
  return rational(
    BigInt(digits) * (negative ? -1n : 1n),
    10n ** BigInt(fraction.length),
  );
}
function add(a: Rational, b: Rational) {
  return rational(
    a.numerator * b.denominator + b.numerator * a.denominator,
    a.denominator * b.denominator,
  );
}
function subtract(a: Rational, b: Rational) {
  return add(a, { numerator: -b.numerator, denominator: b.denominator });
}
function multiply(a: Rational, b: Rational) {
  return rational(a.numerator * b.numerator, a.denominator * b.denominator);
}
function compare(a: Rational, b: Rational) {
  const difference = a.numerator * b.denominator - b.numerator * a.denominator;
  return difference < 0n ? -1 : difference > 0n ? 1 : 0;
}
function exact(value: Rational): ExactAmount {
  return {
    numerator: value.numerator.toString(),
    denominator: value.denominator.toString(),
    decimal: new DisplayDecimal(value.numerator.toString())
      .div(value.denominator.toString())
      .toString(),
  };
}
function roundedMoney(value: Rational) {
  const negative = value.numerator < 0n;
  const absolute = negative ? -value.numerator : value.numerator;
  const scaled = absolute * 100n;
  let minor = scaled / value.denominator;
  if ((scaled % value.denominator) * 2n >= value.denominator) minor += 1n;
  return `${negative && minor !== 0n ? "-" : ""}${minor / 100n}.${(minor % 100n).toString().padStart(2, "0")}`;
}

/** Exact raw multiplication; full fractions remain available even above the money column limit. */
export function calculateRawUtilityCharge(input: {
  quantity: string;
  unitRate: string;
}): ExactAmount {
  if (
    !/^(0|[1-9]\d{0,10})(?:\.\d{1,3})?$/.test(input.quantity) ||
    !/^(0|[1-9]\d{0,9})(?:\.\d{1,4})?$/.test(input.unitRate)
  )
    throw new RangeError(
      "Utility input exceeds DECIMAL(14,3) or DECIMAL(14,4)",
    );
  return exact(multiply(finite(input.quantity), finite(input.unitRate)));
}

/** Exact HALF_UP arithmetic helper; negative ties are supported without admitting negative charges. */
export function roundBillingAmountHalfUp(numerator: string, denominator = "1") {
  if (
    !/^-?\d+$/.test(numerator) ||
    !/^\d+$/.test(denominator) ||
    BigInt(denominator) === 0n
  )
    throw new RangeError(
      "Expected an integer numerator and positive integer denominator",
    );
  return roundedMoney(rational(BigInt(numerator), BigInt(denominator)));
}

function compareText(a: string, b: string) {
  return a < b ? -1 : a > b ? 1 : 0;
}
function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  return `{${Object.entries(value)
    .filter(([, entry]) => entry !== undefined)
    .sort(([a], [b]) => compareText(a, b))
    .map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`)
    .join(",")}}`;
}
function days(start: string, end: string) {
  return (
    (new Date(`${end}T00:00:00.000Z`).valueOf() -
      new Date(`${start}T00:00:00.000Z`).valueOf()) /
      86_400_000 +
    1
  );
}
function monthEnd(start: string) {
  const value = new Date(`${start}T00:00:00.000Z`);
  value.setUTCMonth(value.getUTCMonth() + 1, 0);
  return value.toISOString().slice(0, 10);
}
function incomplete(
  issues: BillingValidationIssue[],
): BillingCalculationResult {
  return {
    status: "INCOMPLETE",
    complete: false,
    readyToClose: false,
    eligibleForFutureIssuance: false,
    futureIssuanceReasons: [
      "SOURCE_FREEZE_MISSING",
      "BILLING_INPUTS_INCOMPLETE",
    ],
    issues,
    lines: [],
    totals: null,
    snapshot: null,
  };
}

/** Pure calculation boundary. Canonical database/source verification belongs to the caller. */
export function calculateBillingPreview(
  untrusted: unknown,
): BillingCalculationResult {
  const parsed = billingCalculationInputSchema.safeParse(untrusted);
  if (!parsed.success)
    return incomplete(
      parsed.error.issues.map((issue) => ({
        code: "INPUT_INVALID",
        path: issue.path.join("."),
        message: issue.message,
      })),
    );
  const input = parsed.data;
  const issues: BillingValidationIssue[] = [...input.validationIssues];
  const issue = (code: string, path: string, message: string) =>
    issues.push({ code, path, message });
  const { period, lease } = input;
  if (
    period.propertyId !== input.propertyId ||
    lease.propertyId !== input.propertyId
  )
    issue(
      "PROPERTY_SCOPE_MISMATCH",
      "propertyId",
      "Period and lease must belong to the selected property",
    );
  if (
    !period.startsOn.endsWith("-01") ||
    period.endsOn !== monthEnd(period.startsOn)
  )
    issue(
      "INVALID_PERIOD",
      "period",
      "Billing period must be one complete calendar month",
    );
  if (lease.endsOn < lease.startsOn)
    issue("INVALID_LEASE_DATES", "lease", "Lease ends before it starts");
  if (finite(lease.rent).numerator === 0n)
    issue(
      "ZERO_RENT",
      "lease.rent",
      "Contractual rent must be greater than zero before billing may proceed",
    );
  const occupiedStartsOn =
    lease.startsOn > period.startsOn ? lease.startsOn : period.startsOn;
  const occupiedEndsOn =
    lease.endsOn < period.endsOn ? lease.endsOn : period.endsOn;
  if (occupiedStartsOn > occupiedEndsOn)
    issue(
      "NO_OCCUPANCY",
      "lease",
      "Lease does not overlap this billing period",
    );

  function admin(approval: BillingApproval, path: string) {
    if (approval.approverRole !== "ADMIN")
      issue(
        "ADMIN_APPROVAL_REQUIRED",
        path,
        "An ADMIN must approve this billing input",
      );
  }
  const usedReadings = new Set<string>();
  function checkReading(
    reading: BillingReading,
    kind: "WATER" | "ELECTRICITY",
    path: string,
  ) {
    if (
      reading.propertyId !== input.propertyId ||
      reading.roomId !== lease.roomId ||
      reading.kind !== kind
    )
      issue(
        "READING_SCOPE_MISMATCH",
        path,
        "Reading property, room and utility must match the lease",
      );
    if (reading.status !== "CONFIRMED")
      issue(
        "READING_NOT_CONFIRMED",
        path,
        "Only confirmed readings establish actual consumption",
      );
    if (usedReadings.has(reading.id))
      issue(
        "DUPLICATE_READING",
        `${path}.id`,
        "Reading source cannot be allocated more than once",
      );
    usedReadings.add(reading.id);
  }
  function readings(
    previous: BillingReading,
    current: BillingReading,
    kind: "WATER" | "ELECTRICITY",
    path: string,
  ) {
    checkReading(previous, kind, `${path}.previous`);
    checkReading(current, kind, `${path}.current`);
    if (current.meterId !== previous.meterId)
      issue(
        "CROSS_METER_READING",
        path,
        "Consumption must be calculated within one physical meter",
      );
    if (previous.readOn >= current.readOn)
      issue(
        "INVALID_READING_DATES",
        path,
        "Previous reading must predate the current reading",
      );
    if (
      current.readOn < period.startsOn ||
      current.readOn > period.endsOn ||
      current.billingPeriodId !== period.id
    )
      issue(
        "READING_PERIOD_MISMATCH",
        `${path}.current`,
        "Current reading must be assigned to and dated within this billing period",
      );
    const usage = subtract(finite(current.value), finite(previous.value));
    if (usage.numerator < 0n)
      issue(
        "NEGATIVE_USAGE",
        path,
        "Physical meter consumption cannot be negative",
      );
    return usage;
  }

  const utilityAmounts: { kind: "WATER" | "ELECTRICITY"; amount: Rational }[] =
    [];
  for (const kind of ["WATER", "ELECTRICITY"] satisfies (
    "WATER" | "ELECTRICITY"
  )[]) {
    const matching = input.utilities.filter((utility) => utility.kind === kind);
    if (matching.length !== 1) {
      issue(
        matching.length === 0 ? "MISSING_UTILITY" : "DUPLICATE_UTILITY",
        `utilities.${kind}`,
        "Exactly one input is required for each utility",
      );
      continue;
    }
    const utility = matching[0];
    const path = `utilities.${kind}`;
    const { rate, consumption } = utility;
    if (rate === null)
      issue(
        "MISSING_RATE",
        `${path}.rate`,
        "An ADMIN-selected existing utility rate is required",
      );
    else {
      admin(rate.approval, `${path}.rate.approval`);
      if (
        rate.propertyId !== input.propertyId ||
        rate.kind !== kind ||
        rate.billingPeriodId !== period.id
      )
        issue(
          "RATE_SCOPE_MISMATCH",
          `${path}.rate`,
          "Rate selection must match property, period and utility",
        );
      if (
        rate.effectiveFrom > period.endsOn ||
        (rate.nextEffectiveFrom !== null &&
          rate.nextEffectiveFrom <= period.startsOn)
      )
        issue(
          "RATE_NOT_ELIGIBLE",
          `${path}.rate`,
          "Selected rate effective interval must overlap the billing month",
        );
      if (
        rate.nextEffectiveFrom !== null &&
        rate.nextEffectiveFrom <= rate.effectiveFrom
      )
        issue(
          "INVALID_RATE_INTERVAL",
          `${path}.rate`,
          "Next rate must start after the selected rate",
        );
    }
    if (consumption === null) {
      issue(
        "MISSING_CONSUMPTION",
        `${path}.consumption`,
        "Actual or approved consumption is required",
      );
      continue;
    }
    let quantity = rational(0n);
    switch (consumption.kind) {
      case "ACTUAL": {
        if (consumption.selection)
          admin(
            consumption.selection.approval,
            `${path}.consumption.selection.approval`,
          );
        const usage = readings(
          consumption.previous,
          consumption.current,
          kind,
          `${path}.consumption`,
        );
        quantity = finite(consumption.quantity);
        if (compare(quantity, usage) !== 0)
          issue(
            "ACTUAL_QUANTITY_MISMATCH",
            `${path}.consumption.quantity`,
            "Actual quantity must equal the same-meter reading difference",
          );
        break;
      }
      case "ESTIMATE":
        admin(consumption.approval, `${path}.consumption.approval`);
        quantity = finite(consumption.quantity);
        break;
      case "ALLOCATED_ACTUAL": {
        admin(consumption.approval, `${path}.consumption.approval`);
        const usage = readings(
          consumption.previous,
          consumption.current,
          kind,
          `${path}.consumption`,
        );
        quantity = finite(consumption.quantity);
        if (compare(quantity, usage) > 0)
          issue(
            "ALLOCATION_EXCEEDS_VERIFIED",
            `${path}.consumption.quantity`,
            "Approved lease quantity cannot exceed verified room consumption",
          );
        if (consumption.current.readOn < occupiedStartsOn)
          issue(
            "ALLOCATION_SOURCE_BEFORE_OCCUPANCY",
            `${path}.consumption`,
            "Measured consumption must overlap the lease occupancy",
          );
        if (consumption.previous.readOn > occupiedEndsOn)
          issue(
            "ALLOCATION_SOURCE_AFTER_OCCUPANCY",
            `${path}.consumption`,
            "Measured consumption must overlap the lease occupancy",
          );
        break;
      }
      case "REPLACEMENT": {
        const usedMeters = new Set<string>();
        for (const [index, segment] of consumption.segments.entries()) {
          const segmentPath = `${path}.consumption.segments.${index}`;
          admin(segment.approval, `${segmentPath}.approval`);
          if (usedMeters.has(segment.meterId))
            issue(
              "DUPLICATE_METER_SEGMENT",
              segmentPath,
              "Physical meter may be allocated in only one verified segment",
            );
          usedMeters.add(segment.meterId);
          if (
            new Set(segment.replacementIds).size !==
            segment.replacementIds.length
          )
            issue(
              "DUPLICATE_REPLACEMENT_REFERENCE",
              segmentPath,
              "Replacement source references must be unique within a segment",
            );
          const approved = finite(segment.quantity);
          if (segment.verification === "READINGS") {
            if (
              segment.previous.meterId !== segment.meterId ||
              segment.current.meterId !== segment.meterId
            )
              issue(
                "SEGMENT_METER_MISMATCH",
                segmentPath,
                "Segment readings must identify the approved physical meter",
              );
            const usage = readings(
              segment.previous,
              segment.current,
              kind,
              segmentPath,
            );
            if (compare(approved, usage) > 0)
              issue(
                "REPLACEMENT_QUANTITY_EXCEEDS_VERIFIED",
                `${segmentPath}.quantity`,
                "Approved chargeable quantity cannot exceed verified segment consumption",
              );
          } else {
            if (
              segment.startsOn > segment.endsOn ||
              segment.startsOn < period.startsOn ||
              segment.endsOn > period.endsOn ||
              segment.startsOn < occupiedStartsOn ||
              segment.endsOn > occupiedEndsOn
            )
              issue(
                "INVALID_SEGMENT_DATES",
                segmentPath,
                "Approved segment dates must be ordered and inside billing period and lease occupancy",
              );
            for (const [
              sourceIndex,
              sourceReading,
            ] of segment.sourceReadings.entries()) {
              checkReading(
                sourceReading,
                kind,
                `${segmentPath}.sourceReadings.${sourceIndex}`,
              );
              if (sourceReading.meterId !== segment.meterId)
                issue(
                  "SEGMENT_METER_MISMATCH",
                  segmentPath,
                  "Evidence source reading must identify the approved physical meter",
                );
              if (sourceReading.readOn > segment.endsOn)
                issue(
                  "INVALID_READING_DATES",
                  segmentPath,
                  "Evidence source reading cannot follow the verified segment",
                );
            }
          }
          quantity = add(quantity, approved);
        }
        break;
      }
      default: {
        const exhaustive: never = consumption;
        return exhaustive;
      }
    }
    if (compare(quantity, finite("99999999999.999")) > 0)
      issue(
        "QUANTITY_OUT_OF_RANGE",
        `${path}.consumption`,
        "Combined consumption exceeds DECIMAL(14,3)",
      );
    if (rate !== null)
      utilityAmounts.push({
        kind,
        amount: multiply(quantity, finite(rate.value)),
      });
  }
  if (issues.length > 0) return incomplete(issues);
  const occupiedDays = days(occupiedStartsOn, occupiedEndsOn);
  const periodDays = days(period.startsOn, period.endsOn);
  const rentAmount = multiply(
    finite(lease.rent),
    rational(BigInt(occupiedDays), BigInt(periodDays)),
  );
  const amounts = [
    { kind: "RENT", amount: rentAmount } satisfies {
      kind: "RENT";
      amount: Rational;
    },
    ...utilityAmounts,
  ];
  const lines: BillingLine[] = amounts.map(({ kind, amount }) => ({
    kind,
    rawAmount: exact(amount),
    displayAmount: roundedMoney(amount),
  }));
  const rawTotal = amounts.reduce(
    (sum, line) => add(sum, line.amount),
    rational(0n),
  );
  const finalTotal = roundedMoney(rawTotal);
  if (compare(finite(finalTotal), finite("999999999999.99")) > 0)
    return incomplete([
      {
        code: "AMOUNT_OUT_OF_RANGE",
        path: "totals.finalTotal",
        message: "Final total exceeds DECIMAL(14,2)",
      },
    ]);
  const displayLineTotal = lines.reduce(
    (sum, line) => add(sum, finite(line.displayAmount)),
    rational(0n),
  );
  const totals: BillingTotals = {
    rawTotal: exact(rawTotal),
    finalTotal,
    displayLineTotal: roundedMoney(displayLineTotal),
    reconciliationDelta: roundedMoney(
      subtract(finite(finalTotal), displayLineTotal),
    ),
  };
  const source: BillingCalculationInput = {
    ...input,
    utilities: [...input.utilities]
      .sort(
        (a, b) => (a.kind === "WATER" ? 0 : 1) - (b.kind === "WATER" ? 0 : 1),
      )
      .map((utility) => ({
        ...utility,
        consumption:
          utility.consumption?.kind === "REPLACEMENT"
            ? {
                ...utility.consumption,
                segments: [...utility.consumption.segments]
                  .sort((a, b) => compareText(a.meterId, b.meterId))
                  .map((segment) => ({
                    ...segment,
                    replacementIds: [...segment.replacementIds].sort(),
                    ...(segment.verification === "ADMIN_EVIDENCE"
                      ? {
                          sourceReadings: [...segment.sourceReadings].sort(
                            (a, b) => compareText(a.id, b.id),
                          ),
                        }
                      : {}),
                  })),
              }
            : utility.consumption,
      })),
  };
  const snapshotBody: Omit<BillingPreviewSnapshot, "fingerprint"> = {
    snapshotVersion: "3C-2.1",
    purpose: "PREVIEW_ONLY",
    source,
    rentProration: {
      occupiedStartsOn,
      occupiedEndsOn,
      occupiedDays,
      periodDays,
    },
    lines,
    totals,
    rounding: {
      mode: "HALF_UP",
      scale: 2,
      aggregation: "SUM_EXACT_RAW_THEN_ROUND_ONCE",
      decimalDisplayPrecision: 80,
    },
  };
  const snapshot: BillingPreviewSnapshot = {
    ...structuredClone(snapshotBody),
    fingerprint: createHash("sha256")
      .update(canonicalJson(snapshotBody))
      .digest("hex"),
  };
  const futureIssuanceReasons = ["SOURCE_FREEZE_MISSING"];
  if (period.status !== "CLOSED")
    futureIssuanceReasons.push("PERIOD_NOT_CLOSED");
  return {
    status: "COMPLETE",
    complete: true,
    readyToClose: true,
    eligibleForFutureIssuance: false,
    futureIssuanceReasons,
    issues: [],
    lines,
    totals,
    snapshot,
  };
}
