import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

const runId = process.env.STAGE5_RUN_ID;
const origin = process.env.APP_ORIGIN;
const tlsHost = process.env.STAGE5_HOST;
const adminUsername = process.env.STAGE5_ADMIN_USERNAME;
const staffUsername = process.env.STAGE5_STAFF_USERNAME;
const adminPassword = process.env.TEST_ADMIN_PASSWORD;
const staffPassword = process.env.TEST_STAFF_PASSWORD;
const artifactDir = process.env.STAGE5_ARTIFACT_DIR;

for (const [name, value] of Object.entries({
  STAGE5_RUN_ID: runId,
  APP_ORIGIN: origin,
  STAGE5_HOST: tlsHost,
  STAGE5_ADMIN_USERNAME: adminUsername,
  STAGE5_STAFF_USERNAME: staffUsername,
  TEST_ADMIN_PASSWORD: adminPassword,
  TEST_STAFF_PASSWORD: staffPassword,
  STAGE5_ARTIFACT_DIR: artifactDir,
}))
  assert.ok(value, `${name} is required`);
assert.match(runId, /^[a-f0-9]{24}$/);
const parsedOrigin = new URL(origin);
assert.equal(parsedOrigin.protocol, "https:");
assert.equal(tlsHost, "127.0.0.1");
assert.equal(parsedOrigin.hostname, tlsHost);
assert.equal(parsedOrigin.pathname, "/");

const checks = [];
function check(name, predicate, evidence) {
  assert.ok(predicate, name);
  checks.push({ name, evidence: String(evidence) });
}
function key(prefix) {
  return `stage5:${runId}:${prefix}:${randomUUID()}`;
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
function verifyInvoiceFingerprint(invoice) {
  assert.ok(invoice.snapshot && typeof invoice.snapshot === "object");
  const { fingerprint, ...body } = invoice.snapshot;
  const computed = createHash("sha256")
    .update(JSON.stringify(canonical(body)))
    .digest("hex");
  assert.equal(fingerprint, computed);
  assert.equal(invoice.fingerprint, computed);
}

async function request(path, { cookie = "", method = "GET", body } = {}) {
  const response = await fetch(new URL(path, origin), {
    method,
    headers: {
      ...(cookie ? { cookie } : {}),
      ...(method === "GET"
        ? {}
        : {
            "content-type": "application/json",
            origin,
          }),
    },
    ...(method === "GET" ? {} : { body: JSON.stringify(body ?? {}) }),
    signal: globalThis.AbortSignal.timeout(15000),
  });
  const contentType = response.headers.get("content-type") ?? "";
  const payload = contentType.includes("application/json")
    ? await response.json()
    : undefined;
  assert.equal(
    response.headers.get("cache-control")?.includes("no-store"),
    true,
    `${method} ${path} omitted no-store`,
  );
  return { response, payload };
}
async function post(path, cookie, body, expectedStatus = 201) {
  const { response, payload } = await request(path, {
    cookie,
    method: "POST",
    body,
  });
  assert.equal(
    response.status,
    expectedStatus,
    `POST ${path} returned ${response.status}: ${JSON.stringify(payload?.error ?? {})}`,
  );
  return payload?.data;
}
async function recordActualMeter({
  adminCookie,
  staffCookie,
  roomId,
  kind,
  priorPeriodId,
  currentPeriodId,
  installedAt,
  priorReadingDate,
  currentReadingDate,
}) {
  const registration = await post("/api/v1/meters/", adminCookie, {
    roomId,
    kind,
    serial: `S5-${runId.slice(0, 8)}-${kind}`,
    installedAt,
    openingReading: "0.000",
    reason: "Synthetic Stage 5 meter registration",
  });
  const priorDraft = await post(
    "/api/v1/meter-readings/drafts/",
    staffCookie,
    {
      meterId: registration.meter.id,
      billingPeriodId: priorPeriodId,
      value: "100.000",
      readingDate: priorReadingDate,
      type: "NORMAL",
    },
    200,
  );
  const prior = await post(
    `/api/v1/meter-readings/${priorDraft.id}/confirm/`,
    staffCookie,
    {},
    200,
  );
  const currentDraft = await post(
    "/api/v1/meter-readings/drafts/",
    staffCookie,
    {
      meterId: registration.meter.id,
      billingPeriodId: currentPeriodId,
      value: "101.000",
      readingDate: currentReadingDate,
      type: "NORMAL",
    },
    200,
  );
  const current = await post(
    `/api/v1/meter-readings/${currentDraft.id}/confirm/`,
    staffCookie,
    {},
    200,
  );
  assert.equal(prior.status, "CONFIRMED");
  assert.equal(current.status, "CONFIRMED");
  assert.equal(current.previousReadingId, prior.id);
  assert.equal(current.consumption, "1.000");
  return { meter: registration.meter, previous: prior, current };
}
async function login(identifier, password) {
  const { response } = await request("/api/auth/login/", {
    method: "POST",
    body: { identifier, password },
  });
  assert.equal(response.status, 200, `${identifier} login failed`);
  const cookies = response.headers
    .getSetCookie()
    .map((value) => value.split(";")[0]);
  assert.equal(cookies.length, 1);
  const setCookie = response.headers.getSetCookie()[0];
  check(
    `${identifier} receives Secure HttpOnly SameSite session cookie`,
    /; Secure(?:;|$)/i.test(setCookie) &&
      /; HttpOnly(?:;|$)/i.test(setCookie) &&
      /; SameSite=Strict(?:;|$)/i.test(setCookie),
    "cookie attributes checked; token omitted",
  );
  assert.match(cookies[0], /^taky_session=[a-f0-9]{64}$/);
  return {
    cookie: cookies[0],
    token: cookies[0].slice("taky_session=".length),
  };
}
async function downloadPdf(path, cookie, filename, artifactName = filename) {
  const { response } = await request(path, { cookie });
  assert.equal(response.status, 200, `GET ${path} failed`);
  assert.equal(response.headers.get("content-type"), "application/pdf");
  assert.equal(
    response.headers.get("cache-control"),
    "private, no-store, max-age=0",
  );
  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
  assert.equal(
    response.headers.get("content-disposition"),
    `attachment; filename="${filename}"`,
  );
  const bytes = Buffer.from(await response.arrayBuffer());
  assert.ok(bytes.byteLength > 1000);
  assert.equal(
    Number(response.headers.get("content-length")),
    bytes.byteLength,
  );
  assert.equal(bytes.subarray(0, 5).toString(), "%PDF-");
  assert.ok(bytes.toString("latin1").includes("%%EOF"));
  const pathName = join(artifactDir, artifactName);
  await writeFile(pathName, bytes, { mode: 0o600, flag: "wx" });
  return {
    filename,
    bytes: bytes.byteLength,
    sha256: createHash("sha256").update(bytes).digest("hex"),
    file: artifactName,
  };
}

await mkdir(artifactDir, { recursive: true, mode: 0o700 });
const adminSession = await login(adminUsername, adminPassword);
const staffSession = await login(staffUsername, staffPassword);
assert.ok(adminSession.token && staffSession.token);

const suffix = runId.slice(0, 8);
const property = await post("/api/v1/properties/", adminSession.cookie, {
  code: `S5-${suffix}`,
  name: "Synthetic Stage 5 Property",
  address: "Synthetic address",
});
const floor = await post("/api/v1/floors/", adminSession.cookie, {
  propertyId: property.id,
  number: 1,
  name: "Synthetic floor",
});
const room = await post("/api/v1/rooms/", adminSession.cookie, {
  floorId: floor.id,
  number: "S5-101",
  rent: "1000.00",
  status: "AVAILABLE",
  notes: "Synthetic Stage 5 fixture",
});
const tenant = await post("/api/v1/tenants/", adminSession.cookie, {
  name: `Synthetic Stage 5 Tenant ${suffix}`,
  phone: "",
  email: "",
  address: "Synthetic address",
  notes: "",
  isDemo: false,
  assignment: {
    roomId: room.id,
    number: `S5-LEASE-${suffix}`,
    startDate: "2026-01-01",
    endDate: "2099-12-31",
    rent: "1000.00",
    deposit: "0.00",
  },
});
const leasesResponse = await request("/api/v1/leases/", {
  cookie: adminSession.cookie,
});
assert.equal(leasesResponse.response.status, 200);
const leases = leasesResponse.payload?.data;
assert.ok(Array.isArray(leases));
const lease = leases.find((entry) => entry.roomId === room.id);
assert.ok(lease, "synthetic active lease was not returned by API");
check(
  "tenant assignment retains the entered 1000.00 rent",
  lease.rent === "1000.00",
  lease.rent,
);

const now = new Date();
const month = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Bangkok",
  year: "numeric",
  month: "2-digit",
}).format(now);
const [year, monthNumber] = month.split("-").map(Number);
const priorMonthDate = new Date(Date.UTC(year, monthNumber - 2, 1));
const priorMonth = `${priorMonthDate.getUTCFullYear()}-${String(priorMonthDate.getUTCMonth() + 1).padStart(2, "0")}`;
const priorMonthEnd = String(
  new Date(Date.UTC(year, monthNumber - 1, 0)).getUTCDate(),
).padStart(2, "0");
const installedAt = `${priorMonth}-01`;
const priorReadingDate = `${priorMonth}-${priorMonthEnd}`;
const effectiveFrom = `${month}-01`;
const duePolicy = await request("/api/v1/invoices/due-policy/", {
  cookie: adminSession.cookie,
  method: "PUT",
  body: {
    propertyId: property.id,
    offsetDays: 5,
    expectedVersion: 0,
    commandKey: key("due-policy"),
  },
});
assert.equal(duePolicy.response.status, 200);
const period = await post("/api/v1/billing-periods/", adminSession.cookie, {
  propertyId: property.id,
  month,
});
const priorPeriod = await post(
  "/api/v1/billing-periods/",
  adminSession.cookie,
  { propertyId: property.id, month: priorMonth },
);

const actualReadings = {};
for (const kind of ["WATER", "ELECTRICITY"]) {
  actualReadings[kind] = await recordActualMeter({
    adminCookie: adminSession.cookie,
    staffCookie: staffSession.cookie,
    roomId: room.id,
    kind,
    priorPeriodId: priorPeriod.id,
    currentPeriodId: period.id,
    installedAt,
    priorReadingDate,
    currentReadingDate: `${month}-01`,
  });
}

const rates = [];
for (const [kind, unitPrice] of [
  ["WATER", "20.0050"],
  ["ELECTRICITY", "30.0050"],
]) {
  const rate = await post("/api/v1/utility-rates/", adminSession.cookie, {
    propertyId: property.id,
    kind,
    effectiveFrom,
    unitPrice,
  });
  rates.push(rate);
  await post("/api/v1/billing/rate-selections/", adminSession.cookie, {
    billingPeriodId: period.id,
    kind,
    utilityRateId: rate.id,
    reason: "Synthetic Stage 5 approved rate",
  });
  await post("/api/v1/billing/consumption-approvals/", adminSession.cookie, {
    billingPeriodId: period.id,
    leaseId: lease.id,
    kind,
    reason: "Synthetic Stage 5 confirmed actual consumption",
    evidence: [`synthetic:stage5:${runId}`],
    source: {
      kind: "ACTUAL",
      currentReadingId: actualReadings[kind].current.id,
    },
  });
}

const preview = await request(
  `/api/v1/billing/preview/?billingPeriodId=${encodeURIComponent(period.id)}`,
  { cookie: staffSession.cookie },
);
assert.equal(preview.response.status, 200);
const previewRows = preview.payload?.data?.results;
assert.equal(previewRows?.length, 1);
const previewTotal = previewRows[0].result.snapshot.totals.finalTotal;
const previewUtilities = previewRows[0].result.snapshot.source.utilities;
for (const [kind, expectedRate] of [
  ["WATER", "20.0050"],
  ["ELECTRICITY", "30.0050"],
]) {
  const utility = previewUtilities.find((item) => item.kind === kind);
  const reading = actualReadings[kind];
  assert.ok(utility, `missing ${kind} utility in frozen preview source`);
  assert.equal(utility.rate.value, expectedRate);
  assert.equal(utility.consumption.kind, "ACTUAL");
  assert.equal(utility.consumption.quantity, "1.000");
  assert.equal(utility.consumption.previous.id, reading.previous.id);
  assert.equal(utility.consumption.previous.value, "100.000");
  assert.equal(utility.consumption.current.id, reading.current.id);
  assert.equal(utility.consumption.current.value, "101.000");
}
assert.equal(previewTotal, "1050.01");
assert.equal(previewRows[0].result.snapshot.totals.displayLineTotal, "1050.02");
assert.equal(
  previewRows[0].result.snapshot.totals.reconciliationDelta,
  "-0.01",
);
check(
  "approved billing formula yields exact Decimal total 1050.01 from confirmed meter deltas and current rates",
  true,
  previewTotal,
);
const staffClose = await request(
  `/api/v1/billing-periods/${period.id}/close/`,
  { cookie: staffSession.cookie, method: "POST", body: {} },
);
assert.equal(staffClose.response.status, 403);
const closedPeriod = await post(
  `/api/v1/billing-periods/${period.id}/close/`,
  adminSession.cookie,
  {},
  200,
);
check("STAFF cannot close a billing period", true, staffClose.response.status);
check(
  "ADMIN closes the billing period",
  closedPeriod?.status === "CLOSED",
  closedPeriod?.status,
);

const draftBody = {
  billingPeriodId: period.id,
  leaseId: lease.id,
  commandKey: key("prepare-invoice"),
};
const draft = await post(
  "/api/v1/invoices/drafts/",
  staffSession.cookie,
  draftBody,
);
const draftReplay = await post(
  "/api/v1/invoices/drafts/",
  staffSession.cookie,
  draftBody,
);
assert.equal(draftReplay.id, draft.id);
assert.equal(draft.finalTotal, "1050.01");
verifyInvoiceFingerprint(draft);
check("invoice draft replay returns the same immutable draft", true, draft.id);

const issueBody = {
  expectedVersion: draft.version,
  commandKey: key("issue-invoice"),
};
const invoice = await post(
  `/api/v1/invoices/${draft.id}/issue/`,
  adminSession.cookie,
  issueBody,
  200,
);
const issueReplay = await post(
  `/api/v1/invoices/${draft.id}/issue/`,
  adminSession.cookie,
  issueBody,
  200,
);
assert.equal(invoice.number, issueReplay.number);
assert.equal(invoice.id, issueReplay.id);
assert.equal(invoice.finalTotal, "1050.01");
verifyInvoiceFingerprint(invoice);
check(
  "invoice issue replay preserves one invoice number",
  true,
  invoice.number,
);

const invoiceResponse = await request(`/api/v1/invoices/${invoice.id}/`, {
  cookie: staffSession.cookie,
});
assert.equal(invoiceResponse.response.status, 200);
assert.equal(invoiceResponse.payload?.data?.fingerprint, invoice.fingerprint);
assert.deepEqual(invoiceResponse.payload?.data?.labels, invoice.labels);
const invoiceLabels = globalThis.structuredClone(
  invoiceResponse.payload.data.labels,
);
const invoicePdf = await downloadPdf(
  `/api/v1/invoices/${invoice.id}/pdf/`,
  staffSession.cookie,
  `Invoice_${invoice.number}.pdf`,
);

const paymentBody = {
  leaseId: lease.id,
  amount: invoice.finalTotal,
  method: "CASH",
  receivedAt: new Date().toISOString(),
  commandKey: key("create-payment"),
};
const payment = await post(
  "/api/v1/payments/",
  staffSession.cookie,
  paymentBody,
);
const paymentReplay = await post(
  "/api/v1/payments/",
  staffSession.cookie,
  paymentBody,
);
assert.equal(paymentReplay.id, payment.id);
assert.equal(paymentReplay.reference, payment.reference);
assert.equal(payment.amount, invoice.finalTotal);

const confirmationBody = {
  expectedVersion: payment.version,
  commandKey: key("confirm-payment"),
  allocations: [
    {
      invoiceId: invoice.id,
      expectedVersion: invoice.version,
      amount: invoice.finalTotal,
    },
  ],
};
const confirmed = await post(
  `/api/v1/payments/${payment.id}/confirm/`,
  adminSession.cookie,
  confirmationBody,
  200,
);
const confirmedReplay = await post(
  `/api/v1/payments/${payment.id}/confirm/`,
  adminSession.cookie,
  confirmationBody,
  200,
);
assert.equal(confirmed.status, "CONFIRMED");
assert.equal(confirmed.receipt?.id, confirmedReplay.receipt?.id);
assert.equal(confirmed.receipt?.number, confirmedReplay.receipt?.number);
assert.deepEqual(confirmed.allocations, [
  { invoiceId: invoice.id, amount: invoice.finalTotal },
]);
check(
  "payment allocation equals the issued invoice total",
  confirmed.amount === invoice.finalTotal &&
    confirmed.allocations[0].amount === invoice.finalTotal,
  confirmed.amount,
);

const receiptPath = `/api/v1/receipts/${confirmed.receipt.id}/`;
const receiptResponse = await request(receiptPath, {
  cookie: staffSession.cookie,
});
assert.equal(receiptResponse.response.status, 200);
const receipt = receiptResponse.payload?.data;
assert.equal(receipt.number, confirmed.receipt.number);
assert.equal(receipt.snapshot.amount, invoice.finalTotal);
assert.equal(receipt.snapshot.invoices.length, 1);
assert.equal(receipt.snapshot.invoices[0].invoiceId, invoice.id);
assert.equal(receipt.snapshot.invoices[0].finalTotal, invoice.finalTotal);
assert.equal(receipt.snapshot.invoices[0].allocatedAmount, invoice.finalTotal);
assert.equal(receipt.cancellation, null);
const receiptReplay = await request(receiptPath, {
  cookie: staffSession.cookie,
});
assert.deepEqual(receiptReplay.payload?.data?.snapshot, receipt.snapshot);
assert.equal(receiptReplay.payload?.data?.fingerprint, receipt.fingerprint);
check(
  "receipt snapshot remains unchanged across reads and command replays",
  true,
  receipt.fingerprint,
);

const receiptPdf = await downloadPdf(
  `/api/v1/receipts/${receipt.id}/pdf/?download=1`,
  staffSession.cookie,
  `Receipt_${receipt.number}.pdf`,
);

const receiptLabels = globalThis.structuredClone(
  receipt.snapshot.invoices[0].labels,
);
const changedProperty = await request(`/api/v1/properties/${property.id}/`, {
  cookie: adminSession.cookie,
  method: "PUT",
  body: {
    code: property.code,
    name: "Changed synthetic property after issue",
    address: "Changed synthetic address after issue",
  },
});
assert.equal(changedProperty.response.status, 200);
assert.equal(
  changedProperty.payload?.data?.name,
  "Changed synthetic property after issue",
);
const changedTenant = await request(`/api/v1/tenants/${tenant.id}/`, {
  cookie: adminSession.cookie,
  method: "PUT",
  body: {
    name: "Changed synthetic tenant after issue",
    phone: "",
    email: "",
    address: "Changed synthetic tenant address",
    notes: "",
    isDemo: false,
  },
});
assert.equal(changedTenant.response.status, 200);
assert.equal(
  changedTenant.payload?.data?.name,
  "Changed synthetic tenant after issue",
);
const changedRoom = await request(`/api/v1/rooms/${room.id}/`, {
  cookie: adminSession.cookie,
  method: "PUT",
  body: {
    floorId: floor.id,
    number: room.number,
    rent: "99999.00",
    status: room.status,
    notes: room.notes,
  },
});
assert.equal(changedRoom.response.status, 200);
const changedLease = await request(`/api/v1/leases/${lease.id}/`, {
  cookie: adminSession.cookie,
  method: "PUT",
  body: {
    number: `CHANGED-${suffix}`,
    roomId: room.id,
    tenantId: tenant.id,
    startDate: lease.startDate.slice(0, 10),
    endDate: lease.endDate.slice(0, 10),
    rent: "88888.00",
    deposit: lease.deposit,
    status: "ACTIVE",
    isDemo: false,
  },
});
assert.equal(changedLease.response.status, 200);

const invoiceAfterSourceChange = await request(
  `/api/v1/invoices/${invoice.id}/`,
  { cookie: staffSession.cookie },
);
assert.equal(invoiceAfterSourceChange.response.status, 200);
assert.deepEqual(
  invoiceAfterSourceChange.payload.data.snapshot,
  invoice.snapshot,
);
assert.equal(invoiceAfterSourceChange.payload.data.finalTotal, "1050.01");
assert.equal(invoiceAfterSourceChange.payload.data.number, invoice.number);
assert.deepEqual(invoiceAfterSourceChange.payload.data.labels, invoiceLabels);
const receiptAfterSourceChange = await request(receiptPath, {
  cookie: staffSession.cookie,
});
assert.equal(receiptAfterSourceChange.response.status, 200);
assert.deepEqual(
  receiptAfterSourceChange.payload.data.snapshot,
  receipt.snapshot,
);
assert.equal(
  receiptAfterSourceChange.payload.data.fingerprint,
  receipt.fingerprint,
);
assert.equal(receiptAfterSourceChange.payload.data.number, receipt.number);
assert.equal(receiptAfterSourceChange.payload.data.snapshot.amount, "1050.01");
assert.deepEqual(
  receiptAfterSourceChange.payload.data.snapshot.invoices[0].labels,
  receiptLabels,
);
const invoicePdfAfterSourceChange = await downloadPdf(
  `/api/v1/invoices/${invoice.id}/pdf/`,
  staffSession.cookie,
  `Invoice_${invoice.number}.pdf`,
  "invoice-after-source-change.pdf",
);
const receiptPdfAfterSourceChange = await downloadPdf(
  `/api/v1/receipts/${receipt.id}/pdf/?download=1`,
  staffSession.cookie,
  `Receipt_${receipt.number}.pdf`,
  "receipt-after-source-change.pdf",
);
check(
  "post-issue live tenant/property/room/lease changes preserve invoice and receipt snapshots, labels, and totals",
  invoiceAfterSourceChange.payload.data.finalTotal === "1050.01" &&
    receiptAfterSourceChange.payload.data.snapshot.amount === "1050.01" &&
    JSON.stringify(invoiceAfterSourceChange.payload.data.labels) ===
      JSON.stringify(invoiceLabels) &&
    JSON.stringify(
      receiptAfterSourceChange.payload.data.snapshot.invoices[0].labels,
    ) === JSON.stringify(receiptLabels),
  invoice.fingerprint,
);

const unauthorizedPdf = await request(`/api/v1/receipts/${receipt.id}/pdf/`);
assert.equal(unauthorizedPdf.response.status, 401);
check(
  "anonymous receipt PDF access is denied",
  true,
  unauthorizedPdf.response.status,
);

const report = {
  schemaVersion: 1,
  runId,
  scenario: "synthetic-current-source-billing-invoice-payment-receipt",
  syntheticOnly: true,
  fixture: {
    propertyId: property.id,
    floorId: floor.id,
    roomId: room.id,
    tenantId: tenant.id,
    leaseId: lease.id,
    billingPeriodId: period.id,
    utilityRateIds: rates.map((rate) => rate.id),
  },
  billing: {
    month,
    expectedRent: "1000.00",
    waterRate: "20.0050",
    electricityRate: "30.0050",
    expectedActualQuantities:
      "1.000 per utility from confirmed 100.000 to 101.000 readings",
    meterReadings: Object.fromEntries(
      Object.entries(actualReadings).map(([kind, readings]) => [
        kind,
        {
          meterId: readings.meter.id,
          previousReadingId: readings.previous.id,
          previousValue: readings.previous.value,
          currentReadingId: readings.current.id,
          currentValue: readings.current.value,
          actualQuantity: readings.current.consumption,
        },
      ]),
    ),
    finalTotal: "1050.01",
    displayLineTotal: "1050.02",
    reconciliationDelta: "-0.01",
  },
  invoice: {
    id: invoice.id,
    number: invoice.number,
    finalTotal: invoice.finalTotal,
    fingerprint: invoice.fingerprint,
    labels: invoiceLabels,
    pdf: invoicePdf,
    pdfAfterSourceChange: invoicePdfAfterSourceChange,
  },
  payment: {
    id: payment.id,
    reference: payment.reference,
    amount: payment.amount,
    status: confirmed.status,
    allocationAmount: confirmed.allocations[0].amount,
    receiptNumber: receipt.number,
  },
  receipt: {
    id: receipt.id,
    number: receipt.number,
    amount: receipt.snapshot.amount,
    fingerprint: receipt.fingerprint,
    labels: receiptLabels,
    pdf: receiptPdf,
    pdfAfterSourceChange: receiptPdfAfterSourceChange,
  },
  sourceMutation: {
    propertyName: "Changed synthetic property after issue",
    tenantName: "Changed synthetic tenant after issue",
    roomRent: "99999.00",
    leaseRent: "88888.00",
    invoiceFingerprintAfter: invoiceAfterSourceChange.payload.data.fingerprint,
    receiptFingerprintAfter: receiptAfterSourceChange.payload.data.fingerprint,
  },
  checks,
};
await writeFile(
  join(artifactDir, "scenario-summary.json"),
  `${JSON.stringify(report, null, 2)}\n`,
  { mode: 0o600, flag: "wx" },
);
process.stdout.write(
  `${JSON.stringify({ runId, invoice: invoice.number, receipt: receipt.number, finalTotal: invoice.finalTotal, checks: checks.length })}\n`,
);
