import { db } from "@/server/db";
import { browserTestTarget, targetProof } from "@/server/browser-test-target";
export const dynamic = "force-dynamic";
const safeErrorNames = new Set([
  "Error",
  "TypeError",
  "PrismaClientKnownRequestError",
  "PrismaClientUnknownRequestError",
  "PrismaClientInitializationError",
  "PrismaClientRustPanicError",
  "ZodError",
]);
const safeConnectionCodes = new Set([
  "ECONNREFUSED",
  "ECONNRESET",
  "ETIMEDOUT",
  "EPIPE",
  "ENOTFOUND",
  "08000",
  "08001",
  "08003",
  "08004",
  "08006",
  "08007",
  "08P01",
  "53300",
  "57P01",
  "57P02",
  "57P03",
]);
export async function GET(request: Request) {
  let stage: "probe" | "target-config" | "identity" = "probe";
  try {
    await db.$queryRaw`SELECT 1`;
    const nonce = request.headers.get("X-Taky-Test-Challenge");
    if (process.env.E2E_RUN_ID && nonce && /^[a-f0-9]{64}$/.test(nonce)) {
      stage = "target-config";
      const target = browserTestTarget();
      stage = "identity";
      const rows = await db.$queryRaw<{ database: string; role: string }[]>`
        SELECT current_database() AS database, current_user AS role`;
      const identity = rows[0];
      if (
        identity?.database !== target.database ||
        identity.role !== target.role
      )
        throw new Error("Test database identity mismatch");
      const value = { runId: target.runId, ...identity };
      return Response.json(
        {
          status: "ok",
          target: { ...value, proof: targetProof(target.secret, nonce, value) },
        },
        { headers: { "Cache-Control": "no-store" } },
      );
    }
    return Response.json(
      { status: "ok" },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    if (process.env.E2E_RUN_ID) {
      const errorClass =
        error instanceof Error && safeErrorNames.has(error.name)
          ? error.name
          : "Unknown";
      const code =
        error !== null &&
        typeof error === "object" &&
        "code" in error &&
        typeof error.code === "string" &&
        (/^P[0-9]{4}$/.test(error.code) || safeConnectionCodes.has(error.code))
          ? error.code
          : undefined;
      console.error(
        JSON.stringify({ event: "e2e_health_failed", stage, errorClass, code }),
      );
    }
    return Response.json({ status: "unavailable" }, { status: 503 });
  }
}
