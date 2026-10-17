import { expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

test("room filtering, empty state, dialog keyboard and focus return", async ({
  page,
}) => {
  await page.goto("/rooms/");
  await expect(page.locator(".room-card")).toHaveCount(15);
  await page.getByLabel("ชั้น", { exact: true }).selectOption("2");
  await expect(page.locator(".room-card")).toHaveCount(5);
  const room = page.getByRole("button", { name: /ห้อง 201/ });
  await room.click();
  await expect(page.getByRole("dialog")).toBeVisible();
  expect(
    (
      await new AxeBuilder({ page })
        .include('[role="dialog"]')
        .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
        .analyze()
    ).violations,
  ).toEqual([]);
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toBeHidden();
  await expect(room).toBeFocused();
  await page.getByLabel("ค้นหาห้องหรือผู้เช่า").fill("does-not-exist");
  await expect(
    page.getByRole("heading", { name: "ไม่พบรายการ" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "ล้างตัวกรอง" }).click();
  await expect(page.locator(".room-card")).toHaveCount(15);
});

test("tenant profile tabs and edit use the selected tenant", async ({
  page,
}) => {
  await page.goto("/tenants/");
  await page.getByLabel("ค้นหาผู้เช่า", { exact: true }).fill("102");
  await expect(page.locator(".tenant-profile")).toContainText(
    "ผู้เช่าตัวอย่าง B",
  );
  await page.getByRole("tab", { name: "ใบแจ้งหนี้", exact: true }).click();
  await expect(page.getByRole("tabpanel")).toContainText("INV-202610-102");
  await page.getByRole("button", { name: "แก้ไขข้อมูล", exact: true }).click();
  await page
    .getByLabel("ชื่อผู้เช่า", { exact: true })
    .fill("ผู้เช่าตัวอย่าง แก้ไข");
  await page.getByRole("button", { name: "บันทึกข้อมูลสาธิต" }).click();
  await page.getByLabel("ค้นหาผู้เช่า", { exact: true }).fill("");
  await expect(page.getByRole("status")).toContainText(
    "บันทึกข้อมูลผู้เช่าสาธิตแล้ว",
  );
  await expect(page.locator(".tenant-profile")).toContainText(
    "ผู้เช่าตัวอย่าง แก้ไข",
  );
});

test("issue a demo invoice, record a partial payment and reconcile across routes", async ({
  page,
}) => {
  await page.goto("/billing/");
  await expect(
    page.getByLabel("ตัวอย่างใบแจ้งหนี้", { exact: true }),
  ).toContainText("INV-202610-101");
  await page.getByLabel("เดือน", { exact: true }).selectOption("2026-11");
  await page.getByLabel("มิเตอร์น้ำปัจจุบัน", { exact: true }).fill("110");
  await expect(
    page.getByText("มิเตอร์ปัจจุบันต้องไม่ต่ำกว่าครั้งก่อน").first(),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "ออกใบแจ้งหนี้สาธิต" }),
  ).toBeDisabled();
  await page.getByLabel("มิเตอร์น้ำปัจจุบัน", { exact: true }).fill("130");
  await expect(
    page.getByLabel("ตัวอย่างใบแจ้งหนี้", { exact: true }),
  ).toContainText("฿4,600");
  await page.getByRole("button", { name: "ออกใบแจ้งหนี้สาธิต" }).click();
  await expect(page.getByRole("status")).toContainText(
    "ออกใบแจ้งหนี้สาธิตห้อง 101 แล้ว",
  );
  await expect(
    page.getByRole("button", { name: "ออกใบแจ้งหนี้สาธิต" }),
  ).toHaveCount(0);
  await page
    .getByRole("navigation", { name: "เมนูหลัก" })
    .getByRole("link", { name: "การชำระเงิน", exact: true })
    .click();
  await page
    .getByRole("button", { name: "บันทึกการชำระเงิน", exact: true })
    .click();
  const option = await page
    .getByLabel("ใบแจ้งหนี้", { exact: true })
    .locator("option")
    .filter({ hasText: "2026-11" })
    .getAttribute("value");
  if (!option) throw new Error("New invoice missing from payment form");
  await page.getByLabel("ใบแจ้งหนี้", { exact: true }).selectOption(option);
  await page.getByLabel("ยอดรับชำระ (บาท)").fill("1000");
  await page.getByLabel("เลขอ้างอิง", { exact: false }).fill("FLOW-NOV-101");
  await page.getByRole("checkbox").check();
  await page.getByRole("button", { name: "บันทึกยอดรับชำระสาธิต" }).click();
  await expect(page.getByRole("status")).toContainText(
    "บันทึกยอดรับชำระสาธิตห้อง 101 แล้ว",
  );
  await page
    .getByRole("navigation")
    .getByRole("link", { name: "รายงานการเงิน", exact: true })
    .click();
  await expect(
    page.locator(".kpi").filter({ hasText: "รับชำระจริง" }),
  ).toContainText("฿49,000");
  await page.getByLabel("เดือน", { exact: true }).selectOption("2026-11");
  await page.getByRole("tab", { name: "ค้างชำระ", exact: true }).click();
  await expect(page.getByRole("tabpanel")).toContainText("฿3,600");
  await expect(page.getByRole("tabpanel")).toContainText("INV-202611-101");
});

test("rejects overpayment and duplicate reference without changing the ledger", async ({
  page,
}) => {
  await page.goto("/payments/");
  await page
    .getByRole("button", { name: "บันทึกการชำระเงิน", exact: true })
    .click();
  await page.getByLabel("ยอดรับชำระ (บาท)").fill("99999");
  await page.getByLabel("เลขอ้างอิง", { exact: false }).fill("TEST-OVER");
  await page.getByRole("checkbox").check();
  await page.getByRole("button", { name: "บันทึกยอดรับชำระสาธิต" }).click();
  await expect(page.getByRole("alert")).toContainText("ยอดชำระเกินยอดค้าง");
  await page.getByLabel("ยอดรับชำระ (บาท)").fill("1");
  await page.getByLabel("เลขอ้างอิง", { exact: false }).fill("DEMO-202610-101");
  await page.getByRole("button", { name: "บันทึกยอดรับชำระสาธิต" }).click();
  await expect(page.getByRole("alert")).toContainText(
    "เลขอ้างอิงนี้ถูกใช้แล้ว",
  );
});

test("expense form, CAPEX filter, financial totals and CSV are real demo interactions", async ({
  page,
}) => {
  await page.goto("/expenses/");
  await page
    .getByRole("button", { name: "เพิ่มค่าใช้จ่าย", exact: true })
    .click();
  await page
    .getByLabel("รายการ", { exact: true })
    .fill("เครื่องปรับอากาศทดสอบ");
  await page
    .getByLabel("ผู้ขาย / ผู้รับเงิน", { exact: true })
    .fill("ร้านตัวอย่าง");
  await page.getByLabel("ประเภท", { exact: true }).selectOption("CAPEX");
  await page.getByLabel("จำนวนเงิน (บาท)").fill("2000");
  await page.getByRole("button", { name: "บันทึกค่าใช้จ่ายสาธิต" }).click();
  await expect(page.getByRole("status")).toContainText("เพิ่มค่าใช้จ่ายสาธิต");
  await page.getByLabel("ประเภทค่าใช้จ่าย").selectOption("CAPEX");
  await expect(
    page.getByRole("row").filter({ hasText: "เครื่องปรับอากาศทดสอบ" }),
  ).toBeVisible();
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "ส่งออก CSV", exact: true }).click();
  expect((await download).suggestedFilename()).toBe("taky-demo-expenses.csv");
  await page
    .getByRole("navigation")
    .getByRole("link", { name: "รายงานการเงิน", exact: true })
    .click();
  await expect(
    page.locator(".kpi").filter({ hasText: "เงินลงทุน (CAPEX)" }),
  ).toContainText("฿20,000");
  await expect(
    page.locator(".kpi").filter({ hasText: "กระแสเงินสดสุทธิ" }),
  ).toContainText("฿21,300");
});

test("maintenance ticket creation and status update", async ({ page }) => {
  await page.goto("/maintenance/");
  await page.getByRole("button", { name: "แจ้งซ่อมใหม่", exact: true }).click();
  await page.getByLabel("ห้องพัก", { exact: true }).selectOption("305");
  await page.getByLabel("ปัญหาที่พบ").fill("ทดสอบซ่อมประตู");
  await page.getByLabel("ผู้รับผิดชอบ", { exact: false }).fill("ช่างสาธิต");
  await page.getByRole("button", { name: "บันทึกแจ้งซ่อมสาธิต" }).click();
  await page
    .getByRole("button", { name: "ดูงาน ทดสอบซ่อมประตู ห้อง 305" })
    .click();
  await page.getByLabel("อัปเดตสถานะงานสาธิต").selectOption("resolved");
  await page.getByRole("button", { name: "ปิด", exact: true }).click();
  await expect(
    page.getByRole("row").filter({ hasText: "ทดสอบซ่อมประตู" }),
  ).toContainText("เสร็จสิ้น");
});

test("settings apply to new invoices, preserve old invoices and do not fake backups", async ({
  page,
}) => {
  await page.goto("/settings/");
  await expect(
    page.getByRole("button", { name: "สำรองข้อมูลทันที" }),
  ).toBeDisabled();
  await expect(
    page.getByText("ยังไม่มีการสำรองข้อมูล", { exact: true }),
  ).toBeVisible();
  await page.getByRole("tab", { name: "อัตราค่าน้ำ - ไฟ" }).click();
  await page.getByLabel("ค่าน้ำ (บาท / หน่วย)").fill("25");
  await page.getByRole("button", { name: "บันทึกอัตราสาธิต" }).click();
  await page
    .getByRole("navigation")
    .getByRole("link", { name: "ออกบิลและค่าน้ำไฟ" })
    .click();
  await expect(
    page.getByLabel("ตัวอย่างใบแจ้งหนี้", { exact: true }),
  ).toContainText("฿4,600");
  await page.getByLabel("เดือน", { exact: true }).selectOption("2026-11");
  await expect(
    page.getByLabel("ตัวอย่างใบแจ้งหนี้", { exact: true }),
  ).toContainText("฿4,650");
});

test("mobile menu traps focus, navigates, closes and keeps layout within viewport", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  const trigger = page.getByRole("button", { name: "เปิดเมนูหลัก" });
  await trigger.click();
  await expect(page.getByRole("dialog")).toBeVisible();
  for (let i = 0; i < 15; i++) await page.keyboard.press("Tab");
  await expect(page.getByRole("dialog")).toContainText("รายงานการเงิน");
  expect(
    await page
      .getByRole("dialog")
      .evaluate((e) => e.contains(document.activeElement)),
  ).toBe(true);
  await page.keyboard.press("Escape");
  await expect(trigger).toBeFocused();
  await trigger.click();
  await page
    .getByRole("dialog")
    .getByRole("link", { name: "ห้องพัก", exact: true })
    .click();
  await expect(page).toHaveURL(/\/rooms\/$/);
  await expect(page.getByRole("dialog")).toBeHidden();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});
