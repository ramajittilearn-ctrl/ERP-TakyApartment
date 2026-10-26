import { createHash, randomUUID } from "node:crypto";
import { deflateSync } from "node:zlib";
import fs from "node:fs/promises";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { Client } from "pg";
import { afterAll, beforeAll, expect, it } from "vitest";
import { db } from "../../src/server/db";
import { uploadDepositEvidence } from "../../src/server/evidence";
import {
  ATTACHMENT_PUBLICATION_KEY,
  EVIDENCE_ADMISSION_ACTION,
} from "../../src/server/evidence/contracts";

const key = () => randomUUID();
let root: string;
let observer: Client;
const originalRoot = process.env.ATTACHMENT_DIR;
function png() {
  const crc = (bytes: Buffer) => {
    let value = 0xffffffff;
    for (const byte of bytes) {
      value ^= byte;
      for (let bit = 0; bit < 8; bit++)
        value = (value >>> 1) ^ (value & 1 ? 0xedb88320 : 0);
    }
    return (value ^ 0xffffffff) >>> 0;
  };
  const chunk = (name: string, data: Buffer) => {
    const type = Buffer.from(name),
      size = Buffer.alloc(4),
      checksum = Buffer.alloc(4);
    size.writeUInt32BE(data.length);
    checksum.writeUInt32BE(crc(Buffer.concat([type, data])));
    return Buffer.concat([size, type, data, checksum]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(1, 0);
  header.writeUInt32BE(1, 4);
  header[8] = 8;
  header[9] = 2;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(Buffer.from([0, 255, 0, 0]))),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}
function stream(bytes = png()) {
  return new ReadableStream<Uint8Array>({
    start(c) {
      c.enqueue(new Uint8Array(bytes));
      c.close();
    },
  });
}
async function fixture() {
  const user = (role: "ADMIN" | "STAFF") =>
    db.user.create({
      data: {
        username: `evidence-${key()}`,
        email: `${key()}@synthetic.invalid`,
        name: `Synthetic ${role}`,
        role,
        passwordHash: "unusable-synthetic-hash",
      },
    });
  const admin = await user("ADMIN"),
    staff = await user("STAFF");
  const property = await db.property.create({
    data: {
      code: `EVI-${key().replaceAll("-", "").slice(0, 24)}`,
      name: "Synthetic evidence property",
    },
  });
  const floor = await db.floor.create({
    data: { propertyId: property.id, number: 1, name: "Synthetic floor" },
  });
  const room = await db.room.create({
    data: { floorId: floor.id, number: "E01", rent: "1000.00" },
  });
  const tenant = await db.tenant.create({
    data: { name: "Synthetic evidence tenant", isDemo: false },
  });
  const lease = await db.lease.create({
    data: {
      number: `EVI-${key().replaceAll("-", "").slice(0, 24)}`,
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
  return {
    admin,
    staff,
    lease,
    metadata: {
      leaseId: lease.id,
      originalName: "หลักฐาน.png",
      declaredMimeType: "image/png",
    },
  };
}

beforeAll(async () => {
  const configured = process.env.DATABASE_URL;
  if (!configured)
    throw new Error("Explicit isolated evidence database required");
  const url = new URL(configured);
  if (
    url.hostname !== "127.0.0.1" ||
    !/^taky_deposit_test_[a-z0-9_]+$/.test(url.pathname.slice(1)) ||
    !url.username ||
    url.search ||
    url.hash
  )
    throw new Error("Owned loopback synthetic evidence database required");
  if (
    process.env.EVIDENCE_VALIDATOR_ORIGIN !== "http://127.0.0.1:3835" ||
    !/^[a-f0-9]{64}$/.test(process.env.EVIDENCE_VALIDATOR_TOKEN ?? "")
  )
    throw new Error("Explicit real isolated validator configuration required");
  observer = new Client({
    connectionString: configured,
    connectionTimeoutMillis: 10000,
    query_timeout: 10000,
  });
  await observer.connect();
  const expected = {
    database: url.pathname.slice(1),
    role: decodeURIComponent(url.username),
  };
  expect(
    (
      await observer.query(
        "SELECT current_database() AS database,current_user AS role",
      )
    ).rows,
  ).toEqual([expected]);
  expect(
    await db.$queryRaw`SELECT current_database() AS database,current_user AS role`,
  ).toEqual([expected]);
  const directory = path.resolve(".local/qa");
  await fs.mkdir(directory, { recursive: true, mode: 0o700 });
  root = await fs.realpath(
    await fs.mkdtemp(path.join(directory, "taky-deposit-test-failures-")),
  );
  await fs.chmod(root, 0o700);
  process.env.ATTACHMENT_DIR = root;
});
afterAll(async () => {
  if (originalRoot === undefined) delete process.env.ATTACHMENT_DIR;
  else process.env.ATTACHMENT_DIR = originalRoot;
  await observer?.end();
  await db.$disconnect();
});

async function retainedFiles() {
  const files = [];
  for (const directory of (await fs.readdir(root)).sort()) {
    const namespace = path.join(root, directory);
    const stat = await fs.lstat(namespace);
    expect(stat.isDirectory()).toBe(true);
    expect(stat.isSymbolicLink()).toBe(false);
    for (const name of (await fs.readdir(namespace)).sort()) {
      const file = path.join(namespace, name),
        actual = await fs.lstat(file);
      expect(actual.isFile()).toBe(true);
      expect(actual.isSymbolicLink()).toBe(false);
      expect(actual.uid).toBe(process.getuid?.());
      const bytes = await fs.readFile(file);
      files.push({
        storageKey: `${directory}/${name}`,
        bytes: bytes.length,
        sha256: createHash("sha256").update(bytes).digest("hex"),
      });
    }
  }
  return files;
}
async function acceptedState(f: Awaited<ReturnType<typeof fixture>>) {
  return {
    attachments: await db.attachment.findMany({
      where: { leaseId: f.lease.id },
      orderBy: { id: "asc" },
    }),
    evidence: await db.depositEvidence.findMany({
      where: { leaseId: f.lease.id },
      orderBy: { id: "asc" },
    }),
    audits: await db.auditLog.findMany({
      where: { actorId: f.admin.id, action: "DEPOSIT_EVIDENCE_ACCEPTED" },
      orderBy: { id: "asc" },
    }),
  };
}
async function admissionCount(f: Awaited<ReturnType<typeof fixture>>) {
  return db.auditLog.count({
    where: { actorId: f.admin.id, action: EVIDENCE_ADMISSION_ACTION },
  });
}
async function healthyUpload(f: Awaited<ReturnType<typeof fixture>>) {
  const saved = await uploadDepositEvidence({
    actor: f.admin,
    metadata: f.metadata,
    body: stream(),
  });
  expect(saved.sha256).toBe(createHash("sha256").update(png()).digest("hex"));
  expect(saved.bytes).toBe(png().length);
  const state = await acceptedState(f);
  expect(state.attachments).toHaveLength(1);
  expect(state.evidence).toHaveLength(1);
  expect(state.audits).toHaveLength(1);
  expect(state.evidence[0].attachmentId).toBe(state.attachments[0].id);
  expect(
    await fs.readFile(path.join(root, state.attachments[0].storageKey)),
  ).toEqual(png());
  return saved;
}

it("rolls back acceptance metadata after a scoped audit failure while preserving the published orphan and allowing a healthy retry", async () => {
  const f = await fixture(),
    beforeFiles = await retainedFiles(),
    before = await acceptedState(f);
  const name = `evidence_failure_${key().replaceAll("-", "")}`;
  await observer.query(`CREATE FUNCTION ${name}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
    IF NEW."actorId"='${f.admin.id}'::uuid AND NEW.action='DEPOSIT_EVIDENCE_ACCEPTED' THEN
      IF NOT EXISTS(SELECT 1 FROM "DepositEvidence" e JOIN "Attachment" a ON a.id=e."attachmentId" WHERE e."leaseId"='${f.lease.id}'::uuid AND a."leaseId"=e."leaseId") THEN
        RAISE EXCEPTION 'Synthetic failure did not reach provisional metadata';
      END IF;
      RAISE EXCEPTION 'Synthetic evidence acceptance audit failure';
    END IF;
    RETURN NEW;
  END $$`);
  try {
    await observer.query(
      `CREATE TRIGGER ${name} BEFORE INSERT ON "AuditLog" FOR EACH ROW EXECUTE FUNCTION ${name}()`,
    );
    try {
      await expect(
        uploadDepositEvidence({
          actor: f.admin,
          metadata: f.metadata,
          body: stream(),
        }),
      ).rejects.toThrow("Synthetic evidence acceptance audit failure");
    } finally {
      await observer.query(`DROP TRIGGER ${name} ON "AuditLog"`);
    }
  } finally {
    await observer.query(`DROP FUNCTION ${name}()`);
  }
  expect(await acceptedState(f)).toEqual(before);
  expect(await admissionCount(f)).toBe(1);
  const after = await retainedFiles(),
    originalKeys = new Set(beforeFiles.map((file) => file.storageKey));
  for (const file of beforeFiles) expect(after).toContainEqual(file);
  const orphan = after.filter((file) => !originalKeys.has(file.storageKey));
  expect(orphan).toHaveLength(1);
  expect(orphan[0]).toMatchObject({
    bytes: png().length,
    sha256: createHash("sha256").update(png()).digest("hex"),
  });
  expect(orphan[0].storageKey).toMatch(/^[a-f0-9-]{36}\/evidence$/);
  expect(
    await db.attachment.count({ where: { storageKey: orphan[0].storageKey } }),
  ).toBe(0);
  await healthyUpload(f);
  expect(await retainedFiles()).toContainEqual(orphan[0]);
  expect(await admissionCount(f)).toBe(2);
});

it("fails closed when only the synthetic actor's real admission backend is terminated during streaming", async () => {
  const f = await fixture(),
    before = await acceptedState(f),
    beforeFiles = await retainedFiles();
  const reading = Promise.withResolvers<void>(),
    release = Promise.withResolvers<void>();
  let cancelled = false;
  const body = new ReadableStream<Uint8Array>(
    {
      async pull(controller) {
        reading.resolve();
        await release.promise;
        if (!cancelled) {
          controller.enqueue(new Uint8Array(png()));
          controller.close();
        }
      },
      cancel() {
        cancelled = true;
      },
    },
    { highWaterMark: 0 },
  );
  const upload = uploadDepositEvidence({
    actor: f.admin,
    metadata: f.metadata,
    body,
  });
  const observed = upload.then(
    () => ({ accepted: true }),
    (error: unknown) => ({ accepted: false, error }),
  );
  try {
    await Promise.race([
      reading.promise,
      upload.then(() => {
        throw new Error("Upload completed before streaming barrier");
      }),
    ]);
    expect(await admissionCount(f)).toBe(1);
    const ownedLock = `FROM pg_locks l JOIN pg_stat_activity a ON a.pid=l.pid
      WHERE l.locktype='advisory' AND l.granted AND l.mode='ExclusiveLock' AND l.objsubid=1
      AND l.classid=((hashtextextended($1,0)>>32)&4294967295)::oid
      AND l.objid=(hashtextextended($1,0)&4294967295)::oid
      AND a.datname=current_database() AND a.usename=current_user AND a.pid<>pg_backend_pid()`;
    const identity = `deposit-evidence-admission:${f.admin.id}`;
    const owners = (
      await observer.query<{ pid: number }>(
        `SELECT DISTINCT a.pid ${ownedLock}`,
        [identity],
      )
    ).rows;
    expect(owners).toHaveLength(1);
    const killed = await observer.query<{ terminated: boolean }>(
      `SELECT pg_terminate_backend(a.pid) AS terminated ${ownedLock} AND a.pid=$2`,
      [identity, owners[0].pid],
    );
    expect(killed.rows).toEqual([{ terminated: true }]);
    let gone = false;
    for (let attempt = 0; attempt < 100; attempt++) {
      if (
        !(await observer.query(`SELECT 1 ${ownedLock}`, [identity])).rowCount
      ) {
        gone = true;
        break;
      }
      await delay(10);
    }
    expect(gone).toBe(true);
  } finally {
    release.resolve();
    await observed;
  }
  expect(await observed).toMatchObject({
    accepted: false,
    error: {
      code: expect.stringMatching(/^EVIDENCE_(ABORTED|ADMISSION_LOST)$/),
    },
  });
  expect(await acceptedState(f)).toEqual(before);
  expect(await retainedFiles()).toEqual(beforeFiles);
  expect(await admissionCount(f)).toBe(1);
  await healthyUpload(f);
});

it("rejects the actual upload service while an owned backup publication session holds the gate, then succeeds after release", async () => {
  const f = await fixture(),
    before = await acceptedState(f),
    beforeFiles = await retainedFiles();
  await observer.query("SELECT pg_advisory_lock($1)", [
    ATTACHMENT_PUBLICATION_KEY,
  ]);
  try {
    await expect(
      uploadDepositEvidence({
        actor: f.admin,
        metadata: f.metadata,
        body: stream(),
      }),
    ).rejects.toMatchObject({ code: "EVIDENCE_PUBLICATION_BUSY" });
    expect(await acceptedState(f)).toEqual(before);
    expect(await retainedFiles()).toEqual(beforeFiles);
    expect(await admissionCount(f)).toBe(1);
  } finally {
    expect(
      (
        await observer.query("SELECT pg_advisory_unlock($1) AS released", [
          ATTACHMENT_PUBLICATION_KEY,
        ])
      ).rows,
    ).toEqual([{ released: true }]);
  }
  await healthyUpload(f);
  expect(await admissionCount(f)).toBe(2);
});
