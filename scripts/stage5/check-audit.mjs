import assert from "node:assert/strict";
import pg from "pg";

const { Client } = pg;
const runId = process.env.STAGE5_RUN_ID;
assert.match(runId ?? "", /^[a-f0-9]{24}$/);
const ids = JSON.parse(process.env.STAGE5_AUDIT_IDS ?? "{}");
for (const key of ["billingPeriodId", "invoiceId"])
  assert.match(ids[key] ?? "", /^[0-9a-f-]{36}$/i);
const client = new Client({ connectionString: process.env.DATABASE_URL });
await client.connect();
try {
  const expected = [
    {
      entity: "billing_periods",
      entityId: ids.billingPeriodId,
      action: "CLOSE",
    },
    { entity: "invoices", entityId: ids.invoiceId, action: "PREPARE_DRAFT" },
    { entity: "invoices", entityId: ids.invoiceId, action: "ISSUE_INVOICE" },
  ];
  const evidence = [];
  for (const item of expected) {
    const result = await client.query(
      `SELECT count(*)::int AS count FROM "AuditLog"
       WHERE entity = $1 AND "entityId" = $2 AND action = $3`,
      [item.entity, item.entityId, item.action],
    );
    assert.equal(
      result.rows[0].count,
      1,
      `expected one ${item.action} audit event`,
    );
    evidence.push({ action: item.action, count: result.rows[0].count });
  }
  const paymentCommand = await client.query(
    `SELECT count(*)::int AS count FROM "PaymentCommand"
     WHERE operation = 'CONFIRM_PAYMENT'`,
  );
  assert.equal(paymentCommand.rows[0].count, 1);
  evidence.push({
    action: "CONFIRM_PAYMENT",
    count: paymentCommand.rows[0].count,
  });
  process.stdout.write(`${JSON.stringify({ runId, auditEvents: evidence })}\n`);
} finally {
  await client.end();
}
