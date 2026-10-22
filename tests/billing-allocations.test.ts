import { describe, expect, it } from "vitest";
import { validateRoomAllocation } from "../src/server/billing/allocation";

describe("explicit ADMIN lease allocation totals", () => {
  it("accepts exact independently approved quantities without prorating them", () => {
    expect(
      validateRoomAllocation({
        verifiedQuantity: "10.000",
        allocations: [
          { leaseId: "previous", quantity: "3.125" },
          { leaseId: "new", quantity: "6.875" },
        ],
      }),
    ).toEqual([]);
  });
  it("rejects a one-milliunit over-allocation", () => {
    expect(
      validateRoomAllocation({
        verifiedQuantity: "10.000",
        allocations: [
          { leaseId: "previous", quantity: "3.125" },
          { leaseId: "new", quantity: "6.876" },
        ],
      })[0].code,
    ).toBe("ALLOCATION_EXCEEDS_VERIFIED");
  });
  it("adds small fractional quantities exactly", () => {
    expect(
      validateRoomAllocation({
        verifiedQuantity: "0.003",
        allocations: [
          { leaseId: "a", quantity: "0.001" },
          { leaseId: "b", quantity: "0.002" },
        ],
      }),
    ).toEqual([]);
  });
  it("preserves maximum supported quantity precision", () => {
    expect(
      validateRoomAllocation({
        verifiedQuantity: "99999999999.999",
        allocations: [
          { leaseId: "a", quantity: "99999999999.998" },
          { leaseId: "b", quantity: "0.001" },
        ],
      }),
    ).toEqual([]);
  });
  it("rejects counting multiple revisions of one lease", () => {
    expect(
      validateRoomAllocation({
        verifiedQuantity: "10",
        allocations: [
          { leaseId: "a", quantity: "1" },
          { leaseId: "a", quantity: "1" },
        ],
      })[0].code,
    ).toBe("DUPLICATE_LEASE_ALLOCATION");
  });
  it.each(["-1", "1.0001", "100000000000.000", "1e3"])(
    "rejects invalid allocated quantity %s",
    (quantity) => {
      expect(
        validateRoomAllocation({
          verifiedQuantity: "10",
          allocations: [{ leaseId: "a", quantity }],
        })[0].code,
      ).toBe("INPUT_INVALID");
    },
  );
  it("permits an explicit zero or unallocated remainder without inventing a tenant charge", () => {
    expect(
      validateRoomAllocation({
        verifiedQuantity: "10",
        allocations: [
          { leaseId: "a", quantity: "0" },
          { leaseId: "b", quantity: "2" },
        ],
      }),
    ).toEqual([]);
  });
});
