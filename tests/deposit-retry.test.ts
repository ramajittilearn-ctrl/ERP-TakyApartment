import { Prisma } from "@prisma/client";
import { describe, expect, it } from "vitest";
import { isRetryableDepositTransaction } from "../src/server/deposits/retry";
const known = (code: string, meta?: Record<string, unknown>) =>
  new Prisma.PrismaClientKnownRequestError("Synthetic transaction error", {
    code,
    clientVersion: "7.10.1",
    meta,
  });
const nested = (originalCode: string, kind = "TransactionWriteConflict") => ({
  driverAdapterError: {
    name: "DriverAdapterError",
    cause: { kind, originalCode },
  },
});

describe("deposit transaction retry classification", () => {
  it("recognizes the actual nested driver serialization shape and existing Prisma/direct shapes", () => {
    expect(isRetryableDepositTransaction(known("P2010", nested("40001")))).toBe(
      true,
    );
    expect(isRetryableDepositTransaction(known("P2010", nested("40P01")))).toBe(
      true,
    );
    expect(
      isRetryableDepositTransaction(known("P2010", { code: "40001" })),
    ).toBe(true);
    expect(
      isRetryableDepositTransaction(known("P2010", { code: "40P01" })),
    ).toBe(true);
    expect(isRetryableDepositTransaction(known("P2034"))).toBe(true);
  });
  it("does not retry business errors, constraint failures, misleading messages or unrecognized metadata", () => {
    for (const code of ["23505", "23514", "P0001", "57014"])
      expect(isRetryableDepositTransaction(known("P2010", nested(code)))).toBe(
        false,
      );
    expect(
      isRetryableDepositTransaction(
        known("P2010", nested("40001", "UnknownDatabaseError")),
      ),
    ).toBe(false);
    expect(isRetryableDepositTransaction(known("P2002", nested("40001")))).toBe(
      false,
    );
    expect(
      isRetryableDepositTransaction(
        known("P2010", { message: "40001", code: 40001 }),
      ),
    ).toBe(false);
    expect(
      isRetryableDepositTransaction(new Error("Raw query failed:40001")),
    ).toBe(false);
    expect(
      isRetryableDepositTransaction({ code: "P2010", meta: nested("40001") }),
    ).toBe(false);
  });
});
