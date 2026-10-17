# Phase 2.6 implementation plan

Baseline: main at ef39ff35f5ca9f0ae1edd38ce4f26f9ecbe6e10d. Existing tenant, room and lease CRUD, authentication, partial unique active-room index, backups and HTTPS deployment are retained.

1. Add RESERVED operational room status through an additive migration. Keep Occupied derived from ACTIVE leases. Protect room/lease consistency in PostgreSQL and services.
2. Add an optional validated assignment to tenant POST/PUT. Save profile, lease and audit rows in one serializable transaction. Editing the same assignment updates that lease. A transfer explicitly ends the old lease and creates another, retaining history. Removing an assignment requires the lease workflow.
3. Reuse existing forms and profile layouts. Populate floor-dependent room selectors from database records, omit unavailable rooms, and add deep links between tenant, room and lease profiles. Display payment data as unavailable until Phase 3.
4. Add database and browser regressions, run all existing checks, build and deploy an isolated Docker test project. Verify restart persistence and backup compatibility without modifying production or the existing demonstration database.
5. Record actual evidence and limitations in PHASE_2_6_IMPLEMENTATION_REPORT.md. Inspect remote history, commit and push without force, then stop.

No tenant-room column, billing workflow, invoice generation or payment processing is in scope. Room inventory is managed through the seeded 15 rooms in the UI; authenticated admin configuration APIs remain available for existing integrations.
