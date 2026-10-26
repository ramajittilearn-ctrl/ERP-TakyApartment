import { randomBytes, randomUUID } from "node:crypto";
import { deflateSync } from "node:zlib";
import fs from "node:fs/promises";
import path from "node:path";
import { afterAll, afterEach, beforeAll, expect, it, vi } from "vitest";
import { db } from "../../src/server/db";
import { AppError } from "../../src/server/errors";
import { tokenHash } from "../../src/server/auth";
import {
  evidenceDtoSchema,
  getDepositEvidenceDownload,
  listDepositEvidence,
  lockAndVerifyDepositEvidence,
  uploadDepositEvidence,
} from "../../src/server/evidence";
import { retainedEvidenceBytes } from "../../src/server/evidence/storage";
import { EVIDENCE_ADMISSION_ACTION } from "../../src/server/evidence/contracts";
const cookie = vi.hoisted((): { token?: string } => ({}));
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) =>
      name === "taky_session" && cookie.token
        ? { value: cookie.token }
        : undefined,
  }),
}));
vi.mock("@/server/http", async () => import("../../src/server/http"));
vi.mock("@/server/errors", async () => import("../../src/server/errors"));
vi.mock("@/server/evidence", async () => import("../../src/server/evidence"));
vi.mock(
  "@/server/evidence/contracts",
  async () => import("../../src/server/evidence/contracts"),
);
vi.mock(
  "@/server/evidence/query",
  async () => import("../../src/server/evidence/query"),
);
import { POST } from "../../src/app/api/v1/deposit-evidence/route";
import { GET as DOWNLOAD } from "../../src/app/api/v1/deposit-evidence/[id]/download/route";
const key = () => randomUUID();
let root: string;
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
beforeAll(async () => {
  if (!process.env.DATABASE_URL)
    throw new Error("Explicit isolated deposit evidence database required");
  const url = new URL(process.env.DATABASE_URL);
  if (
    url.hostname !== "127.0.0.1" ||
    !/^taky_deposit_test_[a-z0-9_]+$/.test(url.pathname.slice(1)) ||
    !url.username ||
    url.search ||
    url.hash
  )
    throw new Error(
      "Owned loopback synthetic deposit evidence database required",
    );
  expect(
    await db.$queryRaw<
      { database: string; role: string }[]
    >`SELECT current_database() AS database,current_user AS role`,
  ).toEqual([
    { database: url.pathname.slice(1), role: decodeURIComponent(url.username) },
  ]);
  if (
    process.env.EVIDENCE_VALIDATOR_ORIGIN !== "http://127.0.0.1:3835" ||
    !/^[a-f0-9]{64}$/.test(process.env.EVIDENCE_VALIDATOR_TOKEN ?? "")
  )
    throw new Error("Explicit real isolated validator configuration required");
  const directory = path.resolve(".local/qa");
  await fs.mkdir(directory, { recursive: true, mode: 0o700 });
  root = await fs.realpath(
    await fs.mkdtemp(path.join(directory, "taky-deposit-test-files-")),
  );
  await fs.chmod(root, 0o700);
  process.env.ATTACHMENT_DIR = root;
});
afterEach(() => {
  cookie.token = undefined;
  vi.unstubAllEnvs();
});
afterAll(async () => {
  if (originalRoot === undefined) delete process.env.ATTACHMENT_DIR;
  else process.env.ATTACHMENT_DIR = originalRoot;
  await db.$disconnect();
});
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
it("accepts actual validator-checked retained bytes through a genuine stored session and downloads them", async () => {
  const f = await fixture(),
    token = randomBytes(32).toString("hex");
  cookie.token = token;
  await db.session.create({
    data: {
      userId: f.admin.id,
      tokenHash: tokenHash(token),
      expiresAt: new Date(Date.now() + 3600000),
    },
  });
  vi.stubEnv("APP_ORIGIN", "http://127.0.0.1:3820");
  const query = new URLSearchParams({
    leaseId: f.lease.id,
    originalName: f.metadata.originalName,
  });
  const response = await POST(
    new Request(`http://127.0.0.1:3820/api/v1/deposit-evidence/?${query}`, {
      method: "POST",
      headers: { origin: "http://127.0.0.1:3820", "content-type": "image/png" },
      body: new Uint8Array(png()),
    }),
  );
  expect(response.status).toBe(201);
  const body: unknown = await response.json();
  if (!body || typeof body !== "object" || !("data" in body))
    throw new Error("Expected stored upload envelope");
  const saved = evidenceDtoSchema.parse(body.data);
  expect(saved).toMatchObject({
    leaseId: f.lease.id,
    originalName: f.metadata.originalName,
    mimeType: "image/png",
    bytes: png().length,
    uploadedById: f.admin.id,
  });
  expect(Object.keys(saved)).not.toContain("storageKey");
  const listed = await listDepositEvidence(f.staff, { leaseId: f.lease.id });
  expect(listed.total).toBe(1);
  expect(listed.items[0].id).toBe(saved.id);
  expect(
    await db.$transaction((tx) =>
      lockAndVerifyDepositEvidence(tx, {
        leaseId: f.lease.id,
        evidenceId: saved.id,
      }),
    ),
  ).toMatchObject({ evidenceId: saved.id });
  const download = await DOWNLOAD(
    new Request(
      `http://127.0.0.1:3820/api/v1/deposit-evidence/${saved.id}/download/`,
    ),
    { params: Promise.resolve({ id: saved.id }) },
  );
  expect(download.status).toBe(200);
  expect(download.headers.get("cache-control")).toBe("no-store");
  expect(download.headers.get("content-disposition")).toContain("attachment;");
  expect(Buffer.from(await download.arrayBuffer())).toEqual(png());
  expect(
    await db.auditLog.count({
      where: { actorId: f.admin.id, action: EVIDENCE_ADMISSION_ACTION },
    }),
  ).toBe(1);
  expect(
    await db.auditLog.count({
      where: { actorId: f.admin.id, action: "DEPOSIT_EVIDENCE_ACCEPTED" },
    }),
  ).toBe(1);
});
it("denies STAFF and disabled ADMIN before durable admission or accepted metadata", async () => {
  const f = await fixture();
  await expect(
    uploadDepositEvidence({
      actor: f.staff,
      metadata: f.metadata,
      body: stream(),
    }),
  ).rejects.toMatchObject({ status: 403 });
  await db.user.update({ where: { id: f.admin.id }, data: { disabled: true } });
  await expect(
    uploadDepositEvidence({
      actor: f.admin,
      metadata: f.metadata,
      body: stream(),
    }),
  ).rejects.toMatchObject({ status: 403 });
  expect(
    await db.auditLog.count({
      where: { actorId: f.admin.id, action: EVIDENCE_ADMISSION_ACTION },
    }),
  ).toBe(0);
  expect(
    await db.depositEvidence.count({ where: { leaseId: f.lease.id } }),
  ).toBe(0);
});
it("counts admitted invalid files and hard streaming failures in the durable rolling limit", async () => {
  const f = await fixture();
  vi.stubEnv("DEPOSIT_EVIDENCE_MAX_ATTEMPTS", "2");
  await expect(
    uploadDepositEvidence({
      actor: f.admin,
      metadata: { ...f.metadata, declaredMimeType: "application/pdf" },
      body: stream(Buffer.from("<html>not a PDF</html>")),
    }),
  ).rejects.toMatchObject({ code: "EVIDENCE_FORMAT" });
  await expect(
    uploadDepositEvidence({
      actor: f.admin,
      metadata: f.metadata,
      body: stream(Buffer.alloc(5242881)),
    }),
  ).rejects.toMatchObject({ code: "EVIDENCE_TOO_LARGE" });
  await expect(
    uploadDepositEvidence({
      actor: f.admin,
      metadata: f.metadata,
      body: stream(),
    }),
  ).rejects.toMatchObject({ code: "EVIDENCE_RATE_LIMITED" });
  expect(
    await db.auditLog.count({
      where: { actorId: f.admin.id, action: EVIDENCE_ADMISSION_ACTION },
    }),
  ).toBe(2);
  expect(
    await db.depositEvidence.count({ where: { leaseId: f.lease.id } }),
  ).toBe(0);
});
it("holds the real actor session lock across streaming and rejects a simultaneous upload without counting it", async () => {
  const f = await fixture();
  const reading = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  const body = new ReadableStream<Uint8Array>(
    {
      async pull(controller) {
        reading.resolve();
        await release.promise;
        controller.enqueue(new Uint8Array(png()));
        controller.close();
      },
    },
    { highWaterMark: 0 },
  );
  const first = uploadDepositEvidence({
    actor: f.admin,
    metadata: f.metadata,
    body,
  });
  await Promise.race([
    reading.promise,
    first.then(() => {
      throw new Error("First upload completed before streaming barrier");
    }),
  ]);
  try {
    await expect(
      uploadDepositEvidence({
        actor: f.admin,
        metadata: f.metadata,
        body: stream(),
      }),
    ).rejects.toMatchObject({ code: "EVIDENCE_UPLOAD_BUSY" });
  } finally {
    release.resolve();
  }
  await first;
  expect(
    await db.auditLog.count({
      where: { actorId: f.admin.id, action: EVIDENCE_ADMISSION_ACTION },
    }),
  ).toBe(1);
  expect(
    await db.depositEvidence.count({ where: { leaseId: f.lease.id } }),
  ).toBe(1);
});
it("serializes two actors competing for the last retained-file capacity without exceeding actual bytes", async () => {
  const first = await fixture(),
    second = await fixture(),
    before = await retainedEvidenceBytes(root),
    limit = before + BigInt(png().length);
  vi.stubEnv("DEPOSIT_EVIDENCE_MAX_RETAINED_BYTES", String(limit));
  const outcomes = await Promise.allSettled([
    uploadDepositEvidence({
      actor: first.admin,
      metadata: first.metadata,
      body: stream(),
    }),
    uploadDepositEvidence({
      actor: second.admin,
      metadata: second.metadata,
      body: stream(),
    }),
  ]);
  expect(outcomes.filter((x) => x.status === "fulfilled")).toHaveLength(1);
  for (const outcome of outcomes)
    if (outcome.status === "rejected") {
      const reason: unknown = outcome.reason;
      if (!(reason instanceof AppError)) throw reason;
      expect(["EVIDENCE_PUBLICATION_BUSY", "EVIDENCE_STORAGE_FULL"]).toContain(
        reason.code,
      );
    }
  expect(await retainedEvidenceBytes(root)).toBe(limit);
  expect(
    await db.depositEvidence.count({
      where: { leaseId: { in: [first.lease.id, second.lease.id] } },
    }),
  ).toBe(1);
});
it("does not authorize financial use after same-length file tampering or for a different lease", async () => {
  const f = await fixture(),
    saved = await uploadDepositEvidence({
      actor: f.admin,
      metadata: f.metadata,
      body: stream(),
    });
  const row = await db.depositEvidence.findUniqueOrThrow({
    where: { id: saved.id },
    include: { attachment: true },
  });
  await expect(
    db.$transaction((tx) =>
      lockAndVerifyDepositEvidence(tx, {
        leaseId: key(),
        evidenceId: saved.id,
      }),
    ),
  ).rejects.toMatchObject({ code: "EVIDENCE_NOT_FOUND" });
  const file = path.join(root, row.attachment.storageKey);
  await fs.chmod(file, 0o600);
  const original = await fs.readFile(file);
  try {
    await fs.writeFile(file, Buffer.alloc(original.length));
    await expect(
      db.$transaction((tx) =>
        lockAndVerifyDepositEvidence(tx, {
          leaseId: f.lease.id,
          evidenceId: saved.id,
        }),
      ),
    ).rejects.toMatchObject({ code: "EVIDENCE_FILE_INVALID" });
    await expect(
      getDepositEvidenceDownload(f.staff, saved.id),
    ).rejects.toMatchObject({ code: "EVIDENCE_FILE_INVALID" });
  } finally {
    await fs.writeFile(file, original);
    await fs.chmod(file, 0o400);
  }
});
