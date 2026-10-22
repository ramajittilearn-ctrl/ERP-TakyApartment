import { z } from "zod";
import {
  billingQuantitySchema,
  type BillingValidationIssue,
} from "./contracts";

const roomAllocation = z.strictObject({
  verifiedQuantity: billingQuantitySchema,
  allocations: z.array(
    z.strictObject({
      leaseId: z.string().min(1),
      quantity: billingQuantitySchema,
    }),
  ),
});
function milliunits(value: string) {
  const [whole, fraction = ""] = value.split(".");
  return BigInt(whole) * 1000n + BigInt(fraction.padEnd(3, "0"));
}
export function validateRoomAllocation(
  input: unknown,
): BillingValidationIssue[] {
  const parsed = roomAllocation.safeParse(input);
  const path = "consumption.allocations";
  if (!parsed.success)
    return [
      {
        code: "INPUT_INVALID",
        path,
        message:
          "Allocation quantities must be decimal strings within DECIMAL(14,3)",
      },
    ];
  const { verifiedQuantity, allocations } = parsed.data;
  if (
    new Set(allocations.map((entry) => entry.leaseId)).size !==
    allocations.length
  )
    return [
      {
        code: "DUPLICATE_LEASE_ALLOCATION",
        path,
        message: "Use only the latest approved quantity for each lease",
      },
    ];
  const total = allocations.reduce(
    (sum, entry) => sum + milliunits(entry.quantity),
    0n,
  );
  if (total > milliunits(verifiedQuantity))
    return [
      {
        code: "ALLOCATION_EXCEEDS_VERIFIED",
        path,
        message: "Combined lease quantities exceed verified room consumption",
      },
    ];
  return [];
}
