import { z } from "zod";
import {
  balanceDtoSchema,
  paymentDtoSchema,
} from "../../server/payments/contracts";
const page = {
  scope: z.literal("managed-only"),
  offset: z.number().int().nonnegative(),
  limit: z.number().int().min(1).max(100),
};
export const paymentPageSchema = z.strictObject({
  ...page,
  items: z.array(paymentDtoSchema),
});
export const balancePageSchema = z.strictObject({
  ...page,
  items: z.array(balanceDtoSchema),
});
const errorSchema = z.object({
  error: z.object({ code: z.string(), message: z.string() }),
});
export class PaymentApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
  }
}
export async function paymentRequest<T>({
  path,
  schema,
  body,
  signal,
}: {
  path: string;
  schema: z.ZodType<T>;
  body?: string;
  signal?: AbortSignal;
}): Promise<T> {
  const [pathname, query] = path.split("?", 2);
  const url = `/api/v1/${pathname.endsWith("/") ? pathname : `${pathname}/`}${query === undefined ? "" : `?${query}`}`;
  const response = await fetch(url, {
    method: body === undefined ? "GET" : "POST",
    body,
    signal,
    headers:
      body === undefined ? undefined : { "Content-Type": "application/json" },
    cache: "no-store",
    credentials: "same-origin",
  });
  const text = await response.text();
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new PaymentApiError(
      response.status,
      "INVALID_RESPONSE",
      "ระบบตอบกลับไม่สมบูรณ์ กรุณาตรวจสอบผลก่อนทำรายการใหม่",
    );
  }
  if (!response.ok) {
    const parsed = errorSchema.safeParse(value);
    throw new PaymentApiError(
      response.status,
      parsed.success ? parsed.data.error.code : "INVALID_RESPONSE",
      parsed.success ? parsed.data.error.message : "ไม่สามารถอ่านผลจากระบบได้",
    );
  }
  const parsed = z.object({ data: schema }).safeParse(value);
  if (!parsed.success)
    throw new PaymentApiError(
      response.status,
      "INVALID_RESPONSE",
      "ข้อมูลตอบกลับไม่ตรงรูปแบบ กรุณาตรวจสอบผลก่อนทำรายการใหม่",
    );
  return parsed.data.data;
}
