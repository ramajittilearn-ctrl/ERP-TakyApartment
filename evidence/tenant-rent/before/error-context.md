# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: phase2/tenant-rent-persisted.spec.ts >> tenant contract rent survives room selection, save, reload and reselect
- Location: tests/phase2/tenant-rent-persisted.spec.ts:18:5

# Error details

```
Error: expect(locator).toHaveValue(expected) failed

Locator:  getByLabel('ค่าเช่าตามสัญญา', { exact: true })
Expected: "4100.75"
Received: "0"
Timeout:  10000ms

Call log:
  - Expect "toHaveValue" getByLabel('ค่าเช่าตามสัญญา', { exact: true }) with timeout 10000ms
  - waiting for getByLabel('ค่าเช่าตามสัญญา', { exact: true })
    23 × locator resolved to <input value="0" id="_r_f_" required="" type="text"/>
       - unexpected value "0"

```

```yaml
- textbox "ค่าเช่าตามสัญญา": "0"
```

# Test source

```ts
  1   | import { randomUUID } from "node:crypto";
  2   | import { test, expect, type APIRequestContext } from "./guarded-test";
  3   | import { browserTestTarget } from "../../src/server/browser-test-target";
  4   | import { db } from "../../src/server/db";
  5   | import { getLeases } from "./fixtures";
  6   | 
  7   | async function signIn(request: APIRequestContext) {
  8   |   const response = await request.post("/api/auth/login/", {
  9   |     headers: { Origin: browserTestTarget().origin },
  10  |     data: {
  11  |       identifier: "test-admin",
  12  |       password: process.env.TEST_ADMIN_PASSWORD,
  13  |     },
  14  |   });
  15  |   expect(response.status()).toBe(200);
  16  | }
  17  | 
  18  | test("tenant contract rent survives room selection, save, reload and reselect", async ({
  19  |   page,
  20  | }) => {
  21  |   const target = browserTestTarget();
  22  |   expect(
  23  |     await db.$queryRaw`SELECT current_database() AS name, current_user AS role`,
  24  |   ).toEqual([{ name: target.database, role: target.role }]);
  25  |   const suffix = randomUUID().slice(0, 20);
  26  |   const property = await db.property.create({
  27  |     data: {
  28  |       code: `RENT-${suffix}`,
  29  |       name: `Synthetic rent ${suffix}`,
  30  |       address: "Synthetic",
  31  |     },
  32  |   });
  33  |   const floor = await db.floor.create({
  34  |     data: {
  35  |       propertyId: property.id,
  36  |       number: 1,
  37  |       name: `Synthetic rent ${suffix}`,
  38  |     },
  39  |   });
  40  |   const room = await db.room.create({
  41  |     data: { floorId: floor.id, number: "R101", rent: "0.00" },
  42  |   });
  43  |   await signIn(page.request);
  44  |   await page.goto("/tenants/");
  45  |   await page.getByRole("button", { name: "เพิ่มผู้เช่า", exact: true }).click();
  46  |   await page
  47  |     .getByLabel("ชื่อผู้เช่า", { exact: true })
  48  |     .fill(`Synthetic rent ${suffix}`);
  49  |   await page.getByLabel("ข้อมูลตัวอย่าง (Demo)").check();
  50  |   await page.getByLabel("กำหนดห้องพัก", { exact: true }).check();
  51  |   const rent = page.getByLabel("ค่าเช่าตามสัญญา", { exact: true });
  52  |   await rent.fill("4100.75");
  53  |   await page.getByLabel("ชั้นสำหรับเลือกห้อง").selectOption(floor.id);
  54  |   await page.getByLabel("ห้องพัก", { exact: true }).selectOption(room.id);
> 55  |   await expect(rent).toHaveValue("4100.75");
      |                      ^ Error: expect(locator).toHaveValue(expected) failed
  56  |   await page.getByLabel("เลขที่สัญญา", { exact: true }).fill(`RENT-${suffix}`);
  57  |   await page.getByLabel("วันเริ่มสัญญา", { exact: true }).fill("2026-10-01");
  58  |   await page.getByLabel("วันสิ้นสุดสัญญา", { exact: true }).fill("2027-09-30");
  59  |   await page.getByRole("button", { name: "บันทึกข้อมูล" }).click();
  60  |   await expect(page).toHaveURL(/tenant=[a-f0-9-]+/);
  61  |   const tenantId = new URL(page.url()).searchParams.get("tenant");
  62  |   expect(tenantId).toBeTruthy();
  63  |   await page.reload();
  64  |   await expect(page.locator(".tenant-profile")).toContainText("4,100.75");
  65  |   expect(
  66  |     (await getLeases(page.request)).find((lease) => lease.tenantId === tenantId)
  67  |       ?.rent,
  68  |   ).toBe("4100.75");
  69  |   await page.getByRole("button", { name: "แก้ไขข้อมูล", exact: true }).click();
  70  |   await expect(rent).toHaveValue("4100.75");
  71  |   await page.getByLabel("ห้องพัก", { exact: true }).selectOption("");
  72  |   await page.getByLabel("ห้องพัก", { exact: true }).selectOption(room.id);
  73  |   await expect(rent).toHaveValue("4100.75");
  74  |   await page.getByRole("button", { name: "บันทึกข้อมูล" }).click();
  75  |   await expect(page.getByRole("dialog")).toHaveCount(0);
  76  |   await page.reload();
  77  |   await expect(page.locator(".tenant-profile")).toContainText("4,100.75");
  78  |   expect(
  79  |     (await getLeases(page.request)).find((lease) => lease.tenantId === tenantId)
  80  |       ?.rent,
  81  |   ).toBe("4100.75");
  82  | });
  83  | 
  84  | test("a tenant without a room assignment has no invented contract rent", async ({
  85  |   page,
  86  | }) => {
  87  |   await signIn(page.request);
  88  |   await page.goto("/tenants/");
  89  |   await page.getByRole("button", { name: "เพิ่มผู้เช่า", exact: true }).click();
  90  |   await page
  91  |     .getByLabel("ชื่อผู้เช่า", { exact: true })
  92  |     .fill(`Synthetic unassigned ${randomUUID()}`);
  93  |   await page.getByLabel("ข้อมูลตัวอย่าง (Demo)").check();
  94  |   await page.getByRole("button", { name: "บันทึกข้อมูล" }).click();
  95  |   await expect(page).toHaveURL(/tenant=[a-f0-9-]+/);
  96  |   await page.reload();
  97  |   await expect(page.locator(".tenant-profile")).toContainText(
  98  |     "ไม่มีสัญญาปัจจุบัน",
  99  |   );
  100 |   const rent = page
  101 |     .locator(".tenant-profile .detail-grid > div")
  102 |     .filter({ has: page.locator("dt", { hasText: /^ค่าเช่า$/ }) });
  103 |   await expect(rent.locator("dd")).toHaveText("—");
  104 |   const tenantId = new URL(page.url()).searchParams.get("tenant");
  105 |   expect(
  106 |     (await getLeases(page.request)).filter(
  107 |       (lease) => lease.tenantId === tenantId,
  108 |     ),
  109 |   ).toHaveLength(0);
  110 | });
  111 | 
```