import PDFDocument from "pdfkit";
import { pdfFontRuns, registerPdfFonts } from "../pdf/fonts";
import type { ReceiptDto } from "./contracts";

const WIDTH = 595.28;
const HEIGHT = 841.89;
const LEFT = 42;
const RIGHT = WIDTH - LEFT;
const CONTENT = RIGHT - LEFT;
const BOTTOM = 779;
const NOTICE =
  "สำเนาข้อมูลใบเสร็จจากระบบ ข้อมูลผู้ออกเอกสารตามกฎหมายยังไม่ได้กำหนด";

function amountText(value: string): string {
  const [whole, fraction] = value.split(".");
  return `฿${whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",")}.${fraction}`;
}

function timeText(value: string): string {
  return new Intl.DateTimeFormat("th-TH-u-ca-gregory-nu-latn", {
    timeZone: "Asia/Bangkok",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).format(new Date(value));
}

export function receiptPdfFilename(number: string): string {
  const safe = number.replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 80);
  return `Receipt_${safe || "receipt"}.pdf`;
}

export async function renderReceiptPdf(
  receipt: ReceiptDto,
): Promise<Uint8Array> {
  const snapshot = receipt.snapshot;
  const doc = new PDFDocument({
    size: "A4",
    margin: LEFT,
    bufferPages: true,
    compress: false,
    info: {
      Title: `Receipt record ${snapshot.number}`,
      Creator: "Taky Apartment ERP",
      CreationDate: new Date(snapshot.issuedAt),
    },
  });
  const chunks: Buffer[] = [];
  const finished = new Promise<Uint8Array>((resolve, reject) => {
    doc.on("data", (chunk: Buffer) => chunks.push(chunk));
    doc.on("end", () => resolve(new Uint8Array(Buffer.concat(chunks))));
    doc.on("error", reject);
  });
  registerPdfFonts(doc);

  function measure(text: string, size: number) {
    let width = 0;
    for (const run of pdfFontRuns(text)) {
      doc.font(run.font).fontSize(size);
      width += doc.widthOfString(run.text);
    }
    return width;
  }
  function line(
    text: string,
    x: number,
    top: number,
    size = 10,
    color = "#203047",
  ) {
    let cursor = x;
    for (const run of pdfFontRuns(text)) {
      doc.font(run.font).fontSize(size).fillColor(color);
      doc.text(run.text, cursor, top, { lineBreak: false });
      cursor += doc.widthOfString(run.text);
    }
  }
  function wrap(text: string, width: number, size: number): string[] {
    const lines: string[] = [];
    for (const paragraph of text.split(/\r\n|[\r\n]/)) {
      let current = "";
      for (const { segment } of new Intl.Segmenter("th", {
        granularity: "word",
      }).segment(paragraph)) {
        if (measure(current + segment, size) <= width) {
          current += segment;
          continue;
        }
        if (current) {
          lines.push(current.trimEnd());
          current = "";
        }
        if (measure(segment, size) <= width) {
          current = segment.trimStart();
          continue;
        }
        for (const { segment: grapheme } of new Intl.Segmenter("th", {
          granularity: "grapheme",
        }).segment(segment)) {
          if (current && measure(current + grapheme, size) > width) {
            lines.push(current);
            current = "";
          }
          current += grapheme;
        }
      }
      lines.push(current.trimEnd());
    }
    return lines;
  }

  let y = 0;
  function pageHeader() {
    y = 35;
    line("ข้อมูลใบเสร็จรับเงิน / RECEIPT RECORD", LEFT, y, 16, "#163a5f");
    y += 28;
    line(snapshot.number, LEFT, y, 11, "#163a5f");
    if (receipt.cancellation)
      line("ยกเลิก / CANCELLED", RIGHT - 145, y, 12, "#b42318");
    y += 21;
    for (const text of wrap(NOTICE, CONTENT, 8)) {
      line(text, LEFT, y, 8, "#7b4f11");
      y += 12;
    }
    y += 9;
    doc.moveTo(LEFT, y).lineTo(RIGHT, y).strokeColor("#cad4df").stroke();
    y += 15;
  }
  function nextPage() {
    doc.addPage();
    pageHeader();
  }
  function space(height: number) {
    if (y + height > BOTTOM) nextPage();
  }
  function paragraph(text: string, size = 10, color = "#203047") {
    for (const textLine of wrap(text, CONTENT, size)) {
      space(size + 5);
      line(textLine, LEFT, y, size, color);
      y += size + 5;
    }
    y += 4;
  }
  function tableHeading() {
    doc.rect(LEFT, y, CONTENT, 24).fill("#eaf0f6");
    line("ใบแจ้งหนี้ / Invoice", LEFT + 6, y + 6, 9);
    line("ยอดใบแจ้งหนี้ / Total", LEFT + 281, y + 6, 8);
    line("จัดสรร / Allocated", LEFT + 399, y + 6, 8);
    y += 30;
  }

  pageHeader();
  paragraph(`เลขอ้างอิงรับชำระ / Payment reference: ${snapshot.reference}`);
  paragraph(`ยอดรับชำระ / Received amount: ${amountText(snapshot.amount)}`, 14);
  paragraph(
    `วิธีชำระ / Method: ${snapshot.method === "CASH" ? "เงินสด / Cash" : "โอนเงิน / Bank transfer"}`,
  );
  if (snapshot.externalReference)
    paragraph(
      `เลขอ้างอิงธนาคาร / Bank reference: ${snapshot.externalReference}`,
    );
  paragraph(
    `เวลารับชำระ / Received (Bangkok): ${timeText(snapshot.receivedAt)}`,
  );
  paragraph(`เวลาออก / Issued (Bangkok): ${timeText(snapshot.issuedAt)}`);
  paragraph(`ผู้บันทึกออกเอกสาร / Issuing operator: ${snapshot.issuedBy.name}`);
  paragraph(`Operator ID: ${snapshot.issuedBy.id}`, 8, "#526174");
  y += 9;
  space(60);
  tableHeading();
  for (const invoice of snapshot.invoices) {
    const description = [
      invoice.number,
      `ที่พัก / Property: ${invoice.labels.property}`,
      ...(invoice.labels.propertyAddress
        ? [
            `ที่อยู่ที่พัก / Property address: ${invoice.labels.propertyAddress}`,
          ]
        : []),
      `ห้อง / Room: ${invoice.labels.room}`,
      `ผู้เช่า / Tenant: ${invoice.labels.tenant}`,
      `สัญญา / Lease: ${invoice.labels.leaseNumber || invoice.frozenLeaseId}`,
    ].flatMap((text) => wrap(text, 267, 9));
    const totals = [amountText(invoice.finalTotal)];
    const allocations = [amountText(invoice.allocatedAmount)];
    for (let index = 0; index < description.length; index++) {
      if (y + 14 > BOTTOM) {
        nextPage();
        tableHeading();
      }
      line(description[index], LEFT + 6, y, 9);
      if (totals[index])
        line(totals[index], LEFT + 390 - measure(totals[index], 9), y, 9);
      if (allocations[index])
        line(
          allocations[index],
          RIGHT - 6 - measure(allocations[index], 9),
          y,
          9,
        );
      y += 14;
    }
    y += 5;
    doc.moveTo(LEFT, y).lineTo(RIGHT, y).strokeColor("#e5eaf0").stroke();
    y += 10;
  }
  space(55);
  y += 4;
  paragraph(
    `ยอดรับชำระเดิม / Original received amount: ${amountText(snapshot.amount)}`,
    12,
  );
  if (receipt.cancellation) {
    space(55);
    paragraph("ข้อมูลการยกเลิกเพิ่มเติม / CANCELLATION", 12, "#b42318");
    paragraph(`เหตุผล / Reason: ${receipt.cancellation.reason}`, 10, "#7b2b27");
    paragraph(
      `เวลายกเลิก / Cancelled (Bangkok): ${timeText(receipt.cancellation.createdAt)}`,
    );
    paragraph(`Actor ID: ${receipt.cancellation.actorId}`, 8);
    paragraph(`Reversal ID: ${receipt.cancellation.reversalId}`, 8);
  }
  space(60);
  paragraph(`Snapshot SHA-256: ${receipt.fingerprint}`, 8, "#526174");
  paragraph(`Payment ID: ${snapshot.paymentId}`, 8, "#526174");

  const pages = doc.bufferedPageRange();
  for (let index = pages.start; index < pages.start + pages.count; index++) {
    doc.switchToPage(index);
    line(
      `หน้า / Page ${index + 1} / ${pages.count}`,
      LEFT,
      HEIGHT - 39,
      8,
      "#526174",
    );
  }
  doc.end();
  return finished;
}
