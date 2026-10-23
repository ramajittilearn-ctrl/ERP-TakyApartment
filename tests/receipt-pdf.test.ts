import { describe, expect, it } from "vitest";
import {
  renderReceiptPdf,
  receiptPdfFilename,
} from "../src/server/payments/pdf";
import { pdfFontRuns } from "../src/server/pdf/fonts";
import { receiptDtoSchema } from "../src/server/payments/contracts";
import { receiptPdfCases, receiptPdfFixture } from "./fixtures/receipt-pdf";

describe("shared PDF glyph policy", () => {
  it("keeps Thai combining graphemes, Baht and superscript three in supported fonts", () => {
    expect(pdfFontRuns("กิ฿12.30 m³ USD")).toEqual([
      { text: "กิ฿", font: "Thai" },
      { text: "12.30 m", font: "Latin" },
      { text: "³", font: "Helvetica" },
      { text: " USD", font: "Latin" },
    ]);
    expect(pdfFontRuns("")).toEqual([]);
  });
});

describe("receipt PDF record rendering", () => {
  it("creates an A4 PDF with embedded fonts and the supported currency glyph", async () => {
    const value = receiptPdfFixture();
    const original = structuredClone(value);
    const bytes = await renderReceiptPdf(value);
    const pdf = Buffer.from(bytes).toString("latin1");
    expect(pdf.startsWith("%PDF-1.")).toBe(true);
    expect(pdf).toContain("/MediaBox [0 0 595.28 841.89]");
    expect(pdf).toContain("/FontFile2");
    expect(pdf).toContain("<0e3f>");
    expect(pdf).toContain("/BaseFont /Helvetica");
    expect(value).toEqual(original);
  });

  for (const name of ["cancelled", "long", "hundred", "maximum"]) {
    it(`renders ${name} without mutating the immutable receipt or cancellation`, async () => {
      const value = receiptDtoSchema.parse(receiptPdfCases()[name]);
      const original = structuredClone(value);
      const pdf = Buffer.from(await renderReceiptPdf(value)).toString("latin1");
      expect(pdf.startsWith("%PDF-1.")).toBe(true);
      const pageCount = (pdf.match(/\/Type \/Page\b/g) ?? []).length;
      expect(pageCount).toBeGreaterThanOrEqual(1);
      if (name === "long" || name === "hundred")
        expect(pageCount).toBeGreaterThan(1);
      expect(value).toEqual(original);
    }, 30000);
  }

  it("uses a bounded safe filename with no header or path injection", () => {
    expect(receiptPdfFilename("REC-202610-0042")).toBe(
      "Receipt_REC-202610-0042.pdf",
    );
    expect(receiptPdfFilename('../../a\r\n".pdf')).not.toMatch(/[\r\n"/]/);
    expect(receiptPdfFilename("")).toBe("Receipt_receipt.pdf");
    expect(receiptPdfFilename("x".repeat(1000))).toHaveLength(92);
  });
});
