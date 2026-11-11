import { createHash, randomUUID } from "node:crypto";
import AxeBuilder from "@axe-core/playwright";
import type { Locator } from "@playwright/test";
import { z } from "zod";
import {
  test,
  expect,
  type Page,
  type APIRequestContext,
} from "./guarded-test";
import { browserTestTarget } from "../../src/server/browser-test-target";
import { db } from "../../src/server/db";
import { depositLedgerDtoSchema } from "../../src/server/deposits/contracts";
import { evidenceDtoSchema } from "../../src/server/evidence/contracts";
import {
  operationLabels,
  type DepositOperation,
} from "../../src/features/deposits/form";
import {
  depositBrowserFixture,
  depositBrowserPng,
  signInDepositBrowser,
} from "./deposit-fixtures";

type Fixture = Awaited<ReturnType<typeof depositBrowserFixture>>;
async function ledger(request: APIRequestContext, leaseId: string, query = "") {
  const response = await request.get(
    `/api/v1/leases/${leaseId}/deposits/${query}`,
  );
  expect(response.status()).toBe(200);
  return z.object({ data: depositLedgerDtoSchema }).parse(await response.json())
    .data;
}
async function openCommand(
  page: Page,
  operation: DepositOperation,
  documentNumber?: string,
) {
  if (operation === "reverse") {
    if (!documentNumber) throw new Error("Original document number required");
    await page
      .getByRole("row")
      .filter({
        has: page.getByRole("link", { name: documentNumber, exact: true }),
      })
      .getByRole("button", { name: "กลับรายการ", exact: true })
      .click();
  } else
    await page
      .getByRole("button", { name: operationLabels[operation], exact: true })
      .click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  return dialog;
}
async function uploadInDialog(page: Page, dialog: Locator) {
  const name = `หลักฐานสังเคราะห์-${randomUUID()}.png`;
  const response = page.waitForResponse(
    (result) =>
      result.request().method() === "POST" &&
      new URL(result.url()).pathname === "/api/v1/deposit-evidence/",
  );
  await dialog.getByLabel("อัปโหลดหลักฐานใหม่", { exact: true }).setInputFiles({
    name,
    mimeType: "image/png",
    buffer: depositBrowserPng(),
  });
  const result = await response;
  expect(result.status()).toBe(201);
  const saved = z
    .object({ data: evidenceDtoSchema })
    .parse(await result.json()).data;
  await expect(
    dialog.getByLabel("เลือกหลักฐานของสัญญานี้", { exact: true }),
  ).toHaveValue(saved.id);
  expect(saved.originalName).toBe(name);
  expect(saved.bytes).toBe(depositBrowserPng().length);
  return saved;
}
async function selectEvidence(dialog: Locator, evidenceId: string) {
  const select = dialog.getByLabel("เลือกหลักฐานของสัญญานี้", { exact: true });
  await expect(select.locator(`option[value="${evidenceId}"]`)).toHaveCount(1);
  await select.selectOption(evidenceId);
}
async function fillCommand(
  dialog: Locator,
  operation: DepositOperation,
  amount: string,
  evidenceId?: string,
  bank = false,
) {
  if (operation !== "reverse")
    await dialog
      .getByLabel(
        operation === "review"
          ? "ยอดตั้งต้นที่ตรวจสอบแล้ว (บาท)"
          : "จำนวนเงิน (บาท)",
        { exact: true },
      )
      .fill(amount);
  if (operation !== "review")
    await dialog
      .getByLabel("วันและเวลาเกิดรายการ (เวลาไทย)", { exact: true })
      .fill("2026-10-25T10:15");
  if (operation === "receipts" || operation === "refunds")
    await dialog
      .getByLabel("วิธีรับหรือคืนเงิน", { exact: true })
      .selectOption(bank ? "BANK_TRANSFER" : "CASH");
  if (operation === "receipts" && bank) {
    await dialog
      .getByLabel("รหัสบัญชีผู้รับเงิน", { exact: true })
      .fill("synthetic-deposit-bank");
    await dialog
      .getByLabel("เลขอ้างอิงเงินโอนเข้า", { exact: true })
      .fill(`SYNTHETIC-IN-${randomUUID()}`);
  }
  if (operation === "refunds") {
    await dialog
      .getByLabel("ชื่อผู้รับเงินคืน", { exact: true })
      .fill("Synthetic refund payee");
    if (bank) {
      await dialog
        .getByLabel("เลขอ้างอิงเงินโอนออก", { exact: true })
        .fill(`SYNTHETIC-OUT-${randomUUID()}`);
      await dialog
        .getByLabel("รายละเอียดปลายทางรับเงินคืน", { exact: true })
        .fill("Synthetic refund destination");
    }
  }
  await dialog
    .getByLabel("เหตุผลและรายละเอียด", { exact: true })
    .fill(`Synthetic ${operation} browser verification`);
  if (evidenceId) await selectEvidence(dialog, evidenceId);
  await dialog.getByRole("checkbox").check();
}
async function submitCommand(
  page: Page,
  dialog: Locator,
  fixture: Fixture,
  operation: DepositOperation,
) {
  const path =
    operation === "reverse"
      ? /\/api\/v1\/deposit-entries\/[^/]+\/reverse\/$/
      : new RegExp(
          `/api/v1/leases/${fixture.lease.id}/deposits/${operation}/$`,
        );
  const received = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      path.test(new URL(response.url()).pathname),
  );
  await dialog
    .getByRole("button", {
      name: `ยืนยัน${operationLabels[operation]}`,
      exact: true,
    })
    .click();
  const response = await received;
  expect(response.status()).toBe(operation === "review" ? 200 : 201);
  expect(response.request().headers()["x-taky-deposit-actor"]).toBe(
    fixture.admin.id,
  );
  const result = z
    .object({ data: depositLedgerDtoSchema })
    .parse(await response.json()).data;
  await dialog.getByRole("button", { name: "ปิด", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await page.reload();
  return result;
}
async function reviewedFixture(page: Page, amount = "0") {
  const fixture = await depositBrowserFixture();
  await signInDepositBrowser(page.request);
  await page.goto(`/deposits/${fixture.lease.id}/`);
  const dialog = await openCommand(page, "review");
  const evidence = await uploadInDialog(page, dialog);
  await fillCommand(dialog, "review", amount);
  const result = await submitCommand(page, dialog, fixture, "review");
  return { ...fixture, evidence, result };
}
async function tabTo(page: Page, target: Locator) {
  for (let count = 0; count < 50; count++) {
    if (await target.evaluate((node) => node === document.activeElement))
      return;
    await page.keyboard.press("Tab");
  }
  await expect(target).toBeFocused();
}

test.afterAll(() => db.$disconnect());

test("deposit persisted valid missing UUID pages render noindex not-found while APIs keep strict 404", async ({
  page,
}) => {
  await signInDepositBrowser(page.request);
  const missing = randomUUID();
  for (const item of [
    {
      page: `/deposits/${missing}/`,
      api: `/api/v1/leases/${missing}/deposits/`,
      code: "LEASE_NOT_FOUND",
    },
    {
      page: `/deposit-entries/${missing}/`,
      api: `/api/v1/deposit-entries/${missing}/`,
      code: "DEPOSIT_ENTRY_NOT_FOUND",
    },
  ]) {
    const response = await page.goto(item.page);
    // Next preserves 200 once the loading boundary has started streaming.
    expect([200, 404]).toContain(response?.status());
    await expect(
      page.getByRole("heading", { name: "ไม่พบหน้าที่ต้องการ", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", {
        name: "ไม่สามารถแสดงข้อมูลได้",
        exact: true,
      }),
    ).toHaveCount(0);
    await expect(
      page.locator('meta[name="robots"][content*="noindex"]').first(),
    ).toBeAttached();
    const api = await page.request.get(item.api);
    expect(api.status()).toBe(404);
    expect(api.headers()["cache-control"]).toBe("no-store");
    expect(await api.json()).toMatchObject({ error: { code: item.code } });
  }
});

test("deposit persisted genuine upload zero and positive review all movements immutable document and full totals", async ({
  page,
}) => {
  test.slow();
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const f = await reviewedFixture(page);
  expect(f.result.account).toMatchObject({
    version: 1,
    reviewState: "REVIEWED",
    openingAmount: "0.00",
  });
  expect(f.result.items).toHaveLength(0);
  expect(f.result.contractualRequirement).toBe("2000.00");
  let dialog = await openCommand(page, "receipts");
  await fillCommand(dialog, "receipts", "1000", f.evidence.id);
  let result = await submitCommand(page, dialog, f, "receipts");
  const original = result.items.find((entry) => entry.kind === "RECEIPT");
  if (!original) throw new Error("Original receipt required");
  expect(original.occurredAt).toBe("2026-10-25T03:15:00.000Z");
  for (const movement of [
    { operation: "receipts" as const, amount: "200.00", bank: true },
    { operation: "deductions" as const, amount: "100.00", bank: false },
    { operation: "refunds" as const, amount: "50.00", bank: false },
    { operation: "refunds" as const, amount: "25.00", bank: true },
  ]) {
    dialog = await openCommand(page, movement.operation);
    await fillCommand(
      dialog,
      movement.operation,
      movement.amount,
      f.evidence.id,
      movement.bank,
    );
    result = await submitCommand(page, dialog, f, movement.operation);
  }
  const deduction = result.items.find((entry) => entry.kind === "DEDUCTION");
  if (!deduction) throw new Error("Deduction required for full reversal");
  dialog = await openCommand(page, "reverse", deduction.documentNumber);
  await fillCommand(dialog, "reverse", "", f.evidence.id);
  result = await submitCommand(page, dialog, f, "reverse");
  expect(result.account.version).toBe(7);
  expect(result.total).toBe(6);
  expect(result.totals).toMatchObject({
    grossReceipts: "1200.00",
    grossRefunds: "75.00",
    grossDeductions: "100.00",
    reversedDeductions: "100.00",
    netDeductions: "0.00",
    heldLiability: "1125.00",
  });
  expect(
    result.items.find(
      (entry) => entry.kind === "RECEIPT" && entry.method === "BANK_TRANSFER",
    ),
  ).toMatchObject({
    receivingAccountKey: "synthetic-deposit-bank",
    externalReference: expect.stringMatching(/^SYNTHETIC-IN-/),
    payeeName: null,
    destination: null,
  });
  expect(
    result.items.find(
      (entry) => entry.kind === "REFUND" && entry.method === "BANK_TRANSFER",
    ),
  ).toMatchObject({
    externalReference: expect.stringMatching(/^SYNTHETIC-OUT-/),
    payeeName: "Synthetic refund payee",
    destination: "Synthetic refund destination",
    receivingAccountKey: null,
  });
  expect(await db.depositEntry.count({ where: { leaseId: f.lease.id } })).toBe(
    6,
  );
  const paged = await ledger(page.request, f.lease.id, "?offset=1&limit=1");
  expect(paged.items).toHaveLength(1);
  expect(paged.total).toBe(6);
  expect(paged.totals).toEqual(result.totals);
  await page.goto(`/deposits/${f.lease.id}/?limit=1`);
  await page.getByRole("link", { name: "หน้าถัดไป", exact: true }).click();
  await expect(page).toHaveURL(
    new RegExp(`/deposits/${f.lease.id}/\\?offset=1&limit=1$`),
  );
  await expect(
    page.locator("section.card").filter({
      has: page.getByRole("heading", {
        name: "เงินประกันคงถือที่จัดการในระบบ",
        exact: true,
      }),
    }),
  ).toContainText("1,125.00 บาท");
  await db.tenant.update({
    where: { id: f.tenant.id },
    data: { name: "Synthetic changed current deposit name" },
  });
  await db.room.update({
    where: { id: f.room.id },
    data: { number: "D101-CHANGED" },
  });
  await page.goto(`/deposit-entries/${original.id}/`);
  await expect(page.getByText(f.tenant.name, { exact: true })).toBeVisible();
  await expect(page.getByText(f.room.number, { exact: true })).toBeVisible();
  await expect(
    page.getByText("Synthetic changed current deposit name", { exact: true }),
  ).toHaveCount(0);
  const saved = await db.depositEntry.findUniqueOrThrow({
    where: { id: original.id },
  });
  expect(saved.documentSnapshot).toEqual(original.documentSnapshot);
  expect(saved.snapshotSha256).toBe(original.snapshotSha256);
  const download = await page.request.get(
    `/api/v1/deposit-evidence/${f.evidence.id}/download/`,
  );
  expect(download.status()).toBe(200);
  expect(download.headers()["content-disposition"]).toContain("attachment;");
  expect(download.headers()["cache-control"]).toBe("no-store");
  expect(download.headers()["x-content-type-options"]).toBe("nosniff");
  expect(await download.body()).toEqual(depositBrowserPng());
  expect(
    createHash("sha256")
      .update(await download.body())
      .digest("hex"),
  ).toBe(f.evidence.sha256);
  const [file] = await Promise.all([
    page.waitForEvent("download"),
    page
      .getByRole("link", { name: "ดาวน์โหลดหลักฐานต้นฉบับ", exact: true })
      .click(),
  ]);
  expect(file.suggestedFilename()).toBe(f.evidence.originalName);
  const downloaded = await file.createReadStream();
  if (!downloaded) throw new Error("Browser download stream required");
  const chunks: Buffer[] = [];
  for await (const chunk of downloaded) {
    if (!Buffer.isBuffer(chunk))
      throw new Error("Binary download chunk required");
    chunks.push(chunk);
  }
  expect(Buffer.concat(chunks)).toEqual(depositBrowserPng());
  expect(createHash("sha256").update(Buffer.concat(chunks)).digest("hex")).toBe(
    f.evidence.sha256,
  );
  const positive = await reviewedFixture(page, "300.25");
  expect(positive.result.account).toMatchObject({
    version: 1,
    openingAmount: "300.25",
  });
  expect(positive.result.items).toHaveLength(1);
  expect(positive.result.items[0]).toMatchObject({
    kind: "OPENING",
    amount: "300.25",
  });
  expect(positive.result.totals).toMatchObject({
    grossOpening: "300.25",
    grossReceipts: "0.00",
    heldLiability: "300.25",
  });
  expect(errors).toEqual([]);
});

test("deposit persisted wrong lease evidence and download query reject while STAFF reads and cannot post", async ({
  page,
}) => {
  test.slow();
  const first = await reviewedFixture(page);
  const second = await reviewedFixture(page);
  const current = await ledger(page.request, second.lease.id);
  const response = await page.request.post(
    `/api/v1/leases/${second.lease.id}/deposits/receipts/`,
    {
      headers: {
        Origin: browserTestTarget().origin,
        "X-Taky-Deposit-Actor": second.admin.id,
      },
      data: {
        expectedVersion: current.account.version,
        evidenceId: first.evidence.id,
        commandKey: randomUUID(),
        reason: "Synthetic wrong-lease attempt",
        amount: "1.00",
        occurredAt: "2026-10-25T03:15:00.000Z",
        verified: true,
        method: "CASH",
      },
    },
  );
  expect(response.status()).toBe(409);
  expect(await response.json()).toMatchObject({
    error: { code: "EVIDENCE_NOT_FOUND" },
  });
  expect(
    (
      await page.request.get(
        `/api/v1/deposit-evidence/${first.evidence.id}/download/?leaseId=${second.lease.id}`,
      )
    ).status(),
  ).toBe(422);
  expect(
    (
      await page.request.get(
        `/api/v1/deposit-evidence/${randomUUID()}/download/`,
      )
    ).status(),
  ).toBe(404);
  const changedActor = await page.request.post(
    `/api/v1/leases/${second.lease.id}/deposits/receipts/`,
    {
      headers: {
        Origin: browserTestTarget().origin,
        "X-Taky-Deposit-Actor": second.staff.id,
      },
      data: {
        expectedVersion: current.account.version,
        evidenceId: second.evidence.id,
        commandKey: randomUUID(),
        reason: "Synthetic stale actor binding",
        amount: "1.00",
        occurredAt: "2026-10-25T03:15:00.000Z",
        verified: true,
        method: "CASH",
      },
    },
  );
  expect(changedActor.status()).toBe(403);
  expect(await changedActor.json()).toMatchObject({
    error: { code: "SESSION_CHANGED" },
  });
  await signInDepositBrowser(page.request, true);
  await page.goto(`/deposits/${second.lease.id}/`);
  await expect(
    page.getByRole("heading", {
      name: "กระทบยอดเงินประกันทั้งหมด",
      exact: true,
    }),
  ).toBeVisible();
  for (const name of [
    "รับเงินประกัน",
    "หักเงินประกัน",
    "คืนเงินประกัน",
    "กลับรายการ",
  ])
    await expect(page.getByRole("button", { name, exact: true })).toHaveCount(
      0,
    );
  const denied = await page.request.post(
    `/api/v1/leases/${second.lease.id}/deposits/receipts/`,
    {
      headers: {
        Origin: browserTestTarget().origin,
        "X-Taky-Deposit-Actor": second.staff.id,
      },
      data: {
        expectedVersion: current.account.version,
        evidenceId: second.evidence.id,
        commandKey: randomUUID(),
        reason: "Synthetic STAFF forbidden attempt",
        amount: "1.00",
        occurredAt: "2026-10-25T03:15:00.000Z",
        verified: true,
        method: "CASH",
      },
    },
  );
  expect(denied.status()).toBe(403);
  expect(
    (
      await page.request.get(
        `/api/v1/deposit-evidence/${second.evidence.id}/download/`,
      )
    ).status(),
  ).toBe(200);
  expect(
    await db.depositEntry.count({ where: { leaseId: second.lease.id } }),
  ).toBe(0);
});

test("deposit persisted lost financial response keeps exact key body actor and recovery inside reopened modal", async ({
  page,
}) => {
  test.slow();
  const f = await reviewedFixture(page);
  const requests: { body: string; actor: string }[] = [];
  let dropped = false;
  await page.route(
    new RegExp(`/api/v1/leases/${f.lease.id}/deposits/receipts/$`),
    async (route) => {
      const request = route.request();
      requests.push({
        body: request.postData() ?? "",
        actor: request.headers()["x-taky-deposit-actor"],
      });
      const response = await route.fetch();
      expect(response.status()).toBe(201);
      if (!dropped) {
        dropped = true;
        await route.abort("failed");
      } else await route.fulfill({ response });
    },
  );
  let dialog = await openCommand(page, "receipts");
  await fillCommand(dialog, "receipts", "5.01", f.evidence.id);
  await dialog
    .getByRole("button", { name: "ยืนยันรับเงินประกัน", exact: true })
    .click();
  await expect(
    dialog.getByRole("button", {
      name: "ตรวจสอบผลด้วยคำสั่งเดิม",
      exact: true,
    }),
  ).toBeEnabled();
  await expect(
    dialog.getByText(/ยังไม่ทราบผล รายการอาจบันทึกแล้ว/),
  ).toBeVisible();
  await dialog
    .getByRole("button", { name: "ปิดหน้าต่างชั่วคราว", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "รับเงินประกัน", exact: true }),
  ).toBeDisabled();
  await page
    .getByRole("button", { name: "เปิดการตรวจสอบผลรายการเดิม", exact: true })
    .click();
  dialog = page.getByRole("dialog");
  await dialog
    .getByRole("button", { name: "ตรวจสอบผลด้วยคำสั่งเดิม", exact: true })
    .click();
  await expect(dialog.getByRole("status")).toContainText("บันทึกสำเร็จแล้ว");
  expect(requests).toHaveLength(2);
  expect(requests[1]).toEqual(requests[0]);
  expect(requests[0].actor).toBe(f.admin.id);
  const body = z
    .object({
      commandKey: z.string(),
      expectedVersion: z.number(),
      amount: z.literal("5.01"),
    })
    .parse(JSON.parse(requests[0].body));
  expect(body.expectedVersion).toBe(1);
  expect(await db.depositEntry.count({ where: { leaseId: f.lease.id } })).toBe(
    1,
  );
  expect(
    await db.depositCommand.count({
      where: { actorId: f.admin.id, commandKey: body.commandKey },
    }),
  ).toBe(1);
  await dialog.getByRole("button", { name: "ปิด", exact: true }).click();
  await page.reload();
  expect((await ledger(page.request, f.lease.id)).totals.heldLiability).toBe(
    "5.01",
  );
});

test("deposit persisted mobile native evidence selection keyboard focus and Axe keep genuine form accessible", async ({
  page,
}) => {
  test.slow();
  const f = await reviewedFixture(page);
  await page.setViewportSize({ width: 390, height: 844 });
  const action = page.getByRole("button", {
    name: "รับเงินประกัน",
    exact: true,
  });
  await tabTo(page, action);
  await page.keyboard.press("Enter");
  let dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
  expect(
    (
      await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
        .analyze()
    ).violations,
  ).toEqual([]);
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(action).toBeFocused();
  await page.keyboard.press("Enter");
  dialog = page.getByRole("dialog");
  const amount = dialog.getByLabel("จำนวนเงิน (บาท)", { exact: true });
  await tabTo(page, amount);
  await page.keyboard.type("0.01");
  const reason = dialog.getByLabel("เหตุผลและรายละเอียด", { exact: true });
  await tabTo(page, reason);
  await page.keyboard.type(
    "Synthetic keyboard focus and native selection verification",
  );
  const evidence = dialog.getByLabel("เลือกหลักฐานของสัญญานี้", {
    exact: true,
  });
  await expect(
    evidence.locator(`option[value="${f.evidence.id}"]`),
  ).toHaveCount(1);
  await tabTo(page, evidence);
  await expect(evidence).toBeFocused();
  await expect(evidence.locator("option")).toHaveCount(2);
  await expect(evidence).toHaveValue("");
  // The retained census did not establish native-popup keyboard navigation.
  await evidence.selectOption({ value: f.evidence.id });
  await expect(evidence).toHaveValue(f.evidence.id);
  await expect(
    dialog.getByRole("link", { name: "ดาวน์โหลดหลักฐานที่เลือก", exact: true }),
  ).toBeVisible();
  const checkbox = dialog.getByRole("checkbox");
  await tabTo(page, checkbox);
  await page.keyboard.press("Space");
  const submit = dialog.getByRole("button", {
    name: "ยืนยันรับเงินประกัน",
    exact: true,
  });
  await tabTo(page, submit);
  await page.keyboard.press("Enter");
  await expect(dialog.getByRole("status")).toContainText("บันทึกสำเร็จแล้ว");
  expect((await ledger(page.request, f.lease.id)).totals.heldLiability).toBe(
    "0.01",
  );
  await dialog.getByRole("button", { name: "ปิด", exact: true }).click();
  await expect(page).toHaveTitle("Taky Apartment ERP");
  expect(
    (
      await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
        .analyze()
    ).violations,
  ).toEqual([]);
});
