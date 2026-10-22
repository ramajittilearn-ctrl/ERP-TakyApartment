"use client";
import { useState } from "react";
import {
  Printer,
  Check,
  Droplets,
  Zap,
  ReceiptText,
  ArrowRight,
} from "lucide-react";
import {
  Badge,
  Button,
  Card,
  DataTable,
  ErrorMessage,
  Field,
  MonthSelect,
  Notice,
  SuccessMessage,
} from "@/components/ui";
import { InvoicePreview } from "@/components/invoice-preview";
import { useDemo } from "@/demo/workspace";
import {
  calculateBill,
  invoiceBalance,
  invoiceTotal,
  lineTotal,
  parseAmount,
  tenantForRoom,
} from "@/demo/finance";
import { baht, DEFAULT_MONTH, type Invoice } from "@/demo/model";
import { money } from "@/lib/format";

export function BillingScreen() {
  const { state, issueInvoice } = useDemo();
  const [month, setMonth] = useState(DEFAULT_MONTH);
  const [room, setRoom] = useState("101");
  const [waterOld, setWaterOld] = useState("120");
  const [waterNew, setWaterNew] = useState("130");
  const [electricOld, setElectricOld] = useState("1250");
  const [electricNew, setElectricNew] = useState("1350");
  const [discount, setDiscount] = useState("0");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const lease = state.leases.find(
    (l) => l.room === room && l.status === "active",
  );
  const existing = state.invoices.find(
    (i) => i.room === room && i.month === month,
  );
  const parsedDiscount =
    discount.trim() === "0"
      ? { ok: true as const, value: baht(0) }
      : parseAmount(discount);
  const reading = (s: string) => (s === "" ? NaN : Number(s));
  const meters = {
    rent: lease?.rent || baht(0),
    waterOld: reading(waterOld),
    waterNew: reading(waterNew),
    electricOld: reading(electricOld),
    electricNew: reading(electricNew),
    waterRate: state.settings.waterRate,
    electricRate: state.settings.electricRate,
    commonFee: state.settings.commonFee,
    discount: parsedDiscount.ok ? parsedDiscount.value : baht(0),
  };
  const calculation = calculateBill(meters);
  const calculationError = !parsedDiscount.ok
    ? parsedDiscount.error
    : !calculation.ok
      ? calculation.error
      : "";
  const draft: Invoice = {
    id: "draft",
    number: "ฉบับร่าง",
    room,
    month,
    date: `${month}-01`,
    dueDate: `${month}-05`,
    lines: calculation.ok ? calculation.value : [],
  };
  const preview = existing || draft;
  function issue() {
    if (calculationError) {
      setError(calculationError);
      return;
    }
    const result = issueInvoice({ room, month, meters });
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setError("");
    setSuccess(
      `ออกใบแจ้งหนี้สาธิตห้อง ${room} แล้ว รายการและอัตราถูกบันทึกตามวันที่ออกบิล`,
    );
  }
  const invoices = state.invoices.filter((i) => i.month === month);
  return (
    <>
      {success && <SuccessMessage>{success}</SuccessMessage>}
      <div className="screen-toolbar">
        <div className="toolbar-actions">
          <MonthSelect
            value={month}
            onChange={(m) => {
              setMonth(m);
              setError("");
              setSuccess("");
            }}
            next
          />
          <label className="select-wrap">
            <span className="sr-only">ห้องออกบิล</span>
            <select
              aria-label="ห้องออกบิล"
              value={room}
              onChange={(e) => {
                setRoom(e.target.value);
                setError("");
              }}
            >
              {state.leases
                .filter((l) => l.status === "active")
                .map((l) => (
                  <option key={l.room} value={l.room}>
                    ห้อง {l.room} · {tenantForRoom(state, l.room)?.name}
                  </option>
                ))}
            </select>
          </label>
        </div>
        <Badge tone={existing ? "green" : "gray"} dot>
          {existing ? "ออกบิลแล้ว" : "ฉบับร่าง"}
        </Badge>
      </div>
      <div className="billing-layout">
        <div className="billing-editor">
          <Card
            title="ข้อมูลมิเตอร์"
            description={
              existing
                ? "ใบแจ้งหนี้ที่ออกแล้วจะเก็บอัตราและยอดเดิม"
                : "กรอกเลขมิเตอร์ปัจจุบันเพื่อคำนวณบิล"
            }
          >
            {existing ? (
              <>
                <Notice>
                  ห้องนี้มีใบแจ้งหนี้ในเดือนที่เลือกแล้ว
                  เลือกเดือนถัดไปเพื่อทดลองกรอกมิเตอร์
                </Notice>
                <div className="paragraph-gap">
                  <Button
                    variant="secondary"
                    onClick={() => {
                      setMonth("2026-11");
                      setError("");
                      setSuccess("");
                    }}
                  >
                    สร้างบิลเดือนพฤศจิกายน
                    <ArrowRight size={15} />
                  </Button>
                </div>
              </>
            ) : (
              <>
                <div
                  className="table-scroll"
                  role="region"
                  aria-label="กรอกมิเตอร์น้ำและไฟ"
                  tabIndex={0}
                >
                  <table className="meter-table">
                    <caption className="sr-only">กรอกข้อมูลมิเตอร์</caption>
                    <thead>
                      <tr>
                        <th scope="col">รายการ</th>
                        <th scope="col">ครั้งก่อน</th>
                        <th scope="col">ครั้งนี้</th>
                        <th scope="col">ใช้ไป</th>
                        <th scope="col">อัตรา / หน่วย</th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr>
                        <td>
                          <Droplets
                            size={14}
                            className="text-blue"
                            aria-hidden="true"
                          />{" "}
                          น้ำ
                        </td>
                        <td>
                          <input
                            aria-label="มิเตอร์น้ำก่อน"
                            type="number"
                            min="0"
                            max="99999999"
                            value={waterOld}
                            onChange={(e) => setWaterOld(e.target.value)}
                          />
                        </td>
                        <td>
                          <input
                            aria-label="มิเตอร์น้ำปัจจุบัน"
                            type="number"
                            min="0"
                            max="99999999"
                            value={waterNew}
                            onChange={(e) => setWaterNew(e.target.value)}
                          />
                        </td>
                        <td>
                          {Number.isFinite(meters.waterNew)
                            ? meters.waterNew - meters.waterOld
                            : "-"}
                        </td>
                        <td>{money(meters.waterRate)}</td>
                      </tr>
                      <tr>
                        <td>
                          <Zap
                            size={14}
                            className="text-blue"
                            aria-hidden="true"
                          />{" "}
                          ไฟฟ้า
                        </td>
                        <td>
                          <input
                            aria-label="มิเตอร์ไฟก่อน"
                            type="number"
                            min="0"
                            max="99999999"
                            value={electricOld}
                            onChange={(e) => setElectricOld(e.target.value)}
                          />
                        </td>
                        <td>
                          <input
                            aria-label="มิเตอร์ไฟปัจจุบัน"
                            type="number"
                            min="0"
                            max="99999999"
                            value={electricNew}
                            onChange={(e) => setElectricNew(e.target.value)}
                          />
                        </td>
                        <td>
                          {Number.isFinite(meters.electricNew)
                            ? meters.electricNew - meters.electricOld
                            : "-"}
                        </td>
                        <td>{money(meters.electricRate)}</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
                <ErrorMessage>{calculationError}</ErrorMessage>
                <p className="text-small muted-text paragraph-gap">
                  อัตราสาธิต ปรับได้ในหน้าตั้งค่า •
                  ไม่ใช่อัตราสำหรับเรียกเก็บเงินจริง
                </p>
              </>
            )}
          </Card>
          <Card title="รายการค่าใช้จ่าย">
            <DataTable caption="รายการในบิล" headers={["รายการ", "จำนวนเงิน"]}>
              {preview.lines.map((l, i) => (
                <tr key={i}>
                  <td>{l.label}</td>
                  <td className="numeric">{money(l.quantity * l.unitPrice)}</td>
                </tr>
              ))}
            </DataTable>
            {!existing && (
              <div className="paragraph-gap">
                <Field label="ส่วนลด (บาท)">
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={discount}
                    onChange={(e) => setDiscount(e.target.value)}
                  />
                </Field>
              </div>
            )}
            <div className="bill-total">
              <span>ยอดรวม</span>
              <strong>{money(lineTotal(preview.lines))}</strong>
            </div>
            <ErrorMessage>{error}</ErrorMessage>
            <div className="billing-actions paragraph-gap">
              <Button
                variant="ghost"
                onClick={() => window.print()}
                disabled={!!calculationError && !existing}
              >
                <Printer size={15} />
                พิมพ์ / บันทึก PDF
              </Button>
              {!existing && (
                <Button onClick={issue} disabled={!!calculationError}>
                  <Check size={15} />
                  ออกใบแจ้งหนี้สาธิต
                </Button>
              )}
            </div>
          </Card>
        </div>
        <div className="billing-preview">
          <div className="invoice-preview-label">
            <span>
              <ReceiptText
                size={14}
                style={{ display: "inline", marginRight: 6 }}
              />
              ตัวอย่างใบแจ้งหนี้
            </span>
            <span>A4 / พิมพ์ได้</span>
          </div>
          {calculationError && !existing ? (
            <Card>
              <ErrorMessage>{calculationError}</ErrorMessage>
              <p className="text-small muted-text">
                แก้ไขข้อมูลเพื่อแสดงตัวอย่างใบแจ้งหนี้
              </p>
            </Card>
          ) : (
            <InvoicePreview
              invoice={preview}
              tenant={tenantForRoom(state, room)?.name || "-"}
              propertyName={state.settings.propertyName}
              draft={!existing}
            />
          )}
        </div>
      </div>
      <div className="paragraph-gap print-hidden">
        <Card
          title="ใบแจ้งหนี้ในเดือนที่เลือก"
          action={<span className="table-count">{invoices.length} รายการ</span>}
        >
          <DataTable
            caption="ใบแจ้งหนี้ประจำเดือน"
            headers={["เลขที่", "ห้อง", "ยอดรวม", "ค้างชำระ", "รายละเอียด"]}
            empty={invoices.length === 0}
          >
            {invoices.map((i) => (
              <tr key={i.id}>
                <td>{i.number}</td>
                <td className="table-room">{i.room}</td>
                <td>{money(invoiceTotal(i))}</td>
                <td className={invoiceBalance(state, i) > 0 ? "text-red" : ""}>
                  {money(invoiceBalance(state, i))}
                </td>
                <td>
                  <button className="text-link" onClick={() => setRoom(i.room)}>
                    ดูบิลห้อง {i.room}
                  </button>
                </td>
              </tr>
            ))}
          </DataTable>
        </Card>
      </div>
    </>
  );
}
