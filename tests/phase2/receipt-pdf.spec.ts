import { randomUUID } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import AxeBuilder from "@axe-core/playwright";
import { z } from "zod";
import type { Download, Locator, Response } from "@playwright/test";
import { test, expect, type Page } from "./guarded-test";
import { browserTestTarget } from "../../src/server/browser-test-target";
import { db } from "../../src/server/db";
import { paymentPageSchema } from "../../src/features/payments/client";
import {
  createBillingPeriod,
  createUtilityRate,
  closeBillingPeriod,
} from "../../src/server/finance";
import {
  approveBillingConsumption,
  approveBillingRate,
} from "../../src/server/billing";
import {
  configureDuePolicy,
  prepareDraft,
  issueInvoice,
} from "../../src/server/invoices";
import {
  createPayment,
  confirmPayment,
  getReceipt,
  reversePayment,
} from "../../src/server/payments";

// Browser plugin skill is unavailable. Main executes this existing guarded Playwright workflow.
const key = () => randomUUID();
async function signIn(page: Page, staff = false) {
  const response = await page.request.post("/api/auth/login/", {
    headers: { Origin: browserTestTarget().origin },
    data: {
      identifier: staff ? "test-staff" : "test-admin",
      password: staff
        ? process.env.TEST_STAFF_PASSWORD
        : process.env.TEST_ADMIN_PASSWORD,
    },
  });
  expect(response.status()).toBe(200);
}

async function fixture() {
  const target = browserTestTarget();
  const identity = await db.$queryRaw<
    { name: string; role: string }[]
  >`SELECT current_database() AS name, current_user AS role`;
  expect(identity).toEqual([{ name: target.database, role: target.role }]);
  const admin = await db.user.findUniqueOrThrow({
    where: { username: "test-admin" },
  });
  const suffix = key();
  const property = await db.property.create({
    data: {
      code: `PDF-${suffix}`,
      name: `ที่พักสมมติ / Synthetic PDF ${suffix}`,
      address: "99 ถนนสมมติ / Synthetic address",
    },
  });
  const floor = await db.floor.create({
    data: { propertyId: property.id, number: 1, name: "Synthetic PDF" },
  });
  const room = await db.room.create({
    data: { floorId: floor.id, number: "PDF101", rent: "1000.00" },
  });
  const tenant = await db.tenant.create({
    data: { name: `ผู้เช่าสมมติ / Synthetic PDF ${suffix}`, isDemo: false },
  });
  const lease = await db.lease.create({
    data: {
      number: `PDF-${suffix}`,
      roomId: room.id,
      tenantId: tenant.id,
      startDate: new Date("2026-01-01"),
      endDate: new Date("2026-12-31"),
      rent: "1000.00",
      deposit: "0",
      status: "ACTIVE",
      isDemo: false,
    },
  });
  await configureDuePolicy(admin, {
    propertyId: property.id,
    offsetDays: 5,
    expectedVersion: 0,
    commandKey: key(),
  });
  const period = await createBillingPeriod(admin, {
    propertyId: property.id,
    month: "2026-01",
  });
  for (const kind of ["WATER", "ELECTRICITY"] as const) {
    const rate = await createUtilityRate(admin, {
      propertyId: property.id,
      kind,
      effectiveFrom: "2026-01-01",
      unitPrice: "0.0000",
    });
    await approveBillingRate(admin, {
      billingPeriodId: period.id,
      kind,
      utilityRateId: rate.id,
      reason: "Synthetic receipt browser fixture",
    });
    await approveBillingConsumption(admin, {
      billingPeriodId: period.id,
      leaseId: lease.id,
      kind,
      reason: "Synthetic receipt estimate",
      evidence: ["Synthetic-only"],
      source: {
        kind: "ESTIMATE",
        quantity: "0.000",
        sourceContext: "Isolated receipt browser acceptance",
      },
    });
  }
  await closeBillingPeriod(admin, period.id);
  const draft = await prepareDraft(admin, {
    billingPeriodId: period.id,
    leaseId: lease.id,
    commandKey: key(),
  });
  const invoice = await issueInvoice(admin, {
    invoiceId: draft.id,
    expectedVersion: draft.version,
    commandKey: key(),
  });
  const pending = await createPayment(admin, {
    leaseId: lease.id,
    amount: "0.30",
    method: "BANK_TRANSFER",
    receivedAt: "2026-10-22T18:01:02+00:00",
    receivingAccountKey: "SYNTHETIC-RECEIPT-BROWSER",
    externalReference: `SYNTHETIC-${key()}`,
    commandKey: key(),
  });
  const payment = await confirmPayment(admin, {
    paymentId: pending.id,
    expectedVersion: pending.version,
    commandKey: key(),
    allocations: [
      {
        invoiceId: invoice.id,
        expectedVersion: invoice.version,
        amount: "0.30",
      },
    ],
  });
  if (!payment.receipt) throw new Error("Persisted synthetic receipt required");
  return {
    admin,
    payment,
    receipt: await getReceipt(admin, payment.receipt.id),
    lease,
  };
}

async function showReceipt(page: Page, reference: string, leaseId: string) {
  await page.goto("/payments/");
  await page
    .getByLabel("สัญญาเช่า (ข้อมูลปัจจุบัน)", { exact: true })
    .selectOption(leaseId);
  await page
    .getByRole("button", { name: `ดูรายการ ${reference}`, exact: true })
    .click();
  const receipt = page.getByRole("region", {
    name: "ข้อมูลใบเสร็จรับเงิน",
    exact: true,
  });
  await expect(receipt).toBeVisible();
  return receipt;
}

function isPdf(response: Response, path: string, attachment: boolean) {
  const url = new URL(response.url());
  return (
    url.pathname === path && url.search === (attachment ? "?download=1" : "")
  );
}
function pdfHeaders(response: Response, number: string, attachment: boolean) {
  expect(response.status()).toBe(200);
  const headers = response.headers();
  expect(headers["content-type"]).toBe("application/pdf");
  expect(headers["cache-control"]).toBe("private, no-store, max-age=0");
  expect(headers["x-content-type-options"]).toBe("nosniff");
  expect(headers["content-disposition"]).toBe(
    `${attachment ? "attachment" : "inline"}; filename="Receipt_${number}.pdf"`,
  );
  expect(Number(headers["content-length"])).toBeGreaterThan(10000);
}
async function keyboardTabTo(page: Page, target: Locator) {
  for (let count = 0; count < 100; count++) {
    if (await target.evaluate((node) => node === document.activeElement))
      return;
    await page.keyboard.press("Tab");
  }
  throw new Error("Receipt link was not reachable with keyboard Tab");
}

async function clickDownload(page: Page, link: Locator): Promise<Download> {
  const context = page.context();
  const observedPages = new Set([page]);
  let resolveDownload: (value: Download) => void = () => {};
  const download = new Promise<Download>((resolve) => {
    resolveDownload = resolve;
  });
  const observe = (newPage: Page) => {
    observedPages.add(newPage);
    newPage.on("download", resolveDownload);
  };
  page.on("download", resolveDownload);
  context.on("page", observe);
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(
      () =>
        reject(
          new Error("Receipt link did not produce a real browser download"),
        ),
      15000,
    );
  });
  try {
    await link.click();
    return await Promise.race([download, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
    context.off("page", observe);
    for (const observed of observedPages)
      observed.off("download", resolveDownload);
  }
}

test.afterAll(() => db.$disconnect());

for (const role of ["ADMIN", "STAFF"] as const) {
  test(`receipt PDF persisted ${role} opens inline, downloads real bytes and supports narrow keyboard actions`, async ({
    page,
  }, testInfo) => {
    if (role === "ADMIN") {
      const foreign = await fixture();
      for (let index = 0; index < 51; index++) {
        await createPayment(foreign.admin, {
          leaseId: foreign.lease.id,
          amount: "0.01",
          method: "BANK_TRANSFER",
          receivedAt: "2026-10-23T18:01:02+00:00",
          receivingAccountKey: "SYNTHETIC-RECEIPT-PAGINATION",
          externalReference: `SYNTHETIC-PAGE-${key()}`,
          commandKey: key(),
        });
      }
    }
    const f = await fixture();
    await signIn(page, role === "STAFF");
    if (role === "ADMIN") {
      const response = await page.request.get(
        "/api/v1/payments/?offset=0&limit=50",
      );
      expect(response.status()).toBe(200);
      const unfiltered = z
        .object({ data: paymentPageSchema })
        .parse(await response.json()).data;
      expect(unfiltered.items).toHaveLength(50);
      expect(unfiltered.items.map((item) => item.reference)).not.toContain(
        f.payment.reference,
      );
      await testInfo.attach(
        "Target receipt is outside the default first page",
        {
          body: Buffer.from(
            JSON.stringify({
              targetLeaseId: f.lease.id,
              targetReference: f.payment.reference,
              unfilteredCount: unfiltered.items.length,
              targetAbsent: true,
            }),
          ),
          contentType: "application/json",
        },
      );
    }
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("console", (message) => {
      if (message.type() === "error") errors.push(message.text());
    });
    const region = await showReceipt(page, f.payment.reference, f.lease.id);
    await expect(region).toContainText(f.receipt.number);
    await expect(region).toContainText(
      "ข้อมูลผู้ออกเอกสารตามกฎหมายยังไม่ได้กำหนด",
    );
    const path = `/api/v1/receipts/${f.receipt.id}/pdf/`;
    const open = region.getByRole("link", {
      name: "เปิด PDF / พิมพ์",
      exact: true,
    });
    const download = region.getByRole("link", {
      name: "ดาวน์โหลด PDF",
      exact: true,
    });
    await expect(open).toHaveAttribute("href", path);
    await expect(open).toHaveAttribute("target", "_blank");
    await expect(open).toHaveAttribute("rel", "noopener noreferrer");
    const inlineResponse = page.context().waitForEvent("response", {
      predicate: (response) => isPdf(response, path, false),
    });
    const popupPromise = page.waitForEvent("popup");
    await keyboardTabTo(page, open);
    await expect(open).toBeFocused();
    await page.keyboard.press("Enter");
    const popup = await popupPromise;
    pdfHeaders(await inlineResponse, f.receipt.number, false);
    await expect
      .poll(() => popup.url())
      .toBe(`${browserTestTarget().origin}${path}`);
    await popup.close();
    const attachmentResponse = page.context().waitForEvent("response", {
      predicate: (response) => isPdf(response, path, true),
    });
    const downloaded = await clickDownload(page, download);
    const response = await attachmentResponse;
    pdfHeaders(response, f.receipt.number, true);
    expect(downloaded.suggestedFilename()).toBe(
      `Receipt_${f.receipt.number}.pdf`,
    );
    const savedPath = testInfo.outputPath(`${role.toLowerCase()}-receipt.pdf`);
    await downloaded.saveAs(savedPath);
    const bytes = await readFile(savedPath);
    expect(bytes.subarray(0, 5).toString()).toBe("%PDF-");
    expect(bytes.toString("latin1")).toContain("%%EOF");
    expect(bytes.byteLength).toBe(Number(response.headers()["content-length"]));
    await testInfo.attach(`${role} actual receipt PDF`, {
      path: savedPath,
      contentType: "application/pdf",
    });
    const snapshotPath = testInfo.outputPath("frozen-receipt.json");
    await writeFile(snapshotPath, JSON.stringify(f.receipt, null, 2));
    await testInfo.attach("Expected frozen facts", {
      path: snapshotPath,
      contentType: "application/json",
    });
    await page.setViewportSize({ width: 390, height: 844 });
    await keyboardTabTo(page, download);
    await expect(download).toBeFocused();
    await expect(download).toBeInViewport();
    await expect(open).toBeVisible();
    const bounds = await region.boundingBox();
    expect(bounds).not.toBeNull();
    if (bounds) {
      expect(bounds.x).toBeGreaterThanOrEqual(0);
      expect(bounds.x + bounds.width).toBeLessThanOrEqual(391);
    }
    const axe = await new AxeBuilder({ page })
      .include('section[aria-label="ข้อมูลใบเสร็จรับเงิน"]')
      .withTags(["wcag2a", "wcag2aa"])
      .analyze();
    expect(axe.violations).toEqual([]);
    await testInfo.attach("Narrow receipt controls", {
      body: await page.screenshot({ fullPage: true }),
      contentType: "image/png",
    });
    expect(await getReceipt(f.admin, f.receipt.id)).toEqual(f.receipt);
    expect(await db.receipt.count({ where: { paymentId: f.payment.id } })).toBe(
      1,
    );
    expect(errors).toEqual([]);
  });
}

test("receipt PDF persisted cancellation remains original and revoked or disabled sessions cannot export", async ({
  page,
}, testInfo) => {
  const f = await fixture();
  await signIn(page);
  const region = await showReceipt(page, f.payment.reference, f.lease.id);
  await reversePayment(f.admin, {
    paymentId: f.payment.id,
    expectedVersion: f.payment.version,
    commandKey: key(),
    reason: "Synthetic browser cancellation",
  });
  await page
    .getByRole("button", { name: "อ่านข้อมูลล่าสุด", exact: true })
    .click();
  await expect(
    region.getByText("ใบเสร็จถูกยกเลิก", { exact: true }),
  ).toBeVisible();
  await expect(region).toContainText("Synthetic browser cancellation");
  const after = await getReceipt(f.admin, f.receipt.id);
  expect(after.snapshot).toEqual(f.receipt.snapshot);
  expect(after.fingerprint).toBe(f.receipt.fingerprint);
  const pdfPath = `/api/v1/receipts/${f.receipt.id}/pdf/`;
  const responsePromise = page.context().waitForEvent("response", {
    predicate: (response) => isPdf(response, pdfPath, true),
  });
  const download = await clickDownload(
    page,
    region.getByRole("link", { name: "ดาวน์โหลด PDF", exact: true }),
  );
  pdfHeaders(await responsePromise, after.number, true);
  const cancelledPath = testInfo.outputPath("cancelled-receipt.pdf");
  await download.saveAs(cancelledPath);
  await testInfo.attach(
    "Actual cancelled receipt PDF for independent text and visual inspection",
    { path: cancelledPath, contentType: "application/pdf" },
  );
  await testInfo.attach("Original and cancellation facts", {
    body: Buffer.from(JSON.stringify({ before: f.receipt, after }, null, 2)),
    contentType: "application/json",
  });
  expect((await readFile(cancelledPath)).subarray(0, 5).toString()).toBe(
    "%PDF-",
  );
  const logout = await page.request.post("/api/auth/logout/", {
    headers: { Origin: browserTestTarget().origin },
  });
  expect(logout.status()).toBe(200);
  const revoked = await page.request.get(pdfPath);
  expect(revoked.status()).toBe(401);
  expect(revoked.headers()["cache-control"]).toBe("no-store");
  expect(revoked.headers()["content-type"]).toContain("application/json");
  await signIn(page, true);
  const staff = await db.user.findUniqueOrThrow({
    where: { username: "test-staff" },
  });
  try {
    await db.user.update({ where: { id: staff.id }, data: { disabled: true } });
    const disabled = await page.request.get(`${pdfPath}?download=1`);
    expect(disabled.status()).toBe(401);
    expect(disabled.headers()["cache-control"]).toBe("no-store");
    expect(disabled.headers()["content-type"]).toContain("application/json");
  } finally {
    await db.user.update({
      where: { id: staff.id },
      data: { disabled: false },
    });
  }
  expect(await db.receipt.count({ where: { paymentId: f.payment.id } })).toBe(
    1,
  );
});
