import { z } from "zod";
import { handle, requireActor } from "@/server/http";
import { getReceipt } from "@/server/payments";
import { receiptPdfFilename, renderReceiptPdf } from "@/server/payments/pdf";

export const runtime = "nodejs";
type Context = { params: Promise<{ id: string }> };

export function GET(request: Request, context: Context) {
  return handle(async () => {
    const actor = await requireActor();
    const id = z.uuid().parse((await context.params).id);
    const query = new URL(request.url).searchParams;
    for (const [key] of query)
      z.literal(true).parse(
        key === "download" && query.getAll(key).length === 1,
      );
    const download = z
      .literal("1")
      .optional()
      .parse(query.get("download") ?? undefined);
    const receipt = await getReceipt(actor, id);
    const bytes = await renderReceiptPdf(receipt);
    return new Response(Buffer.from(bytes), {
      headers: {
        "Content-Type": "application/pdf",
        "Cache-Control": "private, no-store, max-age=0",
        "Content-Disposition": `${download ? "attachment" : "inline"}; filename="${receiptPdfFilename(receipt.snapshot.number)}"`,
        "Content-Length": String(bytes.byteLength),
        "X-Content-Type-Options": "nosniff",
      },
    });
  });
}
