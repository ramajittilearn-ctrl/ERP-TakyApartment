import PDFDocument from "pdfkit";
import { pdfFontRuns, registerPdfFonts } from "../pdf/fonts";

export type InvoicePdfDocument = {
  invoiceNumber: string;
  status: "ISSUED" | "VOID";
  periodStart: string;
  periodEnd: string;
  issuedDate: string;
  dueDate: string;
  revision: number;
  property: { name: string; address: string };
  tenant: { name: string; room: string; leaseReference: string | null };
  lines: Array<{
    kind: "RENT" | "WATER" | "ELECTRICITY";
    quantity: string | null;
    unit: string | null;
    rate: string | null;
    amount: string;
  }>;
  total: string;
  voidedAt: string | null;
  voidReason: string | null;
};

const PAGE_WIDTH = 595.28;
const PAGE_HEIGHT = 841.89;
const MARGIN = 46;
const CONTENT_WIDTH = PAGE_WIDTH - MARGIN * 2;

function dateText(iso: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!match) return iso;
  const date = new Date(
    Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])),
  );
  return new Intl.DateTimeFormat("th-TH-u-ca-gregory-nu-latn", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(date);
}

function amountText(decimal: string): string {
  const match = /^(-?)(\d+)(?:\.(\d+))?$/.exec(decimal);
  if (!match) return `฿${decimal}`;
  const fraction = (match[3] ?? "").padEnd(2, "0").slice(0, 2);
  const grouped = match[2].replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${match[1]}฿${grouped}.${fraction}`;
}

function rateText(decimal: string): string {
  const match = /^(-?)(\d+)(?:\.(\d+))?$/.exec(decimal);
  if (!match) return `฿${decimal}`;
  const grouped = match[2].replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${match[1]}฿${grouped}${match[3] ? `.${match[3]}` : ".00"}`;
}

function labelFor(kind: InvoicePdfDocument["lines"][number]["kind"]): string {
  if (kind === "RENT") return "ค่าเช่าห้อง / Room rent";
  if (kind === "WATER") return "ค่าน้ำ / Water";
  return "ค่าไฟฟ้า / Electricity";
}

export function invoicePdfFilename(invoiceNumber: string): string {
  const safe = invoiceNumber.replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 80);
  return `Invoice_${safe || "invoice"}.pdf`;
}

export async function renderInvoicePdf(
  invoice: InvoicePdfDocument,
): Promise<Uint8Array> {
  const doc = new PDFDocument({
    size: "A4",
    margin: MARGIN,
    compress: false,
    info: {
      Title: `Invoice ${invoice.invoiceNumber}`,
      Author: invoice.property.name,
    },
  });
  const chunks: Buffer[] = [];
  const finished = new Promise<Uint8Array>((resolvePromise, reject) => {
    doc.on("data", (chunk: Buffer) => chunks.push(chunk));
    doc.on("end", () => resolvePromise(new Uint8Array(Buffer.concat(chunks))));
    doc.on("error", reject);
  });
  registerPdfFonts(doc);

  let y = 42;
  const left = MARGIN;
  const right = PAGE_WIDTH - MARGIN;

  const measure = (value: string, size: number): number => {
    let width = 0;
    for (const run of pdfFontRuns(value)) {
      doc.font(run.font).fontSize(size);
      width += doc.widthOfString(run.text);
    }
    return width;
  };
  const writeLine = (
    value: string,
    x: number,
    top: number,
    size: number,
    color = "#203047",
  ) => {
    let cursor = x;
    for (const run of pdfFontRuns(value)) {
      doc.font(run.font).fontSize(size).fillColor(color);
      doc.text(run.text, cursor, top, { lineBreak: false, continued: false });
      cursor += doc.widthOfString(run.text);
    }
  };
  const wrap = (value: string, maxWidth: number, size: number): string[] => {
    const segmenter = new Intl.Segmenter("th", { granularity: "word" });
    const result: string[] = [];
    let line = "";
    for (const { segment } of segmenter.segment(value)) {
      if (measure(line + segment, size) <= maxWidth || !line) {
        if (measure(segment, size) <= maxWidth) line += segment;
        else {
          for (const { segment: grapheme } of new Intl.Segmenter("th", {
            granularity: "grapheme",
          }).segment(segment)) {
            if (line && measure(line + grapheme, size) > maxWidth) {
              result.push(line.trimEnd());
              line = "";
            }
            line += grapheme;
          }
        }
      } else {
        result.push(line.trimEnd());
        line = segment.trimStart();
        if (measure(line, size) > maxWidth) {
          const pieces = Array.from(
            new Intl.Segmenter("th", { granularity: "grapheme" }).segment(line),
            (item) => item.segment,
          );
          line = "";
          for (const piece of pieces) {
            if (line && measure(line + piece, size) > maxWidth) {
              result.push(line);
              line = "";
            }
            line += piece;
          }
        }
      }
    }
    if (line || result.length === 0) result.push(line.trimEnd());
    return result;
  };
  const ensureSpace = (height: number) => {
    if (y + height > PAGE_HEIGHT - 42) {
      doc.addPage({ size: "A4", margin: MARGIN });
      y = 42;
    }
  };
  const wrapped = (
    value: string,
    x: number,
    width: number,
    size: number,
    color?: string,
  ) => {
    const lines = wrap(value, width, size);
    ensureSpace(lines.length * (size + 4));
    for (const line of lines) {
      writeLine(line, x, y, size, color);
      y += size + 4;
    }
  };

  writeLine("ใบแจ้งหนี้ / INVOICE", left, y, 22, "#163a5f");
  writeLine(
    invoice.status === "VOID" ? "VOID / ยกเลิก" : "ISSUED / ออกแล้ว",
    right - 110,
    y + 5,
    10,
    invoice.status === "VOID" ? "#b42318" : "#24734a",
  );
  y += 36;
  doc.moveTo(left, y).lineTo(right, y).strokeColor("#cad4df").stroke();
  y += 14;

  writeLine(
    invoice.property.name || "ที่พัก / Property",
    left,
    y,
    14,
    "#163a5f",
  );
  y += 22;
  wrapped(invoice.property.address || "—", left, CONTENT_WIDTH, 9, "#526174");
  y += 7;

  const boxTop = y;
  doc
    .roundedRect(left, boxTop, CONTENT_WIDTH, 82, 8)
    .fillAndStroke("#f3f6fa", "#e0e6ed");
  writeLine(
    "เลขที่ใบแจ้งหนี้ / Invoice no.",
    left + 12,
    boxTop + 10,
    8,
    "#526174",
  );
  writeLine(invoice.invoiceNumber, left + 12, boxTop + 25, 12, "#163a5f");
  writeLine("ครบกำหนด / Due date", left + 12, boxTop + 48, 8, "#526174");
  writeLine(dateText(invoice.dueDate), left + 12, boxTop + 61, 11, "#163a5f");
  writeLine("รอบบิล / Billing period", left + 290, boxTop + 10, 8, "#526174");
  writeLine(
    `${dateText(invoice.periodStart)} – ${dateText(invoice.periodEnd)}`,
    left + 290,
    boxTop + 25,
    10,
    "#163a5f",
  );
  writeLine("วันที่ออก / Issue date", left + 290, boxTop + 48, 8, "#526174");
  writeLine(
    dateText(invoice.issuedDate),
    left + 290,
    boxTop + 61,
    10,
    "#163a5f",
  );
  y = boxTop + 96;

  writeLine("ผู้เช่าและสัญญา / TENANT & LEASE", left, y, 9, "#526174");
  y += 17;
  wrapped(invoice.tenant.name, left, 250, 11, "#203047");
  writeLine(`ห้อง / Room: ${invoice.tenant.room}`, left, y, 9);
  writeLine(
    `สัญญา / Lease: ${invoice.tenant.leaseReference ?? "—"}`,
    left + 270,
    y,
    9,
  );
  y += 23;

  const tableTop = y;
  doc.rect(left, tableTop, CONTENT_WIDTH, 25).fill("#eaf0f6");
  writeLine("รายการ / Description", left + 9, tableTop + 7, 8, "#34465c");
  writeLine(
    "ปริมาณ × อัตรา / Qty × Rate",
    left + 274,
    tableTop + 7,
    8,
    "#34465c",
  );
  writeLine("จำนวนเงิน / Amount", right - 106, tableTop + 7, 8, "#34465c");
  y += 25;
  for (const line of invoice.lines) {
    const description = labelFor(line.kind);
    const details =
      line.quantity === null
        ? "—"
        : `${line.quantity}${line.unit ? ` ${line.unit}` : ""} × ${line.rate === null ? "—" : rateText(line.rate)}`;
    const descLines = wrap(description, 245, 9);
    const detailLines = wrap(details, 128, 8);
    const rowHeight = Math.max(
      30,
      Math.max(descLines.length * 13, detailLines.length * 12),
    );
    ensureSpace(rowHeight + 8);
    for (let i = 0; i < descLines.length; i++)
      writeLine(descLines[i], left + 9, y + 8 + i * 13, 9);
    for (let i = 0; i < detailLines.length; i++)
      writeLine(detailLines[i], left + 274, y + 8 + i * 12, 8, "#526174");
    writeLine(amountText(line.amount), right - 106, y + 8, 9);
    y += rowHeight;
    doc.moveTo(left, y).lineTo(right, y).strokeColor("#e5eaf0").stroke();
  }
  y += 15;
  ensureSpace(72);
  writeLine("ยอดชำระรวม / TOTAL PAYABLE", left + 265, y, 10, "#526174");
  writeLine(amountText(invoice.total), left + 265, y + 19, 19, "#163a5f");
  y += 54;
  writeLine(`Revision ${invoice.revision}`, left, y, 8, "#758397");
  if (invoice.status === "VOID") {
    y += 18;
    writeLine(
      `VOID / ยกเลิก ณ ${invoice.voidedAt ? dateText(invoice.voidedAt) : "—"}`,
      left,
      y,
      11,
      "#b42318",
    );
    if (invoice.voidReason) {
      y += 17;
      wrapped(
        `เหตุผล / Reason: ${invoice.voidReason}`,
        left,
        CONTENT_WIDTH,
        9,
        "#7b2b27",
      );
    }
    doc.save();
    doc.rotate(-28, { origin: [PAGE_WIDTH / 2, PAGE_HEIGHT / 2] });
    doc
      .font("Latin")
      .fontSize(52)
      .fillColor("#b42318", 0.1)
      .text("VOID", 190, 350, { lineBreak: false });
    doc.restore();
  }
  doc.end();
  return finished;
}
