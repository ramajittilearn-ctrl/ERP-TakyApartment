import { expect, test, type APIRequestContext } from "@playwright/test";
import { z } from "zod";
import { getRooms } from "./fixtures";

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
}

async function period(
  request: APIRequestContext,
  propertyId: string,
  month: string,
) {
  const response = await request.post("/api/v1/billing-periods/", {
    headers: { Origin: origin },
    data: { propertyId, month },
  });
  if (response.ok()) return (await response.json()).data.id as string;
  expect(response.status()).toBe(409);
  const list = await request.get(
    `/api/v1/billing-periods/?propertyId=${propertyId}`,
  );
  const body: unknown = await list.json();
  return z
    .object({
      data: z.array(z.object({ id: z.uuid(), startsOn: z.string() })),
    })
    .parse(body)
    .data.find((item) => item.startsOn.startsWith(month))!.id;
}

test("mobile operator records water and electricity on separate actual dates", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await signIn(page.request);
  const room = (await getRooms(page.request)).find(
    (item) => item.number === "101",
  );
  expect(room).toBeDefined();
  const propertyId = room!.floor.propertyId;
  await period(page.request, propertyId, "2026-09");
  const octoberId = await period(page.request, propertyId, "2026-10");
  const overview = await page.request.get(
    `/api/v1/meter-readings/?billingPeriodId=${octoberId}&roomId=${room!.id}`,
  );
  expect(overview.status()).toBe(200);
  const overviewBody = await overview.json();
  for (const slot of overviewBody.data.rooms[0].meters) {
    if (slot.meterId) continue;
    const registration = await page.request.post("/api/v1/meters/", {
      headers: { Origin: origin },
      data: {
        roomId: room!.id,
        kind: slot.kind,
        serial: `E2E-${slot.kind}-101`,
        installedAt: "2026-09-30",
        openingReading: slot.kind === "WATER" ? "100.000" : "500.000",
        reason: "ตั้งค่าทดสอบ Stage 3B",
      },
    });
    expect(registration.status()).toBe(201);
  }
  const prepared = await (
    await page.request.get(
      `/api/v1/meter-readings/?billingPeriodId=${octoberId}&roomId=${room!.id}`,
    )
  ).json();
  for (const slot of prepared.data.rooms[0].meters) {
    if (slot.reading?.status !== "DRAFT") continue;
    const reset = await page.request.post("/api/v1/meter-readings/drafts/", {
      headers: { Origin: origin },
      data: {
        meterId: slot.meterId,
        billingPeriodId: octoberId,
        value: slot.reading.value,
        readingDate: "2026-10-18",
        type: "NORMAL",
      },
    });
    expect(reset.status()).toBe(200);
  }

  await page.goto("/meters/");
  await page.getByRole("button", { name: /ห้อง 101/ }).click();
  const waterDate = page.getByLabel("วันที่จดมิเตอร์น้ำ");
  const electricDate = page.getByLabel("วันที่จดมิเตอร์ไฟฟ้า");
  await expect(waterDate).toHaveValue("2026-10-18");
  await expect(electricDate).toHaveValue("2026-10-18");
  await expect(waterDate).toHaveAttribute("max", "2026-10-18");

  await waterDate.fill("2026-10-17");
  await page.getByLabel("เลขมิเตอร์น้ำปัจจุบัน").fill("105.125");
  await page
    .locator(".meter-slot")
    .filter({ hasText: "มิเตอร์น้ำ" })
    .getByRole("button", { name: "บันทึกฉบับร่าง" })
    .click();
  await expect(page.locator(".success-message")).toContainText(
    "บันทึกฉบับร่าง",
  );
  await expect(page.getByText("กำลังโหลด…", { exact: true })).toHaveCount(0);

  await electricDate.fill("2026-10-16");
  await page.getByLabel("เลขมิเตอร์ไฟฟ้าปัจจุบัน").fill("540.500");
  await page
    .locator(".meter-slot")
    .filter({ hasText: "มิเตอร์ไฟฟ้า" })
    .getByRole("button", { name: "บันทึกฉบับร่าง" })
    .click();
  await expect(page.locator(".success-message")).toContainText("มิเตอร์ไฟฟ้า");
  await expect(page.getByText("กำลังโหลด…", { exact: true })).toHaveCount(0);

  await page.reload();
  await page.getByRole("button", { name: /ห้อง 101/ }).click();
  await expect(page.getByLabel("วันที่จดมิเตอร์น้ำ")).toHaveValue("2026-10-17");
  await expect(page.getByLabel("วันที่จดมิเตอร์ไฟฟ้า")).toHaveValue(
    "2026-10-16",
  );
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});
