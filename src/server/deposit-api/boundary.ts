import { z } from "zod";
import {
  deductionDepositInput,
  depositId,
  receiptDepositInput,
  refundDepositInput,
  reversalDepositInput,
  reviewDepositInput,
} from "../deposits/contracts";
import { AppError } from "../errors";
import { checkOrigin, readJson, requireActor } from "../http";

const integer = z
  .string()
  .regex(/^(?:0|[1-9]\d*)$/)
  .transform(Number);
const pageSchema = z.strictObject({
  offset: integer.pipe(z.number().int().min(0).max(100000)).default(0),
  limit: integer.pipe(z.number().int().min(1).max(100)).default(50),
});
export function depositPageQuery(params: URLSearchParams) {
  const fields: Record<string, string> = Object.create(null);
  for (const [key, value] of params) {
    if (Object.hasOwn(fields, key))
      throw new AppError(422, "VALIDATION", "ห้ามระบุพารามิเตอร์ซ้ำ");
    fields[key] = value;
  }
  return pageSchema.parse(fields);
}
export function depositSsrQuery(
  raw: Record<string, string | string[] | undefined>,
) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(raw)) {
    if (Array.isArray(value))
      for (const item of value) params.append(key, item);
    else if (value !== undefined) params.append(key, value);
  }
  return depositPageQuery(params);
}
export function noDepositQuery(request: Request) {
  if (new URL(request.url).searchParams.size)
    throw new AppError(422, "VALIDATION", "คำขอนี้ไม่รับพารามิเตอร์เพิ่มเติม");
}
export async function depositMutation(request: Request) {
  checkOrigin(request);
  const actor = await requireActor();
  if (actor.role !== "ADMIN")
    throw new AppError(403, "FORBIDDEN", "เฉพาะผู้ดูแลระบบเท่านั้น");
  const expectedActor = depositId.safeParse(
    request.headers.get("x-taky-deposit-actor"),
  );
  if (!expectedActor.success || expectedActor.data !== actor.id)
    throw new AppError(
      403,
      "SESSION_CHANGED",
      "ผู้ทำรายการไม่ตรงกับผู้ใช้ปัจจุบัน กรุณาตรวจสอบผลด้วยผู้ทำรายการเดิม",
    );
  noDepositQuery(request);
  const contentType = request.headers.get("content-type") ?? "";
  if (
    !/^application\/json(?:\s*;\s*charset=(?:utf-8|"utf-8"))?\s*$/i.test(
      contentType,
    )
  )
    throw new AppError(415, "CONTENT_TYPE", "ต้องส่งข้อมูล JSON แบบ UTF-8");
  const encoding = request.headers.get("content-encoding");
  if (encoding && encoding !== "identity")
    throw new AppError(
      415,
      "CONTENT_ENCODING",
      "ต้องส่งข้อมูลโดยไม่บีบอัดคำขอ",
    );
  const length = request.headers.get("content-length");
  if (
    length !== null &&
    (!/^(?:0|[1-9]\d*)$/.test(length) || BigInt(length) > 16384n)
  )
    throw new AppError(
      413,
      "BODY_TOO_LARGE",
      "ข้อมูลมีขนาดใหญ่เกินไปหรือขนาดไม่ถูกต้อง",
    );
  return {
    actor,
    body: z.record(z.string(), z.unknown()).parse(await readJson(request)),
  };
}
const actionSchema = z.enum(["review", "receipts", "deductions", "refunds"]);
export function leaseDepositCommand(
  action: string,
  id: string,
  body: Record<string, unknown>,
) {
  if (Object.hasOwn(body, "leaseId"))
    throw new AppError(422, "VALIDATION", "ใช้สัญญาจากเส้นทางคำขอเท่านั้น");
  const command = { ...body, leaseId: depositId.parse(id) };
  switch (actionSchema.parse(action)) {
    case "review":
      return {
        kind: "review" as const,
        command: reviewDepositInput.parse(command),
      };
    case "receipts":
      return {
        kind: "receipts" as const,
        command: receiptDepositInput.parse(command),
      };
    case "deductions":
      return {
        kind: "deductions" as const,
        command: deductionDepositInput.parse(command),
      };
    case "refunds":
      return {
        kind: "refunds" as const,
        command: refundDepositInput.parse(command),
      };
  }
}
export function reverseDepositCommand(
  id: string,
  body: Record<string, unknown>,
) {
  if (Object.hasOwn(body, "entryId"))
    throw new AppError(422, "VALIDATION", "ใช้รายการจากเส้นทางคำขอเท่านั้น");
  return reversalDepositInput.parse({ ...body, entryId: depositId.parse(id) });
}
