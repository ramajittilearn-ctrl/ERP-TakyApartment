import { expect, guardedRequest, test } from "./guarded-test";
import { browserTestTarget } from "../../src/server/browser-test-target";

test("shell describes persisted read-only, persisted write, and demo routes truthfully", async ({
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

  const cases = [
    {
      path: "/",
      badge: "ฐานข้อมูลจริง • อ่านอย่างเดียว",
      footer: "อ่านข้อมูลจาก PostgreSQL • หน้านี้ไม่แก้ไขข้อมูล",
      helpButton: "เกี่ยวกับการอ่านข้อมูล",
      dialog: "อ่านข้อมูลจากฐานข้อมูล PostgreSQL โดยไม่แก้ไขข้อมูล",
    },
    {
      path: "/reports/",
      badge: "ฐานข้อมูลจริง • อ่านอย่างเดียว",
      footer: "อ่านข้อมูลจาก PostgreSQL • หน้านี้ไม่แก้ไขข้อมูล",
      helpButton: "เกี่ยวกับการอ่านข้อมูล",
      dialog: "อ่านข้อมูลจากฐานข้อมูล PostgreSQL โดยไม่แก้ไขข้อมูล",
    },
    {
      path: "/rooms/",
      badge: "ฐานข้อมูลจริง",
      footer: "อ่านและบันทึกข้อมูลใน PostgreSQL",
      helpButton: "เกี่ยวกับการบันทึกข้อมูล",
      dialog: "ข้อมูลของหน้านี้อ่านและบันทึกในฐานข้อมูล PostgreSQL",
    },
    {
      path: "/expenses/",
      badge: "ฐานข้อมูลจริง",
      footer: "อ่านและบันทึกข้อมูลใน PostgreSQL",
      helpButton: "เกี่ยวกับการบันทึกข้อมูล",
      dialog: "ข้อมูลของหน้านี้อ่านและบันทึกในฐานข้อมูล PostgreSQL",
    },
    {
      path: "/deposits/",
      badge: "ฐานข้อมูลจริง",
      footer: "อ่านและบันทึกข้อมูลใน PostgreSQL",
      helpButton: "เกี่ยวกับการบันทึกข้อมูล",
      dialog: "ข้อมูลของหน้านี้อ่านและบันทึกในฐานข้อมูล PostgreSQL",
    },
    {
      path: "/deposit-entries/00000000-0000-4000-8000-000000000000/",
      badge: "ฐานข้อมูลจริง",
      footer: "อ่านและบันทึกข้อมูลใน PostgreSQL",
      helpButton: "เกี่ยวกับการบันทึกข้อมูล",
      dialog: "ข้อมูลของหน้านี้อ่านและบันทึกในฐานข้อมูล PostgreSQL",
    },
    {
      path: "/maintenance/",
      badge: "หน้าจอสาธิต",
      footer: "ข้อมูลสาธิต • หน้านี้ไม่บันทึกลงฐานข้อมูลจริง",
      helpButton: "เกี่ยวกับโหมดสาธิต",
      dialog: "หน้าจอสาธิตแยกจากข้อมูลจริง",
    },
    {
      path: "/settings/",
      badge: "หน้าจอสาธิต",
      footer: "ข้อมูลสาธิต • หน้านี้ไม่บันทึกลงฐานข้อมูลจริง",
      helpButton: "เกี่ยวกับโหมดสาธิต",
      dialog: "หน้าจอสาธิตแยกจากข้อมูลจริง",
    },
  ];

  for (const item of cases) {
    await page.goto(item.path);
    const banner = page.getByRole("banner");
    const footer = page.getByRole("contentinfo");
    await expect(banner.locator(".demo-badge")).toHaveText(item.badge);
    await expect(footer).toContainText(item.footer);
    await page
      .getByRole("button", { name: item.helpButton, exact: true })
      .click();
    await expect(page.getByRole("dialog")).toContainText(item.dialog);
    await page.keyboard.press("Escape");
  }

  await expect(page.getByRole("contentinfo")).not.toContainText("Phase 2");
});
