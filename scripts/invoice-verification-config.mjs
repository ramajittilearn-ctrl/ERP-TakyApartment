import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";

export function invoiceVerificationConfig(env = process.env) {
  assert.ok(
    env.STAGE3C4_VERIFICATION === undefined ||
      env.STAGE3C4_VERIFICATION === "1",
    "STAGE3C4_VERIFICATION must be unset or exactly 1",
  );
  const stage3c4 = env.STAGE3C4_VERIFICATION === "1";
  const origin = stage3c4 ? "http://127.0.0.1:3800" : "http://127.0.0.1:3900";
  assert.equal(
    env.INVOICE_TEST_ORIGIN ?? (stage3c4 ? undefined : origin),
    origin,
    "INVOICE_TEST_ORIGIN must identify the selected verification app",
  );
  assert.ok(env.DATABASE_URL, "DATABASE_URL is required");
  const target = new URL(env.DATABASE_URL);
  assert.equal(target.protocol, "postgresql:");
  assert.equal(target.hostname, "127.0.0.1");
  assert.equal(target.port, stage3c4 ? "55440" : "55434");
  assert.equal(target.pathname, "/taky_phase2_test");
  const role = stage3c4 ? "stage3c4_test" : "stage3c3_test";
  assert.equal(target.username, role);
  assert.equal(
    target.search,
    "",
    "Verification URLs cannot override DB options",
  );
  assert.equal(target.hash, "");
  assert.ok(env.TEST_ADMIN_PASSWORD, "TEST_ADMIN_PASSWORD is required");
  assert.ok(env.TEST_STAFF_PASSWORD, "TEST_STAFF_PASSWORD is required");
  return {
    origin,
    target,
    identity: { name: "taky_phase2_test", role },
    fixturePath: stage3c4
      ? fileURLToPath(
          new URL("../.local/stage3c4/http-fixture.json", import.meta.url),
        )
      : ".local/stage3c3-http-fixture.json",
    evidenceDirectory: stage3c4
      ? fileURLToPath(new URL("../.local/stage3c4/invoices", import.meta.url))
      : "/private/tmp/taky-stage3c3-qa",
  };
}
