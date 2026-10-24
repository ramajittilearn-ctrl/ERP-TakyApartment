export const INVENTORY_TABLES_V2 = Object.freeze([
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
export const INVENTORY_TABLES_V3 = Object.freeze([
  ...INVENTORY_TABLES_V2,
  "PaymentReversal",
  "Receipt",
  "ReceiptCancellation",
  "PaymentCommand",
  "ReceiptMonthCounter",
]);
export const INVENTORY_TABLES_V4 = Object.freeze([
  ...INVENTORY_TABLES_V3,
  "ExpenseCommand",
]);
export const INVENTORY_TABLES = INVENTORY_TABLES_V4;

export const LEGACY_INVENTORY_SQL = `SELECT jsonb_build_object(
 'schema', (SELECT encode(sha256(convert_to(string_agg(table_name||':'||column_name||':'||data_type||':'||is_nullable,',' ORDER BY table_name,ordinal_position),'UTF8')),'hex') FROM information_schema.columns WHERE table_schema='public'),
 'migrations', (SELECT jsonb_agg(jsonb_build_object('name',migration_name,'checksum',checksum) ORDER BY migration_name) FROM "_prisma_migrations" WHERE finished_at IS NOT NULL),
 'rooms', (SELECT jsonb_build_object('count',count(*),'numbers',jsonb_agg(number ORDER BY number),'hash',encode(sha256(convert_to(coalesce(jsonb_agg(to_jsonb(t) ORDER BY id)::text,'[]'),'UTF8')),'hex')) FROM "Room" t),
 'tenants', (SELECT jsonb_build_object('count',count(*),'hash',encode(sha256(convert_to(coalesce(jsonb_agg(to_jsonb(t) ORDER BY id)::text,'[]'),'UTF8')),'hex')) FROM "Tenant" t),
 'leases', (SELECT jsonb_build_object('count',count(*),'hash',encode(sha256(convert_to(coalesce(jsonb_agg(to_jsonb(t) ORDER BY id)::text,'[]'),'UTF8')),'hex')) FROM "Lease" t),
 'attachments', (SELECT coalesce(jsonb_agg(jsonb_build_object('path',"storageKey",'sha256',sha256,'bytes',bytes) ORDER BY "storageKey"),'[]') FROM "Attachment"));`;

function versionSql(version, registry) {
  const tables = registry
    .map((name) => {
      const table = `"${name}"`;
      return `'${name}', (SELECT jsonb_build_object('count', count(*)::text, 'sha256', encode(sha256(convert_to(coalesce(jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text COLLATE "C")::text, '[]'), 'UTF8')), 'hex')) FROM ${table} t)`;
    })
    .join(",\n");
  return (
    LEGACY_INVENTORY_SQL.replace(/;$/, "") +
    ` || jsonb_build_object('version', ${version}, 'tables', jsonb_build_object(${tables}));`
  );
}
export const INVENTORY_SQL_V2 = versionSql(2, INVENTORY_TABLES_V2);
export const INVENTORY_SQL_V3 = versionSql(3, INVENTORY_TABLES_V3);
export const INVENTORY_SQL_V4 = versionSql(4, INVENTORY_TABLES_V4);
export const INVENTORY_SQL = INVENTORY_SQL_V4;
export function inventorySql(version) {
  if (version === 1) return LEGACY_INVENTORY_SQL;
  if (version === 2) return INVENTORY_SQL_V2;
  if (version === 3) return INVENTORY_SQL_V3;
  if (version === 4) return INVENTORY_SQL_V4;
  throw new Error("Unsupported inventory version");
}

export function inventoryVersion(expected) {
  if (!expected || typeof expected !== "object" || Array.isArray(expected))
    throw new Error("Invalid inventory");
  if (!Object.hasOwn(expected, "version")) {
    if (Object.hasOwn(expected, "tables"))
      throw new Error("Missing inventory version");
    return 1;
  }
  if (
    expected.version !== 2 &&
    expected.version !== 3 &&
    expected.version !== 4
  )
    throw new Error("Unsupported inventory version");
  const registry =
    expected.version === 2
      ? INVENTORY_TABLES_V2
      : expected.version === 3
        ? INVENTORY_TABLES_V3
        : INVENTORY_TABLES_V4;
  const tables = expected.tables;
  if (
    !tables ||
    typeof tables !== "object" ||
    Array.isArray(tables) ||
    Object.keys(tables).length !== registry.length ||
    !registry.every((name) => Object.hasOwn(tables, name))
  )
    throw new Error("Invalid inventory table registry");
  for (const name of registry) {
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
  return expected.version;
}
