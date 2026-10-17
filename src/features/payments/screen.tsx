"use client";
import { useState, type FormEvent } from "react";
import { CreditCard, Download, Printer, ReceiptText } from "lucide-react";
import {
  AddButton,
  Badge,
  Button,
  Card,
  DataTable,
  EmptyState,
  ErrorMessage,
  Field,
  Modal,
  MonthSelect,
  Notice,
  SearchField,
  SuccessMessage,
} from "@/components/ui";
import { useDemo } from "@/demo/workspace";
import { invoiceBalance, paymentTotal, tenantForRoom } from "@/demo/finance";
import {
  DEFAULT_MONTH,
  DEMO_TODAY,
  type Payment,
  type PaymentDraft,
} from "@/demo/model";
import { date, exportCsv, money } from "@/lib/format";

export const methodLabels = {
  transfer: "โอนเงิน",
  cash: "เงินสด",
  qr: "QR Code",
};
export function PaymentsScreen() {
  const { state, recordPayment } = useDemo();
  const [month, setMonth] = useState(DEFAULT_MONTH);
  const [room, setRoom] = useState("all");
  const [status, setStatus] = useState("all");
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<Payment | null>(null);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const unpaid = state.invoices.filter((i) => invoiceBalance(state, i) > 0);
  const [draft, setDraft] = useState<PaymentDraft>({
    invoiceId: unpaid[0]?.id || "",
    amount: "",
    method: "transfer",
    date: DEMO_TODAY,
    reference: "",
  });
  const rows = state.payments
    .filter(
      (p) =>
        p.date.startsWith(month) &&
        (status === "all" || p.status === status) &&
        p.allocations.some((a) => {
          const i = state.invoices.find((i) => i.id === a.invoiceId);
          const tenant = i && tenantForRoom(state, i.room);
          return (
            (room === "all" || i?.room === room) &&
            `${i?.room} ${tenant?.name || ""} ${p.reference}`
              .toLowerCase()
              .includes(query.toLowerCase())
          );
        }),
    )
    .toSorted((a, b) => b.date.localeCompare(a.date));
  const invoice = state.invoices.find((i) => i.id === draft.invoiceId);
  function submit(event: FormEvent) {
    event.preventDefault();
    const result = recordPayment(draft);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setOpen(false);
    setError("");
    setSuccess(`บันทึกยอดรับชำระสาธิตห้อง ${invoice?.room} แล้ว`);
  }
  function showForm() {
    const first = unpaid.find((i) => i.month === month) || unpaid[0];
    setDraft({
      invoiceId: first?.id || "",
      amount: first ? String(invoiceBalance(state, first) / 100) : "",
      method: "transfer",
      date: DEMO_TODAY,
      reference: "",
    });
    setError("");
    setOpen(true);
  }
  const selectedInvoice = state.invoices.find(
    (i) => i.id === selected?.allocations[0]?.invoiceId,
  );
  return (
    <>
      {success && <SuccessMessage>{success}</SuccessMessage>}
      <div className="screen-toolbar">
        <p className="toolbar-label">
          <CreditCard size={16} />
          รายการรับชำระประจำเดือน
        </p>
        <AddButton onClick={showForm}>บันทึกการชำระเงิน</AddButton>
      </div>
      <Card>
        <div className="filter-bar">
          <MonthSelect value={month} onChange={setMonth} next />
          <select
            aria-label="ห้องชำระเงิน"
            value={room}
            onChange={(e) => setRoom(e.target.value)}
          >
            <option value="all">ทุกห้อง</option>
            {state.rooms.map((r) => (
              <option key={r.number}>{r.number}</option>
            ))}
          </select>
          <select
            aria-label="สถานะการชำระ"
            value={status}
            onChange={(e) => setStatus(e.target.value)}
          >
            <option value="all">สถานะทั้งหมด</option>
            <option value="confirmed">ยืนยันแล้ว</option>
            <option value="pending">รอตรวจสอบ</option>
          </select>
          <SearchField
            value={query}
            onChange={setQuery}
            label="ค้นหาการชำระเงิน"
            placeholder="ค้นหาผู้เช่า / เลขอ้างอิง..."
          />
        </div>
        <DataTable
          caption="รายการรับชำระเงิน"
          headers={[
            "วันที่",
            "ห้อง",
            "ชื่อผู้เช่า",
            "ยอดชำระ",
            "วิธีชำระ",
            "สถานะ",
            "ใบเสร็จ",
          ]}
          empty={rows.length === 0}
        >
          {rows.map((p) => {
            const i = state.invoices.find(
              (i) => i.id === p.allocations[0]?.invoiceId,
            );
            return (
              <tr key={p.id}>
                <td>{date(p.date)}</td>
                <td className="table-room">{i?.room}</td>
                <td>
                  {i && tenantForRoom(state, i.room)?.name}
                  <span className="table-subtitle">{p.reference}</span>
                </td>
                <td className="font-semibold">{money(paymentTotal(p))}</td>
                <td>{methodLabels[p.method]}</td>
                <td>
                  <Badge tone={p.status === "confirmed" ? "green" : "amber"}>
                    {p.status === "confirmed" ? "ยืนยันแล้ว" : "รอตรวจสอบ"}
                  </Badge>
                </td>
                <td>
                  <button
                    className="text-link"
                    aria-label={`ดูรายการ ${p.reference}`}
                    onClick={() => setSelected(p)}
                  >
                    <ReceiptText size={15} />
                    ดูรายการ
                  </button>
                </td>
              </tr>
            );
          })}
        </DataTable>
        <div className="table-footer">
          <span>
            แสดง {rows.length} รายการ • ไม่รวมรายการรอตรวจสอบในรายรับจริง
          </span>
          <Button
            variant="ghost"
            onClick={() =>
              exportCsv("taky-demo-payments.csv", [
                ["วันที่", "เลขอ้างอิง", "จำนวนเงิน", "วิธีชำระ", "สถานะ"],
                ...rows.map((p) => [
                  p.date,
                  p.reference,
                  paymentTotal(p) / 100,
                  methodLabels[p.method],
                  p.status,
                ]),
              ])
            }
          >
            <Download size={14} />
            ส่งออก CSV
          </Button>
        </div>
      </Card>
      <div className="paragraph-gap">
        <Notice>
          บันทึกโดยผู้ดูแลหลังตรวจสอบด้วยตนเอง
          ระบบสาธิตไม่มีการเชื่อมต่อหรือยืนยันยอดธนาคารอัตโนมัติ
        </Notice>
      </div>
      <Modal open={open} onOpenChange={setOpen} title="บันทึกการชำระเงิน">
        {unpaid.length === 0 ? (
          <EmptyState
            title="ไม่มีใบแจ้งหนี้ค้างชำระ"
            description="ออกใบแจ้งหนี้สาธิตในหน้าออกบิลเพื่อทดลองบันทึกชำระ"
          />
        ) : (
          <form onSubmit={submit}>
            <div className="form-grid">
              <Field className="form-full" label="ใบแจ้งหนี้">
                <select
                  value={draft.invoiceId}
                  onChange={(e) => {
                    const i = state.invoices.find(
                      (i) => i.id === e.target.value,
                    );
                    setDraft({
                      ...draft,
                      invoiceId: e.target.value,
                      amount: i ? String(invoiceBalance(state, i) / 100) : "",
                    });
                  }}
                >
                  {unpaid.map((i) => (
                    <option key={i.id} value={i.id}>
                      ห้อง {i.room} · {i.month} · ค้าง{" "}
                      {money(invoiceBalance(state, i))}
                    </option>
                  ))}
                </select>
              </Field>
            </div>
            {invoice && (
              <div className="payment-amount-preview paragraph-gap">
                <span>ยอดค้างชำระ</span>
                <strong>{money(invoiceBalance(state, invoice))}</strong>
              </div>
            )}
            <div className="form-grid">
              <Field label="ยอดรับชำระ (บาท)" hint="รองรับการชำระบางส่วน">
                <input
                  required
                  type="number"
                  min="0.01"
                  step="0.01"
                  value={draft.amount}
                  onChange={(e) =>
                    setDraft({ ...draft, amount: e.target.value })
                  }
                />
              </Field>
              <Field label="วันที่รับชำระ">
                <input
                  required
                  type="date"
                  max={DEMO_TODAY}
                  value={draft.date}
                  onChange={(e) => setDraft({ ...draft, date: e.target.value })}
                />
              </Field>
              <Field label="วิธีชำระ">
                <select
                  value={draft.method}
                  onChange={(e) =>
                    setDraft({
                      ...draft,
                      method:
                        e.target.value === "cash"
                          ? "cash"
                          : e.target.value === "qr"
                            ? "qr"
                            : "transfer",
                    })
                  }
                >
                  {Object.entries(methodLabels).map(([key, label]) => (
                    <option key={key} value={key}>
                      {label}
                    </option>
                  ))}
                </select>
              </Field>
              <Field
                label="เลขอ้างอิง"
                hint="ใช้เลขอ้างอิงใหม่ทุกครั้ง เช่น DEMO-001"
              >
                <input
                  required
                  maxLength={80}
                  value={draft.reference}
                  onChange={(e) =>
                    setDraft({ ...draft, reference: e.target.value })
                  }
                />
              </Field>
            </div>
            <label className="checkbox-field paragraph-gap">
              <input type="checkbox" required />
              ตรวจสอบรายการด้วยตนเองแล้ว (ข้อมูลสาธิต)
            </label>
            <ErrorMessage>{error}</ErrorMessage>
            <div className="form-actions">
              <Button variant="ghost" onClick={() => setOpen(false)}>
                ยกเลิก
              </Button>
              <Button type="submit">บันทึกยอดรับชำระสาธิต</Button>
            </div>
          </form>
        )}
      </Modal>
      <Modal
        open={selected !== null}
        onOpenChange={(value) => {
          if (!value) setSelected(null);
        }}
        title={
          selected?.status === "confirmed"
            ? "ใบเสร็จรับเงินสาธิต"
            : "รายการรอตรวจสอบ"
        }
      >
        {selected && (
          <>
            <div className="receipt-preview">
              <h3>
                {selected.status === "confirmed"
                  ? "ใบเสร็จรับเงิน"
                  : "รายการรอตรวจสอบ"}
              </h3>
              <p className="text-small muted-text">
                {state.settings.propertyName} • เอกสารสาธิตเท่านั้น
              </p>
              <dl className="detail-grid paragraph-gap">
                <div>
                  <dt>เลขอ้างอิง</dt>
                  <dd>{selected.reference}</dd>
                </div>
                <div>
                  <dt>วันที่</dt>
                  <dd>{date(selected.date)}</dd>
                </div>
                <div>
                  <dt>ห้องพัก</dt>
                  <dd>{selectedInvoice?.room}</dd>
                </div>
                <div>
                  <dt>วิธีชำระ</dt>
                  <dd>{methodLabels[selected.method]}</dd>
                </div>
                <div>
                  <dt>จำนวนเงิน</dt>
                  <dd>{money(paymentTotal(selected))}</dd>
                </div>
                <div>
                  <dt>สถานะ</dt>
                  <dd>
                    <Badge
                      tone={selected.status === "confirmed" ? "green" : "amber"}
                    >
                      {selected.status === "confirmed"
                        ? "ยืนยันโดยผู้ดูแล"
                        : "รอตรวจสอบ"}
                    </Badge>
                  </dd>
                </div>
              </dl>
            </div>
            <div className="form-actions">
              <Button variant="ghost" onClick={() => setSelected(null)}>
                ปิด
              </Button>
              {selected.status === "confirmed" && (
                <Button onClick={() => window.print()}>
                  <Printer size={15} />
                  พิมพ์ใบเสร็จสาธิต
                </Button>
              )}
            </div>
          </>
        )}
      </Modal>
    </>
  );
}
