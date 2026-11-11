import { createServer } from "node:http";
import { guardedRequest, test, expect } from "./guarded-test";
import { browserTestTarget } from "../../src/server/browser-test-target";

test("API contexts reject unauthorized destinations and redirects before following them", async ({
  request,
  page,
}) => {
  await expect(
    request.get("http://127.0.0.1:3700/api/health/"),
  ).rejects.toThrow("Unauthorized browser destination");
  await expect(
    request.post("http://production.invalid/api/auth/login/", { data: {} }),
  ).rejects.toThrow("Unauthorized browser destination");
  await expect(request.get("/api/health")).rejects.toThrow(
    "Browser API redirects are forbidden",
  );
  await expect(
    request.get("/api/health/", { maxRedirects: 5 }),
  ).rejects.toThrow("redirect overrides are forbidden");
  const response = await page.request.get(
    "http://production.invalid/api/auth/login/",
  );
  expect(response.status()).toBe(403);
});

test("page-bound API contexts also reject off-origin requests and redirects", async ({
  page,
}) => {
  const request = guardedRequest(page.request, browserTestTarget().origin);
  await expect(
    request.get("http://127.0.0.1:3700/api/health/"),
  ).rejects.toThrow("Unauthorized browser destination");
  await expect(request.get("/api/health")).rejects.toThrow(
    "Browser API redirects are forbidden",
  );
});

test("browser rejects an off-origin redirect without reaching its destination", async ({
  page,
}) => {
  let requests = 0;
  const destination = createServer((_request, response) => {
    requests++;
    response.end("unexpected destination");
  });
  await new Promise<void>((resolve) =>
    destination.listen(0, "127.0.0.1", resolve),
  );
  try {
    const address = destination.address();
    if (!address || typeof address === "string")
      throw new Error("Missing destination port");
    await page.route("**/guard-redirect/", (route) =>
      route.fulfill({
        status: 302,
        headers: { location: `http://127.0.0.1:${address.port}/` },
      }),
    );
    const response = await page.goto("/guard-redirect/");
    expect(response?.status()).toBe(403);
    expect(
      (await page.request.get(`http://127.0.0.1:${address.port}/`)).status(),
    ).toBe(403);
    let fetchedStatus = 0;
    await page.route("**/guard-fetch/", async (route) => {
      const response = await route.fetch({
        url: `http://127.0.0.1:${address.port}/`,
      });
      fetchedStatus = response.status();
      await route.fulfill({ response });
    });
    const navigationResponse = await page.goto("/guard-fetch/");
    expect(navigationResponse?.status()).toBe(403);
    expect(navigationResponse?.url()).toBe(
      `${browserTestTarget().origin}/guard-fetch/`,
    );
    expect(fetchedStatus).toBe(403);
    expect(requests).toBe(0);
  } finally {
    await new Promise<void>((resolve, reject) =>
      destination.close((error) => (error ? reject(error) : resolve())),
    );
  }
});
