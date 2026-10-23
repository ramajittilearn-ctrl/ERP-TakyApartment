export function canonicalAmount(input: string): string {
  const value = input.trim();
  if (!/^(?:0|[1-9]\d{0,11})(?:\.\d{1,2})?$/.test(value))
    throw new Error("ระบุจำนวนเงินเป็นตัวเลขทศนิยมไม่เกิน 2 ตำแหน่ง");
  const [whole, fraction = ""] = value.split(".");
  const result = `${whole}.${fraction.padEnd(2, "0")}`;
  if (minorUnits(result) <= 0n) throw new Error("จำนวนเงินต้องมากกว่าศูนย์");
  return result;
}
export function minorUnits(value: string): bigint {
  if (!/^(?:0|[1-9]\d{0,11})\.\d{2}$/.test(value))
    throw new Error("รูปแบบจำนวนเงินไม่ถูกต้อง");
  return BigInt(value.replace(".", ""));
}
export function minorText(value: bigint): string {
  const sign = value < 0n ? "-" : "";
  const digits = (value < 0n ? -value : value).toString().padStart(3, "0");
  return `${sign}${digits.slice(0, -2)}.${digits.slice(-2)}`;
}
export function amountLabel(value: string): string {
  const [whole, fraction] = value.split(".");
  return `${whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",")}.${fraction} บาท`;
}
export function bangkokTimestamp(value: string): string {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value))
    throw new Error("ระบุวันและเวลารับชำระให้ครบถ้วน");
  const parsed = new Date(`${value}:00.000Z`);
  if (
    !Number.isFinite(parsed.getTime()) ||
    parsed.toISOString().slice(0, 16) !== value
  )
    throw new Error("วันหรือเวลารับชำระไม่ถูกต้อง");
  return `${value}:00+07:00`;
}
export function bangkokNow(now: Date): string {
  return new Date(now.getTime() + 7 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 16);
}
export function timeLabel(value: string): string {
  return new Intl.DateTimeFormat("th-TH", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Bangkok",
  }).format(new Date(value));
}
