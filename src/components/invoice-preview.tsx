import { Building2 } from "lucide-react";
import { invoiceTotal } from "@/demo/finance";
import type { Invoice } from "@/demo/model";
import { date, money } from "@/lib/format";

export function InvoicePreview({
  invoice,
  tenant,
  propertyName,
  draft = false,
}: {
  invoice: Invoice;
  tenant: string;
  propertyName: string;
  draft?: boolean;
}) {
  return (
    <article className="invoice-paper" aria-label="ตัวอย่างใบแจ้งหนี้">
      <div className="invoice-heading">
        <div>
          <h2>ใบแจ้งหนี้</h2>
          <p>{propertyName}</p>
          <p>เอกสารสาธิต • ไม่ใช่เอกสารเรียกเก็บเงินจริง</p>
        </div>
        <Building2 className="invoice-logo" size={29} aria-hidden="true" />
      </div>
      <dl className="invoice-meta">
        <dt>เลขที่</dt>
        <dd>{draft ? "ฉบับร่าง" : invoice.number}</dd>
        <dt>วันที่</dt>
        <dd>{date(invoice.date)}</dd>
        <dt>กำหนดชำระ</dt>
        <dd>{date(invoice.dueDate)}</dd>
        <dt>ห้อง</dt>
        <dd>{invoice.room}</dd>
        <dt>ผู้เช่า</dt>
        <dd>{tenant}</dd>
      </dl>
      <table className="invoice-lines">
        <caption className="sr-only">รายการเรียกเก็บในใบแจ้งหนี้</caption>
        <thead>
          <tr>
            <th scope="col">รายการ</th>
            <th scope="col">ยอดชำระ</th>
          </tr>
        </thead>
        <tbody>
          {invoice.lines.map((line, i) => (
            <tr key={i}>
              <td>
                {line.label}
                {line.quantity !== 1 && line.quantity > 0 && (
                  <span className="table-subtitle">
                    {line.quantity} หน่วย × {money(line.unitPrice)}
                  </span>
                )}
              </td>
              <td>{money(Math.round(line.quantity * line.unitPrice))}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="invoice-total">
        <span>ยอดรวม</span>
        <strong>{money(invoiceTotal(invoice))}</strong>
      </div>
      <div className="invoice-footnote">
        {draft
          ? "ตัวอย่างก่อนออกบิล • ยังไม่ได้บันทึก"
          : "ใบแจ้งหนี้สาธิต • ข้อมูลเก็บเฉพาะรอบการใช้งานนี้"}
        <br />
        ขอบคุณที่ใช้บริการ {propertyName}
      </div>
    </article>
  );
}
