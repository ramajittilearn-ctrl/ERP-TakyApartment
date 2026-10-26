import { test, expect } from "./guarded-test";
import { browserTestTarget } from "../../src/server/browser-test-target";

const retainedRun = "704fa285e6e344d5955c4e93";
const retainedLease = "21055a63-588a-4e07-be26-29ddb6c30a9b";
const retainedEvidence = "51551b2b-d479-44ab-8301-5db492877e69";
type NativeState = {
  value: string;
  index: number;
  options: number;
  disabled: boolean;
} | null;
type Sample = {
  phase: string;
  active: string;
  app: NativeState;
  reference: NativeState;
  reactiveDownload: boolean;
  event: {
    type: string;
    target: string;
    key: string | null;
    trusted: boolean;
    prevented: boolean;
  } | null;
};
declare global {
  interface Window {
    depositKeyboardCensus?: { events: Sample[]; sample(phase: string): void };
  }
}

test("deposit keyboard diagnostic retained704 native versus controlled select census", async ({
  page,
}) => {
  test.setTimeout(90000);
  const target = browserTestTarget();
  test.skip(
    target.runId !== retainedRun,
    "Diagnostic for the retained fictional 704 run only; not an acceptance case",
  );
  const blockedWrites: string[] = [];
  const records: { actor: string; protocol: string; events: Sample[] }[] = [];
  await page.route("**/api/v1/**", async (route) => {
    if (["POST", "PUT", "PATCH", "DELETE"].includes(route.request().method())) {
      blockedWrites.push(new URL(route.request().url()).pathname);
      await route.abort("blockedbyclient");
    } else await route.continue();
  });
  const login = await page.request.post("/api/auth/login/", {
    headers: { Origin: target.origin },
    data: {
      identifier: "test-admin",
      password: process.env.TEST_ADMIN_PASSWORD,
    },
  });
  expect(login.status()).toBe(200);
  const ledger = await page.request.get(
    `/api/v1/leases/${retainedLease}/deposits/`,
  );
  expect(ledger.status()).toBe(200);
  expect(await ledger.json()).toMatchObject({
    data: {
      leaseId: retainedLease,
      account: { reviewState: "REVIEWED" },
      total: 0,
      totals: { heldLiability: "0.00" },
    },
  });
  const evidence = await page.request.get(
    `/api/v1/deposit-evidence/?leaseId=${retainedLease}`,
  );
  expect(evidence.status()).toBe(200);
  expect(await evidence.json()).toMatchObject({
    data: {
      total: 1,
      items: [{ id: retainedEvidence, leaseId: retainedLease }],
    },
  });
  await page.setViewportSize({ width: 390, height: 844 });
  try {
    for (const actor of ["app", "reference"]) {
      for (const protocol of [
        { name: "original", keys: ["Home", "ArrowDown"] },
        {
          name: "explicit-open-commit",
          keys: ["Space", "Home", "ArrowDown", "Enter"],
        },
      ]) {
        await page.goto(`/deposits/${retainedLease}/`);
        await page
          .getByRole("button", { name: "รับเงินประกัน", exact: true })
          .click();
        const dialog = page.getByRole("dialog");
        const app = dialog.getByLabel("เลือกหลักฐานของสัญญานี้", {
          exact: true,
        });
        await expect(
          app.locator(`option[value="${retainedEvidence}"]`),
        ).toHaveCount(1);
        await expect(app).toHaveValue("");
        await app.evaluate((node) =>
          node.setAttribute("data-keyboard-census", "app"),
        );
        await dialog.evaluate((node) => {
          const field = document.createElement("fieldset");
          field.setAttribute("data-keyboard-census", "reference-field");
          const label = document.createElement("label");
          label.htmlFor = "deposit-keyboard-reference";
          label.textContent = "Native diagnostic reference";
          const select = document.createElement("select");
          select.id = "deposit-keyboard-reference";
          select.setAttribute("data-keyboard-census", "reference");
          select.add(new Option("Diagnostic placeholder", ""));
          select.add(new Option("Diagnostic accepted item", "reference-file"));
          field.append(label, select);
          const form = node.querySelector("form");
          if (!form) throw new Error("Expected retained deposit form");
          form.append(field);
        });
        await page.evaluate(
          ({ accepted }) => {
            const app = document.querySelector('[data-keyboard-census="app"]');
            const reference = document.querySelector(
              '[data-keyboard-census="reference"]',
            );
            const events: Sample[] = [];
            const actor = (node: EventTarget | null) =>
              node === app
                ? "app"
                : node === reference
                  ? "reference"
                  : node === document.body
                    ? "body"
                    : node instanceof HTMLElement
                      ? node.tagName.toLowerCase()
                      : "other";
            const state = (node: Element | null): NativeState =>
              node instanceof HTMLSelectElement
                ? {
                    value: node.value,
                    index: node.selectedIndex,
                    options: node.options.length,
                    disabled: node.disabled,
                  }
                : null;
            const sample = (phase: string, event: Event | null = null) => {
              if (events.length >= 256) return;
              events.push({
                phase,
                active: actor(document.activeElement),
                app: state(app),
                reference: state(reference),
                reactiveDownload: !!document.querySelector(
                  `a[href="/api/v1/deposit-evidence/${accepted}/download/"]`,
                ),
                event: event
                  ? {
                      type: event.type,
                      target: actor(event.target),
                      key: event instanceof KeyboardEvent ? event.key : null,
                      trusted: event.isTrusted,
                      prevented: event.defaultPrevented,
                    }
                  : null,
              });
            };
            for (const type of [
              "focusin",
              "focusout",
              "keydown",
              "keyup",
              "input",
              "change",
            ])
              document.addEventListener(
                type,
                (event) => {
                  if (
                    actor(event.target) !== "app" &&
                    actor(event.target) !== "reference" &&
                    type !== "focusin" &&
                    type !== "focusout"
                  )
                    return;
                  sample("capture", event);
                  queueMicrotask(() => sample("after-dispatch", event));
                  requestAnimationFrame(() => sample("next-frame", event));
                },
                true,
              );
            window.depositKeyboardCensus = { events, sample };
          },
          { accepted: retainedEvidence },
        );
        const control =
          actor === "app"
            ? app
            : dialog.getByLabel("Native diagnostic reference", { exact: true });
        for (let steps = 0; steps < 50; steps++) {
          if (await control.evaluate((node) => node === document.activeElement))
            break;
          await page.keyboard.press("Tab");
        }
        await expect(control).toBeFocused();
        await page.evaluate(() =>
          window.depositKeyboardCensus?.sample("before-protocol"),
        );
        for (const key of protocol.keys) await page.keyboard.press(key);
        await page.evaluate(() =>
          window.depositKeyboardCensus?.sample("after-protocol"),
        );
        const samples = await page.evaluate(
          () => window.depositKeyboardCensus?.events ?? [],
        );
        records.push({ actor, protocol: protocol.name, events: samples });
      }
    }
    expect(blockedWrites).toEqual([]);
  } finally {
    await test.info().attach("deposit-keyboard-census", {
      body: Buffer.from(
        JSON.stringify(
          {
            diagnosticOnly: true,
            runId: retainedRun,
            blockedWrites,
            records,
          },
          null,
          2,
        ),
      ),
      contentType: "application/json",
    });
    console.info(
      JSON.stringify({
        diagnosticOnly: true,
        runId: retainedRun,
        records: records.map((record) => ({
          actor: record.actor,
          protocol: record.protocol,
          samples: record.events.length,
          final: record.events.at(-1),
        })),
      }),
    );
  }
});
