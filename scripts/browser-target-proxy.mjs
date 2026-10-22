import { createServer, request as httpRequest } from "node:http";
import { connect } from "node:net";

// Every redirect creates another proxy request, so destination checks cannot be
// bypassed by Playwright page routes or the browser's redirect handling.
export function browserTargetProxy(origin) {
  const allowed = new URL(origin);
  if (allowed.protocol !== "http:" || allowed.hostname !== "127.0.0.1")
    throw new Error("Test proxy requires a loopback HTTP target");
  const proxy = createServer((request, response) => {
    let target;
    try {
      target = new URL(request.url);
      if (
        target.origin !== allowed.origin ||
        target.username ||
        target.password ||
        request.headers.host !== allowed.host
      )
        throw new Error("Unauthorized destination");
    } catch {
      response.writeHead(403, { "Content-Type": "text/plain" });
      response.end("Unauthorized browser destination");
      return;
    }
    const headers = { ...request.headers, host: allowed.host };
    delete headers["proxy-authorization"];
    delete headers["proxy-connection"];
    const upstream = httpRequest(
      {
        hostname: allowed.hostname,
        port: allowed.port,
        path: target.pathname + target.search,
        method: request.method,
        headers,
      },
      (incoming) => {
        response.writeHead(incoming.statusCode ?? 502, incoming.headers);
        incoming.pipe(response);
      },
    );
    upstream.on("error", () => {
      if (!response.headersSent) response.writeHead(502);
      response.end("Isolated target unavailable");
    });
    request.on("aborted", () => upstream.destroy());
    request.pipe(upstream);
  });
  proxy.on("connect", (request, socket, head) => {
    if (request.url !== allowed.host) {
      socket.end("HTTP/1.1 403 Forbidden\r\n\r\n");
      return;
    }
    const upstream = connect(
      { host: allowed.hostname, port: Number(allowed.port) },
      () => {
        socket.write("HTTP/1.1 200 Connection Established\r\n\r\n");
        if (head.length) upstream.write(head);
        socket.pipe(upstream);
        upstream.pipe(socket);
      },
    );
    upstream.on("error", () => socket.destroy());
    socket.on("error", () => upstream.destroy());
    socket.on("close", () => upstream.destroy());
  });
  proxy.on("upgrade", (_request, socket) => {
    socket.end("HTTP/1.1 403 Forbidden\r\n\r\n");
  });
  return proxy;
}
