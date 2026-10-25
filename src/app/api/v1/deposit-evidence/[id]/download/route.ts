import { handle, requireActor } from "@/server/http";
import { getDepositEvidenceDownload } from "@/server/evidence";
import { requireNoEvidenceQuery } from "@/server/evidence/query";
export function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  return handle(async () => {
    const actor = await requireActor();
    requireNoEvidenceQuery(new URL(request.url).searchParams);
    const result = await getDepositEvidenceDownload(
      actor,
      (await context.params).id,
    );
    const filename = encodeURIComponent(result.metadata.originalName)
      .replaceAll("'", "%27")
      .replaceAll("(", "%28")
      .replaceAll(")", "%29");
    return new Response(result.body, {
      headers: {
        "Content-Type": result.metadata.mimeType,
        "Content-Length": String(result.metadata.bytes),
        "Content-Disposition": `attachment; filename="evidence"; filename*=UTF-8''${filename}`,
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  });
}
