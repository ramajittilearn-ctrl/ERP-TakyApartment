import { randomUUID } from "node:crypto";
import AxeBuilder from "@axe-core/playwright";
import { z } from "zod";
import {
  test,
  expect,
  type Page,
  type APIRequestContext,
} from "./guarded-test";
import { browserTestTarget } from "../../src/server/browser-test-target";
import { db } from "../../src/server/db";
import {
  createBillingPeriod,
  createUtilityRate,
  closeBillingPeriod,
} from "../../src/server/finance";
import {
  approveBillingRate,
  approveBillingConsumption,
} from "../../src/server/billing";
import {
  configureDuePolicy,
  prepareDraft,
  issueInvoice,
  voidInvoice,
} from "../../src/server/invoices";
import { createPayment, confirmPayment } from "../../src/server/payments";
import { paymentDtoSchema } from "../../src/server/payments/contracts";
import { balancePageSchema } from "../../src/features/payments/client";

const key = () => randomUUID();
const origin = () => browserTestTarget().origin;
async function signIn(request: APIRequestContext, staff = false) {
  const response = await request.post("/api/auth/login/", {
    headers: { Origin: origin() },
    data: {
      identifier: staff ? "test-staff" : "test-admin",
      password: staff
        ? process.env.TEST_STAFF_PASSWORD
        : process.env.TEST_ADMIN_PASSWORD,
    },
  });
  expect(response.status()).toBe(200);
}
async function fixture(months = 2, rent = "1000.00") {
  const target = browserTestTarget();
  const identity = await db.$queryRaw<
    { name: string; role: string }[]
  >`SELECT current_database() AS name, current_user AS role`;
  expect(identity).toEqual([{ name: target.database, role: target.role }]);
  const admin = await db.user.findUniqueOrThrow({
    where: { username: "test-admin" },
  });
  const suffix = key();
  const property = await db.property.create({
    data: {
      code: `PAY-${suffix}`,
      name: `Synthetic Payments ${suffix}`,
      address: "Synthetic test address",
    },
  });
  const floor = await db.floor.create({
    data: { propertyId: property.id, number: 1, name: "Synthetic" },
  });
  const room = await db.room.create({
    data: { floorId: floor.id, number: "P101", rent },
  });
  const tenant = await db.tenant.create({
    data: { name: `Synthetic payment tenant ${suffix}`, isDemo: false },
  });
  const lease = await db.lease.create({
    data: {
      number: `PAY-${suffix}`,
      roomId: room.id,
      tenantId: tenant.id,
      startDate: new Date("2026-01-01"),
      endDate: new Date("2038-12-31"),
      rent,
      deposit: "0",
      status: "ACTIVE",
      isDemo: false,
    },
  });
  const rates = [];
  for (const kind of ["WATER", "ELECTRICITY"] as const)
    rates.push(
      await createUtilityRate(admin, {
        propertyId: property.id,
        kind,
        effectiveFrom: "2026-01-01",
        unitPrice: "0.0000",
      }),
    );
  await configureDuePolicy(admin, {
    propertyId: property.id,
    offsetDays: 5,
    expectedVersion: 0,
    commandKey: key(),
  });
  const invoices = [];
  for (let index = 0; index < months; index++) {
    const month = `${2026 + Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, "0")}`;
    const period = await createBillingPeriod(admin, {
      propertyId: property.id,
      month,
    });
    for (const rate of rates) {
      await approveBillingRate(admin, {
        billingPeriodId: period.id,
        kind: rate.kind,
        utilityRateId: rate.id,
        reason: "Synthetic payment browser fixture",
      });
      await approveBillingConsumption(admin, {
        billingPeriodId: period.id,
        leaseId: lease.id,
        kind: rate.kind,
        reason: "Synthetic estimate",
        evidence: ["Synthetic browser fixture"],
        source: {
          kind: "ESTIMATE",
          quantity: "0.000",
          sourceContext: "Isolated synthetic browser UAT",
        },
      });
    }
    await closeBillingPeriod(admin, period.id);
    const draft = await prepareDraft(admin, {
      billingPeriodId: period.id,
      leaseId: lease.id,
      commandKey: key(),
    });
    invoices.push(
      await issueInvoice(admin, {
        invoiceId: draft.id,
        expectedVersion: draft.version,
        commandKey: key(),
      }),
    );
  }
  return { admin, lease, invoices, tenant };
}
async function apiPayment(request: APIRequestContext, id: string) {
  const response = await request.get(`/api/v1/payments/${id}`);
  expect(response.status()).toBe(200);
  return z.object({ data: paymentDtoSchema }).parse(await response.json()).data;
}
async function entry(
  page: Page,
  leaseId: string,
  amount: string,
  bank = false,
) {
  await page
    .getByRole("button", { name: "บันทึกรับชำระ", exact: true })
    .click();
  const dialog = page.getByRole("dialog");
  await dialog
    .getByLabel("สัญญาเช่า (ข้อมูลปัจจุบัน)", { exact: true })
    .selectOption(leaseId);
  await dialog.getByLabel("ยอดรับชำระ (บาท)", { exact: true }).fill(amount);
  await dialog
    .getByLabel("วันเวลารับชำระ (กรุงเทพฯ UTC+07:00)")
    .fill("2026-10-23T10:15");
  if (bank) {
    await dialog.getByLabel("วิธีรับชำระ").selectOption("BANK_TRANSFER");
    await dialog
      .getByLabel("เลขอ้างอิงธนาคาร", { exact: true })
      .fill(`SYNTHETIC-${key()}`);
    await dialog
      .getByLabel("รหัสบัญชีรับเงิน", { exact: true })
      .fill("synthetic-account");
  }
  return dialog;
}
async function createInUi(
  page: Page,
  leaseId: string,
  amount: string,
  bank = false,
) {
  const dialog = await entry(page, leaseId, amount, bank);
  await dialog.getByRole("button", { name: "ตรวจสอบก่อนบันทึก" }).click();
  const result = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname.replace(/\/$/, "") ===
        "/api/v1/payments" && response.request().method() === "POST",
  );
  await dialog.getByRole("button", { name: "ยืนยันบันทึกรอตรวจสอบ" }).click();
  const response = await result;
  expect(response.status()).toBe(201);
  const payment = z
    .object({ data: paymentDtoSchema })
    .parse(await response.json()).data;
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(
    page.getByRole("heading", { name: `${payment.reference} · รอตรวจสอบ` }),
  ).toBeVisible();
  return payment;
}
async function allocations(
  page: Page,
  values: { number: string | null; amount: string }[],
) {
  await page
    .getByRole("button", { name: "ตรวจสอบและยืนยัน", exact: true })
    .click();
  const dialog = page.getByRole("dialog");
  for (const value of values) {
    if (!value.number) throw new Error("Issued invoice number required");
    await dialog
      .getByRole("checkbox", { name: `จัดสรรให้ ${value.number}`, exact: true })
      .check();
    const input = dialog.getByLabel(`ยอดจัดสรร ${value.number} (บาท)`, {
      exact: true,
    });
    await expect(input).toBeEnabled();
    await input.fill(value.amount);
  }
  return dialog;
}
async function confirmInUi(
  page: Page,
  values: { number: string | null; amount: string }[],
) {
  const dialog = await allocations(page, values);
  await dialog.getByRole("button", { name: "ตรวจสอบก่อนบันทึก" }).click();
  const response = page.waitForResponse((value) =>
    /\/payments\/[^/]+\/confirm\/?$/.test(new URL(value.url()).pathname),
  );
  await dialog
    .getByRole("button", { name: "ยืนยันและออกใบเสร็จ", exact: true })
    .click();
  expect((await response).status()).toBe(200);
  await expect(dialog).toHaveCount(0);
  await expect(
    page.getByRole("region", { name: "ข้อมูลใบเสร็จรับเงิน" }),
  ).toBeVisible();
}
async function sourcePayment(
  f: Awaited<ReturnType<typeof fixture>>,
  amount = "10.00",
  cash = false,
) {
  return createPayment(f.admin, {
    leaseId: f.lease.id,
    amount,
    method: cash ? "CASH" : "BANK_TRANSFER",
    receivedAt: "2026-10-23T10:15:00+07:00",
    commandKey: key(),
    ...(!cash
      ? { receivingAccountKey: "synthetic-bank", externalReference: key() }
      : {}),
  });
}

test.afterAll(() => db.$disconnect());

test("payment persisted STAFF pending capture, Bangkok date, roles and reload", async ({
  page,
}) => {
  const browserErrors: string[] = [];
  page.on("pageerror", (error) => browserErrors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") browserErrors.push(message.text());
  });
  const f = await fixture(0);
  await signIn(page.request, true);
  await page.goto("/payments/");
  const payment = await createInUi(page, f.lease.id, "125.10", true);
  expect(payment.receivedAt).toBe("2026-10-23T03:15:00.000Z");
  expect(payment.receipt).toBeNull();
  expect(payment.status).toBe("PENDING");
  await expect(
    page.getByRole("button", { name: "ตรวจสอบและยืนยัน" }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "ยกเลิกรายการรอตรวจสอบ" }),
  ).toHaveCount(0);
  await expect(page.getByRole("button", { name: /พิมพ์|CSV/ })).toHaveCount(0);
  await expect(
    page.getByText("หน้านี้ยังไม่เชื่อมต่อฐานข้อมูล", { exact: false }),
  ).toHaveCount(0);
  await page.reload();
  await expect(
    page.getByRole("button", {
      name: `ดูรายการ ${payment.reference}`,
      exact: true,
    }),
  ).toBeVisible();
  expect(await db.payment.count({ where: { leaseId: f.lease.id } })).toBe(1);
  await page
    .getByRole("button", { name: "เกี่ยวกับการบันทึกข้อมูล", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toContainText("ฐานข้อมูลจริง");
  expect(browserErrors).toEqual([]);
});

test("payment persisted ADMIN exact multi-invoice allocations, immutable receipt, reversal and pending cancellation", async ({
  page,
}) => {
  const f = await fixture(2, "0.20");
  await signIn(page.request);
  await page.goto("/payments/");
  const payment = await createInUi(page, f.lease.id, "0.30");
  await confirmInUi(page, [
    { number: f.invoices[0].number, amount: "0.10" },
    { number: f.invoices[1].number, amount: "0.20" },
  ]);
  const confirmed = await apiPayment(page.request, payment.id);
  expect(confirmed.status).toBe("CONFIRMED");
  if (!confirmed.receipt) throw new Error("Missing receipt");
  const before = await db.receipt.findUniqueOrThrow({
    where: { id: confirmed.receipt.id },
  });
  await db.tenant.update({
    where: { id: f.tenant.id },
    data: { name: "Synthetic changed current name" },
  });
  await page.getByRole("button", { name: "อ่านข้อมูลล่าสุด" }).click();
  await expect(
    page.getByRole("region", { name: "ข้อมูลใบเสร็จรับเงิน" }),
  ).toContainText(f.tenant.name);
  await page
    .getByRole("button", { name: "กลับรายการทั้งหมด", exact: true })
    .click();
  let dialog = page.getByRole("dialog");
  await dialog
    .getByLabel("เหตุผล", { exact: true })
    .fill("Synthetic owner review reversal");
  await dialog.getByRole("button", { name: "ตรวจสอบก่อนบันทึก" }).click();
  await dialog
    .getByRole("button", { name: "กลับรายการและยกเลิกใบเสร็จ", exact: true })
    .click();
  await expect(dialog).toHaveCount(0);
  await expect(
    page.getByText("ใบเสร็จถูกยกเลิก", { exact: true }),
  ).toBeVisible();
  const after = await db.receipt.findUniqueOrThrow({
    where: { id: before.id },
    include: { cancellation: true },
  });
  expect(after.snapshot).toEqual(before.snapshot);
  expect(after.number).toBe(before.number);
  expect(after.cancellation).not.toBeNull();
  const response = await page.request.get(
    `/api/v1/outstanding-balances?leaseId=${f.lease.id}`,
  );
  const balances = z
    .object({ data: balancePageSchema })
    .parse(await response.json()).data.items;
  expect(balances.map((item) => item.outstanding)).toEqual(["0.20", "0.20"]);
  const pending = await createInUi(page, f.lease.id, "0.01");
  await page
    .getByRole("button", { name: "ยกเลิกรายการรอตรวจสอบ", exact: true })
    .click();
  dialog = page.getByRole("dialog");
  await dialog
    .getByLabel("เหตุผล", { exact: true })
    .fill("Synthetic cancelled pending");
  await dialog.getByRole("button", { name: "ตรวจสอบก่อนบันทึก" }).click();
  await dialog
    .getByRole("button", { name: "ยกเลิกรายการรอตรวจสอบ", exact: true })
    .click();
  await expect(dialog).toHaveCount(0);
  expect((await apiPayment(page.request, pending.id)).status).toBe("CANCELLED");
});

test("payment persisted lost create response survives Next navigation and exact replay", async ({
  page,
}) => {
  const f = await fixture(0);
  await signIn(page.request);
  await page.goto("/payments/");
  const bodies: string[] = [];
  let dropped = false;
  await page.route(/\/api\/v1\/payments\/?(?:\?.*)?$/, async (route) => {
    if (route.request().method() !== "POST") return route.continue();
    bodies.push(route.request().postData() || "");
    const response = await route.fetch();
    if (!dropped) {
      dropped = true;
      await route.abort("failed");
    } else await route.fulfill({ response });
  });
  const dialog = await entry(page, f.lease.id, "5.00");
  await dialog.getByRole("button", { name: "ตรวจสอบก่อนบันทึก" }).click();
  await dialog.getByRole("button", { name: "ยืนยันบันทึกรอตรวจสอบ" }).click();
  await expect(
    dialog.getByRole("button", {
      name: "ลองส่งคำสั่งเดิมอีกครั้ง",
      exact: true,
    }),
  ).toBeVisible();
  await dialog.getByRole("button", { name: "ปิด", exact: true }).click();
  await page
    .getByRole("link", { name: "ห้องพัก", exact: true })
    .first()
    .click();
  await expect(page).toHaveURL(/\/rooms\/?$/);
  await page.goBack();
  await expect(
    page.getByRole("button", { name: "ลองส่งคำสั่งเดิมอีกครั้ง", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "ลองส่งคำสั่งเดิมอีกครั้ง", exact: true })
    .click();
  await expect(
    page.getByRole("status").filter({ hasText: "บันทึกผลแล้ว" }),
  ).toBeVisible();
  expect(bodies).toHaveLength(2);
  expect(bodies[0]).toBe(bodies[1]);
  expect(await db.payment.count({ where: { leaseId: f.lease.id } })).toBe(1);
  expect(
    await db.paymentCommand.count({
      where: { commandKey: JSON.parse(bodies[0]).commandKey },
    }),
  ).toBe(1);
});

test("payment persisted cash duplicate review, explicit override and stale invoice rejection", async ({
  page,
}) => {
  const f = await fixture(1);
  const first = await sourcePayment(f, "10.00", true);
  await confirmPayment(f.admin, {
    paymentId: first.id,
    expectedVersion: first.version,
    allocations: [
      {
        invoiceId: f.invoices[0].id,
        expectedVersion: f.invoices[0].version,
        amount: "10.00",
      },
    ],
    commandKey: key(),
  });
  await signIn(page.request);
  await page.goto("/payments/");
  const second = await createInUi(page, f.lease.id, "10.00");
  let dialog = await allocations(page, [
    { number: f.invoices[0].number, amount: "10.00" },
  ]);
  await dialog.getByRole("button", { name: "ตรวจสอบก่อนบันทึก" }).click();
  await dialog
    .getByRole("button", { name: "ยืนยันและออกใบเสร็จ", exact: true })
    .click();
  await expect(dialog.getByLabel("เหตุผลอนุมัติเงินสดที่อาจซ้ำ")).toBeVisible();
  await dialog
    .getByLabel("เหตุผลอนุมัติเงินสดที่อาจซ้ำ")
    .fill("Synthetic separate cash delivery reviewed");
  await dialog.getByRole("button", { name: "ตรวจสอบก่อนบันทึก" }).click();
  await dialog
    .getByRole("button", { name: "ยืนยันและออกใบเสร็จ", exact: true })
    .click();
  await expect(dialog).toHaveCount(0);
  expect((await apiPayment(page.request, second.id)).status).toBe("CONFIRMED");
  expect(
    await db.auditLog.count({
      where: { entityId: second.id, action: "CASH_DUPLICATE_OVERRIDE" },
    }),
  ).toBe(1);
  const other = await fixture(1);
  await page.reload();
  const pending = await createInUi(page, other.lease.id, "1.00");
  dialog = await allocations(page, [
    { number: other.invoices[0].number, amount: "1.00" },
  ]);
  await dialog.getByRole("button", { name: "ตรวจสอบก่อนบันทึก" }).click();
  await voidInvoice(other.admin, {
    invoiceId: other.invoices[0].id,
    expectedVersion: other.invoices[0].version,
    reason: "Synthetic concurrent void",
    commandKey: key(),
  });
  await dialog
    .getByRole("button", { name: "ยืนยันและออกใบเสร็จ", exact: true })
    .click();
  await expect(dialog.getByRole("alert")).toContainText("INVOICE_NOT_PAYABLE");
  await expect(
    dialog.getByRole("button", { name: "ยืนยันและออกใบเสร็จ", exact: true }),
  ).toBeDisabled();
  expect((await apiPayment(page.request, pending.id)).status).toBe("PENDING");
});

test("payment persisted invalid precision, maximum amount, keyboard and narrow accessibility", async ({
  page,
}) => {
  const f = await fixture(0);
  await signIn(page.request);
  await page.goto("/payments/");
  const dialog = await entry(page, f.lease.id, "0.001");
  await dialog.getByRole("button", { name: "ตรวจสอบก่อนบันทึก" }).click();
  await expect(dialog.getByRole("alert")).toContainText("ทศนิยมไม่เกิน 2");
  await dialog
    .getByLabel("ยอดรับชำระ (บาท)", { exact: true })
    .fill("999999999999.99");
  await dialog.getByRole("button", { name: "ตรวจสอบก่อนบันทึก" }).click();
  await expect(dialog).toContainText("999,999,999,999.99 บาท");
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "บันทึกรับชำระ", exact: true }),
  ).toBeFocused();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.keyboard.press("Enter");
  await expect(page.getByRole("dialog")).toBeVisible();
  expect(
    (await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze())
      .violations,
  ).toEqual([]);
  expect(await db.payment.count({ where: { leaseId: f.lease.id } })).toBe(0);
});

test("payment persisted uncertain retry403 stays protected and logout never resurrects its command", async ({
  page,
}) => {
  const f = await fixture(0);
  await signIn(page.request);
  await page.goto("/payments/");
  let posts = 0;
  await page.route(/\/api\/v1\/payments\/?(?:\?.*)?$/, async (route) => {
    if (route.request().method() !== "POST") return route.continue();
    posts++;
    if (posts === 1) {
      await route.fetch();
      await route.abort("failed");
    } else
      await route.fulfill({
        status: 403,
        contentType: "application/json",
        body: JSON.stringify({
          error: {
            code: "FORBIDDEN",
            message: "Synthetic changed authorization on retry",
          },
        }),
      });
  });
  const dialog = await entry(page, f.lease.id, "7.00");
  await dialog.getByRole("button", { name: "ตรวจสอบก่อนบันทึก" }).click();
  await dialog.getByRole("button", { name: "ยืนยันบันทึกรอตรวจสอบ" }).click();
  await expect(
    dialog.getByRole("button", { name: "ลองส่งคำสั่งเดิมอีกครั้ง" }),
  ).toBeVisible();
  await dialog
    .getByRole("button", { name: "ลองส่งคำสั่งเดิมอีกครั้ง" })
    .click();
  await expect(
    dialog.getByRole("region", { name: "ติดตามผลคำสั่งรับชำระ" }),
  ).toContainText("FORBIDDEN");
  await dialog.getByRole("button", { name: "ปิด", exact: true }).click();
  await expect(
    page.getByRole("region", { name: "ติดตามผลคำสั่งรับชำระ" }),
  ).toContainText("FORBIDDEN");
  await expect(
    page.getByRole("button", { name: "บันทึกรับชำระ", exact: true }),
  ).toBeDisabled();
  expect(posts).toBe(2);
  expect(await db.payment.count({ where: { leaseId: f.lease.id } })).toBe(1);
  page.on("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "ออกจากระบบ", exact: true }).click();
  await expect(page).toHaveURL(/\/login\//);
  await signIn(page.request, true);
  await page.goto("/payments/");
  await expect(
    page.getByRole("region", { name: "ติดตามผลคำสั่งรับชำระ" }),
  ).toHaveCount(0);
  await page.goBack();
  await page.goForward();
  await expect(
    page.getByRole("region", { name: "ติดตามผลคำสั่งรับชำระ" }),
  ).toHaveCount(0);
});

test("payment persisted lost confirmation replay remains uncertain after real ADMIN demotion", async ({
  page,
}) => {
  const f = await fixture(1);
  await signIn(page.request);
  await page.goto("/payments/");
  const payment = await createInUi(page, f.lease.id, "11.00", true);
  const bodies: string[] = [];
  let dropped = false;
  await page.route(/\/api\/v1\/payments\/[^/]+\/confirm\/?$/, async (route) => {
    bodies.push(route.request().postData() || "");
    const response = await route.fetch();
    if (!dropped) {
      dropped = true;
      await route.abort("failed");
    } else await route.fulfill({ response });
  });
  const dialog = await allocations(page, [
    { number: f.invoices[0].number, amount: "11.00" },
  ]);
  await dialog.getByRole("button", { name: "ตรวจสอบก่อนบันทึก" }).click();
  await dialog
    .getByRole("button", { name: "ยืนยันและออกใบเสร็จ", exact: true })
    .click();
  await expect(
    dialog.getByRole("button", {
      name: "ลองส่งคำสั่งเดิมอีกครั้ง",
      exact: true,
    }),
  ).toBeVisible();
  await dialog.getByRole("button", { name: "ปิด", exact: true }).click();
  try {
    await db.user.update({
      where: { id: f.admin.id },
      data: { role: "STAFF" },
    });
    await page
      .getByRole("button", { name: "ลองส่งคำสั่งเดิมอีกครั้ง", exact: true })
      .click();
    await expect(
      page.getByRole("region", { name: "ติดตามผลคำสั่งรับชำระ" }),
    ).toContainText("FORBIDDEN");
    await expect(
      page.getByRole("button", { name: "บันทึกรับชำระ", exact: true }),
    ).toBeDisabled();
    expect(await db.receipt.count({ where: { paymentId: payment.id } })).toBe(
      1,
    );
  } finally {
    await db.user.update({
      where: { id: f.admin.id },
      data: { role: "ADMIN" },
    });
  }
  await page
    .getByRole("button", { name: "ลองส่งคำสั่งเดิมอีกครั้ง", exact: true })
    .click();
  await expect(
    page.getByRole("region", { name: "ข้อมูลใบเสร็จรับเงิน" }),
  ).toBeVisible();
  expect(bodies).toHaveLength(3);
  expect(new Set(bodies).size).toBe(1);
  expect(await db.receipt.count({ where: { paymentId: payment.id } })).toBe(1);
});

test("payment persisted all-history allocations load the second balance page", async ({
  page,
}) => {
  test.slow();
  const f = await fixture(101, "1.00");
  const payment = await sourcePayment(f, "0.01");
  await signIn(page.request);
  await page.goto("/payments/");
  await page
    .getByRole("button", { name: `ดูรายการ ${payment.reference}`, exact: true })
    .click();
  await page
    .getByRole("button", { name: "ตรวจสอบและยืนยัน", exact: true })
    .click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("checkbox")).toHaveCount(101);
  await expect(
    dialog.getByRole("checkbox", {
      name: `จัดสรรให้ ${f.invoices[100].number}`,
      exact: true,
    }),
  ).toBeVisible();
  await dialog.getByRole("button", { name: "ปิด", exact: true }).click();
  expect((await apiPayment(page.request, payment.id)).status).toBe("PENDING");
});

test("payment persisted malformed list and receipt mismatch remain failures, stale detail never overwrites selection", async ({
  page,
}) => {
  const f = await fixture(1);
  const first = await sourcePayment(f, "1.00");
  const second = await sourcePayment(f, "2.00");
  await signIn(page.request);
  const malformed = /\/api\/v1\/payments\/\?.*/;
  await page.route(malformed, (route) =>
    route.fulfill({
      status: 200,
      contentType: "text/html",
      body: "<html>synthetic malformed response</html>",
    }),
  );
  await page.goto("/payments/");
  await expect(
    page.getByRole("alert").filter({ hasText: "ระบบตอบกลับไม่สมบูรณ์" }),
  ).toBeVisible();
  await expect(
    page.getByText("ไม่มีรายการรับชำระในหน้านี้", { exact: true }),
  ).toHaveCount(0);
  await page.unroute(malformed);
  await page
    .getByRole("button", { name: "อ่านข้อมูลล่าสุด", exact: true })
    .click();
  let release: () => void = () => {
    throw new Error("delay not started");
  };
  const delayed = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route(
    new RegExp(`/api/v1/payments/${first.id}/?$`),
    async (route) => {
      const response = await route.fetch();
      await delayed;
      await route.fulfill({ response }).catch(() => {});
    },
  );
  await page
    .getByRole("button", { name: `ดูรายการ ${first.reference}`, exact: true })
    .click();
  await page
    .getByRole("button", { name: `ดูรายการ ${second.reference}`, exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: `${second.reference} · รอตรวจสอบ` }),
  ).toBeVisible();
  release();
  await expect(
    page.getByRole("heading", { name: `${first.reference} · รอตรวจสอบ` }),
  ).toHaveCount(0);
  const confirmed = await confirmPayment(f.admin, {
    paymentId: second.id,
    expectedVersion: second.version,
    allocations: [
      {
        invoiceId: f.invoices[0].id,
        expectedVersion: f.invoices[0].version,
        amount: second.amount,
      },
    ],
    commandKey: key(),
  });
  if (!confirmed.receipt) throw new Error("Receipt required");
  await page.route(
    new RegExp(`/api/v1/receipts/${confirmed.receipt.id}/?$`),
    (route) =>
      route.fulfill({
        status: 409,
        contentType: "application/json",
        body: JSON.stringify({
          error: {
            code: "RECEIPT_SNAPSHOT_MISMATCH",
            message: "Synthetic integrity check failed",
          },
        }),
      }),
  );
  await page
    .getByRole("button", { name: "อ่านข้อมูลล่าสุด", exact: true })
    .click();
  await expect(
    page
      .getByRole("alert")
      .filter({ hasText: "Synthetic integrity check failed" }),
  ).toBeVisible();
  await expect(
    page.getByRole("region", { name: "ข้อมูลใบเสร็จรับเงิน" }),
  ).toHaveCount(0);
});

test("payment persisted bank duplicate has no override and failed allocation paging cannot confirm", async ({
  page,
}) => {
  const f = await fixture(1);
  const original = await sourcePayment(f, "9.00");
  await signIn(page.request);
  await page.goto("/payments/");
  let dialog = await entry(page, f.lease.id, "9.00", true);
  if (!original.externalReference || !original.receivingAccountKey)
    throw new Error("Bank identity required");
  await dialog
    .getByLabel("เลขอ้างอิงธนาคาร", { exact: true })
    .fill(original.externalReference);
  await dialog
    .getByLabel("รหัสบัญชีรับเงิน", { exact: true })
    .fill(original.receivingAccountKey);
  await dialog.getByRole("button", { name: "ตรวจสอบก่อนบันทึก" }).click();
  await dialog.getByRole("button", { name: "ยืนยันบันทึกรอตรวจสอบ" }).click();
  await expect(dialog.getByRole("alert")).toContainText(
    "DUPLICATE_PAYMENT_REFERENCE",
  );
  await expect(dialog.getByLabel("เหตุผลอนุมัติเงินสดที่อาจซ้ำ")).toHaveCount(
    0,
  );
  await dialog.getByRole("button", { name: "ปิด", exact: true }).click();
  await page
    .getByRole("button", {
      name: `ดูรายการ ${original.reference}`,
      exact: true,
    })
    .click();
  await expect(
    page.getByRole("heading", { name: `${original.reference} · รอตรวจสอบ` }),
  ).toBeVisible();
  await page.route(/\/api\/v1\/outstanding-balances\/\?.*/, (route) =>
    route.fulfill({
      status: 503,
      contentType: "application/json",
      body: JSON.stringify({
        error: {
          code: "INTERNAL",
          message: "Synthetic allocation source unavailable",
        },
      }),
    }),
  );
  await page
    .getByRole("button", { name: "ตรวจสอบและยืนยัน", exact: true })
    .click();
  dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("alert")).toContainText(
    "Synthetic allocation source unavailable",
  );
  await expect(
    dialog.getByRole("button", { name: "ตรวจสอบก่อนบันทึก" }),
  ).toBeDisabled();
  expect(await db.payment.count({ where: { leaseId: f.lease.id } })).toBe(1);
});

test("payment persisted genuine doubleclick settles original POST while the view is unmounted", async ({
  page,
}) => {
  const f = await fixture(0);
  await signIn(page.request);
  await page.goto("/payments/");
  let release: () => void = () => {
    throw new Error("POST not captured");
  };
  let captured = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const arrived = new Promise<void>((resolve) => {
    captured = resolve;
  });
  const bodies: string[] = [];
  await page.route(/\/api\/v1\/payments\/?(?:\?.*)?$/, async (route) => {
    if (route.request().method() !== "POST") return route.continue();
    bodies.push(route.request().postData() || "");
    captured();
    await gate;
    const response = await route.fetch();
    await route.fulfill({ response });
  });
  const dialog = await entry(page, f.lease.id, "8.00");
  await dialog.getByRole("button", { name: "ตรวจสอบก่อนบันทึก" }).click();
  await dialog
    .getByRole("button", { name: "ยืนยันบันทึกรอตรวจสอบ", exact: true })
    .dblclick();
  await arrived;
  await dialog.getByRole("button", { name: "ปิด", exact: true }).click();
  await page
    .getByRole("link", { name: "ห้องพัก", exact: true })
    .first()
    .click();
  await expect(page).toHaveURL(/\/rooms\/?$/);
  expect(await db.payment.count({ where: { leaseId: f.lease.id } })).toBe(0);
  release();
  await expect
    .poll(() => db.payment.count({ where: { leaseId: f.lease.id } }))
    .toBe(1);
  await expect
    .poll(() =>
      db.paymentCommand.count({
        where: { commandKey: JSON.parse(bodies[0]).commandKey },
      }),
    )
    .toBe(1);
  await page.goBack();
  await expect(
    page.getByRole("heading", { name: /PAY-.*รอตรวจสอบ/ }),
  ).toBeVisible();
  expect(bodies).toHaveLength(1);
  await expect(
    page.getByRole("button", { name: "ลองส่งคำสั่งเดิมอีกครั้ง", exact: true }),
  ).toHaveCount(0);
});

test("payment persisted two ADMIN browser sessions race explicit allocations without overpayment", async ({
  page,
  browser,
}) => {
  const f = await fixture(1, "1.00");
  const first = await sourcePayment(f, "0.80");
  const second = await sourcePayment(f, "0.80");
  await signIn(page.request);
  await page.goto("/payments/");
  const other = await browser.newContext({
    baseURL: origin(),
    proxy: { server: "http://127.0.0.1:3822" },
    serviceWorkers: "block",
    locale: "th-TH",
    timezoneId: "Asia/Bangkok",
  });
  try {
    const secondPage = await other.newPage();
    await signIn(secondPage.request);
    await secondPage.goto(`${origin()}/payments/`);
    await page
      .getByRole("button", { name: `ดูรายการ ${first.reference}`, exact: true })
      .click();
    await secondPage
      .getByRole("button", {
        name: `ดูรายการ ${second.reference}`,
        exact: true,
      })
      .click();
    const one = await allocations(page, [
      { number: f.invoices[0].number, amount: "0.80" },
    ]);
    const two = await allocations(secondPage, [
      { number: f.invoices[0].number, amount: "0.80" },
    ]);
    await one.getByRole("button", { name: "ตรวจสอบก่อนบันทึก" }).click();
    await two.getByRole("button", { name: "ตรวจสอบก่อนบันทึก" }).click();
    let release: () => void = () => {
      throw new Error("barrier not ready");
    };
    let both = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const arrived = new Promise<void>((resolve) => {
      both = resolve;
    });
    let contenders = 0;
    for (const current of [page, secondPage])
      await current.route(
        /\/api\/v1\/payments\/[^/]+\/confirm\/?$/,
        async (route) => {
          contenders++;
          if (contenders === 2) both();
          await gate;
          await route.continue();
        },
      );
    const responseOne = page.waitForResponse((response) =>
      /\/payments\/[^/]+\/confirm\/?$/.test(new URL(response.url()).pathname),
    );
    const responseTwo = secondPage.waitForResponse((response) =>
      /\/payments\/[^/]+\/confirm\/?$/.test(new URL(response.url()).pathname),
    );
    await Promise.all([
      one
        .getByRole("button", { name: "ยืนยันและออกใบเสร็จ", exact: true })
        .click(),
      two
        .getByRole("button", { name: "ยืนยันและออกใบเสร็จ", exact: true })
        .click(),
    ]);
    await arrived;
    release();
    const responses = await Promise.all([responseOne, responseTwo]);
    expect(responses.map((response) => response.status()).sort()).toEqual([
      200, 409,
    ]);
    const losingPage = responses[0].status() === 409 ? page : secondPage;
    const losingDialog = losingPage.getByRole("dialog");
    await expect(losingDialog.getByRole("alert")).toContainText(
      /ALLOCATION_EXCEEDS_BALANCE|STALE_VERSION/,
    );
    await expect(
      losingDialog.getByRole("button", {
        name: "ยืนยันและออกใบเสร็จ",
        exact: true,
      }),
    ).toBeDisabled();
    expect(
      await db.payment.count({
        where: { leaseId: f.lease.id, status: "CONFIRMED" },
      }),
    ).toBe(1);
    expect(
      await db.receipt.count({ where: { payment: { leaseId: f.lease.id } } }),
    ).toBe(1);
    const response = await page.request.get(
      `/api/v1/outstanding-balances/?leaseId=${f.lease.id}`,
    );
    const balances = z
      .object({ data: balancePageSchema })
      .parse(await response.json()).data.items;
    expect(balances[0].activePaid).toBe("0.80");
    expect(balances[0].outstanding).toBe("0.20");
  } finally {
    await other.close();
  }
});

test("payment persisted list pages beyond fifty managed records without inventing a total", async ({
  page,
}) => {
  const f = await fixture(0);
  for (let index = 0; index < 51; index++) await sourcePayment(f, "0.01");
  await signIn(page.request);
  await page.goto("/payments/");
  await page
    .getByLabel("สัญญาเช่า (ข้อมูลปัจจุบัน)", { exact: true })
    .selectOption(f.lease.id);
  const region = page.getByRole("region", {
    name: "ตารางรายการรับชำระ",
    exact: true,
  });
  await expect(region.getByRole("row")).toHaveCount(51);
  await expect(
    page.getByText("เริ่มรายการที่ 1 · หน้านี้ 50 รายการ", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "หน้าถัดไป", exact: true }).click();
  await expect(region.getByRole("row")).toHaveCount(2);
  await expect(
    page.getByText("เริ่มรายการที่ 51 · หน้านี้ 1 รายการ", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "หน้าถัดไป", exact: true }),
  ).toBeDisabled();
  await page.getByRole("button", { name: "หน้าก่อน", exact: true }).click();
  await expect(region.getByRole("row")).toHaveCount(51);
});

async function keyboardTabTo(
  page: Page,
  target: ReturnType<Page["getByRole"]>,
) {
  for (let index = 0; index < 80; index++) {
    if (await target.evaluate((element) => element === document.activeElement))
      return;
    await page.keyboard.press("Tab");
  }
  throw new Error("Keyboard could not reach the labelled control");
}

test("payment persisted keyboard-only dialogs complete pending capture and receipt confirmation without runtime errors", async ({
  page,
}) => {
  const f = await fixture(1);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  await signIn(page.request);
  await page.goto("/payments/");
  const create = page.getByRole("button", {
    name: "บันทึกรับชำระ",
    exact: true,
  });
  await expect(create).toBeEnabled();
  await keyboardTabTo(page, create);
  await page.keyboard.press("Enter");
  const dialog = page.getByRole("dialog");
  const lease = dialog.getByLabel("สัญญาเช่า (ข้อมูลปัจจุบัน)", {
    exact: true,
  });
  await keyboardTabTo(page, lease);
  await page.keyboard.press("Home");
  await page.keyboard.type(f.lease.number);
  await expect(lease).toHaveValue(f.lease.id);
  await keyboardTabTo(
    page,
    dialog.getByLabel("ยอดรับชำระ (บาท)", { exact: true }),
  );
  await page.keyboard.type("0.01");
  await keyboardTabTo(
    page,
    dialog.getByRole("button", { name: "ตรวจสอบก่อนบันทึก", exact: true }),
  );
  await page.keyboard.press("Enter");
  await expect(
    dialog.getByRole("button", { name: "ยืนยันบันทึกรอตรวจสอบ", exact: true }),
  ).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(dialog).toHaveCount(0);
  const confirm = page.getByRole("button", {
    name: "ตรวจสอบและยืนยัน",
    exact: true,
  });
  await expect(confirm).toBeVisible();
  await keyboardTabTo(page, confirm);
  await page.keyboard.press("Enter");
  const allocationDialog = page.getByRole("dialog");
  const checkbox = allocationDialog.getByRole("checkbox", {
    name: `จัดสรรให้ ${f.invoices[0].number}`,
    exact: true,
  });
  await expect(checkbox).toBeVisible();
  await keyboardTabTo(page, checkbox);
  await page.keyboard.press("Space");
  const amount = allocationDialog.getByLabel(
    `ยอดจัดสรร ${f.invoices[0].number} (บาท)`,
    { exact: true },
  );
  await expect(amount).toBeEnabled();
  await keyboardTabTo(page, amount);
  await page.keyboard.type("0.01");
  await keyboardTabTo(
    page,
    allocationDialog.getByRole("button", {
      name: "ตรวจสอบก่อนบันทึก",
      exact: true,
    }),
  );
  await page.keyboard.press("Enter");
  await expect(
    allocationDialog.getByRole("button", {
      name: "ยืนยันและออกใบเสร็จ",
      exact: true,
    }),
  ).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(allocationDialog).toHaveCount(0);
  await expect(
    page.getByRole("region", { name: "ข้อมูลใบเสร็จรับเงิน", exact: true }),
  ).toBeVisible();
  expect(
    await db.payment.count({
      where: { leaseId: f.lease.id, status: "CONFIRMED" },
    }),
  ).toBe(1);
  expect(errors).toEqual([]);
});
