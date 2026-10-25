import { beforeEach, expect, it, vi } from "vitest";
import { AppError } from "../src/server/errors";
const boundary = vi.hoisted(() => ({
  ledger: vi.fn(),
  document: vi.fn(),
  actor: vi.fn(),
  lease: vi.fn(),
  missing: new Error("Synthetic Next notFound boundary"),
}));
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw boundary.missing;
  },
}));
vi.mock("@/server/http", () => ({ requirePageActor: boundary.actor }));
vi.mock("@/server/errors", async () => import("../src/server/errors"));
vi.mock(
  "@/server/deposits/contracts",
  async () => import("../src/server/deposits/contracts"),
);
vi.mock("@/server/deposit-api/boundary", () => ({
  depositSsrQuery: () => ({ offset: 0, limit: 50 }),
}));
vi.mock("@/server/deposit-api/service", () => ({
  depositService: {
    getLeaseDepositLedger: boundary.ledger,
    getDepositDocument: boundary.document,
  },
}));
vi.mock("@/server/db", () => ({
  db: { lease: { findFirst: boundary.lease } },
}));
vi.mock("@/features/deposits/screen", () => ({ DepositScreen: () => null }));
vi.mock("@/features/deposits/form", () => ({
  depositLabels: {},
  depositMoneyLabel: vi.fn(),
  depositTime: vi.fn(),
}));
vi.mock("@/components/ui", () => ({ Card: () => null, Notice: () => null }));
import LeasePage from "../src/app/(erp)/deposits/[leaseId]/page";
import DocumentPage from "../src/app/(erp)/deposit-entries/[entryId]/page";

const id = "11111111-1111-4111-8111-111111111111";
const leasePage = () =>
  LeasePage({
    params: Promise.resolve({ leaseId: id }),
    searchParams: Promise.resolve({}),
  });
const documentPage = () =>
  DocumentPage({ params: Promise.resolve({ entryId: id }) });
beforeEach(() => {
  vi.clearAllMocks();
  boundary.actor.mockResolvedValue({ id, role: "ADMIN" });
  boundary.lease.mockResolvedValue(null);
});
it("maps only expected service 404 errors to the framework not-found boundary", async () => {
  boundary.ledger.mockRejectedValue(
    new AppError(404, "LEASE_NOT_FOUND", "Missing synthetic lease"),
  );
  boundary.document.mockRejectedValue(
    new AppError(404, "DEPOSIT_ENTRY_NOT_FOUND", "Missing synthetic entry"),
  );
  await expect(leasePage()).rejects.toBe(boundary.missing);
  await expect(documentPage()).rejects.toBe(boundary.missing);
});
it("preserves unexpected database/service errors and does not hide authorization failures", async () => {
  for (const error of [
    new Error("Synthetic database unavailable"),
    new AppError(403, "FORBIDDEN", "Synthetic denied"),
    new AppError(503, "UNAVAILABLE", "Synthetic unavailable"),
  ]) {
    boundary.ledger.mockRejectedValue(error);
    boundary.document.mockRejectedValue(error);
    await expect(leasePage()).rejects.toBe(error);
    await expect(documentPage()).rejects.toBe(error);
  }
});
it("leaves framework redirect failures from authentication intact", async () => {
  const redirect = new Error("NEXT_REDIRECT synthetic authentication boundary");
  boundary.actor.mockRejectedValue(redirect);
  await expect(leasePage()).rejects.toBe(redirect);
  await expect(documentPage()).rejects.toBe(redirect);
  expect(boundary.ledger).not.toHaveBeenCalled();
  expect(boundary.document).not.toHaveBeenCalled();
});
