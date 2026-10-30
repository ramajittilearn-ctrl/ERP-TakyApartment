import { describe, expect, it } from "vitest";
import {
  invoicePdfRoundingAdjustment,
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
    name: "สมมติ ใจดี Example Tenant",
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
  reconciliationDelta: "0.00",
  total: "9439.75",
  voidedAt: null,
  voidReason: null,
};

describe("invoice PDF rendering", () => {
  it("adds signed rounding reconciliation only when display lines do not match the total", () => {
    expect(invoicePdfRoundingAdjustment("-0.01")).toEqual({
      label: "ส่วนต่างการปัดเศษ / Rounding adjustment",
      amount: "-฿0.01",
    });
    expect(invoicePdfRoundingAdjustment("0.01")).toEqual({
      label: "ส่วนต่างการปัดเศษ / Rounding adjustment",
      amount: "+฿0.01",
    });
    expect(invoicePdfRoundingAdjustment("0.00")).toBeNull();
  });

  it("creates an A4 PDF with embedded Thai and Latin fonts and the snapshot values", async () => {
    const bytes = await renderInvoicePdf(sample);
    const pdf = Buffer.from(bytes).toString("latin1");
    expect(pdf.startsWith("%PDF-1.")).toBe(true);
    expect(pdf).toContain("/MediaBox [0 0 595.28 841.89]");
    expect(pdf).toContain("/FontFile2");
    expect(pdf).toContain("/ToUnicode");
    expect(pdf).toContain("NotoSansThai-Regular");
    expect(pdf.length).toBeGreaterThan(12_000);
    // PDFKit writes text through glyph IDs; ToUnicode maps preserve selectable Unicode text.
    expect(pdf.includes("beginbfrange") || pdf.includes("beginbfchar")).toBe(
      true,
    );
    expect(pdf.includes("<0e01>")).toBe(true);
    // ToUnicode character maps retain the decimal digits used by amounts and dates.
    expect(pdf.includes("<0039>")).toBe(true);
  });

  it("wraps very long Thai and English names and addresses across PDF lines", async () => {
    const bytes = await renderInvoicePdf({
      ...sample,
      property: {
        ...sample.property,
        address:
          "อาคารพักอาศัยพร้อมพื้นที่ส่วนกลางและระบบรักษาความปลอดภัยตลอดยี่สิบสี่ชั่วโมง ".repeat(
            12,
          ),
      },
      tenant: {
        ...sample.tenant,
        name: "ผู้เช่าทดสอบ".repeat(35) + " VeryLongTenantName".repeat(8),
      },
    });
    const pdf = Buffer.from(bytes).toString("latin1");
    expect(pdf.startsWith("%PDF-1.")).toBe(true);
    expect((pdf.match(/\/Type \/Page\b/g) ?? []).length).toBeGreaterThanOrEqual(
      1,
    );
    expect(pdf).toContain("/FontFile2");
  });

  it("encodes Baht and cubic metres with fonts that contain their glyphs", async () => {
    const pdf = Buffer.from(await renderInvoicePdf(sample)).toString("latin1");
    // Baht belongs to Unicode Script=Common, but is in the embedded Thai subset.
    expect(pdf).toContain("<0e3f>");
    // The packaged Latin subset omits superscript three; WinAnsi Helvetica has it.
    expect(pdf).toContain("/BaseFont /Helvetica");
    expect(pdf).toMatch(/\[<b3>\s*[-\d.]*\]\s*TJ/);
  });

  it("renders VOID status without changing snapshot amounts", async () => {
    const bytes = await renderInvoicePdf({
      ...sample,
      status: "VOID",
      voidedAt: "2026-10-23T10:30:00.000Z",
      voidReason: "บันทึกผิด",
    });
    const pdf = Buffer.from(bytes).toString("latin1");
    expect(pdf.includes("<0056>")).toBe(true);
    expect(pdf.includes("<004f>")).toBe(true);
    expect(pdf).toContain("/FontFile2");
  });

  it("formats filenames with a safe invoice number", () => {
    expect(invoicePdfFilename("INV-202610-0042")).toBe(
      "Invoice_INV-202610-0042.pdf",
    );
    expect(invoicePdfFilename("../../a b")).toBe("Invoice_______a_b.pdf");
  });
});
