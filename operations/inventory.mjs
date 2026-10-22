export const INVENTORY_TABLES = Object.freeze([
  "Property",
  "Floor",
  "Room",
  "Tenant",
  "Lease",
  "SecurityDeposit",
  "UtilityMeter",
  "MeterReading",
  "MeterReadingCorrection",
  "MeterReplacement",
  "UtilityRate",
  "BillingPeriod",
  "BillingRateSelection",
  "BillingConsumptionApproval",
  "Invoice",
  "InvoiceItem",
  "Payment",
  "PaymentAllocation",
  "ExpenseCategory",
  "Expense",
  "MaintenanceRequest",
  "User",
  "Session",
  "LoginThrottle",
  "Attachment",
  "AuditLog",
  "BackupHistory",
  "BillingPeriodFreeze",
  "BillingFreezeLease",
  "InvoiceCorrection",
  "InvoiceMonthCounter",
  "PropertyDuePolicy",
  "InvoiceCommand",
]);
export const LEGACY_INVENTORY_SQL = `SELECT jsonb_build_object(
 'schema', (SELECT encode(sha256(convert_to(string_agg(table_name||':'||column_name||':'||data_type||':'||is_nullable,',' ORDER BY table_name,ordinal_position),'UTF8')),'hex') FROM information_schema.columns WHERE table_schema='public'),
 'migrations', (SELECT jsonb_agg(jsonb_build_object('name',migration_name,'checksum',checksum) ORDER BY migration_name) FROM "_prisma_migrations" WHERE finished_at IS NOT NULL),
 'rooms', (SELECT jsonb_build_object('count',count(*),'numbers',jsonb_agg(number ORDER BY number),'hash',encode(sha256(convert_to(coalesce(jsonb_agg(to_jsonb(t) ORDER BY id)::text,'[]'),'UTF8')),'hex')) FROM "Room" t),
 'tenants', (SELECT jsonb_build_object('count',count(*),'hash',encode(sha256(convert_to(coalesce(jsonb_agg(to_jsonb(t) ORDER BY id)::text,'[]'),'UTF8')),'hex')) FROM "Tenant" t),
 'leases', (SELECT jsonb_build_object('count',count(*),'hash',encode(sha256(convert_to(coalesce(jsonb_agg(to_jsonb(t) ORDER BY id)::text,'[]'),'UTF8')),'hex')) FROM "Lease" t),
 'attachments', (SELECT coalesce(jsonb_agg(jsonb_build_object('path',"storageKey",'sha256',sha256,'bytes',bytes) ORDER BY "storageKey"),'[]') FROM "Attachment"));`;

const tables = INVENTORY_TABLES.map((name) => {
  const table = `"${name}"`;
  return `'${name}', (SELECT jsonb_build_object('count', count(*)::text, 'sha256', encode(sha256(convert_to(coalesce(jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text COLLATE "C")::text, '[]'), 'UTF8')), 'hex')) FROM ${table} t)`;
}).join(",\n");
export const INVENTORY_SQL =
  LEGACY_INVENTORY_SQL.replace(/;$/, "") +
  ` || jsonb_build_object('version', 2, 'tables', jsonb_build_object(${tables}));`;

export function inventoryVersion(expected) {
  if (!expected || typeof expected !== "object" || Array.isArray(expected))
    throw new Error("Invalid inventory");
  if (!Object.hasOwn(expected, "version")) {
    if (Object.hasOwn(expected, "tables"))
      throw new Error("Missing inventory version");
    return 1;
  }
  if (expected.version !== 2) throw new Error("Unsupported inventory version");
  const tables = expected.tables;
  if (
    !tables ||
    typeof tables !== "object" ||
    Array.isArray(tables) ||
    Object.keys(tables).length !== INVENTORY_TABLES.length ||
    !INVENTORY_TABLES.every((name) => Object.hasOwn(tables, name))
  )
    throw new Error("Invalid inventory table registry");
  for (const name of INVENTORY_TABLES) {
    const entry = tables[name];
    if (
      !entry ||
      typeof entry !== "object" ||
      Array.isArray(entry) ||
      Object.keys(entry).sort().join(",") !== "count,sha256" ||
      typeof entry.count !== "string" ||
      !/^(0|[1-9][0-9]*)$/.test(entry.count) ||
      typeof entry.sha256 !== "string" ||
      !/^[a-f0-9]{64}$/.test(entry.sha256)
    )
      throw new Error(`Invalid inventory table fingerprint: ${name}`);
  }
  return 2;
}
