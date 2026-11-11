import assert from "node:assert/strict";
import { chromium } from "@playwright/test";

const origin = process.env.APP_ORIGIN;
const tlsHost = process.env.STAGE5_HOST;
assert.ok(origin);
assert.equal(tlsHost, "127.0.0.1");
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage();
  const errors = [];
  page.on("requestfailed", (request) =>
    errors.push(request.failure()?.errorText),
  );
  const response = await page.goto(origin, {
    waitUntil: "networkidle",
    timeout: 30000,
  });
  assert.ok(response?.ok(), `browser navigation failed: ${response?.status()}`);
  assert.equal(new URL(page.url()).hostname, tlsHost);
  const title = await page.title();
  assert.ok(title.length > 0, "application page title is empty");
  assert.equal(
    errors.length,
    0,
    `browser requests failed: ${errors.join(", ")}`,
  );
  process.stdout.write(
    `${JSON.stringify({ tls: "verified", hostname: tlsHost, status: response.status(), titlePresent: true, failedRequests: 0 })}\n`,
  );
} finally {
  await browser.close();
}
