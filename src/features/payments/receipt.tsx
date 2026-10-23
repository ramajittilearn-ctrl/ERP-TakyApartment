import { Notice } from "@/components/ui";
import type { ReceiptDto } from "@/server/payments/contracts";
import { amountLabel, timeLabel } from "./form";
export const methodLabels = { CASH: "เงินสด", BANK_TRANSFER: "โอนเงิน" };
export function ReceiptView({ receipt }: { receipt: ReceiptDto }) {
  const snapshot = receipt.snapshot;
  return (
    <section aria-label="ข้อมูลใบเสร็จรับเงิน">
      <h3>ใบเสร็จ {snapshot.number}</h3>
      <p>
        <a
          href={`/api/v1/receipts/${receipt.id}/pdf/`}
          target="_blank"
          rel="noopener noreferrer"
        >
          เปิด PDF / พิมพ์
        </a>{" "}
        ·{" "}
        <a
          href={`/api/v1/receipts/${receipt.id}/pdf/?download=1`}
          target="_blank"
          rel="noopener noreferrer"
        >
          ดาวน์โหลด PDF
        </a>
      </p>
      <p>พิมพ์หรือบันทึกเป็น PDF ผ่านตัวอ่าน PDF ของเบราว์เซอร์</p>
      {receipt.cancellation && (
        <div role="status">
          <strong>ใบเสร็จถูกยกเลิก</strong>
          <p>{receipt.cancellation.reason}</p>
          <p>
            {timeLabel(receipt.cancellation.createdAt)} · ผู้ดำเนินการ{" "}
            {receipt.cancellation.actorId}
          </p>
        </div>
      )}
      <dl className="detail-grid">
        <div>
          <dt>เลขอ้างอิงรับชำระ</dt>
          <dd>{snapshot.reference}</dd>
        </div>
        <div>
          <dt>ยอดรับชำระ</dt>
          <dd>{amountLabel(snapshot.amount)}</dd>
        </div>
        <div>
          <dt>วิธีชำระ</dt>
          <dd>{methodLabels[snapshot.method]}</dd>
        </div>
        <div>
          <dt>เวลารับชำระ (กรุงเทพฯ)</dt>
          <dd>{timeLabel(snapshot.receivedAt)}</dd>
        </div>
        <div>
          <dt>เวลาออกใบเสร็จ (กรุงเทพฯ)</dt>
          <dd>{timeLabel(snapshot.issuedAt)}</dd>
        </div>
        <div>
          <dt>ผู้ออก</dt>
          <dd>{snapshot.issuedBy.name}</dd>
        </div>
        {snapshot.externalReference && (
          <div>
            <dt>เลขอ้างอิงธนาคาร</dt>
            <dd>{snapshot.externalReference}</dd>
          </div>
        )}
      </dl>
      <ul>
        {snapshot.invoices.map((invoice) => (
          <li key={invoice.invoiceId}>
            <strong>{invoice.number}</strong> · {invoice.labels.property} · ห้อง{" "}
            {invoice.labels.room} · {invoice.labels.tenant} ·{" "}
            {invoice.labels.leaseNumber || invoice.frozenLeaseId}
            <p>
              ยอดใบแจ้งหนี้ {amountLabel(invoice.finalTotal)} · จัดสรร{" "}
              {amountLabel(invoice.allocatedAmount)}
            </p>
          </li>
        ))}
      </ul>
      <details>
        <summary>รายละเอียดความครบถ้วนของข้อมูล</summary>
        <p style={{ overflowWrap: "anywhere" }}>{receipt.fingerprint}</p>
      </details>
      <Notice>
        สำเนาข้อมูลใบเสร็จจากระบบ ข้อมูลผู้ออกเอกสารตามกฎหมายยังไม่ได้กำหนด
      </Notice>
    </section>
  );
}
