import assert from "node:assert/strict";
import { chromium } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import pg from "pg";
import { writeFile } from "node:fs/promises";

const url = new URL(process.env.DATABASE_URL);
assert.equal(url.hostname, "127.0.0.1");
assert.equal(url.port, "55451");
assert.equal(url.pathname, "/taky_phase2_test");
assert.equal(url.username, `int_${process.env.E2E_RUN_ID}`);
const db = new pg.Client({ connectionString: url.href });
await db.connect();
const identity = (
  await db.query("SELECT current_database() AS database, current_user AS role")
).rows[0];
assert.equal(identity.database, "taky_phase2_test");
assert.equal(identity.role, url.username);
await db.end();
const origin = "http://127.0.0.1:3820";
const browser = await chromium.launch({
  channel: process.platform === "darwin" ? "chrome" : undefined,
});
try {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
  });
  const page = await context.newPage();
  const login = await page.request.post(`${origin}/api/auth/login/`, {
    headers: { Origin: origin },
    data: {
      identifier: "test-admin",
      password: process.env.TEST_ADMIN_PASSWORD,
    },
    maxRedirects: 0,
  });
  assert.equal(login.status(), 200);
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  await page.route(/\/api\/v1\/invoices\/?\?/, async (route) => {
    await gate;
    await route.continue();
  });
  await page.goto(`${origin}/billing/`);
  await page.getByRole("status").filter({ hasText: "โหลด" }).waitFor();
  assert.equal(
    await page.getByRole("button", { name: "โหลดข้อมูลใหม่" }).isDisabled(),
    true,
  );
  const loading = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
    .analyze();
  await page.screenshot({
    path: "evidence/remediation/invoice-loading-before.png",
    fullPage: true,
  });
  assert.equal(
    await page.getByRole("button", { name: "โหลดข้อมูลใหม่" }).isDisabled(),
    true,
  );
  release();
  await page.getByRole("button", { name: "โหลดข้อมูลใหม่" }).waitFor();
  const reload = page.getByRole("button", { name: "โหลดข้อมูลใหม่" });
  while (await reload.isDisabled()) await page.waitForTimeout(25);
  const rows = await page.request.get(`${origin}/api/v1/invoices/`);
  await writeFile(
    "evidence/remediation/accessibility-invoice-response.json",
    await rows.text(),
  );
  const ready = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
    .analyze();
  await writeFile(
    "evidence/remediation/invoice-accessibility-before.json",
    JSON.stringify(
      { identity, loading: loading.violations, ready: ready.violations },
      null,
      2,
    ),
  );
  console.info(
    JSON.stringify({
      loading: loading.violations.map((item) => ({
        id: item.id,
        nodes: item.nodes.map((node) => ({
          target: node.target,
          summary: node.failureSummary,
        })),
      })),
      ready: ready.violations.length,
    }),
  );
} finally {
  await browser.close();
}
