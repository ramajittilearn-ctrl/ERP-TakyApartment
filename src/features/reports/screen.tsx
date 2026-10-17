"use client";
import { useState } from "react";
import { Download, FileSpreadsheet, CalendarDays } from "lucide-react";
import {
  Badge,
  Button,
  Card,
  DataTable,
  MonthSelect,
  Notice,
  Tabs,
} from "@/components/ui";
import { BarChart, Donut, Kpi, Legend } from "@/components/charts";
import { useDemo } from "@/demo/workspace";
import { DEFAULT_MONTH, months } from "@/demo/model";
import {
  invoiceBalance,
  invoicePaid,
  invoiceTotal,
  paymentTotal,
  summarizeMonth,
} from "@/demo/finance";
import { date, exportCsv, money, shortMonth } from "@/lib/format";

export function ReportsScreen() {
  const { state } = useDemo();
  const [month, setMonth] = useState(DEFAULT_MONTH);
  const totals = summarizeMonth(state, month);
  const expenses = state.expenses.filter((e) => e.date.startsWith(month));
  const invoices = state.invoices.filter((i) => i.month === month);
  const receipts = state.payments.filter(
    (p) => p.date.startsWith(month) && p.status === "confirmed",
  );
  const summaryRows = [
    ["รายรับตามบิล", totals.billed],
    ["รับชำระแล้ว", totals.received],
    ["ยอดค้างของบิลเดือนนี้", totals.outstanding],
    ["OPEX", totals.opex],
    ["CAPEX", totals.capex],
    ["กระแสเงินสดดำเนินงาน", totals.operatingCash],
    ["กระแสเงินสดสุทธิ", totals.netCash],
  ] satisfies [string, number][];
  const totalExpense = totals.opex + totals.capex;
  const colors = ["#3c8bea", "#24ba93", "#f4bb57", "#ed6f7d", "#9574e8"];
  const categories = [...new Set(expenses.map((e) => e.category))].map(
    (label, i) => ({
      label,
      value: expenses
        .filter((e) => e.category === label)
        .reduce((s, e) => s + e.amount, 0),
      color: colors[i % colors.length],
    }),
  );
  const exportSummary = () =>
    exportCsv(`taky-demo-finance-${month}.csv`, [
      ["เดือน", "รายการ", "จำนวนเงิน (บาท)"],
      ...summaryRows.map(([label, amount]) => [month, label, amount / 100]),
    ]);
  const summary = (
    <>
      <div className="metric-grid">
        <Kpi
          label="รับชำระจริง"
          value={money(totals.received)}
          note="เฉพาะยอดยืนยันแล้ว"
          tone="green"
        />
        <Kpi
          label="ค่าใช้จ่าย (OPEX)"
          value={money(totals.opex)}
          note="ค่าใช้จ่ายดำเนินงาน"
          tone="red"
        />
        <Kpi
          label="เงินลงทุน (CAPEX)"
          value={money(totals.capex)}
          note="จ่ายเพื่อทรัพย์สินระยะยาว"
          tone="purple"
        />
        <Kpi
          label="กระแสเงินสดสุทธิ"
          value={money(totals.netCash)}
          note="รับจริง − OPEX − CAPEX"
          tone="blue"
        />
      </div>
      <div className="two-column">
        <Card
          title="รายรับ vs รายจ่าย"
          description="ย้อนหลังสูงสุด 6 เดือน • หน่วย: บาท"
        >
          <BarChart
            label="รายรับ OPEX และ CAPEX รายเดือน"
            series={[
              { label: "รายรับ", color: "#1bb491" },
              { label: "OPEX", color: "#f16c78" },
              { label: "CAPEX", color: "#9275df" },
            ]}
            rows={months
              .filter((m) => m <= month)
              .slice(-6)
              .map((m) => {
                const t = summarizeMonth(state, m);
                return {
                  label: shortMonth(m),
                  values: [t.received / 100, t.opex / 100, t.capex / 100],
                };
              })}
          />
        </Card>
        <Card title="สัดส่วนค่าใช้จ่าย">
          <div className="report-categories">
            <Donut
              segments={categories}
              primary={totalExpense ? "100%" : "0%"}
              secondary="ค่าใช้จ่ายรวม"
              label={`ค่าใช้จ่ายรวม ${money(totalExpense)}`}
            />
            <Legend
              segments={categories.map((c) => ({
                ...c,
                value: totalExpense
                  ? Math.round((c.value / totalExpense) * 100)
                  : 0,
              }))}
              suffix="%"
            />
          </div>
        </Card>
      </div>
      <div className="paragraph-gap">
        <Card title="สรุปการเงินประจำเดือน">
          <DataTable caption="สรุปการเงิน" headers={["รายการ", "จำนวนเงิน"]}>
            {summaryRows.map(([label, amount]) => (
              <tr key={label}>
                <td>{label}</td>
                <td className="numeric font-semibold">{money(amount)}</td>
              </tr>
            ))}
          </DataTable>
          <p className="report-note paragraph-gap">
            ยอดค้างอ้างอิงบิลของเดือนที่เลือก
            ส่วนรับชำระจริงอ้างอิงวันที่รับเงิน จึงอาจมีเงินรับจากบิลเดือนก่อน
          </p>
        </Card>
      </div>
    </>
  );
  return (
    <>
      <div className="screen-toolbar">
        <div className="toolbar-label">
          <CalendarDays size={16} />
          <span>รายงานประจำเดือน</span>
          <MonthSelect value={month} onChange={setMonth} next />
        </div>
        <Button variant="secondary" onClick={exportSummary}>
          <Download size={15} />
          ส่งออกรายงาน
        </Button>
      </div>
      <Tabs
        items={[
          { value: "summary", label: "สรุปรายเดือน", content: summary },
          {
            value: "income",
            label: "รายรับ",
            content: (
              <Card title="รายรับและยอดคงค้างตามบิล">
                <DataTable
                  caption="รายรับตามบิล"
                  headers={[
                    "เลขที่บิล",
                    "ห้อง",
                    "ยอดบิล",
                    "ชำระแล้ว",
                    "คงค้าง",
                  ]}
                  empty={invoices.length === 0}
                >
                  {invoices.map((i) => (
                    <tr key={i.id}>
                      <td>{i.number}</td>
                      <td>{i.room}</td>
                      <td>{money(invoiceTotal(i))}</td>
                      <td>{money(invoicePaid(state, i))}</td>
                      <td className="text-red">
                        {money(invoiceBalance(state, i))}
                      </td>
                    </tr>
                  ))}
                </DataTable>
              </Card>
            ),
          },
          {
            value: "expenses",
            label: "รายจ่าย",
            content: (
              <Card title="รายจ่าย OPEX / CAPEX">
                <DataTable
                  caption="รายจ่ายในรายงาน"
                  headers={["วันที่", "รายการ", "ประเภท", "จำนวนเงิน"]}
                  empty={expenses.length === 0}
                >
                  {expenses.map((e) => (
                    <tr key={e.id}>
                      <td>{date(e.date)}</td>
                      <td>{e.title}</td>
                      <td>
                        <Badge tone={e.kind === "OPEX" ? "green" : "purple"}>
                          {e.kind}
                        </Badge>
                      </td>
                      <td>{money(e.amount)}</td>
                    </tr>
                  ))}
                </DataTable>
              </Card>
            ),
          },
          {
            value: "cashflow",
            label: "กระแสเงินสด",
            content: (
              <Card title="เงินรับจริงและกระแสเงินสด">
                <div className="expense-split">
                  <span>เงินรับจริง</span>
                  <strong className="text-green">
                    {money(totals.received)}
                  </strong>
                </div>
                <div className="expense-split">
                  <span>หัก OPEX</span>
                  <strong>{money(totals.opex)}</strong>
                </div>
                <div className="expense-split">
                  <span>กระแสเงินสดดำเนินงาน</span>
                  <strong>{money(totals.operatingCash)}</strong>
                </div>
                <div className="expense-split">
                  <span>หัก CAPEX</span>
                  <strong>{money(totals.capex)}</strong>
                </div>
                <div className="expense-split">
                  <span>กระแสเงินสดสุทธิ</span>
                  <strong className="text-blue">{money(totals.netCash)}</strong>
                </div>
                <p className="report-note paragraph-gap">
                  รายงานกระแสเงินสดสาธิตนี้ไม่ใช่งบกำไรขาดทุน
                  และไม่รวมเงินประกัน
                </p>
              </Card>
            ),
          },
          {
            value: "outstanding",
            label: "ค้างชำระ",
            content: (
              <Card title="ยอดค้างของใบแจ้งหนี้เดือนนี้">
                <DataTable
                  caption="ยอดค้างชำระ"
                  headers={["ห้อง", "เลขที่บิล", "กำหนดชำระ", "ยอดค้าง"]}
                  empty={!invoices.some((i) => invoiceBalance(state, i) > 0)}
                >
                  {invoices
                    .filter((i) => invoiceBalance(state, i) > 0)
                    .map((i) => (
                      <tr key={i.id}>
                        <td className="table-room">{i.room}</td>
                        <td>{i.number}</td>
                        <td>{date(i.dueDate)}</td>
                        <td className="text-red font-semibold">
                          {money(invoiceBalance(state, i))}
                        </td>
                      </tr>
                    ))}
                </DataTable>
              </Card>
            ),
          },
          {
            value: "export",
            label: "ส่งออกข้อมูล",
            content: (
              <Card title="ส่งออกข้อมูลสาธิตเป็น CSV">
                <p className="report-note">
                  ไฟล์ตรงกับเดือนที่เลือกและเปิดในโปรแกรมตารางคำนวณได้
                </p>
                <div className="toolbar-actions paragraph-gap">
                  <Button onClick={exportSummary}>
                    <FileSpreadsheet size={16} />
                    สรุปการเงิน CSV
                  </Button>
                  <Button
                    variant="secondary"
                    onClick={() =>
                      exportCsv(`taky-demo-receipts-${month}.csv`, [
                        ["วันที่", "เลขอ้างอิง", "จำนวนเงิน"],
                        ...receipts.map((p) => [
                          p.date,
                          p.reference,
                          paymentTotal(p) / 100,
                        ]),
                      ])
                    }
                  >
                    รายการรับชำระ CSV
                  </Button>
                </div>
              </Card>
            ),
          },
        ]}
      />
      <div className="paragraph-gap">
        <Notice>
          ข้อมูลสมมติ • เงินประกัน{" "}
          {money(
            state.leases
              .filter((l) => l.status === "active")
              .reduce((s, l) => s + l.deposit, 0),
          )}{" "}
          เป็นภาระหนี้สิน จึงไม่รวมในรายรับ ค่าใช้จ่าย หรือกระแสเงินสดข้างต้น
        </Notice>
      </div>
    </>
  );
}
