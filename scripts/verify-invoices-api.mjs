import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { Client } from "pg";
import { invoiceVerificationConfig } from "./invoice-verification-config.mjs";

const {
  origin,
  target,
  identity: expectedIdentity,
  fixturePath,
} = invoiceVerificationConfig();
const db = new Client({ connectionString: target.toString() });
const run = randomUUID();
const key = (operation) => `${run}:${operation}`;
const api = "/api/v1/invoices";
let checks = 0;

async function request(path, cookie = "", options = {}) {
  const { method = "GET", body, rawBody, requestOrigin = origin } = options;
  const response = await fetch(`${origin}${path}`, {
    method,
    headers: {
      cookie,
      ...(method === "GET"
        ? {}
        : { "content-type": "application/json", origin: requestOrigin }),
    },
    ...(method === "GET"
      ? {}
      : { body: rawBody ?? JSON.stringify(body ?? {}) }),
  });
  return { response, payload: await response.json() };
}
async function expect(path, cookie, options, status = 200) {
  const { response, payload } = await request(path, cookie, options);
  assert.equal(
    response.status,
    status,
    `${options?.method ?? "GET"} ${path}: ${JSON.stringify(payload.error ?? {})}`,
  );
  assert.equal(response.headers.get("cache-control"), "no-store");
  checks += 1;
  return status < 400 ? payload.data : payload.error;
}
async function login(identifier, password) {
  const { response } = await request("/api/auth/login/", "", {
    method: "POST",
    body: { identifier, password },
  });
  assert.equal(response.status, 200, `${identifier} login failed`);
  const cookie = response.headers
    .getSetCookie()
    .map((value) => value.split(";")[0])
    .join("; ");
  assert.ok(cookie);
  checks += 1;
  return cookie;
}
async function state() {
  const { rows } = await db.query(`SELECT jsonb_build_object(
    'invoices', (SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY id),'[]') FROM "Invoice" t),
    'items', (SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY id),'[]') FROM "InvoiceItem" t),
    'counters', (SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY month),'[]') FROM "InvoiceMonthCounter" t),
    'corrections', (SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY id),'[]') FROM "InvoiceCorrection" t),
    'commands', (SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY id),'[]') FROM "InvoiceCommand" t),
    'policies', (SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY "propertyId"),'[]') FROM "PropertyDuePolicy" t),
    'audit', (SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY id),'[]') FROM "AuditLog" t),
    'periods', (SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY id),'[]') FROM "BillingPeriod" t),
    'freezes', (SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY id),'[]') FROM "BillingPeriodFreeze" t),
    'frozenLeases', (SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY id),'[]') FROM "BillingFreezeLease" t),
    'approvals', (SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY id),'[]') FROM "BillingConsumptionApproval" t)
  ) AS value`);
  return rows[0].value;
}
async function unchanged(work) {
  const before = await state();
  const result = await work();
  assert.deepEqual(await state(), before, "Unexpected financial state write");
  return result;
}
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value !== null && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, item]) => item !== undefined)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([name, item]) => [name, canonical(item)]),
    );
  return value;
}
function verifyFingerprint(invoice) {
  const { fingerprint, ...body } = invoice.snapshot;
  const computed = createHash("sha256")
    .update(JSON.stringify(canonical(body)))
    .digest("hex");
  assert.equal(fingerprint, computed);
  assert.equal(invoice.fingerprint, computed);
}
function preservedContent(invoice) {
  return {
    number: invoice.number,
    finalTotal: invoice.finalTotal,
    fingerprint: invoice.fingerprint,
    snapshot: invoice.snapshot,
    dueDate: invoice.dueDate,
    dueProvenance: invoice.dueProvenance,
    notes: invoice.notes,
  };
}
const mutation = (body, method = "POST") => ({ method, body });

await db.connect();
try {
  const identity = (
    await db.query("SELECT current_database() AS name, current_user AS role")
  ).rows[0];
  assert.deepEqual(identity, expectedIdentity);
  checks += 1;
  const admin = await login("test-admin", process.env.TEST_ADMIN_PASSWORD);
  const staff = await login("test-staff", process.env.TEST_STAFF_PASSWORD);
  const propertyId = randomUUID();
  const floorId = randomUUID();
  const roomIds = [randomUUID(), randomUUID()];
  const leaseIds = [randomUUID(), randomUUID()];
  await db.query("BEGIN");
  try {
    await db.query(
      'INSERT INTO "Property" (id,code,name,"updatedAt") VALUES ($1,$2,$3,now())',
      [
        propertyId,
        `IHTTP-${run.slice(0, 8)}`,
        "Synthetic invoice HTTP property",
      ],
    );
    await db.query(
      'INSERT INTO "Floor" (id,"propertyId",number,name,"updatedAt") VALUES ($1,$2,1,$3,now())',
      [floorId, propertyId, "Synthetic invoice floor"],
    );
    for (const index of [0, 1]) {
      const tenantId = randomUUID();
      await db.query(
        'INSERT INTO "Room" (id,"floorId",number,rent,"updatedAt") VALUES ($1,$2,$3,$4,now())',
        [roomIds[index], floorId, `H${index + 1}`, "1000.00"],
      );
      await db.query(
        'INSERT INTO "Tenant" (id,name,"updatedAt") VALUES ($1,$2,now())',
        [tenantId, `Synthetic invoice HTTP tenant ${index + 1}`],
      );
      await db.query(
        'INSERT INTO "Lease" (id,number,"roomId","tenantId","startDate","endDate",rent,deposit,status,"updatedAt") VALUES ($1,$2,$3,$4,$5,$6,$7,$8,\'ACTIVE\',now())',
        [
          leaseIds[index],
          `IHTTP-${run.slice(0, 8)}-${index + 1}`,
          roomIds[index],
          tenantId,
          "2026-02-01",
          "2026-12-31",
          "1000.00",
          "0.00",
        ],
      );
    }
    await db.query("COMMIT");
  } catch (error) {
    await db.query("ROLLBACK");
    throw error;
  }
  const period = await expect(
    "/api/v1/billing-periods/",
    admin,
    mutation({ propertyId, month: "2026-02" }),
    201,
  );
  const billingPeriodId = period.id;
  for (const [kind, unitPrice] of [
    ["WATER", "20.0050"],
    ["ELECTRICITY", "30.0050"],
  ]) {
    const rate = await expect(
      "/api/v1/utility-rates/",
      admin,
      mutation({ propertyId, kind, effectiveFrom: "2026-01-01", unitPrice }),
      201,
    );
    await expect(
      "/api/v1/billing/rate-selections/",
      admin,
      mutation({
        billingPeriodId,
        kind,
        utilityRateId: rate.id,
        reason: "Synthetic HTTP rate evidence",
      }),
      201,
    );
    for (const leaseId of leaseIds)
      await expect(
        "/api/v1/billing/consumption-approvals/",
        admin,
        mutation({
          billingPeriodId,
          leaseId,
          kind,
          reason: "Synthetic HTTP approved estimate",
          evidence: [`synthetic:http:${run}`],
          source: {
            kind: "ESTIMATE",
            quantity: "1.000",
            sourceContext: "Synthetic HTTP estimate worksheet",
          },
        }),
        201,
      );
  }
  const previewPath = `/api/v1/billing/preview/?billingPeriodId=${billingPeriodId}`;
  await unchanged(async () => {
    await expect(previewPath, "", undefined, 401);
    await expect(`${api}/`, "", undefined, 401);
    const preview = await expect(previewPath, staff);
    assert.equal(preview.results.length, 2);
    for (const row of preview.results) {
      assert.equal(row.result.complete, true);
      assert.equal(row.result.snapshot.totals.finalTotal, "1050.01");
      assert.equal(row.result.snapshot.totals.displayLineTotal, "1050.02");
      assert.equal(row.result.snapshot.totals.reconciliationDelta, "-0.01");
    }
    await expect(
      `/api/v1/billing-periods/${billingPeriodId}/close/`,
      staff,
      mutation({}),
      403,
    );
  });
  await expect(
    `/api/v1/billing-periods/${billingPeriodId}/close/`,
    admin,
    mutation({}),
  );
  const frozenBefore = await state();
  const frozen = frozenBefore.frozenLeases.filter((row) =>
    leaseIds.includes(row.leaseId),
  );
  assert.equal(frozen.length, 2);
  const prepareBody = {
    billingPeriodId,
    leaseId: leaseIds[0],
    commandKey: key("prepare"),
  };
  let draft = await expect(`${api}/drafts/`, staff, mutation(prepareBody), 201);
  assert.equal(draft.status, "DRAFT");
  assert.equal(draft.number, null);
  assert.equal(draft.dueDate, null);
  assert.equal(draft.finalTotal, "1050.01");
  verifyFingerprint(draft);
  await unchanged(async () => {
    assert.deepEqual(
      await expect(`${api}/drafts/`, staff, mutation(prepareBody), 201),
      draft,
    );
    const error = await expect(
      `${api}/${draft.id}/issue/`,
      admin,
      mutation({
        expectedVersion: draft.version,
        commandKey: key("no-policy"),
      }),
      409,
    );
    assert.equal(error.code, "DUE_POLICY_REQUIRED");
    await expect(
      `${api}/due-policy/`,
      staff,
      mutation(
        {
          propertyId,
          offsetDays: 7,
          expectedVersion: 0,
          commandKey: key("staff-policy"),
        },
        "PUT",
      ),
      403,
    );
    await expect(
      `${api}/${draft.id}/`,
      staff,
      mutation(
        {
          expectedVersion: draft.version,
          commandKey: key("staff-override"),
          dueOverride: { dueDate: "2026-03-15", reason: "Synthetic override" },
        },
        "PATCH",
      ),
      403,
    );
    for (const action of ["issue", "void", "revise"])
      await expect(
        `${api}/${draft.id}/${action}/`,
        staff,
        mutation({
          expectedVersion: draft.version,
          commandKey: key(`staff-${action}`),
          ...(action === "void" ? { reason: "Synthetic denied void" } : {}),
          ...(action === "revise"
            ? {
                reason: "Synthetic denied correction",
                evidence: ["synthetic:denied"],
                correction: {
                  utilities: [{ kind: "WATER", quantity: "2.000" }],
                },
              }
            : {}),
        }),
        403,
      );
  });
  await expect(
    `${api}/due-policy/`,
    admin,
    mutation(
      {
        propertyId,
        offsetDays: 7,
        expectedVersion: 0,
        commandKey: key("policy"),
      },
      "PUT",
    ),
  );
  draft = await expect(
    `${api}/${draft.id}/refresh/`,
    admin,
    mutation({ expectedVersion: draft.version, commandKey: key("refresh") }),
  );
  assert.equal(draft.dueDate, "2026-03-07");
  assert.equal(draft.dueProvenance.kind, "POLICY");
  draft = await expect(
    `${api}/${draft.id}/`,
    admin,
    mutation(
      {
        expectedVersion: draft.version,
        commandKey: key("override"),
        notes: "Synthetic HTTP verification",
        dueOverride: {
          dueDate: "2026-03-15",
          reason: "Synthetic approved extension",
        },
      },
      "PATCH",
    ),
  );
  assert.equal(draft.dueDate, "2026-03-15");
  assert.equal(draft.dueProvenance.kind, "OVERRIDE");
  await unchanged(async () => {
    const body = { expectedVersion: draft.version, commandKey: key("invalid") };
    await expect(
      `${api}/${draft.id}/issue/`,
      admin,
      { ...mutation(body), requestOrigin: "https://invalid.example" },
      403,
    );
    await expect(
      `${api}/${draft.id}/issue/`,
      admin,
      { method: "POST", rawBody: "{" },
      400,
    );
    await expect(
      `${api}/${draft.id}/issue/`,
      admin,
      mutation({ ...body, invoiceId: draft.id }),
      422,
    );
    await expect(
      `${api}/${draft.id}/`,
      admin,
      mutation({ ...body, notes: "x".repeat(17000) }, "PATCH"),
      413,
    );
  });
  const counterBefore =
    (
      await db.query('SELECT value FROM "InvoiceMonthCounter" WHERE month=$1', [
        "202602",
      ])
    ).rows[0]?.value ?? 0;
  const issueBody = {
    expectedVersion: draft.version,
    commandKey: key("issue"),
  };
  const issued = await expect(
    `${api}/${draft.id}/issue/`,
    admin,
    mutation(issueBody),
  );
  assert.equal(issued.status, "ISSUED");
  assert.equal(
    issued.number,
    `INV-202602-${String(counterBefore + 1).padStart(4, "0")}`,
  );
  assert.equal(issued.finalTotal, "1050.01");
  verifyFingerprint(issued);
  const issuedItems = (await state()).items.filter(
    (row) => row.invoiceId === issued.id,
  );
  assert.equal(issuedItems.length, 3);
  await unchanged(async () => {
    assert.deepEqual(
      await expect(`${api}/${issued.id}/issue/`, admin, mutation(issueBody)),
      issued,
    );
    assert.deepEqual(await expect(`${api}/${issued.id}/`, staff), issued);
    assert.deepEqual(await expect(`${api}/${issued.id}/`, admin), issued);
    const listed = await expect(
      `${api}/?billingPeriodId=${billingPeriodId}`,
      admin,
    );
    assert.equal(listed.length, 1);
    assert.equal(listed[0].id, issued.id);
    assert.deepEqual(
      await expect(`${api}/?billingPeriodId=${billingPeriodId}`, staff),
      listed,
    );
    assert.equal(
      (await expect(`${api}/${issued.id}/history/`, staff)).length,
      1,
    );
    const options = await expect(`${api}/options/`, staff);
    assert.ok(
      options.periods.some(
        (row) =>
          row.id === billingPeriodId &&
          row.candidates.some((candidate) => candidate.leaseId === leaseIds[1]),
      ),
    );
  });
  const evidence = [`synthetic:corrected-estimate:${run}`];
  const reviseBody = {
    expectedVersion: issued.version,
    commandKey: key("revise"),
    reason: "Synthetic correction to original estimate worksheet",
    evidence,
    correction: { utilities: [{ kind: "WATER", quantity: "2.000" }] },
  };
  const replacement = await expect(
    `${api}/${issued.id}/revise/`,
    admin,
    mutation(reviseBody),
    201,
  );
  assert.equal(replacement.status, "ISSUED");
  assert.equal(replacement.previousInvoiceId, issued.id);
  assert.equal(replacement.revision, 2);
  assert.equal(
    replacement.number,
    `INV-202602-${String(counterBefore + 2).padStart(4, "0")}`,
  );
  assert.equal(replacement.finalTotal, "1070.02");
  assert.notEqual(replacement.fingerprint, issued.fingerprint);
  assert.deepEqual(replacement.correction.evidence, evidence);
  const water = replacement.snapshot.source.utilities.find(
    (row) => row.kind === "WATER",
  );
  assert.equal(water.consumption.kind, "ESTIMATE");
  assert.equal(water.consumption.quantity, "2.000");
  verifyFingerprint(replacement);
  const replacementItems = (await state()).items.filter(
    (row) => row.invoiceId === replacement.id,
  );
  assert.equal(replacementItems.length, 3);
  const atomicRows = (
    await db.query(
      'SELECT id,status,number,"previousInvoiceId",fingerprint FROM "Invoice" WHERE "leaseId"=$1 AND "billingPeriodId"=$2 ORDER BY revision',
      [leaseIds[0], billingPeriodId],
    )
  ).rows;
  assert.equal(atomicRows.length, 2);
  assert.equal(atomicRows[0].status, "VOID");
  assert.equal(atomicRows[1].status, "ISSUED");
  assert.equal(atomicRows[1].previousInvoiceId, atomicRows[0].id);
  await unchanged(async () => {
    assert.deepEqual(
      await expect(
        `${api}/${issued.id}/revise/`,
        admin,
        mutation(reviseBody),
        201,
      ),
      replacement,
    );
    const original = await expect(`${api}/${issued.id}/`, staff);
    assert.equal(original.status, "VOID");
    assert.equal(original.nextInvoiceId, replacement.id);
    assert.deepEqual(preservedContent(original), preservedContent(issued));
    const history = await expect(`${api}/${replacement.id}/history/`, admin);
    assert.deepEqual(
      history.map((row) => row.id),
      [issued.id, replacement.id],
    );
  });
  const voidBody = {
    expectedVersion: replacement.version,
    commandKey: key("void"),
    reason: "Synthetic standalone void verification",
  };
  const voided = await expect(
    `${api}/${replacement.id}/void/`,
    admin,
    mutation(voidBody),
  );
  assert.equal(voided.status, "VOID");
  assert.deepEqual(preservedContent(voided), preservedContent(replacement));
  await unchanged(async () => {
    assert.deepEqual(
      await expect(`${api}/${replacement.id}/void/`, admin, mutation(voidBody)),
      voided,
    );
  });
  const finalState = await state();
  assert.deepEqual(finalState.freezes, frozenBefore.freezes);
  assert.deepEqual(finalState.frozenLeases, frozenBefore.frozenLeases);
  assert.deepEqual(finalState.approvals, frozenBefore.approvals);
  assert.equal(
    finalState.invoices.filter((row) => row.leaseId === leaseIds[1]).length,
    0,
  );
  assert.equal(
    finalState.counters.find((row) => row.month === "202602").value,
    counterBefore + 2,
  );
  for (const [action, entityId, count] of [
    ["ISSUE_INVOICE", issued.id, 1],
    ["ISSUE_INVOICE", replacement.id, 1],
    ["REVISE_INVOICE", issued.id, 1],
    ["VOID_INVOICE", replacement.id, 1],
  ])
    assert.equal(
      finalState.audit.filter(
        (row) => row.action === action && row.entityId === entityId,
      ).length,
      count,
    );
  assert.deepEqual(
    finalState.items.filter((row) => row.invoiceId === issued.id),
    issuedItems,
  );
  assert.deepEqual(
    finalState.items.filter((row) => row.invoiceId === replacement.id),
    replacementItems,
  );
  await mkdir(dirname(fixturePath), { recursive: true });
  await writeFile(
    fixturePath,
    JSON.stringify(
      {
        propertyId,
        billingPeriodId,
        roomIds,
        leaseIds,
        invoiceIds: [issued.id, replacement.id],
      },
      null,
      2,
    ) + "\n",
    { mode: 0o600 },
  );
  console.info(
    `Invoice HTTP verification passed: ${checks} checks on isolated target.`,
  );
} finally {
  await db.end();
}
