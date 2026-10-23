import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { z } from "zod";
import { expect, test, type APIRequestContext } from "./guarded-test";
import { getLeases, getRooms } from "./fixtures";

const origin = process.env.PLAYWRIGHT_BASE_URL || "http://127.0.0.1:3820";

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

async function postData(
  request: APIRequestContext,
  path: string,
  body: object,
) {
  const response = await request.post(path, {
    headers: { Origin: origin },
    data: body,
  });
  const payload: unknown = await response.json();
  expect(response.status(), `${path}: ${JSON.stringify(payload)}`).toBe(201);
  return z
    .object({ data: z.object({ id: z.uuid() }).passthrough() })
    .parse(payload).data;
}

test("ADMIN completes a fictional monthly billing flow in the UI", async ({
  page,
}) => {
  test.setTimeout(90_000);
  const suffix = randomUUID().slice(0, 8);
  await signIn(page.request);

  const rooms = await getRooms(page.request);
  const occupiedIds = new Set(
    (await getLeases(page.request))
      .filter((lease) => lease.status === "ACTIVE")
      .map((lease) => lease.roomId),
  );
  const room = rooms.find(
    (candidate) => candidate.number === "305" && !occupiedIds.has(candidate.id),
  );
  if (!room)
    throw new Error("Isolated test should have free synthetic room 305");
  const propertyId = room.floor.propertyId;
  const tenant = await postData(page.request, "/api/v1/tenants/", {
    name: `ผู้เช่าสมมติทดสอบ ${suffix}`,
    phone: "",
    email: `billing-${suffix}@example.invalid`,
    address: "ที่อยู่สมมติสำหรับทดสอบระบบ",
    notes: "ตัวอย่างข้อมูลสังเคราะห์ใน isolated browser test",
    isDemo: true,
  });
  await postData(page.request, "/api/v1/leases/", {
    number: `BILLING-${suffix}`,
    roomId: room.id,
    tenantId: tenant.id,
    startDate: "2020-01-01",
    endDate: "2020-01-31",
    rent: "1200.00",
    deposit: "0.00",
    status: "ACTIVE",
    isDemo: true,
  });

  await page.goto("/billing/");
  const panel = page.getByRole("region", {
    name: "จัดการรอบบิลและอัตราสาธารณูปโภค",
  });
  await expect(panel).toBeVisible();
  await panel.locator("#setup-create-property").selectOption(propertyId);
  await panel.locator("#setup-create-month").fill("2020-01");
  await panel.getByRole("button", { name: "สร้างและเลือกรอบบิล" }).click();
  await expect(
    panel.getByText("สร้างรอบบิลแล้ว และเลือกรอบใหม่นี้ให้แล้ว", {
      exact: true,
    }),
  ).toBeVisible();
  const periodResponse = await page.request.get(
    `/api/v1/billing-periods/?propertyId=${propertyId}`,
  );
  const periodBody: unknown = await periodResponse.json();
  const periods = z
    .object({
      data: z.array(z.object({ id: z.uuid(), startsOn: z.string() })),
    })
    .parse(periodBody).data;
  const period = periods.find((value) => value.startsOn === "2020-01-01");
  if (!period) throw new Error("Created billing period was not returned");

  await panel.locator("#setup-rate-kind").selectOption("WATER");
  await panel.locator("#setup-rate-effective").fill("2020-01-01");
  await panel.locator("#setup-rate-price").fill("20.0000");
  await panel.getByRole("button", { name: "เพิ่มอัตรา" }).click();
  await expect(
    panel.getByText("เพิ่มอัตราน้ำประปาแล้ว ประวัติเดิมยังคงเดิม", {
      exact: true,
    }),
  ).toBeVisible();

  await panel.locator("#setup-rate-kind").selectOption("ELECTRICITY");
  await panel.locator("#setup-rate-effective").fill("2020-01-01");
  await panel.locator("#setup-rate-price").fill("8.0000");
  await panel.getByRole("button", { name: "เพิ่มอัตรา" }).click();
  await expect(
    panel.getByText("เพิ่มอัตราไฟฟ้าแล้ว ประวัติเดิมยังคงเดิม", {
      exact: true,
    }),
  ).toBeVisible();

  await panel.locator("#selection-rate-WATER").selectOption({ index: 1 });
  await panel
    .locator("#selection-reason-WATER")
    .fill("อนุมัติอัตราน้ำสำหรับตัวอย่างรอบเดือน");
  await panel.locator("#selection-rate-ELECTRICITY").selectOption({ index: 1 });
  await panel
    .locator("#selection-reason-ELECTRICITY")
    .fill("อนุมัติอัตราไฟฟ้าสำหรับตัวอย่างรอบเดือน");
  await panel.getByRole("button", { name: "บันทึกการเลือก" }).nth(0).click();
  await expect(panel.getByText("20.0000 บาท / ลบ.ม.")).toBeVisible();
  await panel.getByRole("button", { name: "บันทึกการเลือก" }).nth(1).click();
  await expect(panel.getByText("8.0000 บาท / kWh")).toBeVisible();

  await page.reload();
  const reloadedPanel = page.getByRole("region", {
    name: "จัดการรอบบิลและอัตราสาธารณูปโภค",
  });
  await expect(reloadedPanel.getByText("20.0000 บาท / ลบ.ม.")).toBeVisible();
  await expect(reloadedPanel.getByText("8.0000 บาท / kWh")).toBeVisible();
  await expect(
    reloadedPanel.getByText("เปิดรอบ", { exact: true }),
  ).toBeVisible();

  await reloadedPanel.locator("#setup-create-month").fill("2020-01");
  await reloadedPanel
    .getByRole("button", { name: "สร้างและเลือกรอบบิล" })
    .click();
  await expect(reloadedPanel.getByRole("alert")).toContainText("CONFLICT");
  await expect(reloadedPanel.locator("#setup-create-month")).toHaveValue(
    "2020-01",
  );

  await page.goto("/meters/");
  await page.getByLabel("รอบเรียกเก็บ").selectOption(period.id);
  await page
    .getByRole("button", { name: new RegExp(`ห้อง ${room.number}`) })
    .click();
  for (const kind of ["WATER", "ELECTRICITY"] as const) {
    const utility = kind === "WATER" ? "น้ำ" : "ไฟฟ้า";
    const slot = page
      .locator(".meter-slot")
      .filter({ hasText: `มิเตอร์${utility}` });
    await slot
      .getByRole("button", { name: "ตั้งค่ามิเตอร์และค่าเริ่มต้น" })
      .click();
    await page.getByLabel("หมายเลขมิเตอร์ใหม่").fill(`BILL-${suffix}-${kind}`);
    await page.getByLabel("เลขเริ่มต้น").fill("100.000");
    await page.getByLabel("วันที่ติดตั้ง").fill("2020-01-01");
    await page.getByLabel("เหตุผล").fill("ติดตั้งมิเตอร์สมมติสำหรับทดสอบ");
    await page.getByRole("button", { name: "ยืนยันและบันทึก" }).click();
    await expect(page.locator(".success-message")).toContainText(
      "ตั้งค่ามิเตอร์",
    );
  }

  await page.reload();
  await page.getByLabel("รอบเรียกเก็บ").selectOption(period.id);
  await page
    .getByRole("button", { name: new RegExp(`ห้อง ${room.number}`) })
    .click();
  for (const [utility, value] of [
    ["น้ำ", "110.000"],
    ["ไฟฟ้า", "510.000"],
  ] as const) {
    const slot = page
      .locator(".meter-slot")
      .filter({ hasText: `มิเตอร์${utility}` });
    await page.getByLabel(`วันที่จดมิเตอร์${utility}`).fill("2020-01-31");
    await page.getByLabel(`เลขมิเตอร์${utility}ปัจจุบัน`).fill(value);
    page.once("dialog", (dialog) => dialog.accept());
    await slot.getByRole("button", { name: "ยืนยันค่า" }).click();
    await expect(slot.getByText("ยืนยันแล้ว")).toBeVisible();
  }

  await page.goto("/billing/");
  const billingPanel = page.getByRole("region", {
    name: "จัดการรอบบิลและอัตราสาธารณูปโภค",
  });
  await billingPanel.locator("#setup-period").selectOption(period.id);
  await page.getByRole("button", { name: "ตรวจสอบและปิดรอบ" }).click();
  await page.getByRole("button", { name: "ตรวจสอบข้อมูลก่อนปิดรอบ" }).click();
  await expect(
    page.getByText("ข้อมูลเรียกเก็บครบ ระบบจะตรวจสอบอีกครั้งเมื่อยืนยัน", {
      exact: true,
    }),
  ).toBeVisible();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "ยืนยัน" })
    .click();
  await expect(billingPanel.getByText("ปิดรอบ", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "ตั้งค่าวันครบกำหนด" }).click();
  await page.getByLabel("จำนวนวันหลังสิ้นรอบ").fill("0");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "ยืนยัน" })
    .click();
  await page.getByRole("button", { name: "เตรียมฉบับร่าง" }).click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "ยืนยัน" })
    .click();
  const invoiceRow = page.getByRole("row").filter({ hasText: room.number });
  await expect(invoiceRow).toBeVisible();
  await invoiceRow.getByRole("button", { name: "ดูรายละเอียด" }).click();
  await page.getByRole("button", { name: "ออกใบแจ้งหนี้" }).click();
  const issueResponsePromise = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      /\/api\/v1\/invoices\/[^/]+\/issue\/$/.test(response.url()),
  );
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "ยืนยัน" })
    .click();
  const issueResponse = await issueResponsePromise;
  const issuePayload: unknown =
    issueResponse.status() >= 300 && issueResponse.status() < 400
      ? { location: issueResponse.headers().location }
      : await issueResponse.json();
  expect(
    issueResponse.status(),
    JSON.stringify({ url: issueResponse.url(), payload: issuePayload }),
  ).toBe(200);
  expect(
    z
      .object({ data: z.object({ status: z.literal("ISSUED") }) })
      .parse(issuePayload).data.status,
  ).toBe("ISSUED");
  await page.reload();
  await page
    .getByRole("combobox", { name: "รอบบิล", exact: true })
    .selectOption(period.id);
  const reloadedInvoiceRow = page
    .getByRole("row")
    .filter({ hasText: room.number });
  await reloadedInvoiceRow
    .getByRole("button", { name: "ดูรายละเอียด" })
    .click();
  const downloadButton = page.getByRole("button", {
    name: /ดาวน์โหลดใบแจ้งหนี้ .* เป็น PDF/,
  });
  await expect(downloadButton).toBeEnabled();
  const downloadPromise = page.waitForEvent("download");
  await downloadButton.click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(
    /^Invoice_INV-202001-\d{4}\.pdf$/,
  );
  const pdf = await readFile((await download.path()) ?? "");
  expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");

  await page.request.post("/api/auth/logout/", {
    headers: { Origin: origin },
    data: {},
  });
  await signIn(page.request, true);
  await page.goto("/billing/");
  await expect(
    page.getByRole("heading", { name: "สร้างรอบบิลรายเดือน" }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("heading", { name: "เพิ่มอัตราใหม่" }),
  ).toHaveCount(0);
  expect(
    (
      await page.request.post("/api/v1/billing-periods/", {
        headers: { Origin: origin },
        data: { propertyId, month: "2020-02" },
      })
    ).status(),
  ).toBe(403);
  expect(
    (
      await page.request.post("/api/v1/utility-rates/", {
        headers: { Origin: origin },
        data: {
          propertyId,
          kind: "WATER",
          effectiveFrom: "2020-02-01",
          unitPrice: "99.0000",
        },
      })
    ).status(),
  ).toBe(403);
  expect(
    (
      await page.request.post("/api/v1/billing/rate-selections/", {
        headers: { Origin: origin },
        data: {
          billingPeriodId: period.id,
          kind: "WATER",
          utilityRateId: randomUUID(),
          reason: "staff security assertion",
        },
      })
    ).status(),
  ).toBe(403);
});

test("billing rate history never carries selected values into a different period", async ({
  page,
}) => {
  await signIn(page.request);
  const propertyId = (await getRooms(page.request))[0].floor.propertyId;
  const periodA = await postData(page.request, "/api/v1/billing-periods/", {
    propertyId,
    month: "1998-01",
  });
  const periodB = await postData(page.request, "/api/v1/billing-periods/", {
    propertyId,
    month: "1998-02",
  });
  let releaseB = () => {};
  const pendingB = new Promise<void>((resolve) => {
    releaseB = resolve;
  });
  const reason = "Period A approval must stay in period A";
  await page.route(
    /\/api\/v1\/billing\/rate-selections\/?\?/,
    async (route) => {
      const periodId = new URL(route.request().url()).searchParams.get(
        "billingPeriodId",
      );
      if (periodId === periodB.id) await pendingB;
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          data:
            periodId === periodA.id
              ? [
                  {
                    id: randomUUID(),
                    billingPeriodId: periodA.id,
                    kind: "WATER",
                    utilityRateId: randomUUID(),
                    reason,
                    revision: 1,
                    approvedAt: "1998-01-01T00:00:00.000Z",
                    approvedById: randomUUID(),
                    rate: {
                      unitPrice: "123.4567",
                      effectiveFrom: "1998-01-01",
                      nextEffectiveFrom: null,
                    },
                  },
                ]
              : [],
        }),
      });
    },
  );
  await page.goto("/billing/");
  const panel = page.getByRole("region", {
    name: "จัดการรอบบิลและอัตราสาธารณูปโภค",
  });
  await panel.locator("#setup-period").selectOption(periodA.id);
  await expect(
    panel.getByText(`เหตุผล: ${reason}`, { exact: true }),
  ).toBeVisible();
  await panel.locator("#setup-period").selectOption(periodB.id);
  await expect(
    panel.getByText(`เหตุผล: ${reason}`, { exact: true }),
  ).toHaveCount(0);
  await expect(
    panel.getByText("123.4567 บาท / ลบ.ม.", { exact: true }),
  ).toHaveCount(0);
  await expect(
    panel.getByText("กำลังโหลดประวัติ…", { exact: true }),
  ).toBeVisible();
  releaseB();
  await expect(
    panel.getByText("กำลังโหลดประวัติ…", { exact: true }),
  ).toHaveCount(0);
  await expect(
    panel.getByText("ยังไม่ได้เลือกอัตราสำหรับรอบนี้", { exact: true }),
  ).toHaveCount(2);
  await expect(
    panel.getByText(`เหตุผล: ${reason}`, { exact: true }),
  ).toHaveCount(0);
});
