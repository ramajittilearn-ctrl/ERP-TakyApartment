import type { LiveLease } from "./contracts";
export const leaseLabels = {
  DRAFT: "ฉบับร่าง",
  ACTIVE: "ใช้งาน",
  ENDED: "สิ้นสุด",
  CANCELLED: "ยกเลิก",
};
export function sumMoney(values: string[]) {
  const total = values.reduce((sum, value) => {
    const [whole, fraction = ""] = value.split(".");
    return sum + BigInt(whole) * 100n + BigInt(fraction.padEnd(2, "0"));
  }, 0n);
  return `${total / 100n}.${String(total % 100n).padStart(2, "0")}`;
}
export function expiringWithin30Days(
  lease: Pick<LiveLease, "status" | "endDate">,
  today: string,
) {
  const end = lease.endDate.slice(0, 10);
  const limit = new Date(`${today}T00:00:00Z`);
  limit.setUTCDate(limit.getUTCDate() + 30);
  return (
    lease.status === "ACTIVE" &&
    end >= today &&
    end <= limit.toISOString().slice(0, 10)
  );
}
