import { randomUUID } from "node:crypto";
import { z } from "zod";
import { test, expect, type APIRequestContext } from "./guarded-test";
import { browserTestTarget } from "../../src/server/browser-test-target";
import { db } from "../../src/server/db";
import { getLeases } from "./fixtures";

function moneyCents(value: string) {
  const match = /^(0|[1-9]\d{0,11})(?:\.(\d{1,2}))?$/.exec(value);
  expect(match, `invalid API money string ${value}`).not.toBeNull();
  return BigInt(match![1]) * 100n + BigInt((match![2] ?? "").padEnd(2, "0"));
}

async function signIn(request: APIRequestContext) {
  const response = await request.post("/api/auth/login/", {
    headers: { Origin: browserTestTarget().origin },
    data: {
      identifier: "test-admin",
      password: process.env.TEST_ADMIN_PASSWORD,
    },
  });
  expect(response.status()).toBe(200);
}

test("tenant contract rent survives room selection, save, reload and reselect", async ({
  page,
}) => {
  const target = browserTestTarget();
  expect(
    await db.$queryRaw`SELECT current_database() AS name, current_user AS role`,
  ).toEqual([{ name: target.database, role: target.role }]);
  const suffix = randomUUID().slice(0, 20);
  const property = await db.property.create({
    data: {
      code: `RENT-${suffix}`,
      name: `Synthetic rent ${suffix}`,
      address: "Synthetic",
    },
  });
  const floor = await db.floor.create({
    data: {
      propertyId: property.id,
      number: 1,
      name: `Synthetic rent ${suffix}`,
    },
  });
  const room = await db.room.create({
    data: { floorId: floor.id, number: "R101", rent: "0.00" },
  });
  await signIn(page.request);
  await page.goto("/tenants/");
  await page.getByRole("button", { name: "เพิ่มผู้เช่า", exact: true }).click();
  await page
    .getByLabel("ชื่อผู้เช่า", { exact: true })
    .fill(`Synthetic rent ${suffix}`);
  await page.getByLabel("ข้อมูลตัวอย่าง (Demo)").check();
  await page.getByLabel("กำหนดห้องพัก", { exact: true }).check();
  const rent = page.getByLabel("ค่าเช่าตามสัญญา", { exact: true });
  await rent.fill("4100.75");
  await page.getByLabel("ชั้นสำหรับเลือกห้อง").selectOption(floor.id);
  await page.getByLabel("ห้องพัก", { exact: true }).selectOption(room.id);
  await expect(rent).toHaveValue("4100.75");
  await page.getByLabel("เลขที่สัญญา", { exact: true }).fill(`RENT-${suffix}`);
  await page.getByLabel("วันเริ่มสัญญา", { exact: true }).fill("2026-10-01");
  await page.getByLabel("วันสิ้นสุดสัญญา", { exact: true }).fill("2027-09-30");
  await page.getByRole("button", { name: "บันทึกข้อมูล" }).click();
  await expect(page).toHaveURL(/tenant=[a-f0-9-]+/);
  const tenantId = new URL(page.url()).searchParams.get("tenant");
  expect(tenantId).toBeTruthy();
  await page.reload();
  await expect(page.locator(".tenant-profile")).toContainText("4,100.75");
  expect(
    (await getLeases(page.request)).find((lease) => lease.tenantId === tenantId)
      ?.rent,
  ).toBe("4100.75");
  await page.getByRole("button", { name: "แก้ไขข้อมูล", exact: true }).click();
  await expect(rent).toHaveValue("4100.75");
  await page.getByLabel("ห้องพัก", { exact: true }).selectOption("");
  await page.getByLabel("ห้องพัก", { exact: true }).selectOption(room.id);
  await expect(rent).toHaveValue("4100.75");
  await page.getByRole("button", { name: "บันทึกข้อมูล" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.reload();
  await expect(page.locator(".tenant-profile")).toContainText("4,100.75");
  expect(
    (await getLeases(page.request)).find((lease) => lease.tenantId === tenantId)
      ?.rent,
  ).toBe("4100.75");
});

test("a tenant without a room assignment has no invented contract rent", async ({
  page,
}) => {
  await signIn(page.request);
  await page.goto("/tenants/");
  await page.getByRole("button", { name: "เพิ่มผู้เช่า", exact: true }).click();
  await page
    .getByLabel("ชื่อผู้เช่า", { exact: true })
    .fill(`Synthetic unassigned ${randomUUID()}`);
  await page.getByLabel("ข้อมูลตัวอย่าง (Demo)").check();
  await page.getByRole("button", { name: "บันทึกข้อมูล" }).click();
  await expect(page).toHaveURL(/tenant=[a-f0-9-]+/);
  await page.reload();
  await expect(page.locator(".tenant-profile")).toContainText(
    "ไม่มีสัญญาปัจจุบัน",
  );
  const rent = page
    .locator(".tenant-profile .detail-grid > div")
    .filter({ has: page.locator("dt", { hasText: /^ค่าเช่า$/ }) });
  await expect(rent.locator("dd")).toHaveText("—");
  const tenantId = new URL(page.url()).searchParams.get("tenant");
  expect(
    (await getLeases(page.request)).filter(
      (lease) => lease.tenantId === tenantId,
    ),
  ).toHaveLength(0);
});

test("room defaults fill untouched rent while explicit zero survives a room change and reload", async ({
  page,
}) => {
  const target = browserTestTarget();
  expect(
    await db.$queryRaw`SELECT current_database() AS name, current_user AS role`,
  ).toEqual([{ name: target.database, role: target.role }]);
  const suffix = randomUUID().slice(0, 20);
  const property = await db.property.create({
    data: {
      code: `ZERO-${suffix}`,
      name: `Synthetic zero rent ${suffix}`,
      address: "Synthetic",
    },
  });
  const floor = await db.floor.create({
    data: {
      propertyId: property.id,
      number: 1,
      name: `Synthetic zero rent ${suffix}`,
    },
  });
  const firstRoom = await db.room.create({
    data: { floorId: floor.id, number: "Z101", rent: "3500.25" },
  });
  const secondRoom = await db.room.create({
    data: { floorId: floor.id, number: "Z102", rent: "4200.50" },
  });
  await signIn(page.request);
  await page.goto("/tenants/");
  await page.getByRole("button", { name: "เพิ่มผู้เช่า", exact: true }).click();
  await page
    .getByLabel("ชื่อผู้เช่า", { exact: true })
    .fill(`Synthetic zero rent ${suffix}`);
  await page.getByLabel("ข้อมูลตัวอย่าง (Demo)").check();
  await page.getByLabel("กำหนดห้องพัก", { exact: true }).check();
  await page.getByLabel("ชั้นสำหรับเลือกห้อง").selectOption(floor.id);
  const room = page.getByLabel("ห้องพัก", { exact: true });
  const rent = page.getByLabel("ค่าเช่าตามสัญญา", { exact: true });
  await room.selectOption(firstRoom.id);
  await expect(rent).toHaveValue("3500.25");
  await room.selectOption(secondRoom.id);
  await expect(rent).toHaveValue("4200.5");
  await rent.fill("0.00");
  await room.selectOption(firstRoom.id);
  await expect(rent).toHaveValue("0.00");
  await page.getByLabel("เลขที่สัญญา", { exact: true }).fill(`ZERO-${suffix}`);
  await page.getByLabel("วันเริ่มสัญญา", { exact: true }).fill("2026-10-01");
  await page.getByLabel("วันสิ้นสุดสัญญา", { exact: true }).fill("2027-09-30");
  await page.getByRole("button", { name: "บันทึกข้อมูล" }).click();
  await expect(page).toHaveURL(/tenant=[a-f0-9-]+/);
  const tenantId = new URL(page.url()).searchParams.get("tenant");
  expect(tenantId).toBeTruthy();
  await page.reload();
  const displayedRent = page
    .locator(".tenant-profile .detail-grid > div")
    .filter({ has: page.locator("dt", { hasText: /^ค่าเช่า$/ }) });
  await expect(displayedRent.locator("dd")).toHaveText("฿0");
  const lease = (await getLeases(page.request)).find(
    (candidate) => candidate.tenantId === tenantId,
  );
  expect(lease?.rent).toBe("0");
  expect(lease?.roomId).toBe(firstRoom.id);
  await page.getByRole("button", { name: "แก้ไขข้อมูล", exact: true }).click();
  await expect(rent).toHaveValue("0");
});

test("tenant rent entered after room selection survives immediate save and reload", async ({
  page,
}) => {
  const target = browserTestTarget();
  expect(
    await db.$queryRaw`SELECT current_database() AS name, current_user AS role`,
  ).toEqual([{ name: target.database, role: target.role }]);
  const suffix = randomUUID().slice(0, 20);
  const name = `Synthetic 1000 rent ${suffix}`;
  const property = await db.property.create({
    data: {
      code: `ORDER-${suffix}`,
      name,
      address: "Synthetic",
    },
  });
  const floor = await db.floor.create({
    data: { propertyId: property.id, number: 1, name },
  });
  const room = await db.room.create({
    data: { floorId: floor.id, number: "N101", rent: "0.00" },
  });
  await signIn(page.request);
  await page.goto("/tenants/");
  await page.getByRole("button", { name: "เพิ่มผู้เช่า", exact: true }).click();
  await page.getByLabel("ชื่อผู้เช่า", { exact: true }).fill(name);
  await page.getByLabel("ข้อมูลตัวอย่าง (Demo)").check();
  await page.getByLabel("กำหนดห้องพัก", { exact: true }).check();
  await page.getByLabel("ชั้นสำหรับเลือกห้อง").selectOption(floor.id);
  await page.getByLabel("ห้องพัก", { exact: true }).selectOption(room.id);
  await page.getByLabel("เลขที่สัญญา", { exact: true }).fill(`ORDER-${suffix}`);
  await page.getByLabel("วันเริ่มสัญญา", { exact: true }).fill("2026-10-01");
  await page.getByLabel("วันสิ้นสุดสัญญา", { exact: true }).fill("2027-09-30");
  const submitted = page.waitForRequest(
    (request) =>
      request.method() === "POST" &&
      new URL(request.url()).pathname === "/api/v1/tenants/",
  );
  await page.getByLabel("ค่าเช่าตามสัญญา", { exact: true }).fill("1000.00");
  await page.getByRole("button", { name: "บันทึกข้อมูล" }).click();
  const submittedData: unknown = (await submitted).postDataJSON();
  const payload = z
    .object({ assignment: z.object({ rent: z.string(), roomId: z.string() }) })
    .parse(submittedData);
  expect(payload.assignment).toEqual({ rent: "1000.00", roomId: room.id });
  await expect(page).toHaveURL(/tenant=[a-f0-9-]+/);
  const tenantId = new URL(page.url()).searchParams.get("tenant");
  expect(tenantId).toBeTruthy();
  await expect(page.locator(".tenant-profile")).toContainText(name);
  const displayedRent = page
    .locator(".tenant-profile .detail-grid > div")
    .filter({ has: page.locator("dt", { hasText: /^ค่าเช่า$/ }) });
  await expect(displayedRent.locator("dd")).toContainText("1,000");
  const savedLease = (await getLeases(page.request)).find(
    (lease) => lease.tenantId === tenantId,
  );
  expect(moneyCents(savedLease?.rent ?? "")).toBe(moneyCents("1000.00"));
  expect(savedLease?.roomId).toBe(room.id);
  await page.reload();
  await expect(page.locator(".tenant-profile")).toContainText(name);
  await expect(displayedRent.locator("dd")).toContainText("1,000");
  const reloadedLease = (await getLeases(page.request)).find(
    (lease) => lease.tenantId === tenantId,
  );
  expect(moneyCents(reloadedLease?.rent ?? "")).toBe(moneyCents("1000.00"));
});
