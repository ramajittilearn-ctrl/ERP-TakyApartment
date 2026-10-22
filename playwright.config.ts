import { defineConfig, devices } from "@playwright/test";
import { config } from "dotenv";
import { browserTestTarget } from "./src/server/browser-test-target";
config({ path: ".env.test", quiet: true });
const target = browserTestTarget();
export default defineConfig({
  testDir: "./tests",
  testMatch: "phase2/**/*.spec.ts",
  fullyParallel: true,
  workers: 1,
  timeout: 45000,
  expect: { timeout: 10000 },
  retries: 0,
  reporter: [
    ["list"],
    ["html", { open: "never" }],
    ["json", { outputFile: "test-results/results.json" }],
  ],
  use: {
    ...devices["Desktop Chrome"],
    channel: process.platform === "darwin" ? "chrome" : undefined,
    baseURL: target.origin,
    serviceWorkers: "block",
    proxy: { server: "http://127.0.0.1:3822" },
    launchOptions: { args: ["--proxy-bypass-list=<-loopback>"] },
    viewport: { width: 1440, height: 1000 },
    locale: "th-TH",
    timezoneId: "Asia/Bangkok",
    colorScheme: "light",
    reducedMotion: "reduce",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
});
