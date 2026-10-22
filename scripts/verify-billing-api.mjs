import assert from "node:assert/strict";
import { Client } from "pg";

const origin = process.env.BILLING_TEST_ORIGIN ?? "http://127.0.0.1:3800";
const target = new URL(process.env.DATABASE_URL);
assert.equal(
  origin,
  "http://127.0.0.1:3800",
  "Only use the dedicated billing test app",
);
assert.equal(target.hostname, "127.0.0.1");
assert.equal(target.port, "55432");
assert.equal(target.pathname, "/taky_phase2_test");
assert.equal(target.username, "stage3c_test");
const db = new Client({ connectionString: target.toString() });
await db.connect();
let checks = 0;
const post = (path, cookie, body, requestOrigin = origin) =>
  fetch(`${origin}${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: requestOrigin,
      cookie,
    },
    body: JSON.stringify(body),
  });
async function login(identifier, password) {
  const response = await post("/api/auth/login/", "", { identifier, password });
  assert.equal(response.status, 200);
  checks += 1;
  return response.headers
    .getSetCookie()
    .map((value) => value.split(";")[0])
    .join("; ");
}
async function counts() {
  return (
    await db.query(
      'SELECT (SELECT count(*) FROM "Invoice") AS invoices, (SELECT count(*) FROM "InvoiceItem") AS items, (SELECT count(*) FROM "MeterReading") AS readings, (SELECT count(*) FROM "BillingRateSelection") AS rates, (SELECT count(*) FROM "BillingConsumptionApproval") AS approvals, (SELECT count(*) FROM "AuditLog") AS audit',
    )
  ).rows;
}
try {
  assert.equal(
    (await db.query("SELECT current_database() AS name, current_user AS role"))
      .rows[0].name,
    "taky_phase2_test",
  );
  const { rows } = await db.query(
    `SELECT bp.id AS period, l.id AS lease, r.id AS rate FROM "BillingPeriod" bp JOIN "Property" p ON p.id = bp."propertyId" JOIN "Floor" f ON f."propertyId" = p.id JOIN "Room" room ON room."floorId" = f.id JOIN "Lease" l ON l."roomId" = room.id JOIN "UtilityRate" r ON r."propertyId" = p.id AND r.kind = 'WATER' WHERE p.code LIKE 'C%' AND bp.status = 'OPEN' AND bp."startsOn" = DATE '2026-02-01' AND l.status = 'ACTIVE' AND r."effectiveFrom" <= bp."endsOn" AND NOT EXISTS (SELECT 1 FROM "UtilityRate" n WHERE n."propertyId" = p.id AND n.kind = 'WATER' AND n."effectiveFrom" > r."effectiveFrom" AND n."effectiveFrom" <= bp."startsOn") AND NOT EXISTS (SELECT 1 FROM "UtilityMeter" m WHERE m."roomId" = room.id) ORDER BY bp."createdAt" LIMIT 1`,
  );
  assert.ok(rows[0], "Run isolated synthetic billing fixtures first");
  const source = rows[0];
  const path = `/api/v1/billing/preview/?billingPeriodId=${source.period}`;
  assert.equal((await fetch(`${origin}${path}`)).status, 401);
  checks += 1;
  const staff = await login("test-staff", process.env.TEST_STAFF_PASSWORD);
  const admin = await login("test-admin", process.env.TEST_ADMIN_PASSWORD);
  const before = await counts();
  const preview = await fetch(`${origin}${path}`, {
    headers: { cookie: staff },
  });
  assert.equal(preview.status, 200);
  assert.equal(preview.headers.get("cache-control"), "no-store");
  assert.equal((await preview.json()).data.sourceSet, "PREVIEW_ONLY");
  assert.deepEqual(await counts(), before);
  checks += 1;
  const rate = {
    billingPeriodId: source.period,
    kind: "WATER",
    utilityRateId: source.rate,
    reason: "Synthetic API rate approval",
  };
  const estimate = {
    billingPeriodId: source.period,
    leaseId: source.lease,
    kind: "WATER",
    reason: "Synthetic API estimate approval",
    evidence: ["api-fixture:1"],
    source: {
      kind: "ESTIMATE",
      quantity: "1.000",
      sourceContext: "Isolated API fixture",
    },
  };
  assert.equal(
    (await post("/api/v1/billing/rate-selections/", staff, rate)).status,
    403,
  );
  assert.equal(
    (await post("/api/v1/billing/consumption-approvals/", staff, estimate))
      .status,
    403,
  );
  assert.equal(
    (
      await post(
        "/api/v1/billing/rate-selections/",
        admin,
        rate,
        "https://invalid.example",
      )
    ).status,
    403,
  );
  assert.equal(
    (
      await post("/api/v1/billing/consumption-approvals/", admin, {
        ...estimate,
        source: { ...estimate.source, quantity: "1.0001" },
      })
    ).status,
    422,
  );
  assert.equal(
    (
      await fetch(`${origin}/api/v1/billing/preview/?billingPeriodId=invalid`, {
        headers: { cookie: staff },
      })
    ).status,
    422,
  );
  assert.deepEqual(await counts(), before);
  checks += 5;
  const selected = await post("/api/v1/billing/rate-selections/", admin, rate);
  assert.equal(selected.status, 201);
  const selectedData = (await selected.json()).data;
  assert.equal(
    (
      await db.query(
        'SELECT count(*) AS count FROM "AuditLog" WHERE "entityId" = $1::uuid AND action = $2',
        [selectedData.selectionId, "APPROVE_RATE"],
      )
    ).rows[0].count,
    "1",
  );
  checks += 1;
  const estimated = await post(
    "/api/v1/billing/consumption-approvals/",
    admin,
    estimate,
  );
  assert.equal(estimated.status, 201);
  const estimatedData = (await estimated.json()).data;
  assert.equal(
    (
      await db.query(
        'SELECT count(*) AS count FROM "AuditLog" WHERE "entityId" = $1::uuid AND action = $2',
        [estimatedData.id, "APPROVE_CONSUMPTION"],
      )
    ).rows[0].count,
    "1",
  );
  checks += 1;
  console.info(
    `Billing HTTP verification passed: ${checks} checks on isolated target.`,
  );
} finally {
  await db.end();
}
