import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import {
  INVENTORY_TABLES,
  INVENTORY_SQL,
  LEGACY_INVENTORY_SQL,
  inventoryVersion,
} from "../../operations/inventory.mjs";
import { assertInventory, inventory } from "../../operations/database.mjs";

function complete() {
  return {
    version: 2,
    tables: Object.fromEntries(
      INVENTORY_TABLES.map((name) => [
        name,
        { count: "0", sha256: "a".repeat(64) },
      ]),
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
  assert.equal(models.length, 33);
  assert.deepEqual([...INVENTORY_TABLES].sort(), models.sort());
  assert.equal(new Set(INVENTORY_TABLES).size, 33);
  assert(Object.isFrozen(INVENTORY_TABLES));
  assert.doesNotMatch(
    schema,
    /@@map\(/,
    "Mapped models need explicit inventory registry review",
  );
});
test("v2 query extends legacy fingerprint and hashes full ordered database rows", () => {
  assert(INVENTORY_SQL.startsWith(LEGACY_INVENTORY_SQL.replace(/;$/, "")));
  for (const name of INVENTORY_TABLES)
    assert(INVENTORY_SQL.includes(`FROM "${name}" t`));
  assert.equal((INVENTORY_SQL.match(/count\(\*\)::text/g) || []).length, 33);
  assert.equal(
    (INVENTORY_SQL.match(/ORDER BY to_jsonb\(t\)::text COLLATE "C"/g) || [])
      .length,
    33,
  );
  assert.equal(
    (INVENTORY_SQL.match(/'sha256', encode\(sha256/g) || []).length,
    33,
  );
});
test("absent version selects legacy, explicit unknown versions fail closed", () => {
  assert.equal(inventoryVersion({ schema: "legacy" }), 1);
  assert.equal(inventoryVersion(complete()), 2);
  for (const version of [undefined, null, 1, 3, "2", false])
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
test("v2 requires exact registry and canonical string counts/hash, before any DB access", async () => {
  const bad = [];
  let value = complete();
  delete value.tables.Invoice;
  bad.push(value);
  value = complete();
  value.tables.Extra = value.tables.Room;
  bad.push(value);
  value = complete();
  value.tables = [];
  bad.push(value);
  for (const count of [0, -1, "-1", "01", "1.2", "", null]) {
    value = complete();
    value.tables.Invoice.count = count;
    bad.push(value);
  }
  for (const sha256 of [null, "", "x".repeat(64), "A".repeat(64)]) {
    value = complete();
    value.tables.Payment.sha256 = sha256;
    bad.push(value);
  }
  value = complete();
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
  assert.equal(inventoryVersion(value), 2);
  assert.equal(value.tables.Payment.count, "90071992547409931234567890");
});
