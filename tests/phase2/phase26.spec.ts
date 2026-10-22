import { expect, test, type APIRequestContext } from "./guarded-test";
import { randomUUID } from "node:crypto";
import type { LiveRoom } from "@/features/live/contracts";
import { availableRooms, getLeases, getRooms, getTenants } from "./fixtures";
const origin = process.env.PLAYWRIGHT_BASE_URL || "http://127.0.0.1:3300";
const headers = { Origin: origin };
const screenshotDir =
  process.env.SCREENSHOT_DIR || "docs/phase-2.6-screenshots";
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
  const leases = await getLeases(request);
  for (const lease of leases.filter(
    (candidate) =>
      candidate.tenantId === tenantId && candidate.status === "ACTIVE",
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

function requireAvailableRooms(rooms: LiveRoom[], count: number): LiveRoom[] {
  const candidates = availableRooms(rooms);
  if (candidates.length < count)
    throw new Error(`Expected at least ${count} available test rooms`);
  return candidates;
}

function requireTransferRooms(rooms: LiveRoom[]): [LiveRoom, LiveRoom] {
  const candidates = requireAvailableRooms(rooms, 2);
  const source = candidates[0];
  const destination = candidates.find(
    (candidate) => candidate.floorId !== source.floorId,
  );
  if (!destination)
    throw new Error("Expected available test rooms on different floors");
  return [source, destination];
}

test("floor-dependent assignment options contain database rooms and exclude occupied rooms", async ({
  page,
}) => {
  await signIn(page.request);
  const rooms = await getRooms(page.request);
  const [room, reserved] = requireAvailableRooms(rooms, 2);
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
      const expected = rooms
        .filter(
          (candidate) =>
            candidate.floor.number === n &&
            candidate.status === "AVAILABLE" &&
            candidate.leases.every((lease) => lease.status !== "ACTIVE") &&
            candidate.id !== room.id &&
            candidate.id !== reserved.id,
        )
        .map((candidate) => candidate.number);
      expect(await roomSelect.locator("option").allTextContents()).toEqual([
        "เลือกห้องพัก",
        ...expected,
      ]);
      if (expected[0]) await roomSelect.selectOption({ label: expected[0] });
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
    ).toHaveText(room.number);
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
  try {
    await page.goto("/tenants/");
    await page
      .getByRole("button", { name: "เพิ่มผู้เช่า", exact: true })
      .click();
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
    expect(
      (await getTenants(page.request)).filter(
        (tenant) => tenant.name === `${name} invalid`,
      ),
    ).toHaveLength(0);
  } finally {
    const tenant = (await getTenants(page.request)).find(
      (candidate) => candidate.name === name && candidate.isDemo,
    );
    if (tenant) {
      await signIn(page.request);
      expect(
        (
          await page.request.delete(`/api/v1/tenants/${tenant.id}/`, {
            headers,
          })
        ).status(),
      ).toBe(200);
    }
  }
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
    const [sourceRoom, destinationRoom] = requireTransferRooms(
      await getRooms(page.request),
    );
    let tenantId: string | undefined;
    try {
      await page.goto("/tenants/");
      await page
        .getByRole("button", { name: "เพิ่มผู้เช่า", exact: true })
        .click();
      await page.getByLabel("ชื่อผู้เช่า", { exact: true }).fill(name);
      await page.getByLabel("ข้อมูลตัวอย่าง (Demo)").check();
      await page.getByLabel("กำหนดห้องพัก", { exact: true }).check();
      await page
        .getByLabel("ชั้นสำหรับเลือกห้อง")
        .selectOption({ label: `ชั้น ${sourceRoom.floor.number}` });
      await page
        .getByLabel("ห้องพัก", { exact: true })
        .selectOption({ label: sourceRoom.number });
      await page.getByLabel("เลขที่สัญญา", { exact: true }).fill(number);
      await page
        .getByLabel("วันเริ่มสัญญา", { exact: true })
        .fill("2026-10-01");
      await page
        .getByLabel("วันสิ้นสุดสัญญา", { exact: true })
        .fill("2027-09-30");
      await page.getByLabel("ค่าเช่าตามสัญญา", { exact: true }).fill("4100.75");
      await page
        .getByLabel("เงินประกันตามสัญญา", { exact: true })
        .fill("8201.50");
      await page.screenshot({
        path: `${screenshotDir}/${width}-assignment.png`,
        fullPage: false,
      });
      await page.getByRole("button", { name: "บันทึกข้อมูล" }).click();
      await expect(page).toHaveURL(/tenant=[a-f0-9-]+/);
      tenantId = new URL(page.url()).searchParams.get("tenant") ?? undefined;
      if (!tenantId) throw new Error("Created tenant URL has no tenant ID");
      await expect(page.locator(".tenant-profile")).toContainText(name);
      await page
        .getByRole("link", {
          name: `ห้อง ${sourceRoom.number}`,
          exact: true,
        })
        .click();
      const detail = page.getByRole("dialog");
      await expect(detail).toContainText("มีผู้เช่า");
      await expect(detail).toContainText("4,100.75");
      await expect(detail).toContainText("Not Available — Phase 3");
      await page.screenshot({
        path: `${screenshotDir}/${width}-room.png`,
        fullPage: false,
      });
      await detail.getByRole("link", { name, exact: true }).click();
      await expect(page.locator(".tenant-profile")).toContainText(name);
      await page
        .getByRole("link", {
          name: `ห้อง ${sourceRoom.number}`,
          exact: true,
        })
        .click();
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
        .selectOption({ label: `ชั้น ${destinationRoom.floor.number}` });
      await page
        .getByLabel("ห้องพัก", { exact: true })
        .selectOption({ label: destinationRoom.number });
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
        page.locator(".tenant-profile").getByRole("link", {
          name: `ห้อง ${destinationRoom.number}`,
          exact: true,
        }),
      ).toBeVisible();
      const leases = await getLeases(page.request);
      expect(
        leases.filter((lease) => lease.tenantId === tenantId),
      ).toHaveLength(2);
      expect(leases.find((lease) => lease.number === number)?.status).toBe(
        "ENDED",
      );
      const roomRecords = await getRooms(page.request);
      expect(
        roomRecords.find((room) => room.id === sourceRoom.id)?.leases,
      ).toHaveLength(0);
      expect(
        roomRecords.find((room) => room.id === destinationRoom.id)?.leases[0]
          ?.tenant.id,
      ).toBe(tenantId);
      await page.reload();
      await expect(
        page.locator(".tenant-profile").getByRole("link", {
          name: `ห้อง ${destinationRoom.number}`,
          exact: true,
        }),
      ).toBeVisible();
      await page.screenshot({
        path: `${screenshotDir}/${width}-tenant.png`,
        fullPage: true,
      });
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= window.innerWidth + 1,
        ),
      ).toBe(true);
      expect(errors).toEqual([]);
    } finally {
      const tenant = (await getTenants(page.request)).find(
        (candidate) =>
          candidate.isDemo &&
          (candidate.id === tenantId || candidate.name === name),
      );
      if (tenant) await endDemoLeases(page.request, tenant.id);
    }
  });
}
