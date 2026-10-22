import assert from "node:assert/strict";
import { mkdir, readFile } from "node:fs/promises";
import { chromium, expect } from "@playwright/test";
import { Client } from "pg";
import { z } from "zod";
import { invoiceVerificationConfig } from "./invoice-verification-config.mjs";

// Browser plugin not available. Use the installed Playwright and Chrome.
// Run the HTTP verifier first to create a fresh isolated fixture.
const { origin, evidenceDirectory, target, identity, fixturePath } =
  invoiceVerificationConfig();
const fixture = z
  .strictObject({
    propertyId: z.uuid(),
    billingPeriodId: z.uuid(),
    roomIds: z.tuple([z.uuid(), z.uuid()]),
    leaseIds: z.tuple([z.uuid(), z.uuid()]),
    invoiceIds: z.tuple([z.uuid(), z.uuid()]),
  })
  .parse(JSON.parse(await readFile(fixturePath, "utf8")));
const db = new Client({ connectionString: target.toString() });
let browser;
let activePage;
let checks = 0;
const errors = [];
const requests = [];
async function check(name, work) {
  await work();
  checks += 1;
  console.info(`PASS ${checks}: ${name}`);
}
function watch(page) {
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  page.on("request", (request) => {
    if (
      request.method() !== "GET" &&
      request.url().startsWith(`${origin}/api/v1/invoices`)
    )
      requests.push(request);
  });
}
async function login(context, identifier, password) {
  const response = await context.request.post(`${origin}/api/auth/login/`, {
    headers: { Origin: origin },
    data: { identifier, password },
  });
  assert.equal(response.status(), 200, `${identifier} session login failed`);
  assert.ok((await context.cookies(origin)).length, "Session cookie missing");
}
async function selectPeriod(page) {
  await page.goto(`${origin}/billing/`);
  await expect(
    page
      .getByLabel("รอบบิล", { exact: true })
      .locator(`option[value="${fixture.billingPeriodId}"]`),
  ).toBeAttached();
  await page
    .getByLabel("รอบบิล", { exact: true })
    .selectOption(fixture.billingPeriodId);
  await page
    .getByLabel("ห้อง", { exact: true })
    .selectOption(fixture.roomIds[1]);
  await expect(
    page.getByText("กำลังโหลดใบแจ้งหนี้…", { exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByText("มีชุดข้อมูลตรึงแล้ว", { exact: true }),
  ).toBeVisible();
}
async function health(page) {
  assert.equal(new URL(page.url()).origin, origin);
  assert.equal(new URL(page.url()).pathname, "/billing/");
  assert.equal(await page.title(), "Taky Apartment ERP");
  await expect(
    page.getByRole("heading", { name: "ใบแจ้งหนี้", exact: true }),
  ).toBeVisible();
  await expect(
    page.locator(
      "nextjs-portal, vite-error-overlay, #webpack-dev-server-client-overlay",
    ),
  ).toHaveCount(0);
  await expect(
    page.getByText(/Application error:|Unhandled Runtime Error/),
  ).toHaveCount(0);
  assert.equal(errors.length, 0, `Browser errors: ${errors.join(" | ")}`);
}
async function mutation(page, endpoint, method, trigger, expectedStatus = 200) {
  const responsePromise = page.waitForResponse((response) => {
    const url = new URL(response.url());
    return (
      url.origin === origin &&
      url.pathname.replace(/\/$/, "") === endpoint &&
      response.request().method() === method &&
      ![307, 308].includes(response.status())
    );
  });
  await trigger();
  const response = await responsePromise;
  assert.equal(
    response.status(),
    expectedStatus,
    `Unexpected ${method} ${endpoint} response`,
  );
  assert.equal(response.headers()["cache-control"], "no-store");
  const payload = await response.json();
  assert.ok(
    payload.data && !payload.error,
    "Expected successful data envelope",
  );
  const input = response.request().postDataJSON();
  assert.match(
    input.commandKey,
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
  );
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(
    page.getByRole("status").filter({ hasText: "บันทึกเรียบร้อยแล้ว" }),
  ).toBeVisible();
  return { invoice: payload.data, input };
}
async function detail(page, number = null) {
  const table = page.getByRole("region", {
    name: "รายการใบแจ้งหนี้",
    exact: true,
  });
  const row = number
    ? table.getByRole("row").filter({ hasText: number })
    : table.getByRole("row").filter({ hasText: "H2" });
  await expect(row).toHaveCount(1);
  await row.getByRole("button", { name: "ดูรายละเอียด", exact: true }).click();
  const heading = number ?? "รายละเอียดฉบับร่าง";
  const section = page
    .locator("section.card")
    .filter({ has: page.getByRole("heading", { name: heading, exact: true }) });
  await expect(section).toBeVisible();
  await expect(
    section.getByRole("heading", {
      name: "แหล่งข้อมูลที่บันทึกไว้",
      exact: true,
    }),
  ).toBeVisible();
  return section;
}
function financialContent(invoice) {
  return {
    number: invoice.number,
    snapshot: invoice.snapshot,
    finalTotal: invoice.finalTotal,
    fingerprint: invoice.fingerprint,
    dueDate: invoice.dueDate,
    dueProvenance: invoice.dueProvenance,
    notes: invoice.notes,
  };
}
async function readInvoice(context, id) {
  const response = await context.request.get(
    `${origin}/api/v1/invoices/${id}/`,
  );
  assert.equal(response.status(), 200);
  return (await response.json()).data;
}
async function noOverflow(page, label) {
  const dimensions = await page.locator("html").evaluate((element) => ({
    viewport: element.clientWidth,
    document: element.scrollWidth,
    body: element.ownerDocument.body.scrollWidth,
  }));
  assert.ok(
    dimensions.document <= dimensions.viewport + 1 &&
      dimensions.body <= dimensions.viewport + 1,
    `${label} page overflows: ${JSON.stringify(dimensions)}`,
  );
}

await db.connect();
try {
  await check("isolated database identity and fresh HTTP fixture", async () => {
    assert.deepEqual(
      (
        await db.query(
          "SELECT current_database() AS name, current_user AS role",
        )
      ).rows[0],
      identity,
    );
    const scope = (
      await db.query(
        'SELECT bp.status,p.code,fl.snapshot FROM "BillingPeriod" bp JOIN "Property" p ON p.id=bp."propertyId" JOIN "BillingPeriodFreeze" f ON f."billingPeriodId"=bp.id JOIN "BillingFreezeLease" fl ON fl."freezeId"=f.id WHERE bp.id=$1 AND p.id=$2 AND fl."leaseId"=$3 AND fl."roomId"=$4',
        [
          fixture.billingPeriodId,
          fixture.propertyId,
          fixture.leaseIds[1],
          fixture.roomIds[1],
        ],
      )
    ).rows;
    assert.equal(scope.length, 1);
    assert.equal(scope[0].status, "CLOSED");
    assert.match(scope[0].code, /^IHTTP-/);
    assert.equal(scope[0].snapshot.totals.finalTotal, "1050.01");
    const existing = await db.query(
      'SELECT id FROM "Invoice" WHERE "leaseId"=$1 AND "billingPeriodId"=$2',
      [fixture.leaseIds[1], fixture.billingPeriodId],
    );
    assert.equal(
      existing.rowCount,
      0,
      "Browser fixture was already consumed. Rerun the HTTP verifier to create a fresh fixture; do not reset a database.",
    );
  });
  const frozenBefore = (
    await db.query(
      'SELECT to_jsonb(f) AS value FROM "BillingFreezeLease" f WHERE "leaseId"=ANY($1::uuid[]) ORDER BY id',
      [fixture.leaseIds],
    )
  ).rows;
  await mkdir(evidenceDirectory, { recursive: true });
  browser = await chromium.launch({
    headless: true,
    ...(process.platform === "darwin" ? { channel: "chrome" } : {}),
  });
  const staffContext = await browser.newContext({
    baseURL: origin,
    viewport: { width: 1440, height: 1000 },
    locale: "th-TH",
    timezoneId: "Asia/Bangkok",
    reducedMotion: "reduce",
  });
  await login(staffContext, "test-staff", process.env.TEST_STAFF_PASSWORD);
  const staffPage = await staffContext.newPage();
  activePage = staffPage;
  watch(staffPage);
  await selectPeriod(staffPage);
  await check("STAFF desktop page and restricted actions", async () => {
    await health(staffPage);
    for (const name of [
      "ตรวจสอบและปิดรอบ",
      "ตั้งค่าวันครบกำหนด",
      "ออกใบแจ้งหนี้",
      "ออกฉบับแก้ไข",
      "ยกเลิกใบแจ้งหนี้",
    ])
      await expect(
        staffPage.getByRole("button", { name, exact: true }),
      ).toHaveCount(0);
    await noOverflow(staffPage, "desktop staff");
  });
  let draft;
  await check(
    "STAFF prepares the second frozen lease and exact amount",
    async () => {
      await staffPage
        .getByRole("button", { name: "เตรียมฉบับร่าง", exact: true })
        .click();
      const dialog = staffPage.getByRole("dialog");
      await dialog
        .getByLabel("สัญญาจากชุดข้อมูลตรึง", { exact: true })
        .selectOption(fixture.leaseIds[1]);
      const result = await mutation(
        staffPage,
        "/api/v1/invoices/drafts",
        "POST",
        () =>
          dialog.getByRole("button", { name: "ยืนยัน", exact: true }).click(),
        201,
      );
      assert.equal(result.input.leaseId, fixture.leaseIds[1]);
      assert.equal(result.input.billingPeriodId, fixture.billingPeriodId);
      draft = result.invoice;
      assert.equal(draft.status, "DRAFT");
      assert.equal(draft.number, null);
      assert.equal(draft.finalTotal, "1050.01");
      assert.equal(draft.dueDate, "2026-03-07");
      const section = await detail(staffPage);
      await expect(
        section.locator("strong").filter({ hasText: /^1,050[.]01 บาท$/ }),
      ).toBeVisible();
      await expect(
        section.getByText("ส่วนต่างการปัดเศษกับยอดเรียกเก็บ", { exact: true }),
      ).toBeVisible();
      await expect(
        section.getByText("ประมาณการที่ ADMIN อนุมัติ", { exact: true }),
      ).toHaveCount(2);
    },
  );
  const notes = "บันทึกฉบับร่างโดย STAFF สำหรับตรวจสอบ Stage 3C-3";
  await check(
    "STAFF saves notes without financial or due changes",
    async () => {
      await staffPage
        .getByRole("button", { name: "แก้ไขหมายเหตุ", exact: true })
        .click();
      const dialog = staffPage.getByRole("dialog");
      await expect(
        dialog.getByLabel("วันครบกำหนด", { exact: true }),
      ).toHaveCount(0);
      await dialog.getByLabel("หมายเหตุ", { exact: true }).fill(notes);
      const result = await mutation(
        staffPage,
        `/api/v1/invoices/${draft.id}`,
        "PATCH",
        () =>
          dialog.getByRole("button", { name: "ยืนยัน", exact: true }).click(),
      );
      assert.equal(result.input.expectedVersion, draft.version);
      assert.equal("dueOverride" in result.input, false);
      assert.deepEqual(result.invoice.snapshot, draft.snapshot);
      assert.equal(result.invoice.dueDate, draft.dueDate);
      assert.equal(result.invoice.notes, notes);
      draft = result.invoice;
      await detail(staffPage);
      await expect(staffPage.getByText(notes, { exact: true })).toBeVisible();
      await staffPage.screenshot({
        path: `${evidenceDirectory}/desktop-staff-draft.png`,
        fullPage: true,
      });
    },
  );
  const adminContext = await browser.newContext({
    baseURL: origin,
    viewport: { width: 1440, height: 1000 },
    locale: "th-TH",
    timezoneId: "Asia/Bangkok",
    reducedMotion: "reduce",
  });
  await login(adminContext, "test-admin", process.env.TEST_ADMIN_PASSWORD);
  const page = await adminContext.newPage();
  activePage = page;
  watch(page);
  await selectPeriod(page);
  await detail(page);
  let issued;
  await check(
    "ADMIN confirms issuance with unchanged totals and due provenance",
    async () => {
      await page
        .getByRole("button", { name: "ออกใบแจ้งหนี้", exact: true })
        .click();
      const dialog = page.getByRole("dialog");
      await expect(dialog.getByText(/จองเลขที่ใหม่/)).toBeVisible();
      const before = await readInvoice(adminContext, draft.id);
      assert.equal(before.status, "DRAFT");
      const result = await mutation(
        page,
        `/api/v1/invoices/${draft.id}/issue`,
        "POST",
        () =>
          dialog.getByRole("button", { name: "ยืนยัน", exact: true }).click(),
      );
      issued = result.invoice;
      assert.equal(result.input.expectedVersion, draft.version);
      assert.equal(issued.status, "ISSUED");
      assert.match(issued.number, /^INV-202602-\d{4}$/);
      assert.equal(issued.finalTotal, draft.finalTotal);
      assert.equal(issued.dueDate, draft.dueDate);
      assert.deepEqual(issued.dueProvenance, draft.dueProvenance);
      assert.deepEqual(issued.snapshot, draft.snapshot);
      assert.equal(issued.notes, notes);
      const section = await detail(page, issued.number);
      await expect(
        section.getByRole("button", {
          name: "แก้ไขหมายเหตุ / วันครบกำหนด",
          exact: true,
        }),
      ).toHaveCount(0);
    },
  );
  let replacement;
  const reason = "ตรวจสอบเอกสารอนุมัติปริมาณประมาณการน้ำอีกครั้ง";
  const evidence = "synthetic:browser:approved-estimate-worksheet";
  await check(
    "ADMIN approves an evidenced invoice-specific revision",
    async () => {
      await page
        .getByRole("button", { name: "ออกฉบับแก้ไข", exact: true })
        .click();
      const dialog = page.getByRole("dialog");
      await expect(dialog.getByText(/รอบอนาคต/)).toBeVisible();
      await dialog
        .getByLabel("ปริมาณน้ำที่อนุมัติ", { exact: true })
        .fill("2.000");
      await dialog.getByLabel("เหตุผล", { exact: true }).fill(reason);
      await dialog
        .getByLabel("หลักฐานการแก้ไข", { exact: true })
        .fill(evidence);
      const result = await mutation(
        page,
        `/api/v1/invoices/${issued.id}/revise`,
        "POST",
        () =>
          dialog
            .getByRole("button", {
              name: "ยืนยันอนุมัติและออกฉบับใหม่",
              exact: true,
            })
            .click(),
        201,
      );
      assert.deepEqual(result.input.correction, {
        useCurrentContract: false,
        utilities: [{ kind: "WATER", quantity: "2.000" }],
      });
      assert.equal(result.input.reason, reason);
      assert.deepEqual(result.input.evidence, [evidence]);
      replacement = result.invoice;
      assert.equal(replacement.status, "ISSUED");
      assert.equal(replacement.revision, 2);
      assert.equal(replacement.previousInvoiceId, issued.id);
      assert.notEqual(replacement.number, issued.number);
      assert.equal(replacement.finalTotal, "1070.02");
      assert.equal(replacement.dueDate, issued.dueDate);
      assert.deepEqual(replacement.correction.evidence, [evidence]);
      const original = await readInvoice(adminContext, issued.id);
      assert.equal(original.status, "VOID");
      assert.deepEqual(financialContent(original), financialContent(issued));
      const section = await detail(page, replacement.number);
      await expect(
        section.locator(".notice").filter({ hasText: reason }),
      ).toBeVisible();
      const history = section.getByRole("list");
      await expect(history.getByRole("listitem")).toHaveCount(2);
      await expect(
        history.getByRole("button", {
          name: `${issued.number} · ฉบับ 1`,
          exact: true,
        }),
      ).toBeVisible();
      await page.screenshot({
        path: `${evidenceDirectory}/desktop-admin-revision.png`,
        fullPage: true,
      });
    },
  );
  await check(
    "ADMIN void requires a reason and preserves issued content",
    async () => {
      await page
        .getByRole("button", { name: "ยกเลิกใบแจ้งหนี้", exact: true })
        .click();
      const dialog = page.getByRole("dialog");
      const reasonField = dialog.getByLabel("เหตุผล", { exact: true });
      assert.equal(
        await reasonField.evaluate((element) => element.checkValidity()),
        false,
      );
      const count = requests.length;
      await dialog.getByRole("button", { name: "ยืนยัน", exact: true }).click();
      await expect(dialog).toBeVisible();
      assert.equal(requests.length, count, "Empty reason submitted a mutation");
      const voidReason = "ยกเลิกเอกสารสังเคราะห์หลังตรวจสอบหน้าจอ";
      await reasonField.fill(voidReason);
      const result = await mutation(
        page,
        `/api/v1/invoices/${replacement.id}/void`,
        "POST",
        () =>
          dialog.getByRole("button", { name: "ยืนยัน", exact: true }).click(),
      );
      assert.equal(result.input.reason, voidReason);
      assert.equal(result.invoice.status, "VOID");
      assert.deepEqual(
        financialContent(result.invoice),
        financialContent(replacement),
      );
      const section = await detail(page, replacement.number);
      for (const name of [
        "ออกใบแจ้งหนี้",
        "ออกฉบับแก้ไข",
        "ยกเลิกใบแจ้งหนี้",
        "ปรับปรุงฉบับร่าง",
        "แก้ไขหมายเหตุ / วันครบกำหนด",
      ])
        await expect(
          section.getByRole("button", { name, exact: true }),
        ).toHaveCount(0);
      await expect(section.getByText(new RegExp(voidReason))).toBeVisible();
    },
  );
  await check(
    "mobile filters, invoice detail and policy dialog remain usable",
    async () => {
      await page.setViewportSize({ width: 390, height: 844 });
      await page.getByLabel("สถานะ", { exact: true }).selectOption("VOID");
      await detail(page, replacement.number);
      await health(page);
      await noOverflow(page, "mobile detail");
      await expect(page.getByLabel("รอบบิล", { exact: true })).toBeVisible();
      await expect(page.getByLabel("ห้อง", { exact: true })).toBeVisible();
      await page.screenshot({
        path: `${evidenceDirectory}/mobile-invoice-detail.png`,
        fullPage: true,
      });
      await page
        .getByRole("button", { name: "ตั้งค่าวันครบกำหนด", exact: true })
        .click();
      const dialog = page.getByRole("dialog");
      await expect(
        dialog.getByLabel("จำนวนวันหลังสิ้นรอบ", { exact: true }),
      ).toHaveValue("7");
      const box = await dialog.boundingBox();
      assert.ok(
        box && box.x >= -1 && box.x + box.width <= 391,
        "Mobile dialog clips horizontally",
      );
      await noOverflow(page, "mobile dialog");
      await page.screenshot({
        path: `${evidenceDirectory}/mobile-policy-dialog.png`,
        fullPage: true,
      });
      await dialog.getByRole("button", { name: "กลับ", exact: true }).click();
    },
  );
  await check(
    "frozen sources remain unchanged and browser errors are absent",
    async () => {
      assert.deepEqual(
        (
          await db.query(
            'SELECT to_jsonb(f) AS value FROM "BillingFreezeLease" f WHERE "leaseId"=ANY($1::uuid[]) ORDER BY id',
            [fixture.leaseIds],
          )
        ).rows,
        frozenBefore,
      );
      await health(page);
      await health(staffPage);
      assert.equal(errors.length, 0, errors.join(" | "));
    },
  );
  console.info(
    `Invoice browser verification passed: ${checks} checks. Desktop 1440x1000; mobile 390x844. Screenshots: ${evidenceDirectory}`,
  );
} catch (error) {
  if (activePage) {
    await mkdir(evidenceDirectory, { recursive: true });
    await activePage
      .screenshot({ path: `${evidenceDirectory}/failure.png`, fullPage: true })
      .catch(() => {});
  }
  throw error;
} finally {
  if (browser) await browser.close();
  await db.end();
}
