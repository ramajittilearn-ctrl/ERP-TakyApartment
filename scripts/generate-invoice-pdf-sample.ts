import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import {
  invoicePdfFilename,
  renderInvoicePdf,
  type InvoicePdfDocument,
} from "../src/server/invoices/pdf";

const sample: InvoicePdfDocument = {
  invoiceNumber: "INV-202610-0042",
  status: "ISSUED",
  periodStart: "2026-10-01",
  periodEnd: "2026-10-31",
  issuedDate: "2026-10-22",
  dueDate: "2026-10-29",
  revision: 1,
  property: {
    name: "บ้านตัวอย่าง / Sample Residence",
    address: "99 ถนนสุขุมวิท แขวงคลองตัน เขตวัฒนา กรุงเทพมหานคร 10110",
  },
  tenant: {
    name: "สมมติ ใจดี / Sommai Jaidee (fictional)",
    room: "A-204",
    leaseReference: "LEASE-DEMO-204",
  },
  lines: [
    { kind: "RENT", quantity: null, unit: null, rate: null, amount: "8500.00" },
    {
      kind: "WATER",
      quantity: "3.500",
      unit: "m³",
      rate: "18.00",
      amount: "63.00",
    },
    {
      kind: "ELECTRICITY",
      quantity: "125.250",
      unit: "kWh",
      rate: "7.00",
      amount: "876.75",
    },
  ],
  total: "9439.75",
  voidedAt: null,
  voidReason: null,
};

const outputPath = resolve(
  process.cwd(),
  "docs/samples",
  invoicePdfFilename(sample.invoiceNumber),
);
async function main() {
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, await renderInvoicePdf(sample));
  console.log(`Generated fictional invoice sample: ${outputPath}`);
}

void main();
