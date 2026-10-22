import { randomBytes } from "node:crypto";
import { test as base, expect, type APIRequestContext } from "@playwright/test";
import {
  assertBrowserDestination,
  assertBrowserTestOptions,
  browserTestTarget,
  verifyTargetProof,
} from "../../src/server/browser-test-target";

export { expect };
export type { APIRequestContext, Page } from "@playwright/test";

function guardedRequest(
  request: APIRequestContext,
  origin: string,
): APIRequestContext {
  const fetch: APIRequestContext["fetch"] = async (url, options) => {
    assertBrowserDestination(typeof url === "string" ? url : url.url(), origin);
    if (options?.maxRedirects !== undefined && options.maxRedirects !== 0)
      throw new Error("Browser API redirect overrides are forbidden");
    const response = await request.fetch(url, { ...options, maxRedirects: 0 });
    if (response.status() >= 300 && response.status() < 400)
      throw new Error("Browser API redirects are forbidden");
    assertBrowserDestination(response.url(), origin);
    return response;
  };
  return {
    fetch,
    addCookies: request.addCookies.bind(request),
    clearCookies: request.clearCookies.bind(request),
    cookies: request.cookies.bind(request),
    tracing: request.tracing,
    [Symbol.asyncDispose]: request[Symbol.asyncDispose].bind(request),
    get: (url, options) => fetch(url, { ...options, method: "GET" }),
    post: (url, options) => fetch(url, { ...options, method: "POST" }),
    put: (url, options) => fetch(url, { ...options, method: "PUT" }),
    patch: (url, options) => fetch(url, { ...options, method: "PATCH" }),
    delete: (url, options) => fetch(url, { ...options, method: "DELETE" }),
    head: (url, options) => fetch(url, { ...options, method: "HEAD" }),
    storageState: request.storageState.bind(request),
    dispose: request.dispose.bind(request),
  };
}

let reportedIdentity = false;

export const test = base.extend<{ verifiedTarget: void }>({
  verifiedTarget: [
    async (
      { baseURL, proxy, contextOptions, launchOptions, connectOptions },
      use,
    ) => {
      const target = browserTestTarget();
      assertBrowserTestOptions({
        baseURL,
        proxy,
        contextOptions,
        launchOptions,
        connectOptions,
      });
      assertBrowserDestination("/", baseURL ?? "");
      const nonce = randomBytes(32).toString("hex");
      const response = await fetch(`${target.origin}/api/health/`, {
        headers: { "X-Taky-Test-Challenge": nonce },
        redirect: "error",
      });
      if (!response.ok)
        throw new Error("Browser target health verification failed");
      const body: unknown = await response.json();
      if (!body || typeof body !== "object" || !("target" in body))
        throw new Error(
          "Browser target did not provide isolated database proof",
        );
      verifyTargetProof(body.target, nonce, target);
      if (!reportedIdentity) {
        console.info(
          JSON.stringify({
            verifiedBrowserTarget: target.origin,
            runId: target.runId,
            database: target.database,
            role: target.role,
            proxy: proxy?.server,
          }),
        );
        reportedIdentity = true;
      }
      await use();
    },
    { auto: true },
  ],
  request: async ({ request, baseURL, verifiedTarget }, use) => {
    void verifiedTarget;
    await use(guardedRequest(request, baseURL ?? ""));
  },
});
