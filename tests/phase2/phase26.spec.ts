import { expect, test, type APIRequestContext } from "@playwright/test";
import { randomUUID } from "node:crypto";
const origin = process.env.PLAYWRIGHT_BASE_URL || "http://127.0.0.1:3300";
const headers = { Origin: origin };
async function signIn(request: APIRequestContext, staff = false) {
  expect(
    (
      await request.post("/api/auth/login/", {
        headers,
        data: {
          identifier: staff ? "test-staff" : "test-admin",
          password: staff
            ? process.env.TEST_STAFF_PASSWORD
            : process.env.TEST_ADMIN_PASSWORD,
        },
      })
    ).status(),
  ).toBe(200);
}
async function endDemoLeases(request: APIRequestContext, tenantId: string) {
  const { data } = await (await request.get("/api/v1/leases/")).json();
  for (const lease of data.filter(
    (l: { tenantId: string; status: string }) =>
      l.tenantId === tenantId && l.status === "ACTIVE",
  )) {
    const { number, roomId, tenantId, rent, deposit, isDemo } = lease;
    expect(
      (
        await request.put(`/api/v1/leases/${lease.id}/`, {
          headers,
          data: {
            number,
            roomId,
            tenantId,
            rent,
            deposit,
            isDemo,
            status: "ENDED",
            startDate: lease.startDate.slice(0, 10),
            endDate: lease.endDate.slice(0, 10),
          },
        })
      ).status(),
    ).toBe(200);
  }
}

test("floor-dependent assignment options contain database rooms and exclude occupied rooms", async ({
  page,
}) => {
  await signIn(page.request);
  const { data: rooms } = await (
    await page.request.get("/api/v1/rooms/")
  ).json();
  const room = rooms.find((r: { number: string }) => r.number === "102");
  const reserved = rooms.find((r: { number: string }) => r.number === "103");
  const suffix = randomUUID().slice(0, 8);
  const result = await page.request.post("/api/v1/tenants/", {
    headers,
    data: {
      name: `Demo options ${suffix}`,
      phone: "",
      email: "",
      isDemo: true,
      assignment: {
        roomId: room.id,
        number: `DEMO-options-${suffix}`,
        startDate: "2026-10-01",
        endDate: "2027-09-30",
        rent: "3500.25",
        deposit: "0",
      },
    },
  });
  expect(result.status()).toBe(201);
  const { data: tenant } = await result.json();
  const roomInput = {
    floorId: reserved.floorId,
    number: reserved.number,
    rent: reserved.rent,
    status: "RESERVED",
    notes: reserved.notes,
  };
  try {
    expect(
      (
        await page.request.put(`/api/v1/rooms/${reserved.id}/`, {
          headers,
          data: roomInput,
        })
      ).status(),
    ).toBe(200);
    await page.goto("/tenants/");
    await page
      .getByRole("button", { name: "เพิ่มผู้เช่า", exact: true })
      .click();
    await page.getByLabel("กำหนดห้องพัก", { exact: true }).check();
    const floor = page.getByLabel("ชั้นสำหรับเลือกห้อง");
    const roomSelect = page.getByLabel("ห้องพัก", { exact: true });
    await expect(roomSelect).toBeDisabled();
    for (const n of [1, 2, 3]) {
      await floor.selectOption({ label: `ชั้น ${n}` });
      const expected = Array.from({ length: 5 }, (_, i) =>
        String(n * 100 + i + 1),
      ).filter((number) => number !== "102" && number !== "103");
      expect(await roomSelect.locator("option").allTextContents()).toEqual([
        "เลือกห้องพัก",
        ...expected,
      ]);
      if (n === 2) await roomSelect.selectOption({ label: "201" });
      if (n === 3) await expect(roomSelect).toHaveValue("");
    }
    await page.getByRole("button", { name: "ยกเลิก", exact: true }).click();
    await page.goto(`/tenants/?tenant=${tenant.id}`);
    await page
      .getByRole("button", { name: "แก้ไขข้อมูล", exact: true })
      .click();
    await expect(page.getByLabel("ห้องพัก", { exact: true })).toHaveValue(
      room.id,
    );
    await expect(
      page
        .getByLabel("ห้องพัก", { exact: true })
        .locator(`option[value="${room.id}"]`),
    ).toHaveText("102");
    await expect(
      page.getByLabel("กำหนดห้องพัก", { exact: true }),
    ).toBeDisabled();
  } finally {
    await endDemoLeases(page.request, tenant.id);
    expect(
      (
        await page.request.put(`/api/v1/rooms/${reserved.id}/`, {
          headers,
          data: { ...roomInput, status: reserved.status },
        })
      ).status(),
    ).toBe(200);
  }
});

test("staff can create an unassigned tenant; incomplete assignment is rejected without a profile", async ({
  page,
}) => {
  await signIn(page.request, true);
  const name = `Demo unassigned ${randomUUID().slice(0, 8)}`;
  await page.goto("/tenants/");
  await page.getByRole("button", { name: "เพิ่มผู้เช่า", exact: true }).click();
  await page.getByLabel("ชื่อผู้เช่า", { exact: true }).fill(name);
  await page.getByLabel("ข้อมูลตัวอย่าง (Demo)").check();
  await page.getByRole("button", { name: "บันทึกข้อมูล" }).click();
  await expect(page).toHaveURL(/tenant=[a-f0-9-]+/);
  await expect(page.locator(".tenant-profile")).toContainText(
    "ยังไม่กำหนดห้อง",
  );
  const response = await page.request.post("/api/v1/tenants/", {
    headers,
    data: {
      name: `${name} invalid`,
      phone: "",
      email: "",
      isDemo: true,
      assignment: {},
    },
  });
  expect(response.status()).toBe(422);
  const { data } = await (await page.request.get("/api/v1/tenants/")).json();
  expect(
    data.filter((t: { name: string }) => t.name === `${name} invalid`),
  ).toHaveLength(0);
});

for (const width of [1440, 834, 390]) {
  test(`Phase 2.6 linked profiles and explicit transfer at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 1000 });
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("console", (message) => {
      if (message.type() === "error") errors.push(message.text());
    });
    await signIn(page.request);
    const suffix = randomUUID().slice(0, 8);
    const name = `Demo linked ${suffix}`;
    const number = `DEMO-linked-${suffix}`;
    await page.goto("/tenants/");
    await page
      .getByRole("button", { name: "เพิ่มผู้เช่า", exact: true })
      .click();
    await page.getByLabel("ชื่อผู้เช่า", { exact: true }).fill(name);
    await page.getByLabel("ข้อมูลตัวอย่าง (Demo)").check();
    await page.getByLabel("กำหนดห้องพัก", { exact: true }).check();
    await page
      .getByLabel("ชั้นสำหรับเลือกห้อง")
      .selectOption({ label: "ชั้น 2" });
    await page
      .getByLabel("ห้องพัก", { exact: true })
      .selectOption({ label: "201" });
    await page.getByLabel("เลขที่สัญญา", { exact: true }).fill(number);
    await page.getByLabel("วันเริ่มสัญญา", { exact: true }).fill("2026-10-01");
    await page
      .getByLabel("วันสิ้นสุดสัญญา", { exact: true })
      .fill("2027-09-30");
    await page.getByLabel("ค่าเช่าตามสัญญา", { exact: true }).fill("4100.75");
    await page
      .getByLabel("เงินประกันตามสัญญา", { exact: true })
      .fill("8201.50");
    await page.screenshot({
      path: `docs/phase-2.6-screenshots/${width}-assignment.png`,
      fullPage: false,
    });
    await page.getByRole("button", { name: "บันทึกข้อมูล" }).click();
    await expect(page).toHaveURL(/tenant=[a-f0-9-]+/);
    const tenantId = new URL(page.url()).searchParams.get("tenant")!;
    try {
      await expect(page.locator(".tenant-profile")).toContainText(name);
      await page.getByRole("link", { name: "ห้อง 201", exact: true }).click();
      const detail = page.getByRole("dialog");
      await expect(detail).toContainText("มีผู้เช่า");
      await expect(detail).toContainText("4,100.75");
      await expect(detail).toContainText("Not Available — Phase 3");
      await page.screenshot({
        path: `docs/phase-2.6-screenshots/${width}-room.png`,
        fullPage: false,
      });
      await detail.getByRole("link", { name, exact: true }).click();
      await expect(page.locator(".tenant-profile")).toContainText(name);
      await page.getByRole("link", { name: "ห้อง 201", exact: true }).click();
      await detail.getByRole("link", { name: number, exact: true }).click();
      await expect(page.getByRole("dialog")).toContainText("8,201.5");
      await page
        .getByRole("dialog")
        .getByRole("link", { name, exact: true })
        .click();
      await expect(page.locator(".tenant-profile")).toContainText(name);
      await page
        .getByRole("button", { name: "แก้ไขข้อมูล", exact: true })
        .click();
      await page
        .getByLabel("ชั้นสำหรับเลือกห้อง")
        .selectOption({ label: "ชั้น 3" });
      await page
        .getByLabel("ห้องพัก", { exact: true })
        .selectOption({ label: "301" });
      await page
        .getByLabel("เลขที่สัญญา", { exact: true })
        .fill(`DEMO-move-${suffix}`);
      await page
        .getByLabel("วันเริ่มสัญญา", { exact: true })
        .fill("2026-11-01");
      await page
        .getByLabel("วันสิ้นสุดสัญญาเดิม", { exact: true })
        .fill("2026-10-31");
      await page.getByLabel("ยืนยันสิ้นสุดสัญญาเดิมและย้ายห้อง").check();
      await page.getByRole("button", { name: "บันทึกข้อมูล" }).click();
      await expect(page.getByRole("dialog")).toHaveCount(0);
      await expect(
        page
          .locator(".tenant-profile")
          .getByRole("link", { name: "ห้อง 301", exact: true }),
      ).toBeVisible();
      const { data: leases } = await (
        await page.request.get("/api/v1/leases/")
      ).json();
      expect(
        leases.filter((l: { tenantId: string }) => l.tenantId === tenantId),
      ).toHaveLength(2);
      expect(
        leases.find((l: { number: string }) => l.number === number).status,
      ).toBe("ENDED");
      const { data: roomRecords } = await (
        await page.request.get("/api/v1/rooms/")
      ).json();
      expect(
        roomRecords.find((r: { number: string }) => r.number === "201").leases,
      ).toHaveLength(0);
      expect(
        roomRecords.find((r: { number: string }) => r.number === "301")
          .leases[0].tenant.id,
      ).toBe(tenantId);
      await page.reload();
      await expect(
        page
          .locator(".tenant-profile")
          .getByRole("link", { name: "ห้อง 301", exact: true }),
      ).toBeVisible();
      await page.screenshot({
        path: `docs/phase-2.6-screenshots/${width}-tenant.png`,
        fullPage: true,
      });
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= window.innerWidth + 1,
        ),
      ).toBe(true);
      expect(errors).toEqual([]);
    } finally {
      await endDemoLeases(page.request, tenantId);
    }
  });
}
