import {
  expect,
  test,
  type APIRequestContext,
  type Page,
} from "./guarded-test";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { getRooms } from "./fixtures";
import { historySchema, overviewSchema } from "@/features/meters/contracts";

const origin = process.env.PLAYWRIGHT_BASE_URL || "http://127.0.0.1:3300";
const headers = { Origin: origin };
const timestamps = new Intl.DateTimeFormat("th-TH", {
  dateStyle: "medium",
  timeStyle: "medium",
  timeZone: "Asia/Bangkok",
});
const evidence = process.env.SCREENSHOT_DIR;

async function signIn(request: APIRequestContext, staff = false) {
  const response = await request.post("/api/auth/login/", {
    headers,
    data: {
      identifier: staff ? "test-staff" : "test-admin",
      password: staff
        ? process.env.TEST_STAFF_PASSWORD
        : process.env.TEST_ADMIN_PASSWORD,
    },
  });
  expect(response.status()).toBe(200);
}

async function ensurePeriod(
  request: APIRequestContext,
  propertyId: string,
  month: string,
) {
  const response = await request.post("/api/v1/billing-periods/", {
    headers,
    data: { propertyId, month },
  });
  if (response.ok())
    return z
      .object({ data: z.object({ id: z.uuid() }) })
      .parse(await response.json()).data.id;
  expect(response.status()).toBe(409);
  const list = await request.get(
    `/api/v1/billing-periods/?propertyId=${propertyId}`,
  );
  expect(list.status()).toBe(200);
  const period = z
    .object({ data: z.array(z.object({ id: z.uuid(), startsOn: z.string() })) })
    .parse(await list.json())
    .data.find((item) => item.startsOn.startsWith(month));
  if (!period) throw new Error(`Missing test period ${month}`);
  return period.id;
}

async function overview(request: APIRequestContext, periodId: string) {
  const response = await request.get(
    `/api/v1/meter-readings/?billingPeriodId=${periodId}`,
  );
  expect(response.status()).toBe(200);
  return z.object({ data: overviewSchema }).parse(await response.json()).data;
}

async function prepare(page: Page) {
  await page.clock.install({ time: new Date("2026-10-22T05:00:00.000Z") });
  await signIn(page.request);
  const rooms = await getRooms(page.request);
  const propertyId = rooms[0]?.floor.propertyId;
  if (!propertyId) throw new Error("Expected seeded test property");
  await ensurePeriod(page.request, propertyId, "2026-07");
  const august = await ensurePeriod(page.request, propertyId, "2026-08");
  const september = await ensurePeriod(page.request, propertyId, "2026-09");
  const room = (await overview(page.request, august)).rooms
    .toReversed()
    .find(
      (candidate) =>
        candidate.floor.number === 3 &&
        candidate.meters.every((slot) => slot.meterId === null),
    );
  if (!room)
    throw new Error(
      "Expected unused floor-three meter fixture; use a fresh isolated target",
    );
  for (const kind of ["WATER", "ELECTRICITY"]) {
    const response = await page.request.post("/api/v1/meters/", {
      headers,
      data: {
        roomId: room.id,
        kind,
        serial: `3C4-${kind}-${randomUUID().slice(0, 8)}`,
        installedAt: "2026-07-31",
        openingReading: kind === "WATER" ? "100.000" : "500.000",
        reason: "Stage 3C-4 isolated browser fixture",
      },
    });
    expect(response.status()).toBe(201);
  }
  const rendered = await page.request.get("/meters/");
  expect(rendered.status()).toBe(200);
  const serverSelectors =
    (await rendered.text()).match(/<select\b[^>]*>/g) ?? [];
  for (const label of ["รอบเรียกเก็บ", "ชั้น"]) {
    const selector = serverSelectors.find((tag) =>
      tag.includes(`aria-label="${label}"`),
    );
    expect(selector).toMatch(/\bdisabled(?:\s|=|>)/);
  }
  await page.goto("/meters/");
  await page.getByLabel("รอบเรียกเก็บ").selectOption(august);
  await expect(page.getByLabel("รอบเรียกเก็บ")).toHaveValue(august);
  await page
    .getByRole("button", { name: new RegExp(`ห้อง ${room.number}`) })
    .click();
  await expect(
    page.getByRole("region", { name: `จดมิเตอร์ห้อง ${room.number}` }),
  ).toBeVisible();
  await expect(page.getByLabel("วันที่จดมิเตอร์น้ำ")).toHaveAttribute(
    "min",
    "2026-08-01",
  );
  await expect(page).toHaveTitle(/Taky Apartment ERP/);
  return { room, august, september };
}

function utility(page: Page, kind: "น้ำ" | "ไฟฟ้า") {
  return page.locator(".meter-slot").filter({ hasText: `มิเตอร์${kind}` });
}

async function fillReading(
  page: Page,
  kind: "น้ำ" | "ไฟฟ้า",
  value: string,
  date: string,
) {
  await page.getByLabel(`วันที่จดมิเตอร์${kind}`).fill(date);
  await page.getByLabel(`เลขมิเตอร์${kind}ปัจจุบัน`).fill(value);
}

async function history(request: APIRequestContext, roomId: string) {
  const response = await request.get(
    `/api/v1/meter-readings/history/?roomId=${roomId}`,
  );
  expect(response.status()).toBe(200);
  return z.object({ data: historySchema }).parse(await response.json()).data;
}

async function checkHistoryTimes(page: Page, roomId: string) {
  const actual = await history(page.request, roomId);
  await page.getByRole("button", { name: "ประวัติ", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "ประวัติมิเตอร์" });
  await expect(dialog).toBeVisible();
  for (const reading of actual.readings) {
    const row = dialog.locator(".history-row").filter({
      hasText: `${reading.kind === "WATER" ? "น้ำ" : "ไฟฟ้า"} · ${reading.value}`,
    });
    await expect(row).toContainText("บันทึกเมื่อ");
    await expect(
      row.locator(`time[datetime="${reading.createdAt}"]`).first(),
    ).toHaveText(timestamps.format(new Date(reading.createdAt)));
    if (reading.confirmedAt) {
      await expect(row).toContainText("ยืนยันเมื่อ");
      await expect(
        row.locator(`time[datetime="${reading.confirmedAt}"]`).last(),
      ).toHaveText(timestamps.format(new Date(reading.confirmedAt)));
    }
  }
  for (const replacement of actual.replacements) {
    const row = dialog.locator(".history-row").filter({
      hasText: `เปลี่ยน ${replacement.oldMeter.serial} เป็น ${replacement.newMeter.serial}`,
    });
    await expect(row).toContainText("เปลี่ยนเมื่อ");
    await expect(
      row.locator(`time[datetime="${replacement.createdAt}"]`),
    ).toHaveText(timestamps.format(new Date(replacement.createdAt)));
  }
  expect(actual.corrections.length).toBeGreaterThan(0);
  for (const correction of actual.corrections) {
    const row = dialog
      .locator(".history-row")
      .filter({ hasText: correction.reason });
    await expect(
      row.locator(`time[datetime="${correction.createdAt}"]`),
    ).toHaveText(timestamps.format(new Date(correction.createdAt)));
  }
  if (evidence)
    await page.screenshot({
      path: `${evidence}/3c4-history-${page.viewportSize()?.width}.png`,
      fullPage: false,
    });
  await dialog
    .getByRole("button", { name: "ปิดหน้าต่าง", exact: true })
    .click();
}

test("3C4 latest overview wins and unrelated drafts survive reload and filter navigation", async ({
  page,
}) => {
  const { room, august, september } = await prepare(page);
  await fillReading(page, "น้ำ", "105.125", "2026-08-15");
  await fillReading(page, "ไฟฟ้า", "540.500", "2026-08-16");
  let draftPosts = 0;
  let releaseDraft = () => {};
  const draftGate = new Promise<void>((resolve) => {
    releaseDraft = resolve;
  });
  await page.route("**/api/v1/meter-readings/drafts/", async (route) => {
    draftPosts++;
    await draftGate;
    await route.continue();
  });
  await utility(page, "น้ำ")
    .getByRole("button", { name: "บันทึกฉบับร่าง" })
    .evaluate((button: HTMLButtonElement) => {
      button.click();
      button.click();
    });
  await expect.poll(() => draftPosts).toBe(1);
  await expect(page.getByLabel("รอบเรียกเก็บ")).toBeDisabled();
  await expect(page.getByLabel("ชั้น", { exact: true })).toBeDisabled();
  await expect(page.locator(".meter-room-button:enabled")).toHaveCount(0);
  await expect(page.locator(".meter-entry input:enabled")).toHaveCount(0);
  await expect(page.locator(".meter-entry button:enabled")).toHaveCount(0);
  releaseDraft();
  await expect(page.locator(".success-message")).toContainText("มิเตอร์น้ำ");
  await page.unrouteAll({ behavior: "wait" });
  expect(draftPosts).toBe(1);
  await expect(page.getByLabel("เลขมิเตอร์ไฟฟ้าปัจจุบัน")).toHaveValue(
    "540.500",
  );
  await expect(page.getByLabel("วันที่จดมิเตอร์ไฟฟ้า")).toHaveValue(
    "2026-08-16",
  );

  const releases = new Map<string, () => void>();
  const arrived = new Set<string>();
  await page.route("**/api/v1/meter-readings/?*", async (route) => {
    const floor = new URL(route.request().url()).searchParams.get("floor");
    if (floor !== "1" && floor !== "2") return route.continue();
    const response = await route.fetch();
    arrived.add(floor);
    await new Promise<void>((resolve) => releases.set(floor, resolve));
    try {
      await route.fulfill({ response });
    } catch {
      /* Superseded browser fetches may be aborted. */
    }
  });
  let mutations = 0;
  page.on("request", (request) => {
    if (request.method() === "POST" && request.url().includes("/api/v1/meter"))
      mutations++;
  });
  await page.getByLabel("ชั้น", { exact: true }).selectOption("1");
  await expect.poll(() => arrived.has("1")).toBe(true);
  await expect(page.locator(".meter-entry")).toHaveCount(0);
  await page.getByLabel("ชั้น", { exact: true }).selectOption("2");
  await expect.poll(() => arrived.has("2")).toBe(true);
  await expect(page.locator(".meter-entry")).toHaveCount(0);
  await page.getByLabel("ชั้น", { exact: true }).selectOption("3");
  await page
    .getByRole("button", { name: new RegExp(`ห้อง ${room.number}`) })
    .click();
  await expect(page.getByLabel("เลขมิเตอร์ไฟฟ้าปัจจุบัน")).toHaveValue(
    "540.500",
  );
  releases.get("2")?.();
  releases.get("1")?.();
  await page.unrouteAll({ behavior: "wait" });
  await expect(page.getByLabel("ชั้น", { exact: true })).toHaveValue("3");
  await expect(page.locator(".meter-room-button")).toHaveCount(5);
  await expect(
    page.getByRole("region", { name: `จดมิเตอร์ห้อง ${room.number}` }),
  ).toBeVisible();
  await expect(page.getByLabel("เลขมิเตอร์ไฟฟ้าปัจจุบัน")).toHaveValue(
    "540.500",
  );
  expect(mutations).toBe(0);
  const persisted = await overview(page.request, august);
  const electric = persisted.rooms
    .find((candidate) => candidate.id === room.id)
    ?.meters.find((slot) => slot.kind === "ELECTRICITY");
  expect(electric?.reading).toBeNull();
  await page.getByLabel("รอบเรียกเก็บ").selectOption(september);
  await page
    .getByRole("button", { name: new RegExp(`ห้อง ${room.number}`) })
    .click();
  await expect(page.getByLabel("เลขมิเตอร์ไฟฟ้าปัจจุบัน")).toHaveValue("");
  await page.getByLabel("รอบเรียกเก็บ").selectOption(august);
  await page
    .getByRole("button", { name: new RegExp(`ห้อง ${room.number}`) })
    .click();
  await expect(page.getByLabel("เลขมิเตอร์ไฟฟ้าปัจจุบัน")).toHaveValue(
    "540.500",
  );

  let historyArrived = false;
  let releaseHistory = () => {};
  await page.route("**/api/v1/meter-readings/history/?*", async (route) => {
    const response = await route.fetch();
    historyArrived = true;
    await new Promise<void>((resolve) => {
      releaseHistory = resolve;
    });
    try {
      await route.fulfill({ response });
    } catch {
      /* Room navigation can abort the stale request. */
    }
  });
  await page.getByRole("button", { name: "ประวัติ", exact: true }).click();
  await expect.poll(() => historyArrived).toBe(true);
  const other = persisted.rooms.find(
    (candidate) => candidate.floor.number === 3 && candidate.id !== room.id,
  );
  if (!other)
    throw new Error("Expected another room for stale history regression");
  await page
    .getByRole("button", { name: new RegExp(`ห้อง ${other.number}`) })
    .click();
  releaseHistory();
  await page.unrouteAll({ behavior: "wait" });
  await expect(
    page.getByRole("dialog", { name: "ประวัติมิเตอร์" }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("region", { name: `จดมิเตอร์ห้อง ${other.number}` }),
  ).toBeVisible();
  if (evidence)
    await page.screenshot({
      path: `${evidence}/3c4-latest-overview.png`,
      fullPage: false,
    });
});

for (const width of [1440, 390]) {
  test(`3C4 ${width}px validation confirmation correction replacement history and STAFF restrictions`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 1000 });
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    const { room, august, september } = await prepare(page);
    await fillReading(page, "น้ำ", "90.000", "2026-08-15");
    const rejected = page.waitForResponse(
      (response) =>
        response.url().endsWith("/api/v1/meter-readings/drafts/") &&
        response.request().method() === "POST",
    );
    await utility(page, "น้ำ")
      .getByRole("button", { name: "บันทึกฉบับร่าง" })
      .click();
    expect((await rejected).status()).toBe(409);
    await expect(page.locator(".error-message")).toContainText(
      "ต้องไม่น้อยกว่า",
    );
    await expect(page.getByLabel("เลขมิเตอร์น้ำปัจจุบัน")).toHaveValue(
      "90.000",
    );
    await fillReading(page, "น้ำ", "105.125", "2026-08-15");
    page.once("dialog", (dialog) => dialog.accept());
    await utility(page, "น้ำ")
      .getByRole("button", { name: "ยืนยันค่า", exact: true })
      .click();
    await expect(page.locator(".success-message")).toContainText(
      "ยืนยันมิเตอร์น้ำ",
    );
    await expect(page.getByLabel("เลขมิเตอร์น้ำปัจจุบัน")).toBeDisabled();
    await utility(page, "น้ำ")
      .getByRole("button", { name: "แก้ไขพร้อมเหตุผล" })
      .click();
    await page.getByLabel("เลขที่แก้ไข").fill("106.125");
    await expect(
      page.getByRole("button", { name: "ยืนยันและบันทึก" }),
    ).toBeDisabled();
    await page.getByLabel("เหตุผล").fill(`3C4 evidenced correction ${width}`);
    await page.getByRole("button", { name: "ยืนยันและบันทึก" }).click();
    await expect(page.locator(".success-message")).toContainText(
      "แก้ไขเลขมิเตอร์",
    );
    await expect(page.getByLabel("เลขมิเตอร์น้ำปัจจุบัน")).toHaveValue(
      "106.125",
    );

    await page.getByLabel("รอบเรียกเก็บ").selectOption(september);
    await page
      .getByRole("button", { name: new RegExp(`ห้อง ${room.number}`) })
      .click();
    await utility(page, "น้ำ")
      .getByRole("button", { name: "เปลี่ยนมิเตอร์", exact: true })
      .click();
    await page
      .getByLabel("หมายเลขมิเตอร์ใหม่")
      .fill(`3C4-replaced-${randomUUID().slice(0, 8)}`);
    await page.getByLabel("เลขสุดท้ายของมิเตอร์เดิม").fill("110.000");
    await page.getByLabel("เลขเริ่มต้นของมิเตอร์ใหม่").fill("2.500");
    await page.getByLabel("วันที่เปลี่ยน").fill("2026-09-10");
    await page.getByLabel("เหตุผล").fill(`3C4 replacement ${width}`);
    await page.getByRole("button", { name: "ยืนยันและบันทึก" }).click();
    await expect(page.locator(".success-message")).toContainText(
      "เปลี่ยนมิเตอร์เรียบร้อย",
    );
    await expect(page.getByLabel("เลขมิเตอร์น้ำปัจจุบัน")).toHaveValue("2.500");
    await checkHistoryTimes(page, room.id);

    const before = await history(page.request, room.id);
    await signIn(page.request, true);
    await page.reload();
    await page.getByLabel("รอบเรียกเก็บ").selectOption(september);
    await page
      .getByRole("button", { name: new RegExp(`ห้อง ${room.number}`) })
      .click();
    await expect(
      page.getByRole("button", { name: "แก้ไขพร้อมเหตุผล" }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: "เปลี่ยนมิเตอร์", exact: true }),
    ).toHaveCount(0);
    await fillReading(page, "ไฟฟ้า", "520.000", "2026-09-15");
    page.once("dialog", (dialog) => dialog.accept());
    await utility(page, "ไฟฟ้า")
      .getByRole("button", { name: "ยืนยันค่า", exact: true })
      .click();
    await expect(page.locator(".success-message")).toContainText(
      "ยืนยันมิเตอร์ไฟฟ้า",
    );
    const waterReading = before.readings.find(
      (reading) => reading.kind === "WATER" && reading.value === "106.125",
    );
    if (!waterReading)
      throw new Error("Missing confirmed water correction fixture");
    const denied = await page.request.post(
      `/api/v1/meter-readings/${waterReading.id}/corrections/`,
      { headers, data: { value: "107.000", reason: "STAFF must not correct" } },
    );
    expect(denied.status()).toBe(403);
    const after = await history(page.request, room.id);
    expect(after.corrections).toEqual(before.corrections);
    expect(after.replacements).toEqual(before.replacements);
    expect(
      after.readings.find((reading) => reading.id === waterReading.id)?.value,
    ).toBe("106.125");
    await page.getByLabel("รอบเรียกเก็บ").selectOption(august);
    await page
      .getByRole("button", { name: new RegExp(`ห้อง ${room.number}`) })
      .click();
    await expect(page.getByLabel("เลขมิเตอร์น้ำปัจจุบัน")).toHaveValue(
      "106.125",
    );
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 1,
      ),
    ).toBe(true);
    await expect(page.locator("nextjs-portal")).toHaveCount(0);
    expect(errors).toEqual([]);
    if (evidence)
      await page.screenshot({
        path: `${evidence}/3c4-staff-${width}.png`,
        fullPage: false,
      });
  });
}
