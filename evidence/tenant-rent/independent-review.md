# Tenant rent independent review

Reviewer: `/root/tenant_rent_review`. Date: 2026-10-23.

The reviewer did not implement the fix, edit application files, run database writes, or change Git state. The review follows the installed Pstack Codex adapter, bug-fix playbook, TypeScript, root-cause, and test-behavior guidance. The installed Next.js client-component guidance was read.

## Result

Accepted for the scoped tenant-rent bug. No material code defect found. The reviewer inspected Main Agent's preserved browser evidence for the old and fixed editor, including raw logs, structured results, execution status, and database identity. The old editor reproduced the overwrite. The fixed editor passed all three browser scenarios on a fresh attested synthetic target.

The old room-selection handler replaced the contract amount with any truthy room rent string, including `"0.00"`. The replacement preserves an explicit contract amount, including zero, and an existing active lease amount. Untouched new assignments still receive room defaults. Floor changes clear the room without discarding explicit rent. Room deselection and reselection preserve the existing contract amount. The editor is mounted with a tenant-specific key and is removed on close, so the dirty flag does not persist into another tenant's editor. Unchecking and rechecking a new assignment preserves that draft's explicit amount.

The change retains decimal strings without numeric conversion. Submission still sends `assignment.rent` to the existing tenant/lease transaction. The tenant profile displays the active lease rent; a tenant with no assignment has no contract rent. No pricing formula, database schema, or lease lifecycle rule changes.

## Verification executed independently

- `npx vitest run tests/tenant-assignment.test.ts`: passed 4/4.
- Scoped ESLint on the editor, helper, unit test, and browser spec: passed.
- Scoped Prettier check on those files: passed.
- `npm run typecheck`: passed with exit code 0.

The unit assertions use literal monetary strings and exercise changed behavior. They would fail if the helper returned undefined or always returned the room default. They do not exercise the React dirty-flag wiring.

The browser spec uses the existing auto-verified target fixture, dedicated database role/origin restrictions, synthetic UUID-scoped property/floor/room, and an explicit database/role identity query before fixture writes. It asserts UI input, saved lease API value, page reload, and existing lease room reselection. It does not replace target guards or use real tenant data. Main Agent executed the browser runs; the reviewer independently inspected their retained results.

## Browser correction verification

The implementer added the requested browser coverage for explicit zero and untouched room defaults. The final third scenario selects rooms with defaults `3500.25` and `4200.50`, verifies their API-normalized input strings, enters `0.00`, changes to a nonzero-default room, and verifies that the submitted zero survives save/reload. The saved lease API returns `"0"`, the profile displays `฿0`, and reopening the editor shows `"0"`. These are equivalent exact decimal values under the existing Prisma JSON and display formatting. The handwritten input remains exactly `"0.00"` before submission.

Baseline run `f96e52ffcc45c5a6aea73e80` used the original editor in `/private/tmp/taky-tenant-rent-before`. Its raw log at `evidence/tenant-rent/before-browser.log` shows the actual browser failure:

```text
Expected: "4100.75"
Received: "0"
1 failed
1 passed (36.2s)
```

The failing assertion occurs directly after selecting the zero-default room. The unassigned-tenant control passed. Structured results record one unexpected failure, one expected pass, zero skipped/flaky results, and no report errors. The identity records role `e2e_f96e52ffcc45c5a6aea73e80` and database `taky_phase2_test`. The trace, screenshot, and structured results remain under that worktree's `evidence/remediation/browser-f96e52ffcc45c5a6aea73e80`.

Fixed run `0ea382341f1086e5d740d5e6` used the integrated editor. `evidence/agent-uat/tenant-rent-fixed-browser.log` records all three scenarios passing in 18.9 seconds. Structured results under `evidence/remediation/browser-0ea382341f1086e5d740d5e6` record three expected passes, zero unexpected/skipped/flaky results, and no report errors. Execution status is `succeeded: true`. Its identity records role `e2e_0ea382341f1086e5d740d5e6` and database `taky_phase2_test`. The reviewer re-ran scoped ESLint and Prettier on the expanded spec successfully.

The browser reproduction covers entry before room selection with a zero-default room. It must not be presented as proof that every possible report of a zero tenant rent has the same cause. No production diagnosis or deployment has been performed by this reviewer.

## Reviewed file hashes

```text
6331cf78f1d73e6b51b8a871f13969bf2a53f2da651d6949f39609c24b141e03  src/features/live/editor.tsx
1354b023258cd32d4f06f7dc6f0c95780fd96f1ef64983857bb2b87c72885508  src/features/live/tenant-assignment.ts
d6913b1b225817b32a023ac37b4b12a69948ce7fb6aad022345f4f5253c6b55b  tests/tenant-assignment.test.ts
b79f54a2576bbb56e41ca02156b9767c103cc7292051e752fae568730bbcbb9f  tests/phase2/tenant-rent-persisted.spec.ts
```

## Clarified entry order verification

The user clarified that they selected the room first, entered rent last, and then saved. The fourth scenario follows that order. It prepares a fresh synthetic zero-default room, fills the other contract fields, registers a listener for the actual tenant POST, enters `4100.75`, and immediately clicks Save. The test parses the captured request body with Zod and asserts the submitted assignment is exactly `rent: "4100.75"` with the selected room ID. It then checks the selected tenant's profile displays `฿4,100.75` and its saved lease API amount is `"4100.75"` before reload and after reload.

Main Agent ran this case on fresh attested target `05437030b03bd82e05af9eba`. The reviewer independently inspected the raw log at `evidence/agent-uat/tenant-rent-save-last-browser.log` and structured records under `evidence/remediation/browser-05437030b03bd82e05af9eba`. They record one expected pass in 12.4 seconds, zero unexpected/skipped/flaky results, no report errors, and `succeeded: true`. Database identity is `taky_phase2_test` with role `e2e_05437030b03bd82e05af9eba`. The expanded spec independently passes scoped ESLint and Prettier.

This clarified flow is accepted for the tested candidate. It does not establish that the user's deployed UAT version contains the fix, reproduce a distinct defect in the deployed version for this entry order, or recover an amount previously lost. No application code changed for this additional scenario. The earlier baseline overwrite reproduction applies to entering rent before selecting the room, so it must not be misreported as a reproduction of the clarified order.
