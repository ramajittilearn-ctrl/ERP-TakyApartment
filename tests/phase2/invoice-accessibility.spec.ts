import AxeBuilder from "@axe-core/playwright";
import { test, expect } from "./guarded-test";
import invoices from "../fixtures/accessibility-invoices.json";

test("invoice loading, populated ready and recoverable error states remain accessible", async ({
  page,
}) => {
  const origin = process.env.PLAYWRIGHT_BASE_URL!;
  const login = await page.request.post("/api/auth/login/", {
    headers: { Origin: origin },
    data: {
      identifier: "test-admin",
      password: process.env.TEST_ADMIN_PASSWORD,
    },
  });
  expect(login.status()).toBe(200);
  await page.setViewportSize({ width: 390, height: 844 });
  let release = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let fail = false;
  await page.route(/\/api\/v1\/invoices\/?\?/, async (route) => {
    await gate;
    await route.fulfill({
      status: fail ? 503 : 200,
      contentType: "application/json",
      body: JSON.stringify(
        fail
          ? {
              error: {
                code: "UNAVAILABLE",
                message: "โหลดใบแจ้งหนี้ไม่สำเร็จ",
              },
            }
          : invoices,
      ),
    });
  });
  await page.goto("/billing/");
  const reload = page.getByRole("button", { name: "โหลดข้อมูลใหม่" });
  await expect(reload).toBeDisabled();
  await expect(
    page.getByRole("status").filter({ hasText: "โหลด" }),
  ).toBeVisible();
  const scan = async () => {
    await page.evaluate(() => document.fonts.ready);
    expect(
      (
        await new AxeBuilder({ page })
          .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
          .analyze()
      ).violations,
    ).toEqual([]);
  };
  await scan();
  await expect(reload).toBeDisabled();
  release();
  await expect(reload).toBeEnabled();
  await expect(
    page.getByText("Historical tenant", { exact: true }),
  ).toBeVisible();
  await scan();
  fail = true;
  await reload.click();
  await expect(page.getByText(/โหลดใบแจ้งหนี้ไม่สำเร็จ/)).toBeVisible();
  await expect(reload).toBeEnabled();
  await scan();
  fail = false;
  await reload.click();
  await expect(
    page.getByText("Historical tenant", { exact: true }),
  ).toBeVisible();
  await expect(page.getByText(/โหลดใบแจ้งหนี้ไม่สำเร็จ/)).toHaveCount(0);
  await scan();
  await page.screenshot({
    path: `${process.env.SCREENSHOT_DIR}/invoice-accessible-ready.png`,
    fullPage: true,
  });
});
