import { randomUUID } from "node:crypto";
import { Client } from "pg";
import { AppError } from "../errors";
import type { Actor } from "../services";
import { EVIDENCE_ADMISSION_ACTION, type EvidenceLimits } from "./contracts";

type Admission = { attemptId: string; signal: AbortSignal; assertHeld(): void };
export async function withEvidenceAdmission<T>(
  input: {
    actor: Actor;
    leaseId: string;
    limits: EvidenceLimits;
    signal?: AbortSignal;
  },
  work: (admission: Admission) => Promise<T>,
): Promise<T> {
  if (input.actor.role !== "ADMIN")
    throw new AppError(403, "FORBIDDEN", "เฉพาะผู้ดูแลระบบเท่านั้น");
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString)
    throw new Error(
      "Explicit database configuration required for evidence admission",
    );
  const client = new Client({
    connectionString,
    connectionTimeoutMillis: 10000,
    query_timeout: 10000,
  });
  const ownership = new AbortController();
  let held = false,
    closing = false,
    lost = false;
  const lose = () => {
    if (!closing) {
      lost = true;
      ownership.abort();
    }
  };
  client.on("error", lose);
  client.on("end", lose);
  function assertHeld() {
    if (!held || lost)
      throw new AppError(
        503,
        "EVIDENCE_ADMISSION_LOST",
        "ไม่สามารถยืนยันสิทธิ์การรับไฟล์หลักฐานได้",
      );
  }
  try {
    await client.connect();
    const result = await client.query<{ acquired: boolean }>(
      "SELECT pg_try_advisory_lock(hashtextextended($1,0)) AS acquired",
      [`deposit-evidence-admission:${input.actor.id}`],
    );
    if (result.rows[0]?.acquired !== true)
      throw new AppError(
        409,
        "EVIDENCE_UPLOAD_BUSY",
        "กำลังรับหลักฐานของผู้ใช้นี้ กรุณาลองใหม่ภายหลัง",
      );
    held = true;
    await client.query("BEGIN");
    let attemptId: string;
    try {
      const actor = await client.query<{ id: string }>(
        "SELECT id FROM \"User\" WHERE id=$1::uuid AND role='ADMIN' AND disabled=false",
        [input.actor.id],
      );
      if (!actor.rows.length)
        throw new AppError(
          403,
          "FORBIDDEN",
          "เฉพาะผู้ดูแลระบบที่เปิดใช้งานเท่านั้น",
        );
      const lease = await client.query<{ id: string }>(
        'SELECT l.id FROM "Lease" l JOIN "Tenant" t ON t.id=l."tenantId" WHERE l.id=$1::uuid AND l."isDemo"=false AND t."isDemo"=false',
        [input.leaseId],
      );
      if (!lease.rows.length)
        throw new AppError(
          404,
          "LEASE_NOT_FOUND",
          "ไม่พบสัญญาเช่าที่รับหลักฐานได้",
        );
      const count = await client.query<{ count: string }>(
        'SELECT count(*)::text AS count FROM "AuditLog" WHERE "actorId"=$1::uuid AND action=$2 AND "createdAt">clock_timestamp()-($3::bigint * interval \'1 millisecond\')',
        [
          input.actor.id,
          EVIDENCE_ADMISSION_ACTION,
          input.limits.windowMilliseconds,
        ],
      );
      if (
        BigInt(count.rows[0]?.count ?? "0") >= BigInt(input.limits.maxAttempts)
      )
        throw new AppError(
          429,
          "EVIDENCE_RATE_LIMITED",
          "รับไฟล์หลักฐานครบจำนวนที่กำหนด กรุณาลองใหม่ภายหลัง",
        );
      attemptId = randomUUID();
      await client.query(
        'INSERT INTO "AuditLog" (id,"actorId",action,entity,"entityId",metadata) VALUES ($1::uuid,$2::uuid,$3,\'deposit-evidence\',NULL,$4::jsonb)',
        [
          randomUUID(),
          input.actor.id,
          EVIDENCE_ADMISSION_ACTION,
          JSON.stringify({ leaseId: input.leaseId, attemptId }),
        ],
      );
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK").catch(() => {});
      throw error;
    }
    assertHeld();
    const signal = input.signal
      ? AbortSignal.any([input.signal, ownership.signal])
      : ownership.signal;
    signal.throwIfAborted();
    const value = await work({ attemptId, signal, assertHeld });
    assertHeld();
    return value;
  } finally {
    closing = true;
    if (held && !lost)
      await client
        .query("SELECT pg_advisory_unlock(hashtextextended($1,0))", [
          `deposit-evidence-admission:${input.actor.id}`,
        ])
        .catch(() => {});
    await client.end().catch(() => {});
  }
}
