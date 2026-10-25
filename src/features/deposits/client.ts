import { z } from "zod";

export class DepositApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
  }
}
export async function depositRequest<T>(
  path: string,
  schema: z.ZodType<T>,
  body?: string | File,
  expectedActorId?: string,
) {
  const response = await fetch(path, {
    method: body === undefined ? "GET" : "POST",
    credentials: "same-origin",
    cache: "no-store",
    signal: AbortSignal.timeout(body === undefined ? 10000 : 75000),
    body,
    headers:
      body === undefined
        ? undefined
        : {
            "Content-Type":
              typeof body === "string" ? "application/json" : body.type,
            ...(expectedActorId
              ? { "X-Taky-Deposit-Actor": expectedActorId }
              : {}),
          },
  });
  let raw: unknown;
  try {
    raw = await response.json();
  } catch {
    throw new DepositApiError(
      response.status,
      "INVALID_RESPONSE",
      "ระบบตอบกลับไม่สมบูรณ์ กรุณาตรวจสอบผลด้วยคำสั่งเดิม",
    );
  }
  if (!response.ok) {
    const error = z
      .object({ error: z.object({ code: z.string(), message: z.string() }) })
      .safeParse(raw);
    throw new DepositApiError(
      response.status,
      error.success ? error.data.error.code : "INVALID_RESPONSE",
      error.success ? error.data.error.message : "ไม่สามารถอ่านผลจากระบบได้",
    );
  }
  const result = z.object({ data: schema }).safeParse(raw);
  if (!result.success)
    throw new DepositApiError(
      response.status,
      "INVALID_RESPONSE",
      "ข้อมูลตอบกลับไม่ครบ กรุณาตรวจสอบผลด้วยคำสั่งเดิม",
    );
  return result.data.data;
}
export const depositSessionSchema = z.strictObject({
  id: z.uuid(),
  role: z.enum(["ADMIN", "STAFF"]),
});
