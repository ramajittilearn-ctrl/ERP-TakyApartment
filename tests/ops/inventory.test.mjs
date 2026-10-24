import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { encrypt, run, sha256 } from "../../operations/archive.mjs";
import { restoreProduction } from "../../operations/production-restore.mjs";
import {
  INVENTORY_TABLES,
  INVENTORY_TABLES_V2,
  INVENTORY_TABLES_V3,
  INVENTORY_TABLES_V4,
  INVENTORY_SQL_V2,
  INVENTORY_SQL_V3,
  INVENTORY_SQL_V4,
  INVENTORY_SQL,
  LEGACY_INVENTORY_SQL,
  inventoryVersion,
} from "../../operations/inventory.mjs";
import {
  assertInventory,
  inventory,
  verifyDatabase,
  verifyArchive,
  restoreIsolated,
} from "../../operations/database.mjs";

function complete(version = 4) {
  return {
    version,
    tables: Object.fromEntries(
      (version === 2
        ? INVENTORY_TABLES_V2
        : version === 3
          ? INVENTORY_TABLES_V3
          : INVENTORY_TABLES_V4
      ).map((name) => [name, { count: "0", sha256: "a".repeat(64) }]),
    ),
  };
}
test("frozen registry covers every current Prisma model exactly once", async () => {
  const schema = await fs.readFile(
    new URL("../../prisma/schema.prisma", import.meta.url),
    "utf8",
  );
  const models = [...schema.matchAll(/^model (\w+) \{/gm)].map(
    (match) => match[1],
  );
  assert.equal(models.length, 39);
  assert.deepEqual([...INVENTORY_TABLES].sort(), models.sort());
  assert.equal(new Set(INVENTORY_TABLES).size, 39);
  assert(Object.isFrozen(INVENTORY_TABLES));
  assert.doesNotMatch(
    schema,
    /@@map\(/,
    "Mapped models need explicit inventory registry review",
  );
});
test("v2 registry stays frozen at the exact historical 33 models", () => {
  assert.deepEqual(INVENTORY_TABLES_V2, [
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
  assert(Object.isFrozen(INVENTORY_TABLES_V2));
  assert.deepEqual(INVENTORY_TABLES_V3.slice(0, 33), INVENTORY_TABLES_V2);
  assert.equal(INVENTORY_SQL, INVENTORY_SQL_V4);
});
test("v3 stays frozen at 38 models and v4 appends only ExpenseCommand", () => {
  assert.deepEqual(INVENTORY_TABLES_V3.slice(33), [
    "PaymentReversal",
    "Receipt",
    "ReceiptCancellation",
    "PaymentCommand",
    "ReceiptMonthCounter",
  ]);
  assert.equal(INVENTORY_TABLES_V3.length, 38);
  assert(Object.isFrozen(INVENTORY_TABLES_V3));
  assert.deepEqual(INVENTORY_TABLES_V4, [
    ...INVENTORY_TABLES_V3,
    "ExpenseCommand",
  ]);
  assert(Object.isFrozen(INVENTORY_TABLES_V4));
});
test("legacy, v2 and v3 SQL bytes remain identical to the accepted baseline", () => {
  for (const [query, expected] of [
    [
      LEGACY_INVENTORY_SQL,
      "50e172a8a8f7cd334850584a63a5d883f7243107ea167786774cf91bbb2ca42c",
    ],
    [
      INVENTORY_SQL_V2,
      "7d1844a4bc13e06bf2befb700d2d323cc8193c4653d8b5f11ea7919402fa0ca5",
    ],
    [
      INVENTORY_SQL_V3,
      "8aaa7d4186ba2012dd1949ecbbf6a06cbb15cb504f0c0be76995ec08cc27146b",
    ],
  ])
    assert.equal(createHash("sha256").update(query).digest("hex"), expected);
});
for (const [version, registry, query] of [
  [2, INVENTORY_TABLES_V2, INVENTORY_SQL_V2],
  [3, INVENTORY_TABLES_V3, INVENTORY_SQL_V3],
  [4, INVENTORY_TABLES_V4, INVENTORY_SQL_V4],
])
  test(`v${version} hashes all full rows with its fixed registry`, () => {
    assert(query.startsWith(LEGACY_INVENTORY_SQL.replace(/;$/, "")));
    for (const name of registry) assert(query.includes(`FROM "${name}" t`));
    assert.equal(
      (query.match(/count\(\*\)::text/g) || []).length,
      registry.length,
    );
    assert.equal(
      (query.match(/ORDER BY to_jsonb\(t\)::text COLLATE "C"/g) || []).length,
      registry.length,
    );
    assert.equal(
      (query.match(/'sha256', encode\(sha256/g) || []).length,
      registry.length,
    );
  });
test("absent version selects legacy, explicit unknown versions fail closed", () => {
  assert.equal(inventoryVersion({ schema: "legacy" }), 1);
  assert.equal(inventoryVersion(complete()), 4);
  for (const version of [undefined, null, 1, 5, "2", "3", "4", false])
    assert.throws(
      () => inventoryVersion({ ...complete(), version }),
      /Unsupported inventory version/,
    );
  const unversioned = complete();
  delete unversioned.version;
  assert.throws(
    () => inventoryVersion(unversioned),
    /Missing inventory version/,
  );
  for (const malformed of [null, [], "inventory"])
    assert.throws(() => inventoryVersion(malformed), /Invalid inventory/);
});
for (const version of [2, 3, 4])
  test(`v${version} requires exact canonical fingerprints before any DB access`, async () => {
    const bad = [];
    for (const key of ["__proto__", "constructor", "prototype"]) {
      const value = complete(version);
      Object.defineProperty(value.tables, key, {
        value: value.tables.Room,
        enumerable: true,
      });
      bad.push(value);
    }
    let value = complete(version);
    delete value.tables.Invoice;
    bad.push(value);
    value = complete(version);
    value.tables.Extra = value.tables.Room;
    bad.push(value);
    value = complete(version);
    value.tables = [];
    bad.push(value);
    for (const count of [0, -1, "-1", "01", "1.2", "", null]) {
      value = complete(version);
      value.tables.Invoice.count = count;
      bad.push(value);
    }
    for (const sha256 of [null, "", "x".repeat(64), "A".repeat(64)]) {
      value = complete(version);
      value.tables.Payment.sha256 = sha256;
      bad.push(value);
    }
    value = complete(version);
    value.tables.Payment.secret = "must not exist";
    bad.push(value);
    for (const invalid of bad)
      await assert.rejects(
        assertInventory(invalid, { PATH: "/nonexistent" }),
        /Invalid inventory/,
      );
    await assert.rejects(inventory({}, 99), /Unsupported inventory version/);
  });
test("arbitrarily large counts remain strings without Number rounding", () => {
  const value = complete();
  value.tables.Payment.count = "90071992547409931234567890";
  assert.equal(inventoryVersion(value), 4);
  assert.equal(value.tables.Payment.count, "90071992547409931234567890");
});

test("verifyDatabase rejects malformed inventory before filesystem or database setup", async () => {
  await assert.rejects(
    verifyDatabase("/missing/dump", { version: 99 }),
    /Unsupported inventory version/,
  );
  await assert.rejects(
    verifyDatabase("/missing/dump", { version: 2, tables: {} }),
    /Invalid inventory/,
  );
});

test("archive verification and both restore routes reject unsupported inventory before database commands", async () => {
  const directory = await fs.mkdtemp(
    path.join(os.tmpdir(), "taky-invalid-inventory-"),
  );
  const previous = { ...process.env };
  try {
    const source = path.join(directory, "set");
    await fs.mkdir(path.join(source, "attachments"), { recursive: true });
    const dump = path.join(source, "database.dump");
    await fs.writeFile(
      dump,
      "not a PostgreSQL dump; validation must reject first",
    );
    const manifest = {
      version: 1,
      inventory: { version: 99 },
      database: {
        sha256: await sha256(dump),
        bytes: (await fs.stat(dump)).size,
      },
      attachments: [],
    };
    await fs.writeFile(
      path.join(source, "manifest.json"),
      JSON.stringify(manifest),
    );
    const tar = path.join(directory, "set.tar.gz");
    await run("tar", [
      "-czf",
      tar,
      "-C",
      source,
      "manifest.json",
      "database.dump",
      "attachments",
    ]);
    const id = randomUUID();
    const name = `taky-20261023T000000Z-${id}.taky.enc`;
    const file = path.join(directory, name);
    const key = randomBytes(32);
    await encrypt(tar, file, key);
    await assert.rejects(
      verifyArchive(file, key),
      /Unsupported inventory version/,
    );
    Object.assign(process.env, {
      RESTORE_MODE: "isolated",
      PGHOST: "restore-db",
      PGDATABASE: "taky_restore_test",
      PGPORT: "1",
    });
    await assert.rejects(
      restoreIsolated(file, key, "/nonexistent/attachment-target"),
      /Unsupported inventory version/,
    );
    // Production's mandatory rollback archive uses the same early validator.
    // No production database or production filesystem target is accessed.
    const keyFile = path.join(directory, "key");
    await fs.writeFile(keyFile, key.toString("base64"), { mode: 0o600 });
    await fs.mkdir(path.join(directory, "records"));
    await fs.writeFile(
      path.join(directory, "records", `${id}.json`),
      JSON.stringify({
        id,
        file: name,
        kind: "rollback",
        status: "SUCCEEDED",
        verifiedAt: "synthetic",
        createdAt: "2026-10-23T00:00:00Z",
        checksum: await sha256(file),
      }),
    );
    Object.assign(process.env, {
      RESTORE_MODE: "production",
      PGHOST: "db",
      OWNER_RESTORE_CONFIRMATION: name,
      ROLLBACK_BACKUP: name,
      BACKUP_DIR: directory,
      BACKUP_KEY_FILE: keyFile,
    });
    await assert.rejects(
      restoreProduction(name),
      /Unsupported inventory version/,
    );
  } finally {
    for (const key of Object.keys(process.env))
      if (!(key in previous)) delete process.env[key];
    Object.assign(process.env, previous);
    await fs.rm(directory, { recursive: true, force: true });
  }
});
