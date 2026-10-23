# Agent UAT runtime findings

Main executes guarded real browser tests; independent assessor is agent_uat_acceptance.

## Accepted observation

Tenant/lease CRUD flow passed1/1 on fresh run1a1e6c8144e1aa256a787f04, database and generated role attested. Raw log tenant-uat-attempt2.log and fresh-ID traces/reports retained. First b27a attempt selected zero tests with anchored grep and is not a functional result.

## BR-04: created-period confirmation disappears

Fresh run630a110c3be65c3713cdb493 executed two cases,1passed1failed. Delayed period switch regression passed. Monthlybilling failed at billing-setup.spec.ts89 waiting for the exact created-period success message. Screenshot/context shows newly created January2020 period selected, confirming the mutation completed, while its success message is absent. Source setup-panel periodId effect unconditionally setNotice empty after createPeriod changes selected ID and sets the success message. This is the supported root-cause hypothesis, to verify with owner correction and original unmodified case rerun. Do not increase timeout or delete assertion.

Fix scope should keep notices tied to their operation/period and clear unrelated stale context on manual period change while preserving the success for the newly created selected period. Independent review must examine correction. Full monthly flow and whole suite remain unverified.

Raw logs billing-uat-run.log, evidence/remediation/630a110c3be65c3713cdb493-browser.log and fresh-ID trace/screenshots retained. No production or existing UAT data changed.
