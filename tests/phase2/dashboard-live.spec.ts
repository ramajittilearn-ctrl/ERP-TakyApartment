import { expect, guardedRequest, test } from "./guarded-test";
import { browserTestTarget } from "../../src/server/browser-test-target";
import { dashboardEnvelopeSchema } from "../../src/server/dashboard/contracts";

test("dashboard uses the persisted monthly overview", async ({ page }) => {
  const origin = browserTestTarget().origin;
  const request = guardedRequest(page.request, origin);
  const login = await request.post("/api/auth/login/", {
    headers: { Origin: origin },
    data: {
      identifier: "test-admin",
      password: process.env.TEST_ADMIN_PASSWORD,
    },
  });
  expect(login.status()).toBe(200);

  const initialResponse = page.waitForResponse((response) => {
    const url = new URL(response.url());
    return (
      url.pathname === "/api/v1/dashboard/" && url.searchParams.has("month")
    );
  });
  await page.goto("/");
  const response = await initialResponse;
  expect(response.status()).toBe(200);
  const first: unknown = await response.json();
  const dashboard = dashboardEnvelopeSchema.parse(first).data;
  expect(dashboard.financials.trend).toHaveLength(6);

  await expect(page.getByText("ห้องที่ลงทะเบียนไว้")).toBeVisible();
  await expect(page.getByText(/ห้องมีสัญญาเช่า\s+สถานะ ACTIVE/)).toBeVisible();
  await expect(page.getByText("ยอดคงค้างปัจจุบัน").first()).toBeVisible();
  await expect(page.getByText("ค่าใช้จ่าย CAPEX")).toBeVisible();
  await expect(page.getByText("กระแสเงินสดสุทธิ")).toHaveCount(0);
  await expect(page.getByText("แจ้งซ่อมล่าสุด")).toHaveCount(0);

  const monthInput = page.getByLabel("เดือน", { exact: true });
  const nextResponse = page.waitForResponse((candidate) => {
    const url = new URL(candidate.url());
    return (
      url.pathname === "/api/v1/dashboard/" &&
      url.searchParams.get("month") === "2027-03"
    );
  });
  await monthInput.fill("2027-03");
  const selectedResponse = await nextResponse;
  expect(selectedResponse.status()).toBe(200);
  const selectedBody: unknown = await selectedResponse.json();
  expect(dashboardEnvelopeSchema.parse(selectedBody).data.month).toBe(
    "2027-03",
  );
});
