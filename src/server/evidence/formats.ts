import { z } from "zod";
import { AppError } from "../errors";
import { evidenceMime, MAX_EVIDENCE_BYTES } from "./contracts";
import { readStagedEvidence, type StagedEvidence } from "./storage";

const resultSchema = z.strictObject({
  valid: z.literal(true),
  mimeType: evidenceMime,
  bytes: z.number().int().positive().max(MAX_EVIDENCE_BYTES),
});
const hosts = new Set([
  "127.0.0.1",
  "localhost",
  "[::1]",
  "evidence-validator",
]);
function unavailable(): never {
  throw new AppError(
    503,
    "EVIDENCE_VALIDATOR_UNAVAILABLE",
    "ระบบตรวจไฟล์หลักฐานยังไม่พร้อม กรุณาลองใหม่ภายหลัง",
  );
}
export function evidenceValidatorConfiguration() {
  const origin = process.env.EVIDENCE_VALIDATOR_ORIGIN;
  const token = process.env.EVIDENCE_VALIDATOR_TOKEN;
  if (!origin || !token || !/^[a-f0-9]{64}$/.test(token)) unavailable();
  let url: URL;
  try {
    url = new URL(origin);
  } catch {
    return unavailable();
  }
  if (
    url.protocol !== "http:" ||
    !hosts.has(url.hostname) ||
    url.port !== "3835" ||
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash
  )
    unavailable();
  return { url: new URL("/validate", url), token };
}
export async function validateStagedEvidence(
  staged: StagedEvidence,
  declaredMimeType: string,
  signal?: AbortSignal,
) {
  const declared = evidenceMime.safeParse(declaredMimeType);
  if (!declared.success)
    throw new AppError(415, "EVIDENCE_TYPE", "รองรับเฉพาะ PDF JPEG และ PNG");
  const { url, token } = evidenceValidatorConfiguration();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10000);
  const combined = signal
    ? AbortSignal.any([signal, controller.signal])
    : controller.signal;
  try {
    combined.throwIfAborted();
    const bytes = await readStagedEvidence(staged);
    const response = await fetch(url, {
      method: "POST",
      redirect: "error",
      signal: combined,
      headers: {
        "Content-Type": declared.data,
        "x-taky-validator-token": token,
      },
      body: new Uint8Array(bytes),
    });
    if (!response.ok) {
      await response.body?.cancel();
      if (
        response.status >= 500 ||
        response.status === 401 ||
        response.status === 403 ||
        response.status === 429
      )
        unavailable();
      throw new AppError(
        422,
        "EVIDENCE_FORMAT",
        "ไฟล์หลักฐานไม่ผ่านการตรวจรูปแบบ",
      );
    }
    if (!response.headers.get("content-type")?.startsWith("application/json")) {
      await response.body?.cancel();
      unavailable();
    }
    const reader = response.body?.getReader();
    if (!reader) unavailable();
    const chunks: Uint8Array[] = [];
    let count = 0;
    try {
      for (;;) {
        const item = await reader.read();
        if (item.done) break;
        count += item.value.byteLength;
        if (count > 1024) {
          await reader.cancel();
          unavailable();
        }
        chunks.push(item.value);
      }
    } finally {
      reader.releaseLock();
    }
    let raw: unknown;
    try {
      raw = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    } catch {
      return unavailable();
    }
    const parsed = resultSchema.safeParse(raw);
    if (!parsed.success) unavailable();
    if (
      parsed.data.bytes !== staged.bytes ||
      parsed.data.mimeType !== declared.data
    )
      throw new AppError(
        422,
        "EVIDENCE_FORMAT",
        "ชนิดหรือขนาดไฟล์หลักฐานไม่ตรงกับข้อมูลที่ส่ง",
      );
    return parsed.data;
  } catch (error) {
    if (error instanceof AppError) throw error;
    if (signal?.aborted)
      throw new AppError(408, "EVIDENCE_ABORTED", "ยกเลิกการรับไฟล์หลักฐาน");
    return unavailable();
  } finally {
    clearTimeout(timer);
  }
}
