# Phase 4 release candidate

Accepted application baseline: `32355958081088e1c849aff39177c86e718139d6`.

Includes the reviewed apartment billing, tenant-rent corrections, payments and Thai receipts, Stage3E deposit/evidence workflows, Phase4 OPEX/CAPEX expenses and CSV export, and V5 retained-file backup/restore integration. Application UAT35/35, unit409/409, deposit PostgreSQL50/50, retained evidence9/9, payment regression39/39 and expense export5/5 passed in isolated environments. See the retained closeout for exact scope and limitations.

Release preparation freezes those features and adds an explicit production Compose overlay, digest/source verifier, environment template and cutover/rollback runbook. App startup does not migrate or seed under this overlay. No default-branch merge, existing UAT change or production deployment was performed.

This is a deployment candidate, not a Go-Live acceptance. The exact production target upgrade, immutable images, private configuration, volume permissions, verified current-version restore and operational/security commissioning must pass the runbook gates first. Dashboard/Reporting and maintenance-demo completion remain outside the Phase4 closure. Native-popup keyboard navigation was not established by the Chrome test runner; native selection, keyboard focus/submission and Axe were tested.

Deploy by this release tag and verified image digests, not the repository's older `main` branch. Never include private environment, key, database or tenant-file artifacts in this public release.
