import { db } from "@/server/db";
import { browserTestTarget, targetProof } from "@/server/browser-test-target";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  try {
    await db.$queryRaw`SELECT 1`;
    const nonce = request.headers.get("X-Taky-Test-Challenge");
    if (process.env.E2E_RUN_ID && nonce && /^[a-f0-9]{64}$/.test(nonce)) {
      const target = browserTestTarget();
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
  } catch {
    return Response.json({ status: "unavailable" }, { status: 503 });
  }
}
