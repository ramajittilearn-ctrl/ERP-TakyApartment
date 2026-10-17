# Repository review

Reviewed upstream main at `7f4652837b89b1b35af5d3cbb4de9d7146ac78f8` on 15 October 2026.

## Entire tracked tree

- `CODEX_MASTER_IMPLEMENTATION_PROMPT.md`: reviewed in full. Defines the 15-room Thai-first local ERP, Next.js App Router/TypeScript/Tailwind/Lucide frontend, future PostgreSQL/Prisma backend, accounting invariants, security, backups and acceptance criteria.
- `prototype/index.html`: reviewed in full. One dependency-free HTML/CSS/JS demo, ten destinations, room/floor and expense filters, simple meter calculator, hardcoded financial summaries, non-persistent sample data and alert-only actions.
- `ERP-TakyApartment-UXUI-Reference.pdf`: downloaded and rendered in full. One landscape page, 1536 x 1024 points, nine approved screen panels. These show dashboard, rooms, tenant profile, billing, payments, expenses, reports, maintenance, settings/backup. A leases destination exists in the sidebar and HTML but has no dedicated PDF panel.

## Design findings

Navy gradient sidebar, bright blue active item and primary buttons, pale-blue workspace, white rounded cards, compact Thai typography, green/amber/red/gray status pills, small line icons, grouped room cards, light table headers and rules. Desktop billing has a left editor and right invoice preview. Tenant details have a profile card and tabs. Reports use grouped bar and donut charts. Settings has tabs and explicit backup/restore panels.

Preserve hierarchy and visual language, while adapting dense PDF panels to actual 1440, 768 and 390px screens. Thai text must remain legible. Mobile uses a keyboard-accessible menu and scrolling table containers.

## Scope and source differences

The PDF shows older fictional dates and names; Phase 1 will use clearly fictional October 2026 fixtures. HTML has twelve occupied rooms versus thirteen in the PDF and inconsistent hardcoded OPEX totals. Use one consistent fixture source to derive all financial totals. Preserve reference artifacts unchanged.

Phase 1 is a local frontend demonstration. No backend, database, authentication, OAuth, attachment storage, bank verification, scheduled backup or restore implementation. Do not imply that a UI state proves these future operations have happened.

## Work checklist

- [x] Ground: inspect all three upstream artifacts and render PDF.
- [x] Sketch: compare two independent frontend architecture candidates.
- [x] Synthesize: write implementation phases, module map, types, future schema and API contract.
- [x] Implement: ten real routes and reusable React components.
- [x] Verify: production build, calculation tests, browser workflows, accessibility and screenshots at three widths.

Architecture comparison criteria: reference fidelity, state consistency, frontend-only boundary, accessibility/responsiveness, future backend replacement, and verifiable simplicity.
