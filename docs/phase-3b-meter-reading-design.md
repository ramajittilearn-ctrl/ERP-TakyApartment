# Stage 3B meter-reading design

## Scope

Stage 3B records water and electricity meter values. It does not calculate charges, create invoices, accept payments, issue receipts, or manage deposits. A confirmed reading is an input to a later billing stage only.

## Domain model

`UtilityMeter` identifies one physical meter in one room. `activeFrom` and `activeUntil` define its service interval. A partial unique index permits one active meter for each room and utility kind. Replacing a meter closes the old identity and creates a new identity. The application never subtracts values across meter identities.

`MeterReading` belongs to one meter and one canonical `BillingPeriod`. Its workflow status is `DRAFT` or `CONFIRMED`, and its type is `OPENING`, `NORMAL`, or `FINAL`. Readings use `DECIMAL(14,3)`. The request validator rejects values with more than three fractional digits before PostgreSQL can round them.

The first value for a meter is an explicit opening reading. The system does not substitute zero. An ADMIN registers the meter identity, installation date, opening value, and reason in one transaction. A normal reading requires an earlier confirmed reading for that same meter.

`MeterReadingCorrection` appends the old value, new value, old consumption, new consumption, reason, operator, and timestamp. Database triggers prevent update or deletion of correction and replacement records. A confirmed reading can change only through the correction transaction.

`MeterReplacement` links the old and new meter identities, the final old-meter reading, the opening new-meter reading, date, reason, and operator. The service creates all replacement records and the audit row in one serializable transaction.

Legacy meter rows remain valid. New lifecycle and billing-period fields are nullable where existing provenance cannot be reconstructed truthfully. New service writes always populate the Stage 3B fields.

## Business rules

- A room has two expected slots per billing period, water and electricity. The overview reports all rooms even before their meters are configured.
- The reading date must fall inside both the billing period and the meter lifecycle.
- Water and electricity keep independent actual reading dates. Each input defaults to today's Bangkok calendar date. Future dates fail before a transaction starts.
- Draft saves are upserts for one meter and period. A confirmed reading is idempotent on retry and cannot return to draft.
- Consumption equals the current confirmed value minus the previous confirmed value for the same physical meter.
- Current values below previous values fail. Invalid syntax, negative values, excess precision, and values outside the database range fail at the request boundary.
- Closed periods reject drafts, confirmations, ordinary corrections, registration, and replacement.
- ADMIN and STAFF can view, draft, and confirm ordinary readings. Only ADMIN can register, correct, or replace a meter.

## API

| Method and path                                 | Roles        | Purpose                                                 |
| ----------------------------------------------- | ------------ | ------------------------------------------------------- |
| `GET /api/v1/meter-readings/`                   | ADMIN, STAFF | Period overview with optional floor or room filter.     |
| `POST /api/v1/meter-readings/drafts/`           | ADMIN, STAFF | Create or update one draft.                             |
| `POST /api/v1/meter-readings/{id}/confirm/`     | ADMIN, STAFF | Confirm one draft.                                      |
| `GET /api/v1/meter-readings/history/`           | ADMIN, STAFF | Readings, corrections, and replacements for a room.     |
| `POST /api/v1/meter-readings/{id}/corrections/` | ADMIN        | Append a correction and update derived consumption.     |
| `POST /api/v1/meters/`                          | ADMIN        | Register an initial physical meter and opening reading. |
| `POST /api/v1/meters/replacements/`             | ADMIN        | Close an old meter and register its replacement.        |

Every mutation checks the exact browser origin, authenticates the session, validates JSON with Zod, repeats authorization in the service, locks affected records, and writes an `AuditLog` row inside the transaction.

## UI

`/meters/` is a live Thai-first screen. It has billing-period and floor selectors, confirmed/draft/missing counts, a room list, and one focused room entry panel. Each utility card has its own actual-reading date and a large phone-friendly numeric control. History shows the reading date separately from the system timestamp, operator, corrections, and replacements. Status badges distinguish unconfigured, missing, draft, and confirmed slots. History and rare ADMIN operations use focused dialogs. The main walking workflow remains on one responsive page.

## Deliberate limits

- Meters support three decimal places because the existing database model defined that precision. Changing physical meter precision requires a separate migration and owner approval.
- Stage 3B does not close billing periods or decide when a period is complete.
- Replacement-day consumption remains split into a final old-meter record and an opening new-meter record. Stage 3C must sum chargeable usage without subtracting the two identities.
