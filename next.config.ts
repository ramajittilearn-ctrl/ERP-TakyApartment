import type { NextConfig } from "next";
const config: NextConfig = {
  output: "standalone",
  trailingSlash: true,
  poweredByHeader: false,
  outputFileTracingIncludes: {
    "/api/v1/invoices/*/pdf": [
      "node_modules/@fontsource/noto-sans-thai/files/noto-sans-thai-thai-400-normal.woff",
      "node_modules/@fontsource/noto-sans-thai/files/noto-sans-thai-latin-400-normal.woff",
    ],
    "/api/v1/receipts/*/pdf": [
      "node_modules/@fontsource/noto-sans-thai/files/noto-sans-thai-thai-400-normal.woff",
      "node_modules/@fontsource/noto-sans-thai/files/noto-sans-thai-latin-400-normal.woff",
    ],
  },
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "same-origin" },
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=()",
          },
          {
            key: "Content-Security-Policy",
            value:
              "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
          },
        ],
      },
    ];
  },
};
export default config;
