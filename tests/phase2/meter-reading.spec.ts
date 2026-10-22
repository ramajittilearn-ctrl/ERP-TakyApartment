import { expect, test, type APIRequestContext } from "./guarded-test";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { getRooms } from "./fixtures";
import { overviewSchema } from "@/features/meters/contracts";

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
  await page.clock.install({ time: new Date("2026-10-18T05:00:00.000Z") });
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

test("admin replacement keeps final and initial readings in the selected billing period", async ({
  page,
}) => {
  const today = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Bangkok",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
  const previousDay = new Date(`${today}T00:00:00.000+07:00`);
  previousDay.setUTCDate(previousDay.getUTCDate() - 1);
  const installedAt = previousDay.toISOString().slice(0, 10);
  const billingPeriodIdMonth = today.slice(0, 7);
  await signIn(page.request);
  const rooms = await getRooms(page.request);
  const propertyId = rooms[0]?.floor.propertyId;
  if (!propertyId) throw new Error("Expected a seeded property");
  const billingPeriodId = await period(
    page.request,
    propertyId,
    billingPeriodIdMonth,
  );

  let targetRoom: (typeof rooms)[number] | undefined;
  for (const room of rooms) {
    const response = await page.request.get(
      `/api/v1/meter-readings/?billingPeriodId=${billingPeriodId}&roomId=${room.id}`,
    );
    expect(response.status()).toBe(200);
    const body = z
      .object({ data: overviewSchema })
      .parse(await response.json()).data;
    const water = body.rooms[0]?.meters.find((slot) => slot.kind === "WATER");
    if (water?.meterId === null) {
      targetRoom = room;
      break;
    }
  }
  if (!targetRoom) throw new Error("Expected a room without a water meter");

  await page.goto("/meters/");
  await page.getByLabel("รอบเรียกเก็บ").selectOption(billingPeriodId);
  await page
    .getByRole("button", { name: new RegExp(`ห้อง ${targetRoom.number}`) })
    .click();
  const waterSlot = page
    .locator(".meter-slot")
    .filter({ hasText: "มิเตอร์น้ำ" });
  const serialSuffix = randomUUID().slice(0, 8);
  await waterSlot
    .getByRole("button", { name: "ตั้งค่ามิเตอร์และค่าเริ่มต้น" })
    .click();
  await page
    .getByLabel("หมายเลขมิเตอร์ใหม่")
    .fill(`BROWSER-OLD-${serialSuffix}`);
  await page.getByLabel("เลขเริ่มต้น").fill("100.000");
  await page.getByLabel("วันที่ติดตั้ง").fill(installedAt);
  await page.getByLabel("เหตุผล").fill("ตั้งค่าทดสอบก่อนเปลี่ยนมิเตอร์");
  await page.getByRole("button", { name: "ยืนยันและบันทึก" }).click();
  await expect(page.locator(".success-message")).toContainText(
    "ตั้งค่ามิเตอร์",
  );

  await waterSlot.getByRole("button", { name: "เปลี่ยนมิเตอร์" }).click();
  await page
    .getByLabel("หมายเลขมิเตอร์ใหม่")
    .fill(`BROWSER-NEW-${serialSuffix}`);
  await page.getByLabel("เลขสุดท้ายของมิเตอร์เดิม").fill("105.125");
  await page.getByLabel("เลขเริ่มต้นของมิเตอร์ใหม่").fill("2.500");
  await page.getByLabel("วันที่เปลี่ยน").fill(today);
  await page.getByLabel("เหตุผล").fill("เปลี่ยนมิเตอร์ใน browser regression");
  await page.getByRole("button", { name: "ยืนยันและบันทึก" }).click();
  await expect(page.locator(".success-message")).toContainText(
    "เปลี่ยนมิเตอร์",
  );

  const historyResponse = await page.request.get(
    `/api/v1/meter-readings/history/?roomId=${targetRoom.id}&kind=WATER`,
  );
  expect(historyResponse.status()).toBe(200);
  const result = z
    .object({
      data: z.object({
        replacements: z.array(
          z.object({ finalReadingId: z.uuid(), initialReadingId: z.uuid() }),
        ),
        readings: z.array(
          z.object({ id: z.uuid(), billingPeriodId: z.uuid().nullable() }),
        ),
      }),
    })
    .parse(await historyResponse.json()).data;
  const replacement = result.replacements[0];
  if (!replacement) throw new Error("Expected the replacement in room history");
  const finalReading = result.readings.find(
    (reading) => reading.id === replacement.finalReadingId,
  );
  const initialReading = result.readings.find(
    (reading) => reading.id === replacement.initialReadingId,
  );
  expect(finalReading?.billingPeriodId).toBe(billingPeriodId);
  expect(initialReading?.billingPeriodId).toBe(billingPeriodId);
});
