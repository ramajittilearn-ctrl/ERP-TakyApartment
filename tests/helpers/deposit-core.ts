import { createHash, randomUUID } from "node:crypto";
import { lstat, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { Client } from "pg";
import { db } from "../../src/server/db";
import { createDepositService } from "../../src/server/deposits";

export const depositTestKey = () => randomUUID();
export const depositTestAt = () => new Date(Date.now() - 60000).toISOString();
const evidenceRoot = path.join(
  process.cwd(),
  ".local/qa/deposit-matrix-retained",
);

// This core verifier checks real retained synthetic bytes. Production upload,
// format admission and publication/backup coordination have separate gates.
export const depositTestService = createDepositService(async (tx, input) => {
  await tx.$queryRaw`SELECT e.id FROM "DepositEvidence" e JOIN "Attachment" a ON a.id=e."attachmentId" WHERE e.id=${input.evidenceId}::uuid FOR UPDATE OF e,a`;
  const evidence = await tx.depositEvidence.findUniqueOrThrow({
    where: { id: input.evidenceId },
    include: { attachment: true },
  });
  if (evidence.leaseId !== input.leaseId)
    throw new Error("Synthetic evidence lease mismatch");
  const file = path.join(evidenceRoot, evidence.attachment.storageKey);
  const stat = await lstat(file);
  if (!stat.isFile() || stat.isSymbolicLink())
    throw new Error("Synthetic evidence is not a regular file");
  const bytes = await readFile(file);
  if (
    BigInt(bytes.length) !== evidence.attachment.bytes ||
    createHash("sha256").update(bytes).digest("hex") !==
      evidence.attachment.sha256
  )
    throw new Error("Synthetic retained evidence changed");
  return { evidenceId: evidence.id, attachmentId: evidence.attachmentId };
});

export async function attestDepositTestDatabase() {
  const configured = process.env.DATABASE_URL;
  if (!configured)
    throw new Error("Explicit isolated deposit test database required");
  const url = new URL(configured);
  if (
    url.hostname !== "127.0.0.1" ||
    !/^taky_deposit_test_[a-z0-9_]+$/.test(url.pathname.slice(1)) ||
    url.search ||
    url.hash
  )
    throw new Error("Isolated loopback deposit test database required");
  const identity = await db.$queryRaw<
    { database: string; role: string }[]
  >`SELECT current_database() AS database,current_user AS role`;
  if (
    identity[0]?.database !== url.pathname.slice(1) ||
    identity[0]?.role !== decodeURIComponent(url.username)
  )
    throw new Error("Actual deposit test database/role mismatch");
  return configured;
}

export async function depositTestConnection() {
  const connectionString = await attestDepositTestDatabase();
  const client = new Client({
    connectionString,
    connectionTimeoutMillis: 5000,
    query_timeout: 20000,
  });
  await client.connect();
  const identity = (
    await client.query(
      "SELECT current_database() AS database,current_user AS role,pg_backend_pid() AS pid",
    )
  ).rows[0];
  const url = new URL(connectionString);
  if (
    identity?.database !== url.pathname.slice(1) ||
    identity?.role !== decodeURIComponent(url.username)
  ) {
    await client.end();
    throw new Error("Actual independent deposit connection mismatch");
  }
  return { client, pid: Number(identity.pid) };
}

export async function createDepositTestFixture(openingAmount?: string) {
  const key = depositTestKey;
  const admin = await db.user.create({
    data: {
      username: `dcr-admin-${key()}`,
      email: `${key()}@synthetic.invalid`,
      name: "Synthetic deposit matrix administrator",
      passwordHash: "not-a-password",
      role: "ADMIN",
    },
  });
  const staff = await db.user.create({
    data: {
      username: `dcr-staff-${key()}`,
      email: `${key()}@synthetic.invalid`,
      name: "Synthetic deposit matrix staff",
      passwordHash: "not-a-password",
      role: "STAFF",
    },
  });
  const property = await db.property.create({
    data: {
      code: `DCR-${key().replaceAll("-", "").slice(0, 24)}`,
      name: "Synthetic deposit matrix property",
    },
  });
  const floor = await db.floor.create({
    data: { propertyId: property.id, number: 1, name: "Synthetic floor" },
  });
  const room = await db.room.create({
    data: { floorId: floor.id, number: "DCR01", rent: "1000.00" },
  });
  const tenant = await db.tenant.create({
    data: { name: "Synthetic deposit matrix tenant", isDemo: false },
  });
  const lease = await db.lease.create({
    data: {
      number: `DCR-${key().replaceAll("-", "").slice(0, 24)}`,
      roomId: room.id,
      tenantId: tenant.id,
      startDate: new Date("2026-01-01"),
      endDate: new Date("2027-01-01"),
      rent: "1000.00",
      deposit: "2000.00",
      status: "ACTIVE",
      isDemo: false,
    },
  });
  await mkdir(evidenceRoot, { recursive: true, mode: 0o700 });
  const storageKey = key();
  const bytes = Buffer.from("Synthetic retained deposit matrix evidence\n");
  await writeFile(path.join(evidenceRoot, storageKey), bytes, {
    flag: "wx",
    mode: 0o600,
  });
  const attachment = await db.attachment.create({
    data: {
      storageKey,
      originalName: "synthetic-core-evidence.txt",
      mimeType: "application/octet-stream",
      bytes: BigInt(bytes.length),
      sha256: createHash("sha256").update(bytes).digest("hex"),
      uploadedById: admin.id,
      leaseId: lease.id,
    },
  });
  await db.auditLog.create({
    data: {
      actorId: admin.id,
      action: "DEPOSIT_EVIDENCE_ADMISSION",
      entity: "deposit-evidence",
      metadata: { leaseId: lease.id, attemptId: key() },
    },
  });
  const evidence = await db.depositEvidence.create({
    data: {
      leaseId: lease.id,
      attachmentId: attachment.id,
      uploadedById: admin.id,
    },
  });
  const base = {
    leaseId: lease.id,
    evidenceId: evidence.id,
    expectedVersion: 0,
    reason: "Synthetic operator-verified settlement",
    commandKey: key(),
  };
  const f = {
    admin,
    staff,
    property,
    room,
    tenant,
    lease,
    attachment,
    evidence,
    base,
    file: path.join(evidenceRoot, storageKey),
  };
  if (openingAmount !== undefined)
    await depositTestService.reviewDepositAccount(admin, {
      ...base,
      openingAmount,
      verified: true,
    });
  return f;
}
export type DepositTestFixture = Awaited<
  ReturnType<typeof createDepositTestFixture>
>;

export async function depositFinancialState(f: DepositTestFixture) {
  return db.$transaction(async (tx) => ({
    accounts: await tx.depositAccount.findMany({
      where: { leaseId: f.lease.id },
      orderBy: { leaseId: "asc" },
    }),
    entries: await tx.depositEntry.findMany({
      where: { leaseId: f.lease.id },
      orderBy: { id: "asc" },
    }),
    commands: await tx.depositCommand.findMany({
      where: { actorId: f.admin.id },
      orderBy: { id: "asc" },
    }),
    audits: await tx.auditLog.findMany({
      where: { actorId: f.admin.id },
      orderBy: { id: "asc" },
    }),
    counters: await tx.depositDocumentCounter.findMany({
      orderBy: { month: "asc" },
    }),
    attachments: await tx.attachment.findMany({
      where: { leaseId: f.lease.id },
      orderBy: { id: "asc" },
    }),
    evidence: await tx.depositEvidence.findMany({
      where: { leaseId: f.lease.id },
      orderBy: { id: "asc" },
    }),
    retainedSha256: createHash("sha256")
      .update(await readFile(f.file))
      .digest("hex"),
  }));
}

export async function withDepositFault(
  f: DepositTestFixture,
  point: "audit" | "counter" | "command" | "entry",
  work: () => Promise<void>,
) {
  const name = `dcr_fault_${depositTestKey().replaceAll("-", "")}`;
  const table = {
    audit: "AuditLog",
    counter: "DepositDocumentCounter",
    command: "DepositCommand",
    entry: "DepositEntry",
  }[point];
  const condition =
    point === "counter"
      ? "true"
      : point === "entry"
        ? `NEW."postedById"='${f.admin.id}'::uuid`
        : `NEW."actorId"='${f.admin.id}'::uuid`;
  if (
    !/^dcr_fault_[a-f0-9]{32}$/.test(name) ||
    !/^[a-f0-9-]{36}$/.test(f.admin.id)
  )
    throw new Error("Invalid fixed synthetic fault identity");
  await db.$executeRawUnsafe(
    `CREATE FUNCTION ${name}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF ${condition} THEN RAISE EXCEPTION 'Synthetic deposit ${point} failure'; END IF; RETURN NEW; END $$`,
  );
  try {
    await db.$executeRawUnsafe(
      `CREATE TRIGGER ${name} AFTER INSERT OR UPDATE ON "${table}" FOR EACH ROW EXECUTE FUNCTION ${name}()`,
    );
    try {
      await work();
    } finally {
      await db.$executeRawUnsafe(`DROP TRIGGER ${name} ON "${table}"`);
    }
  } finally {
    await db.$executeRawUnsafe(`DROP FUNCTION ${name}()`);
  }
}

export async function rawDepositReceipt(
  client: Client,
  f: DepositTestFixture,
  overrides: Record<string, unknown> = {},
) {
  await client.query("SELECT pg_advisory_xact_lock_shared(73422193)");
  await client.query("SELECT pg_advisory_xact_lock(73422194)");
  const month = (
    await client.query(
      "SELECT to_char(CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Bangkok','YYYYMM') AS month",
    )
  ).rows[0].month;
  await client.query(
    'INSERT INTO "DepositDocumentCounter" (month,"nextValue") VALUES ($1,1) ON CONFLICT (month) DO NOTHING',
    [month],
  );
  const counter = (
    await client.query(
      'UPDATE "DepositDocumentCounter" SET "nextValue"="nextValue"+1 WHERE month=$1 RETURNING "nextValue"-1 AS number',
      [month],
    )
  ).rows[0].number;
  const account = (
    await client.query(
      'SELECT version FROM "DepositAccount" WHERE "leaseId"=$1',
      [f.lease.id],
    )
  ).rows[0];
  const prototype = {
    id: depositTestKey(),
    leaseId: f.lease.id,
    sequence: account.version + 1,
    kind: "RECEIPT",
    amount: "1.00",
    occurredAt: depositTestAt(),
    postedAt: new Date().toISOString(),
    postedById: f.admin.id,
    reason: "Synthetic direct deposit",
    evidenceId: f.evidence.id,
    method: "CASH",
    receivingAccountKey: null,
    externalReference: null,
    payeeName: null,
    destination: null,
    reverseOfId: null,
    documentNumber: `DEP-${month}-${String(counter).padStart(6, "0")}`,
    ...overrides,
  };
  const snapshot = (
    await client.query(
      'SELECT deposit_snapshot(jsonb_populate_record(NULL::"DepositEntry",$1::jsonb)) AS snapshot',
      [JSON.stringify(prototype)],
    )
  ).rows[0].snapshot;
  const body = {
    ...prototype,
    documentSnapshot: overrides.documentSnapshot ?? snapshot,
    snapshotSha256: overrides.snapshotSha256 ?? null,
  };
  return client.query(
    `WITH raw AS (SELECT jsonb_populate_record(NULL::"DepositEntry",$1::jsonb) AS e), full_row AS (SELECT (e).* FROM raw) INSERT INTO "DepositEntry" SELECT id,"leaseId",sequence,kind,amount,"occurredAt","postedAt","postedById",reason,"evidenceId",method,"receivingAccountKey","externalReference","payeeName",destination,"reverseOfId","documentNumber","documentSnapshot",COALESCE("snapshotSha256",encode(sha256(convert_to("documentSnapshot"::text,'UTF8')),'hex')) FROM full_row RETURNING id`,
    [JSON.stringify(body)],
  );
}

export async function rawPendingPayment(
  client: Client,
  f: DepositTestFixture,
  identity: { account: string; reference: string },
) {
  const id = depositTestKey();
  await client.query(
    'INSERT INTO "Payment" (id,reference,"leaseId",amount,method,status,"receivedAt","updatedAt","legacyUnmapped","isDemo","methodCode",version,"recordedById","receivingAccountKey","externalReference") VALUES ($1,$2,$3,1.00,\'BANK_TRANSFER\',\'PENDING\',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP,false,false,\'BANK_TRANSFER\',1,$4,$5,$6)',
    [
      id,
      `DCR-${id}`,
      f.lease.id,
      f.staff.id,
      identity.account,
      identity.reference,
    ],
  );
  return id;
}
