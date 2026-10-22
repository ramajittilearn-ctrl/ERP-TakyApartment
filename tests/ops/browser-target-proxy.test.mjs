import assert from "node:assert/strict";
import { test } from "node:test";
import { createServer, request } from "node:http";
import { browserTargetProxy } from "../../scripts/browser-target-proxy.mjs";

async function listen(server) {
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return `http://127.0.0.1:${server.address().port}`;
}
async function close(server) {
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
}
function through(proxyOrigin, destination, host) {
  return new Promise((resolve, reject) => {
    const req = request(
      proxyOrigin,
      {
        path: destination,
        headers: { Host: host ?? new URL(destination).host },
      },
      (response) => {
        response.resume();
        response.on("end", () =>
          resolve({
            status: response.statusCode,
            location: response.headers.location,
          }),
        );
      },
    );
    req.on("error", reject);
    req.end();
  });
}
test("browser proxy blocks direct and redirected unauthorized targets without sending a request", async () => {
  let destinationRequests = 0;
  const destination = createServer((_req, res) => {
    destinationRequests++;
    res.end("forbidden");
  });
  const destinationOrigin = await listen(destination);
  const app = createServer((req, res) => {
    if (req.url === "/redirect")
      res.writeHead(302, { Location: `${destinationOrigin}/private` });
    res.end("isolated app");
  });
  const appOrigin = await listen(app);
  const proxy = browserTargetProxy(appOrigin);
  const proxyOrigin = await listen(proxy);
  try {
    assert.equal((await through(proxyOrigin, appOrigin)).status, 200);
    assert.equal((await through(proxyOrigin, destinationOrigin)).status, 403);
    assert.equal(
      (await through(proxyOrigin, appOrigin, "owner-uat.invalid")).status,
      403,
    );
    const redirect = await through(proxyOrigin, `${appOrigin}/redirect`);
    assert.equal(redirect.status, 302);
    assert.equal((await through(proxyOrigin, redirect.location)).status, 403);
    assert.equal(destinationRequests, 0);
  } finally {
    await close(proxy);
    await close(app);
    await close(destination);
  }
});
