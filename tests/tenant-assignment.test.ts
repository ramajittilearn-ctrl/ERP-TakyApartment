import { describe, expect, it } from "vitest";
import { rentAfterRoomSelection } from "../src/features/live/tenant-assignment";

describe("tenant contract rent when selecting a room", () => {
  it("preserves an entered contract amount when the room default is zero", () => {
    expect(
      rentAfterRoomSelection({
        currentRent: "4100.75",
        explicitlySet: true,
        roomRent: "0.00",
      }),
    ).toBe("4100.75");
  });
  it("preserves the existing lease amount when reselecting its room", () => {
    expect(
      rentAfterRoomSelection({
        currentRent: "4100.75",
        explicitlySet: true,
        roomRent: "3500.00",
      }),
    ).toBe("4100.75");
  });
  it("preserves an explicitly entered zero rather than substituting a room default", () => {
    expect(
      rentAfterRoomSelection({
        currentRent: "0.00",
        explicitlySet: true,
        roomRent: "3500.00",
      }),
    ).toBe("0.00");
  });
  it("uses room defaults only before the contract amount is explicitly set", () => {
    expect(
      rentAfterRoomSelection({
        currentRent: "0.00",
        explicitlySet: false,
        roomRent: "3500.25",
      }),
    ).toBe("3500.25");
    expect(
      rentAfterRoomSelection({
        currentRent: "3500.25",
        explicitlySet: false,
        roomRent: "0.00",
      }),
    ).toBe("0.00");
    expect(
      rentAfterRoomSelection({ currentRent: "4100.75", explicitlySet: true }),
    ).toBe("4100.75");
  });
});
