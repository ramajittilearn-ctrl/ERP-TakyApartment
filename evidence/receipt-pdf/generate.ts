import { mkdir, writeFile } from "node:fs/promises";
import { renderReceiptPdf } from "../../src/server/payments/pdf";
import { receiptPdfCases } from "../../tests/fixtures/receipt-pdf";

async function main() {
  await mkdir("evidence/receipt-pdf/artifacts", { recursive: true });
  const fixtures = receiptPdfCases();
  for (const [name, receipt] of Object.entries(fixtures))
    await writeFile(
      `evidence/receipt-pdf/artifacts/${name}.pdf`,
      await renderReceiptPdf(receipt),
    );
  await writeFile(
    "evidence/receipt-pdf/fixtures.json",
    JSON.stringify(fixtures, null, 2),
  );
}
void main().catch((error: unknown) => {
  process.stderr.write(
    `${error instanceof Error ? error.message : "Generation failed"}\n`,
  );
  process.exitCode = 1;
});
