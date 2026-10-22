import assert from "node:assert/strict";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { invoiceVerificationConfig } from "./invoice-verification-config.mjs";

const isolated = {
  STAGE3C4_VERIFICATION: "1",
  INVOICE_TEST_ORIGIN: "http://127.0.0.1:3800",
  DATABASE_URL:
    "postgresql://stage3c4_test:synthetic@127.0.0.1:55440/taky_phase2_test",
  TEST_ADMIN_PASSWORD: "synthetic-admin",
  TEST_STAFF_PASSWORD: "synthetic-staff",
};

test("selects the dedicated target and worktree-local fixture/evidence", () => {
  const config = invoiceVerificationConfig(isolated);
  assert.equal(config.origin, "http://127.0.0.1:3800");
  assert.deepEqual(config.identity, {
    name: "taky_phase2_test",
    role: "stage3c4_test",
  });
  assert.equal(
    config.fixturePath,
    fileURLToPath(
      new URL("../.local/stage3c4/http-fixture.json", import.meta.url),
    ),
  );
  assert.equal(
    config.evidenceDirectory,
    fileURLToPath(new URL("../.local/stage3c4/invoices", import.meta.url)),
  );
});

test("refuses UAT origin and another app even with dedicated DB identity", () => {
  for (const origin of ["http://127.0.0.1:3700", "http://127.0.0.1:3900"]) {
    assert.throws(() =>
      invoiceVerificationConfig({ ...isolated, INVOICE_TEST_ORIGIN: origin }),
    );
  }
});

test("refuses legacy or UAT DB identities in Stage 3C-4 mode", () => {
  for (const url of [
    "postgresql://stage3c3_test:synthetic@127.0.0.1:55434/taky_phase2_test",
    "postgresql://stage3c4_test:synthetic@127.0.0.1:55435/taky_phase2_test",
    "postgresql://taky_erp_uat:synthetic@db:5432/taky_erp_uat_round1",
    "postgresql://stage3c4_test:synthetic@127.0.0.1:55440/taky_erp_uat_round1",
    "postgresql://postgres:synthetic@127.0.0.1:55440/taky_phase2_test",
    "postgresql://stage3c4_test:synthetic@192.168.1.1:55440/taky_phase2_test",
  ]) {
    assert.throws(() =>
      invoiceVerificationConfig({ ...isolated, DATABASE_URL: url }),
    );
  }
});

test("requires explicit app identity, database and private test credentials", () => {
  for (const key of [
    "INVOICE_TEST_ORIGIN",
    "DATABASE_URL",
    "TEST_ADMIN_PASSWORD",
    "TEST_STAFF_PASSWORD",
  ]) {
    assert.throws(() =>
      invoiceVerificationConfig({ ...isolated, [key]: undefined }),
    );
  }
});

test("refuses URL parameters that could redirect writes to another schema", () => {
  for (const suffix of ["?options=-csearch_path%3Dpublic", "#ignored"]) {
    assert.throws(() =>
      invoiceVerificationConfig({
        ...isolated,
        DATABASE_URL: `${isolated.DATABASE_URL}${suffix}`,
      }),
    );
  }
});

test("refuses a misspelled verification mode rather than falling back", () => {
  for (const mode of ["", "0", "true", "stage3c4"]) {
    assert.throws(() =>
      invoiceVerificationConfig({ ...isolated, STAGE3C4_VERIFICATION: mode }),
    );
  }
});

test("retains the exact legacy target and existing fixture/evidence paths", () => {
  const config = invoiceVerificationConfig({
    ...isolated,
    STAGE3C4_VERIFICATION: undefined,
    INVOICE_TEST_ORIGIN: undefined,
    DATABASE_URL:
      "postgresql://stage3c3_test:synthetic@127.0.0.1:55434/taky_phase2_test",
  });
  assert.equal(config.origin, "http://127.0.0.1:3900");
  assert.equal(config.identity.role, "stage3c3_test");
  assert.equal(config.fixturePath, ".local/stage3c3-http-fixture.json");
  assert.equal(config.evidenceDirectory, "/private/tmp/taky-stage3c3-qa");
});
