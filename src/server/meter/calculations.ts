import { Prisma } from "@prisma/client";
import { AppError } from "../errors";

const readingPattern = /^(0|[1-9]\d{0,10})(?:\.\d{1,3})?$/;

export function canonicalReading(value: string) {
  if (!readingPattern.test(value))
    throw new AppError(
      422,
      "INVALID_READING",
      "ค่ามิเตอร์ต้องเป็นเลขไม่ติดลบและมีทศนิยมไม่เกิน 3 ตำแหน่ง",
    );
  const decimal = new Prisma.Decimal(value);
  if (decimal.greaterThan(new Prisma.Decimal("99999999999.999")))
    throw new AppError(422, "INVALID_READING", "ค่ามิเตอร์สูงเกินขอบเขต");
  return decimal.toFixed(3);
}

export function calculateConsumption(input: {
  previousReading: string;
  currentReading: string;
}) {
  const previous = new Prisma.Decimal(canonicalReading(input.previousReading));
  const current = new Prisma.Decimal(canonicalReading(input.currentReading));
  if (current.lessThan(previous))
    throw new AppError(
      409,
      "NEGATIVE_USAGE",
      "ค่ามิเตอร์ปัจจุบันต้องไม่น้อยกว่าค่าก่อนหน้า",
    );
  return current.minus(previous).toFixed(3);
}

export function calculateReplacementConsumption(input: {
  previousOldMeterReading: string;
  finalOldMeterReading: string;
  initialNewMeterReading: string;
}) {
  return {
    oldMeterConsumption: calculateConsumption({
      previousReading: input.previousOldMeterReading,
      currentReading: input.finalOldMeterReading,
    }),
    newMeterOpeningReading: canonicalReading(input.initialNewMeterReading),
  };
}

export function todayInBangkok(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Bangkok",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const value = Object.fromEntries(
    parts.map((part) => [part.type, part.value]),
  );
  return `${value.year}-${value.month}-${value.day}`;
}

export function assertReadingDateNotFuture(
  readingDate: string,
  now = new Date(),
) {
  if (readingDate > todayInBangkok(now))
    throw new AppError(
      422,
      "FUTURE_READING_DATE",
      "วันที่จดมิเตอร์ต้องไม่เป็นวันในอนาคต",
    );
  return readingDate;
}
