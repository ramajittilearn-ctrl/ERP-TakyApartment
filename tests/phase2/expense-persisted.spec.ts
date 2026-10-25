import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import AxeBuilder from "@axe-core/playwright";
import {
  test,
  expect,
  type Page,
  type APIRequestContext,
} from "./guarded-test";
import { browserTestTarget } from "../../src/server/browser-test-target";
import { db } from "../../src/server/db";
import {
  createExpenseCategory,
  createExpense,
  postExpense,
} from "../../src/server/expenses";
import {
  expenseDtoSchema,
  createExpenseInput,
  categoryDtoSchema,
} from "../../src/server/expenses/contracts";
import { parseCsv } from "../helpers/expense-csv";
const key = () => randomUUID();
const pageErrors = new WeakMap<Page, string[]>();
test.beforeEach(({ page }) => {
  const errors: string[] = [];
  pageErrors.set(page, errors);
  page.on("pageerror", (error) => errors.push(error.message));
});
test.afterEach(({ page }) => expect(pageErrors.get(page)).toEqual([]));
async function fixture() {
  const target = browserTestTarget();
  const identity = await db.$queryRaw<
    { name: string; role: string }[]
  >`SELECT current_database() AS name, current_user AS role`;
  expect(identity).toEqual([{ name: target.database, role: target.role }]);
  const admin = await db.user.findUniqueOrThrow({
    where: { username: "test-admin" },
  });
  const property = await db.property.create({
    data: {
      code: `EU-${key().replaceAll("-", "").slice(0, 29)}`,
      name: `Synthetic Expense ${key()}`,
      address: "Synthetic expense address",
    },
  });
  const category = await createExpenseCategory(admin, {
    name: `Synthetic category ${key()}`,
    kind: "OPEX",
    commandKey: key(),
  });
  return { admin, property, category };
}
async function signIn(
  request: APIRequestContext,
  staff = false,
  username?: string,
) {
  const response = await request.post("/api/auth/login/", {
    headers: { Origin: browserTestTarget().origin },
    data: {
      identifier: username ?? (staff ? "test-staff" : "test-admin"),
      password: staff
        ? process.env.TEST_STAFF_PASSWORD
        : process.env.TEST_ADMIN_PASSWORD,
    },
  });
  expect(response.status()).toBe(200);
}
async function showProperty(page: Page, id: string) {
  await page.getByLabel("อาคารที่แสดง", { exact: true }).selectOption(id);
  await expect(
    page.getByRole("button", {
      name: "ส่งออก CSV ตามตัวกรองทั้งหมด",
      exact: true,
    }),
  ).toBeEnabled();
}
async function capture(
  page: Page,
  f: Awaited<ReturnType<typeof fixture>>,
  amount = "1234.56",
  description = `Synthetic UI ${key()}`,
) {
  await page
    .getByRole("button", { name: "เพิ่มค่าใช้จ่ายรออนุมัติ", exact: true })
    .click();
  const dialog = page.getByRole("dialog", {
    name: "บันทึกค่าใช้จ่ายรออนุมัติ",
    exact: true,
  });
  await dialog.getByLabel("อาคาร", { exact: true }).selectOption(f.property.id);
  await dialog
    .getByLabel("หมวดค่าใช้จ่าย", { exact: true })
    .selectOption(f.category.id);
  await dialog
    .getByLabel("รายการค่าใช้จ่าย", { exact: true })
    .fill(description);
  await dialog.getByLabel("ผู้รับเงิน", { exact: true }).fill("=SUM(1,1)");
  await dialog.getByLabel("จำนวนเงิน (บาท)", { exact: true }).fill(amount);
  await dialog
    .getByLabel("วันที่เกิดค่าใช้จ่าย", { exact: true })
    .fill("2026-10-24");
  await dialog
    .getByLabel("หมายเหตุ", { exact: true })
    .fill('Synthetic, "quoted"\nnew line');
  return dialog;
}
async function createInUi(
  page: Page,
  f: Awaited<ReturnType<typeof fixture>>,
  amount = "1234.56",
) {
  const dialog = await capture(page, f, amount);
  const response = page.waitForResponse(
    (value) =>
      /\/api\/v1\/expenses\/$/.test(new URL(value.url()).pathname) &&
      value.request().method() === "POST",
  );
  await dialog
    .getByRole("button", { name: "บันทึกค่าใช้จ่ายรออนุมัติ", exact: true })
    .click();
  const result = await response;
  expect(result.status()).toBe(201);
  const item = expenseDtoSchema.parse((await result.json()).data);
  await expect(
    page.getByRole("dialog", { name: "รายละเอียดค่าใช้จ่าย", exact: true }),
  ).toContainText(item.id);
  return item;
}
async function transition(
  page: Page,
  kind: "post" | "cancel" | "reverse",
  reason = "Synthetic correction",
) {
  const trigger = {
    post: "ตรวจสอบและอนุมัติ",
    cancel: "ยกเลิกรายการรออนุมัติ",
    reverse: "กลับรายการที่อนุมัติแล้ว",
  };
  const title = {
    post: "อนุมัติค่าใช้จ่าย",
    cancel: "ยกเลิกค่าใช้จ่ายรออนุมัติ",
    reverse: "กลับรายการค่าใช้จ่าย",
  };
  await page
    .getByRole("dialog", { name: "รายละเอียดค่าใช้จ่าย", exact: true })
    .getByRole("button", { name: trigger[kind], exact: true })
    .click();
  const dialog = page.getByRole("dialog", { name: title[kind], exact: true });
  if (kind !== "post")
    await dialog.getByLabel("เหตุผล", { exact: true }).fill(reason);
  const response = page.waitForResponse(
    (value) =>
      new URL(value.url()).pathname.endsWith(`/${kind}/`) &&
      value.request().method() === "POST",
  );
  await dialog.getByRole("button", { name: title[kind], exact: true }).click();
  expect((await response).status()).toBe(200);
  await expect(
    page.getByRole("dialog", { name: "รายละเอียดค่าใช้จ่าย", exact: true }),
  ).toContainText(
    kind === "post"
      ? "อนุมัติแล้ว"
      : kind === "cancel"
        ? "ยกเลิกแล้ว"
        : "กลับรายการแล้ว",
  );
}
async function closeDetail(page: Page) {
  await page
    .getByRole("dialog", { name: "รายละเอียดค่าใช้จ่าย", exact: true })
    .getByRole("button", { name: "ปิดหน้าต่าง", exact: true })
    .click();
}
async function downloadedRows(page: Page) {
  const download = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "ส่งออก CSV ตามตัวกรองทั้งหมด", exact: true })
    .click();
  const value = await download;
  expect(value.suggestedFilename()).toMatch(/^expenses-\d{8}T\d{6}Z\.csv$/);
  const path = await value.path();
  if (!path) throw new Error("Missing downloaded CSV");
  return parseCsv(await readFile(path, "utf8"));
}
test("expense persisted STAFF capture retains satang/date/history and server denies approval", async ({
  page,
}) => {
  const f = await fixture();
  await signIn(page.request, true);
  await page.goto("/expenses/");
  await showProperty(page, f.property.id);
  const item = await createInUi(page, f, "1234.56");
  await expect(
    page.getByRole("button", { name: "ตรวจสอบและอนุมัติ", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "สร้างหมวดค่าใช้จ่าย", exact: true }),
  ).toHaveCount(0);
  const denied = await page.request.post(`/api/v1/expenses/${item.id}/post/`, {
    headers: { Origin: browserTestTarget().origin },
    data: { expectedVersion: 1, commandKey: key() },
  });
  expect(denied.status()).toBe(403);
  await page.reload();
  await showProperty(page, f.property.id);
  await page
    .getByRole("button", {
      name: `ดูค่าใช้จ่าย ${item.description}`,
      exact: true,
    })
    .click();
  const dialog = page.getByRole("dialog", {
    name: "รายละเอียดค่าใช้จ่าย",
    exact: true,
  });
  await expect(dialog).toContainText("1,234.56 บาท");
  await expect(dialog).toContainText("2026-10-24");
  const stored = await db.expense.findUniqueOrThrow({ where: { id: item.id } });
  expect(stored.amount.toFixed(2)).toBe("1234.56");
  expect(stored.status).toBe("PENDING");
  await closeDetail(page);
  const rows = await downloadedRows(page);
  expect(rows).toHaveLength(3);
  expect(rows[1][7]).toBe("0.00");
});
test("expense persisted ADMIN category, post, cancel, reversal and correction preserve original history", async ({
  page,
}) => {
  const f = await fixture();
  await signIn(page.request);
  await page.goto("/expenses/");
  await showProperty(page, f.property.id);
  await page
    .getByRole("button", { name: "สร้างหมวดค่าใช้จ่าย", exact: true })
    .click();
  let dialog = page.getByRole("dialog", {
    name: "สร้างหมวดค่าใช้จ่าย",
    exact: true,
  });
  const name = `Synthetic CAPEX ${key()}`;
  await dialog.getByLabel("ชื่อหมวด").fill(name);
  await dialog.getByLabel("ประเภทหมวด").selectOption("CAPEX");
  const categoryResponse = page.waitForResponse(
    (value) =>
      /\/expense-categories\/$/.test(new URL(value.url()).pathname) &&
      value.request().method() === "POST",
  );
  await dialog
    .getByRole("button", { name: "สร้างหมวดค่าใช้จ่าย", exact: true })
    .click();
  const c = categoryDtoSchema.parse(
    (await (await categoryResponse).json()).data,
  );
  await expect(dialog).toHaveCount(0);
  const opex = await createInUi(page, f);
  await transition(page, "post");
  await closeDetail(page);
  const capex = await createInUi(page, { ...f, category: c }, "10000.01");
  await transition(page, "post");
  await closeDetail(page);
  await expect(page.getByText("11,234.57 บาท", { exact: true })).toBeVisible();
  const cancelled = await createInUi(page, f, "7.00");
  await transition(page, "cancel");
  await closeDetail(page);
  await page
    .getByRole("button", {
      name: `ดูค่าใช้จ่าย ${opex.description}`,
      exact: true,
    })
    .click();
  await transition(page, "reverse");
  dialog = page.getByRole("dialog", {
    name: "รายละเอียดค่าใช้จ่าย",
    exact: true,
  });
  await expect(dialog).toContainText("Synthetic correction");
  await dialog
    .getByRole("button", {
      name: "สร้างรายการแก้ไขอ้างอิงรายการนี้",
      exact: true,
    })
    .click();
  dialog = page.getByRole("dialog", {
    name: "บันทึกค่าใช้จ่ายรออนุมัติ",
    exact: true,
  });
  await expect(dialog.getByLabel("อาคาร", { exact: true })).toBeDisabled();
  await expect(dialog).toContainText(opex.id);
  await dialog
    .getByRole("button", { name: "ปิดแบบฟอร์ม", exact: true })
    .click();
  const summary = page.locator("section.card").filter({
    has: page.getByRole("heading", {
      name: "ค่าใช้จ่ายที่อนุมัติแล้วตามตัวกรอง",
      exact: true,
    }),
  });
  await expect(summary.getByText("10,000.01 บาท", { exact: true })).toHaveCount(
    2,
  );
  const rows = await downloadedRows(page);
  const columns = rows[0];
  const history = rows
    .slice(2)
    .map((row) => Object.fromEntries(columns.map((col, i) => [col, row[i]])));
  expect(history).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        id: opex.id,
        status: "REVERSED",
        reverseReason: "Synthetic correction",
        amount: "1234.56",
      }),
      expect.objectContaining({ id: cancelled.id, status: "CANCELLED" }),
      expect.objectContaining({
        id: capex.id,
        status: "POSTED",
        vendor: "'=SUM(1,1)",
      }),
    ]),
  );
  await page
    .getByRole("button", { name: `ปิดใช้งาน ${name}`, exact: true })
    .click();
  dialog = page.getByRole("dialog", {
    name: "เปลี่ยนสถานะหมวดค่าใช้จ่าย",
    exact: true,
  });
  await dialog
    .getByRole("button", { name: "เปลี่ยนสถานะหมวดค่าใช้จ่าย", exact: true })
    .click();
  await expect(dialog).toHaveCount(0);
  await page
    .getByRole("button", { name: "เพิ่มค่าใช้จ่ายรออนุมัติ", exact: true })
    .click();
  dialog = page.getByRole("dialog", {
    name: "บันทึกค่าใช้จ่ายรออนุมัติ",
    exact: true,
  });
  await expect(
    dialog
      .getByLabel("หมวดค่าใช้จ่าย", { exact: true })
      .locator(`option[value="${c.id}"]`),
  ).toHaveCount(0);
  expect(
    (
      await db.expense.findUniqueOrThrow({ where: { id: opex.id } })
    ).amount.toFixed(2),
  ).toBe("1234.56");
});
test("expense persisted response loss survives navigation and exact replay without duplicate capture", async ({
  page,
}) => {
  const f = await fixture();
  await signIn(page.request);
  await page.goto("/expenses/");
  const bodies: string[] = [];
  await page.route(/\/api\/v1\/expenses\/?(?:\?.*)?$/, async (route) => {
    if (route.request().method() !== "POST") return route.continue();
    bodies.push(route.request().postData() ?? "");
    const response = await route.fetch();
    if (bodies.length === 1) {
      expect(response.status()).toBe(201);
      await route.abort("failed");
    } else await route.fulfill({ response });
  });
  const dialog = await capture(page, f, "5.00");
  await dialog
    .getByRole("button", { name: "บันทึกค่าใช้จ่ายรออนุมัติ", exact: true })
    .dblclick();
  await expect(
    dialog.getByRole("button", {
      name: "ลองส่งคำสั่งเดิมอีกครั้ง",
      exact: true,
    }),
  ).toBeVisible();
  await dialog
    .getByRole("button", { name: "ปิดแบบฟอร์ม", exact: true })
    .click();
  await page
    .getByRole("link", { name: "ห้องพัก", exact: true })
    .first()
    .click();
  await expect(page).toHaveURL(/\/rooms\/?$/);
  await page.goBack();
  await page
    .getByRole("button", { name: "ลองส่งคำสั่งเดิมอีกครั้ง", exact: true })
    .click();
  await expect(
    page.getByRole("dialog", { name: "รายละเอียดค่าใช้จ่าย", exact: true }),
  ).toContainText("5.00 บาท");
  expect(bodies).toHaveLength(2);
  expect(bodies[0]).toBe(bodies[1]);
  expect(await db.expense.count({ where: { propertyId: f.property.id } })).toBe(
    1,
  );
  const body = createExpenseInput.parse(JSON.parse(bodies[0]));
  expect(
    await db.expenseCommand.count({
      where: { actorId: f.admin.id, commandKey: body.commandKey },
    }),
  ).toBe(1);
});
test("expense persisted uncertain category replay remains protected after real ADMIN demotion and logout", async ({
  page,
}) => {
  const f = await fixture();
  const own = await db.user.create({
    data: {
      username: `expense-own-${key()}`,
      email: `${key()}@synthetic.invalid`,
      name: "Synthetic isolated expense admin",
      passwordHash: f.admin.passwordHash,
      role: "ADMIN",
    },
  });
  await signIn(page.request, false, own.username);
  await page.goto("/expenses/");
  let posts = 0;
  await page.route(/\/api\/v1\/expense-categories\/?$/, async (route) => {
    if (route.request().method() !== "POST") return route.continue();
    posts++;
    const response = await route.fetch();
    if (posts === 1) {
      expect(response.status()).toBe(201);
      await db.user.update({ where: { id: own.id }, data: { role: "STAFF" } });
      await route.abort("failed");
    } else await route.fulfill({ response });
  });
  await page
    .getByRole("button", { name: "สร้างหมวดค่าใช้จ่าย", exact: true })
    .click();
  const dialog = page.getByRole("dialog", {
    name: "สร้างหมวดค่าใช้จ่าย",
    exact: true,
  });
  const name = `Synthetic uncertain category ${key()}`;
  await dialog.getByLabel("ชื่อหมวด").fill(name);
  await dialog
    .getByRole("button", { name: "สร้างหมวดค่าใช้จ่าย", exact: true })
    .click();
  await dialog
    .getByRole("button", { name: "ลองส่งคำสั่งเดิมอีกครั้ง", exact: true })
    .click();
  await expect(
    dialog.getByRole("region", {
      name: "ติดตามผลคำสั่งค่าใช้จ่าย",
      exact: true,
    }),
  ).toContainText("FORBIDDEN");
  await dialog
    .getByRole("button", { name: "ปิดแบบฟอร์ม", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "เพิ่มค่าใช้จ่ายรออนุมัติ", exact: true }),
  ).toBeDisabled();
  expect(posts).toBe(2);
  expect(await db.expenseCategory.count({ where: { name } })).toBe(1);
  page.on("dialog", (popup) => popup.accept());
  await page.getByRole("button", { name: "ออกจากระบบ", exact: true }).click();
  await expect(page).toHaveURL(/\/login\//);
  await signIn(page.request, true);
  await page.goto("/expenses/");
  await expect(
    page.getByRole("region", { name: "ติดตามผลคำสั่งค่าใช้จ่าย", exact: true }),
  ).toHaveCount(0);
});
test("expense persisted full paging and CSV cover 105 filtered records in a populated database", async ({
  page,
}) => {
  const f = await fixture();
  const created: Awaited<ReturnType<typeof createExpense>>[] = [];
  for (let i = 0; i < 105; i++) {
    created.push(
      await createExpense(f.admin, {
        propertyId: f.property.id,
        categoryId: f.category.id,
        description: `Synthetic volume ${String(i).padStart(3, "0")}`,
        vendor: `Synthetic vendor ${i}`,
        amount: "0.01",
        occurredAt: "2026-10-24",
        method: "CASH",
        commandKey: key(),
      }),
    );
  }
  await postExpense(f.admin, {
    expenseId: created[0].id,
    expectedVersion: 1,
    commandKey: key(),
  });
  await signIn(page.request);
  await page.goto("/expenses/");
  await showProperty(page, f.property.id);
  await expect(
    page.getByText("1–50 จาก 105 รายการ", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "หน้าถัดไป", exact: true }).click();
  await expect(
    page.getByText("51–100 จาก 105 รายการ", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "หน้าถัดไป", exact: true }).click();
  await expect(
    page.getByText("101–105 จาก 105 รายการ", { exact: true }),
  ).toBeVisible();
  const rows = await downloadedRows(page);
  expect(rows).toHaveLength(107);
  expect(new Set(rows.slice(2).map((row) => row[8])).size).toBe(105);
  expect(rows[1][7]).toBe("0.01");
  await page.getByLabel("สถานะที่แสดง", { exact: true }).selectOption("POSTED");
  await expect(
    page.getByText("1–1 จาก 1 รายการ", { exact: true }),
  ).toBeVisible();
  expect(await downloadedRows(page)).toHaveLength(3);
});
test("expense persisted mobile keyboard, validation retention, max precision and explicit demo separation", async ({
  page,
}) => {
  const f = await fixture();
  await signIn(page.request);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/expenses/");
  await showProperty(page, f.property.id);
  let dialog = await capture(page, f, "0.001");
  await dialog
    .getByRole("button", { name: "บันทึกค่าใช้จ่ายรออนุมัติ", exact: true })
    .click();
  await expect(dialog.getByRole("alert")).toContainText("ทศนิยม");
  await expect(dialog.getByLabel("ผู้รับเงิน", { exact: true })).toHaveValue(
    "=SUM(1,1)",
  );
  await dialog
    .getByLabel("จำนวนเงิน (บาท)", { exact: true })
    .fill("999999999999.99");
  expect(
    (await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze())
      .violations,
  ).toEqual([]);
  await dialog
    .getByRole("button", { name: "บันทึกค่าใช้จ่ายรออนุมัติ", exact: true })
    .focus();
  await page.keyboard.press("Enter");
  dialog = page.getByRole("dialog", {
    name: "รายละเอียดค่าใช้จ่าย",
    exact: true,
  });
  await expect(dialog).toContainText("999,999,999,999.99 บาท");
  await page.keyboard.press("Escape");
  await page
    .getByRole("button", { name: "เปิดข้อมูลสาธิตแยกต่างหาก", exact: true })
    .click();
  await expect(
    page.getByText(
      "โหมดสาธิตแยกต่างหาก ข้อมูลและยอดเงินด้านล่างไม่บันทึกในฐานข้อมูลจริง",
      { exact: true },
    ),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "ค่าใช้จ่ายฐานข้อมูลจริง", exact: true })
    .click();
  await showProperty(page, f.property.id);
  expect(await db.expense.count({ where: { propertyId: f.property.id } })).toBe(
    1,
  );
});

test("expense persisted uncertain command stays keyboard reachable in selected detail", async ({
  page,
}) => {
  const f = await fixture();
  const existing = await createExpense(f.admin, {
    propertyId: f.property.id,
    categoryId: f.category.id,
    description: `Synthetic preexisting detail ${key()}`,
    vendor: "Synthetic existing vendor",
    amount: "1.00",
    occurredAt: "2026-10-24",
    method: "CASH",
    commandKey: key(),
  });
  await signIn(page.request);
  await page.goto("/expenses/");
  await showProperty(page, f.property.id);
  const bodies: string[] = [];
  await page.route(/\/api\/v1\/expenses\/?(?:\?.*)?$/, async (route) => {
    if (route.request().method() !== "POST") return route.continue();
    bodies.push(route.request().postData() ?? "");
    const response = await route.fetch();
    expect(response.status()).toBe(201);
    if (bodies.length === 1) await route.abort("failed");
    else await route.fulfill({ response });
  });
  const entryDialog = await capture(page, f, "8.00");
  await entryDialog
    .getByRole("button", { name: "บันทึกค่าใช้จ่ายรออนุมัติ", exact: true })
    .click();
  await expect(
    entryDialog.getByRole("button", {
      name: "ลองส่งคำสั่งเดิมอีกครั้ง",
      exact: true,
    }),
  ).toBeVisible();
  await entryDialog
    .getByRole("button", { name: "ปิดแบบฟอร์ม", exact: true })
    .click();
  await page
    .getByRole("button", {
      name: `ดูค่าใช้จ่าย ${existing.description}`,
      exact: true,
    })
    .click();
  const detailDialog = page.getByRole("dialog", {
    name: "รายละเอียดค่าใช้จ่าย",
    exact: true,
  });
  await expect(detailDialog).toContainText(existing.id);
  const recovery = detailDialog.getByRole("region", {
    name: "ติดตามผลคำสั่งค่าใช้จ่าย",
    exact: true,
  });
  await expect(recovery).toBeVisible();
  const retry = recovery.getByRole("button", {
    name: "ลองส่งคำสั่งเดิมอีกครั้ง",
    exact: true,
  });
  await retry.focus();
  await expect(retry).toBeFocused();
  const replay = page.waitForResponse(
    (response) =>
      /\/api\/v1\/expenses\/$/.test(new URL(response.url()).pathname) &&
      response.request().method() === "POST",
  );
  await page.keyboard.press("Enter");
  expect((await replay).status()).toBe(201);
  await expect(detailDialog).toContainText("8.00 บาท");
  await expect(recovery).toHaveCount(0);
  expect(bodies).toHaveLength(2);
  expect(bodies[0]).toBe(bodies[1]);
  const body = createExpenseInput.parse(JSON.parse(bodies[0]));
  expect(await db.expense.count({ where: { propertyId: f.property.id } })).toBe(
    2,
  );
  expect(
    await db.expenseCommand.count({
      where: { actorId: f.admin.id, commandKey: body.commandKey },
    }),
  ).toBe(1);
});

test("expense persisted delayed filter and detail reads never overwrite a newer selection", async ({
  page,
}) => {
  const a = await fixture(),
    b = await fixture();
  async function prepared(
    f: Awaited<ReturnType<typeof fixture>>,
    description: string,
  ) {
    return createExpense(f.admin, {
      propertyId: f.property.id,
      categoryId: f.category.id,
      description,
      vendor: "Synthetic delayed-read vendor",
      amount: "0.10",
      occurredAt: "2026-10-24",
      method: "CASH",
      commandKey: key(),
    });
  }
  const firstA = await prepared(a, `Synthetic delayed A ${key()}`);
  const firstB = await prepared(b, `Synthetic delayed B1 ${key()}`);
  const secondB = await prepared(b, `Synthetic delayed B2 ${key()}`);
  let startList = () => {},
    releaseList = () => {},
    finishList = () => {};
  const listStarted = new Promise<void>((resolve) => {
    startList = resolve;
  });
  const listHeld = new Promise<void>((resolve) => {
    releaseList = resolve;
  });
  const listFinished = new Promise<void>((resolve) => {
    finishList = resolve;
  });
  await page.route(/\/api\/v1\/expenses\/?(?:\?.*)?$/, async (route) => {
    if (
      route.request().method() !== "GET" ||
      new URL(route.request().url()).searchParams.get("propertyId") !==
        a.property.id
    )
      return route.continue();
    const response = await route.fetch();
    startList();
    await listHeld;
    try {
      await route.fulfill({ response });
    } catch {
      /* The obsolete read may already be aborted by the client. */
    } finally {
      finishList();
    }
  });
  await signIn(page.request);
  await page.goto("/expenses/");
  await page
    .getByLabel("อาคารที่แสดง", { exact: true })
    .selectOption(a.property.id);
  await listStarted;
  try {
    await showProperty(page, b.property.id);
    await expect(
      page.getByRole("button", {
        name: `ดูค่าใช้จ่าย ${firstB.description}`,
        exact: true,
      }),
    ).toBeVisible();
  } finally {
    releaseList();
  }
  await listFinished;
  await expect(
    page.getByRole("button", {
      name: `ดูค่าใช้จ่าย ${firstA.description}`,
      exact: true,
    }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", {
      name: `ดูค่าใช้จ่าย ${firstB.description}`,
      exact: true,
    }),
  ).toBeVisible();
  let startDetail = () => {},
    releaseDetail = () => {},
    finishDetail = () => {};
  const detailStarted = new Promise<void>((resolve) => {
    startDetail = resolve;
  });
  const detailHeld = new Promise<void>((resolve) => {
    releaseDetail = resolve;
  });
  const detailFinished = new Promise<void>((resolve) => {
    finishDetail = resolve;
  });
  await page.route(
    new RegExp(`/api/v1/expenses/${firstB.id}/?$`),
    async (route) => {
      const response = await route.fetch();
      startDetail();
      await detailHeld;
      try {
        await route.fulfill({ response });
      } catch {
        /* The obsolete read may already be aborted by the client. */
      } finally {
        finishDetail();
      }
    },
  );
  await page
    .getByRole("button", {
      name: `ดูค่าใช้จ่าย ${firstB.description}`,
      exact: true,
    })
    .click();
  await detailStarted;
  try {
    await closeDetail(page);
    await page
      .getByRole("button", {
        name: `ดูค่าใช้จ่าย ${secondB.description}`,
        exact: true,
      })
      .click();
    await expect(
      page.getByRole("dialog", { name: "รายละเอียดค่าใช้จ่าย", exact: true }),
    ).toContainText(secondB.id);
  } finally {
    releaseDetail();
  }
  await detailFinished;
  const detail = page.getByRole("dialog", {
    name: "รายละเอียดค่าใช้จ่าย",
    exact: true,
  });
  await expect(detail).toContainText(secondB.id);
  await expect(detail).not.toContainText(firstB.id);
});
