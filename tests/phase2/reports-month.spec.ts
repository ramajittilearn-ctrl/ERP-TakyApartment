import { expect, guardedRequest, test } from "./guarded-test";
import { browserTestTarget } from "../../src/server/browser-test-target";
import { monthlyReportEnvelopeSchema } from "../../src/server/reports/contracts";

test("reports can select and load a month beyond the preset range", async ({
  page,
}) => {
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

  await page.goto("/reports/");
  const monthInput = page.getByLabel("เดือน", { exact: true });
  await expect(monthInput).toHaveValue(/^\d{4}-\d{2}$/);

  const reportResponse = page.waitForResponse((response) => {
    const url = new URL(response.url());
    return (
      response.status() === 200 &&
      url.pathname === "/api/v1/reports/monthly/" &&
      url.searchParams.get("month") === "2027-03"
    );
  });
  await monthInput.fill("2027-03");
  await expect(monthInput).toHaveValue("2027-03");

  const response = await reportResponse;
  expect(response.status()).toBe(200);
  const body: unknown = await response.json();
  expect(monthlyReportEnvelopeSchema.parse(body).data.month).toBe("2027-03");
});
