import { getInvoicePdfDocument } from "@/server/invoices";
import { renderInvoicePdf, invoicePdfFilename } from "@/server/invoices/pdf";
import { handle, requireActor } from "@/server/http";

type Context = { params: Promise<{ id: string }> };

export const runtime = "nodejs";

export function GET(_request: Request, context: Context) {
  return handle(async () => {
    const actor = await requireActor();
    const { id } = await context.params;
    const document = await getInvoicePdfDocument(actor, id);
    const bytes = await renderInvoicePdf(document);
    const filename = invoicePdfFilename(document.invoiceNumber);
    return new Response(Buffer.from(bytes), {
      headers: {
        "Cache-Control": "private, no-store, max-age=0",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Content-Length": String(bytes.byteLength),
        "Content-Type": "application/pdf",
        "X-Content-Type-Options": "nosniff",
      },
    });
  });
}
