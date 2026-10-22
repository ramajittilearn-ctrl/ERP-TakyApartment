import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

const routes = [
  { path: "/", name: "dashboard", heading: "สวัสดีครับ" },
  { path: "/rooms/", name: "rooms", heading: "ห้องพัก" },
  { path: "/tenants/", name: "tenants", heading: "ข้อมูลผู้เช่า" },
  { path: "/leases/", name: "leases", heading: "สัญญาเช่า" },
  { path: "/billing/", name: "billing", heading: "ออกบิลรายเดือน" },
  { path: "/payments/", name: "payments", heading: "บันทึกการชำระเงิน" },
  { path: "/expenses/", name: "expenses", heading: "บันทึกค่าใช้จ่าย" },
  { path: "/reports/", name: "reports", heading: "รายงานการเงิน" },
  { path: "/maintenance/", name: "maintenance", heading: "รายการแจ้งซ่อม" },
  { path: "/settings/", name: "settings", heading: "ตั้งค่าระบบ" },
];
for (const width of [1440, 768, 390]) {
  test.describe(`${width}px responsive pages`, () => {
    test.use({ viewport: { width, height: width === 390 ? 844 : 1000 } });
    for (const route of routes) {
      test(`${route.name}: route, accessibility and screenshot`, async ({
        page,
      }) => {
        const errors: string[] = [];
        const external: string[] = [];
        page.on("pageerror", (e) => errors.push(e.message));
        page.on("request", (r) => {
          if (!r.url().startsWith("http://127.0.0.1:3100"))
            external.push(r.url());
        });
        const response = await page.goto(route.path);
        expect(response?.status()).toBe(200);
        await expect(
          page.getByRole("heading", {
            level: 1,
            name: route.heading,
            exact: true,
          }),
        ).toBeVisible();
        await page.evaluate(() => document.fonts.ready);
        expect(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= window.innerWidth,
          ),
        ).toBe(true);
        const result = await new AxeBuilder({ page })
          .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
          .analyze();
        expect(
          result.violations.map((v) => ({
            id: v.id,
            nodes: v.nodes.map((n) => ({
              target: n.target,
              reason: n.failureSummary,
            })),
          })),
        ).toEqual([]);
        expect(errors).toEqual([]);
        expect(external).toEqual([]);
        await page.screenshot({
          path: `docs/screenshots/${width}/${route.name}.png`,
          fullPage: true,
          animations: "disabled",
        });
        if (width === 1440)
          await expect(
            page
              .getByRole("navigation", { name: "เมนูหลัก" })
              .locator('[aria-current="page"]'),
          ).toHaveAttribute("href", route.path);
      });
    }
  });
}

test("capture the invoice draft and payment form", async ({ page }) => {
  await page.goto("/billing/");
  await page.getByLabel("เดือน", { exact: true }).selectOption("2026-11");
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({
    path: "docs/screenshots/1440/billing-draft.png",
    fullPage: true,
  });
  await page.goto("/payments/");
  await page
    .getByRole("button", { name: "บันทึกการชำระเงิน", exact: true })
    .click();
  await page.screenshot({
    path: "docs/screenshots/1440/payment-dialog.png",
    fullPage: true,
  });
  const result = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
    .analyze();
  expect(
    result.violations.map((v) => ({
      id: v.id,
      nodes: v.nodes.map((n) => ({
        target: n.target,
        reason: n.failureSummary,
      })),
    })),
  ).toEqual([]);
});

test("invoice and receipt print layouts isolate the document", async ({
  page,
}) => {
  await page.setViewportSize({ width: 794, height: 1123 });
  await page.goto("/billing/");
  await page.emulateMedia({ media: "print" });
  await expect(page.locator(".billing-editor")).toBeHidden();
  await expect(
    page.getByLabel("ตัวอย่างใบแจ้งหนี้", { exact: true }),
  ).toBeVisible();
  await page.screenshot({
    path: "docs/screenshots/print/invoice.png",
    fullPage: true,
  });
  await page.emulateMedia({ media: "screen" });
  await page.goto("/payments/");
  await page
    .getByRole("button", { name: "ดูรายการ DEMO-202610-101", exact: true })
    .click();
  await page.emulateMedia({ media: "print" });
  await expect(page.locator(".workspace")).toBeHidden();
  await expect(page.locator("body")).toHaveCSS(
    "background-color",
    "rgb(255, 255, 255)",
  );
  await expect(page.locator(".modal-content")).toHaveCSS("box-shadow", "none");
  await expect(page.locator(".modal-content")).toHaveCSS("position", "static");
  await expect(page.locator(".receipt-preview")).toBeVisible();
  await page.screenshot({
    path: "docs/screenshots/print/receipt.png",
    fullPage: true,
  });
});
