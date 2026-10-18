# Phase 3 financial rules

## Stage 3A decisions

- Currency enters the financial kernel as a decimal string with at most two fractional digits. Utility rates allow four digits and meter readings three. Excess scale is rejected before PostgreSQL coercion.
- Calculations use `Prisma.Decimal`; JavaScript floating-point numbers are not used for money, rates, readings, or multiplication/division.
- Monetary output uses `ROUND_HALF_UP` to exactly two decimal places. Rent and usage charges round once, after the exact calculation.
- A billing period is exactly one Gregorian calendar month, from its first through its last date. PostgreSQL enforces this shape.
- Rent proration counts occupied calendar dates inclusively. The occupied interval is the intersection of the lease and billing period. No intersection is an error, not a zero or silent charge.
- Full-period occupancy produces the exact monthly rent. Partial rent is `monthly rent × occupied days ÷ period days`, followed by one final monetary rounding.
- Utility usage is `current reading − previous reading`; a lower current reading is rejected. The charge is exact usage multiplied by the applied four-decimal unit rate, followed by one final monetary rounding.
- Utility rates are append-only change points. For a selected application date, the applicable version is the latest matching property/kind rate whose `effectiveFrom` is not later than that date. Stage 3C must confirm which application date it uses.
- Billing periods move only from `OPEN` to `CLOSED`. Closing an already closed period returns the existing record and does not add another audit event. There is no reopen, update, or delete operation.

## Examples

For February 2026, a lease beginning 10 February occupies 19 of 28 dates through month end. A monthly rent of `7500.00` produces `7500 × 19 ÷ 28 = 5089.285714…`, stored as `5089.29`.

Readings `100.125` and `103.125` produce `3.000` units. At `8.3350` per unit the exact charge is `25.005`, stored as `25.01`.

## Unresolved owner decisions

- Which date selects the effective utility rate for invoicing: period start, reading date, or another date?
- Whether a new rate may be backdated into a period with an issued invoice. Stage 3A records history but does not issue invoices.
- Which Stage 3C conditions must be satisfied before an ADMIN closes a billing period.
- Whether zero contractual rent may be billed; the current seed intentionally creates rooms with zero configured rent.
