import { test, expect, type APIRequestContext } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
const origin = process.env.PLAYWRIGHT_BASE_URL || "http://127.0.0.1:3300";
async function signIn(request: APIRequestContext, staff = false) {
  const response = await request.post("/api/auth/login/", {
    headers: { Origin: origin },
    data: {
      identifier: staff ? "test-staff" : "test-admin",
      password: staff
        ? process.env.TEST_STAFF_PASSWORD
        : process.env.TEST_ADMIN_PASSWORD,
    },
  });
  expect(response.status()).toBe(200);
  return response;
}
test("unauthenticated pages redirect and all CRUD APIs reject access", async ({
  page,
  request,
}) => {
  await page.goto("/rooms/");
  await expect(page).toHaveURL(/\/login\//);
  expect(
    (await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze())
      .violations,
  ).toEqual([]);
  await page.screenshot({
    path: `${process.env.SCREENSHOT_DIR || "docs/phase-2-screenshots"}/login.png`,
    fullPage: true,
  });
  for (const resource of [
    "properties",
    "floors",
    "rooms",
    "tenants",
    "leases",
  ]) {
    expect((await request.get(`/api/v1/${resource}/`)).status()).toBe(401);
    expect(
      (
        await request.post(`/api/v1/${resource}/`, {
          headers: { Origin: origin },
          data: {},
        })
      ).status(),
    ).toBe(401);
    expect(
      (
        await request.put(`/api/v1/${resource}/${randomUUID()}/`, {
          headers: { Origin: origin },
          data: {},
        })
      ).status(),
    ).toBe(401);
    expect(
      (
        await request.delete(`/api/v1/${resource}/${randomUUID()}/`, {
          headers: { Origin: origin },
        })
      ).status(),
    ).toBe(401);
  }
});
test("secure cookie, CSRF rejection, staff authorization and logout revocation", async ({
  request,
}) => {
  const response = await signIn(request, true);
  expect(response.headers()["set-cookie"]).toContain("HttpOnly");
  expect(response.headers()["set-cookie"]).toContain("SameSite=strict");
  expect(
    (
      await request.post("/api/v1/rooms/", {
        headers: { Origin: origin },
        data: {},
      })
    ).status(),
  ).toBe(403);
  expect(
    (
      await request.post("/api/v1/tenants/", {
        headers: { Origin: "http://evil.invalid" },
        data: {},
      })
    ).status(),
  ).toBe(403);
  expect(
    (
      await request.post("/api/v1/users/", {
        headers: { Origin: origin },
        data: {},
      })
    ).status(),
  ).toBe(403);
  expect(
    (
      await request.post("/api/auth/logout/", { headers: { Origin: origin } })
    ).status(),
  ).toBe(200);
  expect((await request.get("/api/v1/rooms/")).status()).toBe(401);
});
test("real login form and all fifteen room records", async ({ page }) => {
  await page.goto("/login/");
  await page.getByLabel("ชื่อผู้ใช้หรืออีเมล").fill("test-admin");
  await page
    .getByLabel("รหัสผ่าน", { exact: true })
    .fill(process.env.TEST_ADMIN_PASSWORD!);
  await page.getByRole("button", { name: "เข้าสู่ระบบ", exact: true }).click();
  await expect(page).toHaveURL(/\/rooms\//);
  await expect(page.locator(".room-card")).toHaveCount(15);
  await page.reload();
  await expect(page.locator(".room-card")).toHaveCount(15);
  for (const n of [
    101, 102, 103, 104, 105, 201, 202, 203, 204, 205, 301, 302, 303, 304, 305,
  ])
    await expect(
      page.locator(".room-number strong", { hasText: String(n) }),
    ).toBeVisible();
});
test("properties and floors CRUD; validation and referenced deletes", async ({
  request,
}) => {
  await signIn(request);
  const headers = { Origin: origin };
  const code = `DEMO-${randomUUID().slice(0, 8)}`;
  const propertyResponse = await request.post("/api/v1/properties/", {
    headers,
    data: { code, name: "Demo test property" },
  });
  expect(propertyResponse.status()).toBe(201);
  const property = (await propertyResponse.json()).data;
  const floorResponse = await request.post("/api/v1/floors/", {
    headers,
    data: { propertyId: property.id, number: 1, name: "Demo floor" },
  });
  expect(floorResponse.status()).toBe(201);
  const floor = (await floorResponse.json()).data;
  expect(
    (
      await request.put(`/api/v1/floors/${floor.id}/`, {
        headers,
        data: { propertyId: property.id, number: 2, name: "Demo edited" },
      })
    ).status(),
  ).toBe(200);
  expect(
    (
      await request.put(`/api/v1/properties/${property.id}/`, {
        headers,
        data: { code, name: "Demo edited property" },
      })
    ).status(),
  ).toBe(200);
  expect(
    (
      await request.delete(`/api/v1/properties/${property.id}/`, { headers })
    ).status(),
  ).toBe(409);
  expect(
    (await request.delete(`/api/v1/floors/${floor.id}/`, { headers })).status(),
  ).toBe(200);
  expect(
    (
      await request.delete(`/api/v1/properties/${property.id}/`, { headers })
    ).status(),
  ).toBe(200);
  expect(
    (await request.get(`/api/v1/properties/${property.id}/`)).status(),
  ).toBe(404);
  expect(
    (
      await request.post("/api/v1/tenants/", {
        headers,
        data: { name: "", phone: "", email: "broken" },
      })
    ).status(),
  ).toBe(422);
});
test("room edits persist across refresh and grid filters work", async ({
  page,
}) => {
  await signIn(page.request);
  await page.goto("/rooms/");
  await page.locator(".room-card").filter({ hasText: "101" }).click();
  await page.getByRole("button", { name: "แก้ไขห้องพัก" }).click();
  await page.getByLabel("ค่าเช่ารายเดือน", { exact: true }).fill("3500.25");
  await page.getByRole("button", { name: "บันทึกข้อมูล" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(1);
  await page.reload();
  await expect(
    page.locator(".room-card").filter({ hasText: "101" }),
  ).toContainText("3,500.25");
  await page
    .getByLabel("ชั้น", { exact: true })
    .selectOption({ label: "ชั้น 2" });
  await expect(page.locator(".room-card")).toHaveCount(5);
  await page.getByLabel("ค้นหาห้องหรือผู้เช่า").fill("no-such-room");
  await expect(page.getByText("ไม่พบรายการ", { exact: true })).toBeVisible();
});
test("tenant and lease UI create, update and delete draft", async ({
  page,
}) => {
  await signIn(page.request);
  const suffix = randomUUID().slice(0, 8);
  const name = `Demo UI ${suffix}`;
  await page.goto("/tenants/");
  await page.getByRole("button", { name: "เพิ่มผู้เช่า", exact: true }).click();
  await page.getByLabel("ชื่อผู้เช่า", { exact: true }).fill(name);
  await page.getByLabel("ข้อมูลตัวอย่าง (Demo)").check();
  await page.getByRole("button", { name: "บันทึกข้อมูล" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.getByLabel("ค้นหาผู้เช่า").fill(name);
  await page.getByRole("button", { name: "แก้ไขข้อมูล", exact: true }).click();
  await page
    .getByLabel("หมายเหตุ", { exact: true })
    .fill("Demo persisted contact");
  await page.getByRole("button", { name: "บันทึกข้อมูล" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.reload();
  await page.getByLabel("ค้นหาผู้เช่า").fill(name);
  await expect(
    page.getByText("Demo persisted contact", { exact: true }),
  ).toBeVisible();
  await page.goto("/leases/");
  await page.getByRole("button", { name: "เพิ่มสัญญาเช่า" }).click();
  await page
    .getByLabel("ชั้นสำหรับเลือกห้อง")
    .selectOption({ label: "ชั้น 1" });
  await page.getByLabel("เลขที่สัญญา").fill(`UI-${suffix}`);
  await page
    .getByLabel("ห้องพัก", { exact: true })
    .selectOption({ label: "102" });
  await page
    .getByLabel("ผู้เช่า", { exact: true })
    .selectOption({ label: name });
  await page.getByLabel("วันเริ่มสัญญา").fill("2026-10-01");
  await page.getByLabel("วันสิ้นสุดสัญญา").fill("2027-09-30");
  await page.getByLabel("ค่าเช่าตามสัญญา").fill("3500");
  await page.getByLabel("เงินประกันตามสัญญา").fill("7000");
  await page.getByLabel("ข้อมูลตัวอย่าง (Demo)").check();
  await page.getByRole("button", { name: "บันทึกข้อมูล" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  const row = page.getByRole("row").filter({ hasText: `UI-${suffix}` });
  await expect(row).toBeVisible();
  await row.getByRole("button", { name: "แก้ไข", exact: true }).click();
  await page.getByLabel("ค่าเช่าตามสัญญา").fill("3600");
  await page.getByRole("button", { name: "บันทึกข้อมูล" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.reload();
  await expect(row).toContainText("3,600");
  await expect(page.locator(".metric-grid .kpi")).toHaveCount(4);
  await page.getByLabel("สถานะสัญญา").selectOption("DRAFT");
  await expect(row).toBeVisible();
  await page.getByLabel("สถานะสัญญา").selectOption("expiring");
  await expect(row).toHaveCount(0);
  await page.getByLabel("สถานะสัญญา").selectOption("all");
  await page.getByLabel("ค้นหาสัญญา").fill(`UI-${suffix}`);
  await expect(row).toBeVisible();
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "ส่งออก CSV" }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe("taky-leases.csv");
  const csvPath = await download.path();
  if (!csvPath) throw new Error("CSV download did not produce a file");
  const csv = await readFile(csvPath, "utf8");
  expect(csv).toContain(`UI-${suffix}`);
  expect(csv).toContain(name);
  expect(csv).toContain("3600");
  expect(csv).toContain("ฉบับร่าง");
  await row.getByRole("button", { name: "ลบ", exact: true }).click();
  await page.getByRole("button", { name: "ยืนยันลบ" }).click();
  await expect(row).toHaveCount(0);
  await page.goto("/tenants/");
  await page.getByLabel("ค้นหาผู้เช่า").fill(name);
  await page.getByRole("button", { name: "ลบผู้เช่า" }).click();
  await page.getByRole("button", { name: "ยืนยันลบ" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
});
for (const width of [1440, 768, 390]) {
  for (const route of [
    "",
    "rooms",
    "tenants",
    "leases",
    "billing",
    "payments",
    "expenses",
    "reports",
    "maintenance",
    "settings",
  ]) {
    test(`${width}px ${route || "dashboard"}: protected responsive smoke and accessibility`, async ({
      page,
    }) => {
      await signIn(page.request);
      await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 });
      const errors: string[] = [];
      page.on("pageerror", (e) => errors.push(e.message));
      const response = await page.goto(`/${route ? `${route}/` : ""}`);
      expect(response?.status()).toBe(200);
      await expect(page.locator("h1")).toBeVisible();
      await expect(page.locator(".app-shell")).toBeVisible();
      await expect(page).toHaveURL(`${origin}/${route ? `${route}/` : ""}`);
      if (route === "rooms")
        await expect(page.locator(".room-card")).toHaveCount(15);
      if (["tenants", "leases"].includes(route))
        await expect(
          page.getByRole("button", {
            name: route === "tenants" ? "เพิ่มผู้เช่า" : "เพิ่มสัญญาเช่า",
            exact: true,
          }),
        ).toBeVisible();
      await page.evaluate(() => document.fonts.ready);
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= window.innerWidth,
        ),
      ).toBe(true);
      expect(
        (
          await new AxeBuilder({ page })
            .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
            .analyze()
        ).violations,
      ).toEqual([]);
      await page.screenshot({
        path: `${process.env.SCREENSHOT_DIR || "docs/phase-2-screenshots"}/${width}/${route || "dashboard"}.png`,
        fullPage: true,
      });
      expect(errors).toEqual([]);
    });
  }
}
