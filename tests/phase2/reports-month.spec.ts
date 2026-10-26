import { readFile } from "node:fs/promises";
import { expect, guardedRequest, test } from "./guarded-test";
import { browserTestTarget } from "../../src/server/browser-test-target";
import { monthlyReportEnvelopeSchema } from "../../src/server/reports/contracts";
import { parseCsv } from "../helpers/expense-csv";

test("reports can select and load a month beyond the preset range", async ({
  page,
}) => {
  const origin = browserTestTarget().origin;
  const request = guardedRequest(page.request, origin);
  const login = await request.post("/api/auth/login/", {
    headers: { Origin: origin },
    data: {
      identifier: "test-admin",
      password: process.env.TEST_ADMIN_PASSWORD,
    },
  });
  expect(login.status()).toBe(200);

  await page.goto("/reports/");
  const monthInput = page.getByLabel("เดือน", { exact: true });
  await expect(monthInput).toHaveValue(/^\d{4}-\d{2}$/);

  const reportResponse = page.waitForResponse((response) => {
    const url = new URL(response.url());
    return (
      response.status() === 200 &&
      url.pathname === "/api/v1/reports/monthly/" &&
      url.searchParams.get("month") === "2027-03"
    );
  });
  await monthInput.fill("2027-03");
  await expect(monthInput).toHaveValue("2027-03");

  const response = await reportResponse;
  expect(response.status()).toBe(200);
  const body: unknown = await response.json();
  expect(monthlyReportEnvelopeSchema.parse(body).data.month).toBe("2027-03");
});

test("monthly financial summary downloads exact totals as CSV", async (
  { page },
  testInfo,
) => {
  const origin = browserTestTarget().origin;
  const request = guardedRequest(page.request, origin);
  const login = await request.post("/api/auth/login/", {
    headers: { Origin: origin },
    data: {
      identifier: "test-admin",
      password: process.env.TEST_ADMIN_PASSWORD,
    },
  });
  expect(login.status()).toBe(200);

  const report = monthlyReportEnvelopeSchema.parse({
    data: {
      month: "2027-03",
      invoices: {
        issuedTotal: "1234.50",
        issuedCount: 1,
        currentOutstanding: "1200.50",
        currentOutstandingInvoiceCount: 1,
        rows: [
          {
            invoiceId: "11111111-1111-4111-8111-111111111111",
            number: "INV-2027-03-0001",
            finalTotal: "1234.50",
            paidToDate: "34.00",
            currentOutstanding: "1200.50",
          },
        ],
      },
      receipts: {
        confirmedTotal: "34.00",
        confirmedCount: 1,
        rows: [
          {
            paymentId: "22222222-2222-4222-8222-222222222222",
            reference: "PAY-2027-03-0001",
            receiptNumber: "RCP-2027-03-0001",
            receivedAt: "2027-03-15T10:00:00.000Z",
            amount: "34.00",
          },
        ],
      },
      expenses: {
        opexTotal: "12.34",
        capexTotal: "56.78",
        total: "69.12",
        count: 2,
        rows: [
          {
            expenseId: "33333333-3333-4333-8333-333333333333",
            occurredAt: "2027-03-04",
            description: "Synthetic OPEX",
            categoryName: "Utilities",
            kind: "OPEX",
            amount: "12.34",
          },
          {
            expenseId: "44444444-4444-4444-8444-444444444444",
            occurredAt: "2027-03-05",
            description: "Synthetic CAPEX",
            categoryName: "Equipment",
            kind: "CAPEX",
            amount: "56.78",
          },
        ],
      },
    },
  });

  await page.route(
    /\/api\/v1\/reports\/monthly\/\?month=2027-03$/,
    (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(report),
      }),
  );

  await page.goto("/reports/");
  const monthInput = page.getByLabel("เดือน", { exact: true });
  const reportResponse = page.waitForResponse((response) => {
    const url = new URL(response.url());
    return (
      response.status() === 200 &&
      url.pathname === "/api/v1/reports/monthly/" &&
      url.searchParams.get("month") === "2027-03"
    );
  });
  await monthInput.fill("2027-03");
  expect((await reportResponse).status()).toBe(200);

  const downloadPromise = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "ส่งออกสรุป CSV", exact: true })
    .click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe(
    "taky-financial-summary-2027-03.csv",
  );
  const csvPath = testInfo.outputPath("monthly-financial-summary.csv");
  await download.saveAs(csvPath);

  expect(parseCsv(await readFile(csvPath, "utf8"))).toEqual([
    ["เดือน", "รายการ", "จำนวนเงิน (บาท)"],
    ["2027-03", "ยอดใบแจ้งหนี้ที่ออก", "1234.50"],
    ["2027-03", "ยอดคงค้างปัจจุบันของใบแจ้งหนี้", "1200.50"],
    ["2027-03", "รับชำระที่ยืนยันแล้วตามวันที่รับเงิน", "34.00"],
    ["2027-03", "ค่าใช้จ่าย OPEX ตามวันที่เกิดรายการ", "12.34"],
    ["2027-03", "ค่าใช้จ่าย CAPEX ตามวันที่เกิดรายการ", "56.78"],
  ]);
});
