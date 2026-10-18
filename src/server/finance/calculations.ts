import { Prisma } from "@prisma/client";
import { AppError } from "../errors";

const MONEY = /^(0|[1-9]\d{0,11})(?:\.(\d{1,2}))?$/;
const RATE = /^(0|[1-9]\d{0,9})(?:\.(\d{1,4}))?$/;
const READING = /^(0|[1-9]\d{0,10})(?:\.(\d{1,3}))?$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

function decimal(value: string, pattern: RegExp, label: string) {
  if (!pattern.test(value))
    throw new AppError(422, "VALIDATION", `${label} has invalid precision`);
  return new Prisma.Decimal(value);
}

function date(value: string) {
  if (!DATE.test(value))
    throw new AppError(422, "VALIDATION", "Invalid calendar date");
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (
    Number.isNaN(parsed.valueOf()) ||
    parsed.toISOString().slice(0, 10) !== value
  )
    throw new AppError(422, "VALIDATION", "Invalid calendar date");
  return parsed;
}

function iso(value: Date) {
  return value.toISOString().slice(0, 10);
}

function inclusiveDays(start: Date, end: Date) {
  return Math.floor((end.valueOf() - start.valueOf()) / 86_400_000) + 1;
}

export function calculateProratedRent(input: {
  monthlyRent: string;
  leaseStartsOn: string;
  leaseEndsOn: string;
  periodStartsOn: string;
  periodEndsOn: string;
}) {
  const rent = decimal(input.monthlyRent, MONEY, "monthlyRent");
  const leaseStart = date(input.leaseStartsOn);
  const leaseEnd = date(input.leaseEndsOn);
  const periodStart = date(input.periodStartsOn);
  const periodEnd = date(input.periodEndsOn);
  if (leaseEnd < leaseStart || periodEnd < periodStart)
    throw new AppError(
      422,
      "VALIDATION",
      "End date must not precede start date",
    );
  const occupiedStart = leaseStart > periodStart ? leaseStart : periodStart;
  const occupiedEnd = leaseEnd < periodEnd ? leaseEnd : periodEnd;
  if (occupiedEnd < occupiedStart)
    throw new AppError(
      422,
      "NO_OCCUPANCY",
      "Lease does not overlap billing period",
    );
  const occupiedDays = inclusiveDays(occupiedStart, occupiedEnd);
  const periodDays = inclusiveDays(periodStart, periodEnd);
  const unrounded = rent.mul(occupiedDays).div(periodDays);
  return {
    occupiedStartsOn: iso(occupiedStart),
    occupiedEndsOn: iso(occupiedEnd),
    occupiedDays,
    periodDays,
    unroundedAmount: unrounded.toString(),
    amount: unrounded
      .toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP)
      .toFixed(2),
  };
}

export function calculateUsageCharge(input: {
  previousReading: string;
  currentReading: string;
  unitRate: string;
}) {
  const previous = decimal(input.previousReading, READING, "previousReading");
  const current = decimal(input.currentReading, READING, "currentReading");
  const unitRate = decimal(input.unitRate, RATE, "unitRate");
  if (current.lessThan(previous))
    throw new AppError(
      422,
      "NEGATIVE_USAGE",
      "Current reading must not be lower than previous reading",
    );
  const usage = current.minus(previous);
  const unrounded = usage.mul(unitRate);
  return {
    usage: usage.toFixed(3),
    unitRate: unitRate.toFixed(4),
    unroundedAmount: unrounded.toString(),
    amount: unrounded
      .toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP)
      .toFixed(2),
  };
}
