import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { Prisma } from "@prisma/client";
import { ZodError } from "zod";
import { COOKIE, sessionActor } from "./auth";
import { AppError } from "./errors";

export async function requireActor() {
  const actor = await sessionActor((await cookies()).get(COOKIE)?.value);
  if (!actor) throw new AppError(401, "UNAUTHENTICATED", "กรุณาเข้าสู่ระบบ");
  return actor;
}
export async function requirePageActor() {
  const actor = await sessionActor((await cookies()).get(COOKIE)?.value);
  if (!actor) redirect("/login/");
  return actor;
}
export function checkOrigin(request: Request) {
  const expected = process.env.APP_ORIGIN;
  if (!expected) throw new AppError(403, "ORIGIN", "ต้นทางคำขอไม่ถูกต้อง");
  const origin = new URL(expected);
  if (request.headers.get("origin") !== origin.origin)
    throw new AppError(403, "ORIGIN", "ต้นทางคำขอไม่ถูกต้อง");
  return origin;
}
export async function readJson(request: Request) {
  if (!request.headers.get("content-type")?.startsWith("application/json"))
    throw new AppError(415, "CONTENT_TYPE", "ต้องส่งข้อมูล JSON");
  if (Number(request.headers.get("content-length") || 0) > 16384)
    throw new AppError(413, "BODY_TOO_LARGE", "ข้อมูลมีขนาดใหญ่เกินไป");
  const reader = request.body?.getReader();
  if (!reader) throw new AppError(400, "JSON", "ข้อมูล JSON ไม่ถูกต้อง");
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > 16384) {
      await reader.cancel();
      throw new AppError(413, "BODY_TOO_LARGE", "ข้อมูลมีขนาดใหญ่เกินไป");
    }
    chunks.push(value);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
  } catch {
    throw new AppError(400, "JSON", "ข้อมูล JSON ไม่ถูกต้อง");
  }
}
export function json(data: unknown, status = 200) {
  return Response.json(
    { data },
    { status, headers: { "Cache-Control": "no-store" } },
  );
}
export async function handle(work: () => Promise<Response>) {
  try {
    return await work();
  } catch (error) {
    let status = 500,
      code = "INTERNAL",
      message = "ไม่สามารถดำเนินการได้ กรุณาลองอีกครั้ง";
    if (error instanceof AppError) {
      ({ status, code, message } = error);
    } else if (error instanceof ZodError) {
      status = 422;
      code = "VALIDATION";
      message = error.issues
        .map((i) => `${i.path.join(".")}: ${i.message}`)
        .join("; ");
    } else if (error instanceof Prisma.PrismaClientKnownRequestError) {
      if (error.code === "P2025") {
        status = 404;
        code = "NOT_FOUND";
        message = "ไม่พบข้อมูล";
      } else if (["P2002", "P2003", "P2004", "P2034"].includes(error.code)) {
        status = 409;
        code = "CONFLICT";
        message =
          "ข้อมูลซ้ำ มีการใช้งาน หรือมีผู้แก้ไขพร้อมกัน กรุณาตรวจสอบและลองอีกครั้ง";
      }
    }
    if (status === 500)
      console.error(
        JSON.stringify({
          event: "request_failed",
          type: error instanceof Error ? error.name : "unknown",
        }),
      );
    return Response.json(
      { error: { code, message } },
      { status, headers: { "Cache-Control": "no-store" } },
    );
  }
}
