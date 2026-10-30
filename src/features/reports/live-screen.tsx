"use client";

import { useEffect, useState } from "react";
import { Download, FileSpreadsheet } from "lucide-react";
import { Button, Card, DataTable, Notice, Tabs } from "@/components/ui";
import { Kpi } from "@/components/charts";
import { date, exportCsv, monthLabel } from "@/lib/format";
import {
  monthlyReportEnvelopeSchema,
  type MonthlyReportDto,
} from "@/server/reports/contracts";

type ReportState =
  | { status: "loading" }
  | { status: "error" }
  | { status: "ready"; data: MonthlyReportDto };

function amount(value: string): string {
  const match = /^(-?)(\d+)(?:\.(\d{1,2}))?$/.exec(value);
  if (!match) throw new Error("Invalid decimal amount in report response");

  const [, sign, whole, fraction = ""] = match;
  const formattedWhole = new Intl.NumberFormat("th-TH").format(BigInt(whole));
  return `${sign}${formattedWhole}.${fraction.padEnd(2, "0")} บาท`;
}

function receiptDate(value: string): string {
  return new Intl.DateTimeFormat("th-TH-u-ca-gregory", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Bangkok",
  }).format(new Date(value));
}

function exportSummary(data: MonthlyReportDto) {
  exportCsv(`taky-financial-summary-${data.month}.csv`, [
    ["เดือน", "รายการ", "จำนวนเงิน (บาท)"],
    [data.month, "ยอดใบแจ้งหนี้ที่ออก", data.invoices.issuedTotal],
    [
      data.month,
      "ยอดคงค้างปัจจุบันของใบแจ้งหนี้",
      data.invoices.currentOutstanding,
    ],
    [
      data.month,
      "รับชำระที่ยืนยันแล้วตามวันที่รับเงิน",
      data.receipts.confirmedTotal,
    ],
    [
      data.month,
      "ค่าใช้จ่าย OPEX ตามวันที่เกิดรายการ",
      data.expenses.opexTotal,
    ],
    [
      data.month,
      "ค่าใช้จ่าย CAPEX ตามวันที่เกิดรายการ",
      data.expenses.capexTotal,
    ],
  ]);
}

export function LiveReportsScreen({ initialMonth }: { initialMonth: string }) {
  const [month, setMonth] = useState(initialMonth);
  const [reload, setReload] = useState(0);
  const [report, setReport] = useState<ReportState>({ status: "loading" });

  useEffect(() => {
    const controller = new AbortController();
    setReport({ status: "loading" });

    void fetch(`/api/v1/reports/monthly/?month=${encodeURIComponent(month)}`, {
      signal: controller.signal,
      cache: "no-store",
    })
      .then(async (response) => {
        if (!response.ok) throw new Error("Report request failed");
        const body: unknown = await response.json();
        return monthlyReportEnvelopeSchema.parse(body).data;
      })
      .then((data) => setReport({ status: "ready", data }))
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError")
          return;
        setReport({ status: "error" });
      });

    return () => controller.abort();
  }, [month, reload]);

  const downloadButton = report.status === "ready" && (
    <Button variant="secondary" onClick={() => exportSummary(report.data)}>
      <Download size={15} aria-hidden="true" />
      ส่งออกสรุป CSV
    </Button>
  );

  return (
    <>
      <div className="screen-toolbar">
        <div className="toolbar-label">
          <span>รายงานการเงิน</span>
          <label className="select-wrap">
            <span className="sr-only">เดือน</span>
            <input
              aria-label="เดือน"
              type="month"
              value={month}
              onChange={(event) => setMonth(event.currentTarget.value)}
            />
          </label>
        </div>
        {downloadButton}
      </div>

      {report.status === "loading" && (
        <p role="status" aria-live="polite">
          กำลังโหลดรายงานประจำเดือน…
        </p>
      )}

      {report.status === "error" && (
        <Card title="โหลดรายงานไม่สำเร็จ">
          <p className="report-note">ตรวจสอบการเชื่อมต่อแล้วลองใหม่อีกครั้ง</p>
          <div className="paragraph-gap">
            <Button onClick={() => setReload((value) => value + 1)}>
              ลองอีกครั้ง
            </Button>
          </div>
        </Card>
      )}

      {report.status === "ready" && <ReportContent data={report.data} />}
    </>
  );
}

function ReportContent({ data }: { data: MonthlyReportDto }) {
  const summary = (
    <>
      <div className="metric-grid">
        <Kpi
          label="ยอดใบแจ้งหนี้ที่ออก"
          value={amount(data.invoices.issuedTotal)}
          note={`${data.invoices.issuedCount} ใบ • รอบบิล ${monthLabel(data.month)}`}
          tone="blue"
        />
        <Kpi
          label="ยอดคงค้างปัจจุบัน"
          value={amount(data.invoices.currentOutstanding)}
          note={`${data.invoices.currentOutstandingInvoiceCount} ใบ • ยอด ณ ตอนนี้`}
          tone="red"
        />
        <Kpi
          label="รับชำระที่ยืนยันแล้ว"
          value={amount(data.receipts.confirmedTotal)}
          note={`${data.receipts.confirmedCount} รายการ • ตามวันที่รับเงิน`}
          tone="green"
        />
        <Kpi
          label="ค่าใช้จ่ายที่บันทึก"
          value={amount(data.expenses.total)}
          note={`OPEX ${amount(data.expenses.opexTotal)} • CAPEX ${amount(data.expenses.capexTotal)}`}
          tone="purple"
        />
      </div>
      <div className="paragraph-gap">
        <Card title="หลักการอ่านรายงาน">
          <p className="report-note">
            ใบแจ้งหนี้จัดตามรอบบิล {monthLabel(data.month)};
            เงินรับจัดตามวันที่รับเงินจริงในเดือนนี้;
            ค่าใช้จ่ายจัดตามวันที่เกิดรายการในเดือนนี้
            ยอดคงค้างเป็นยอดปัจจุบันของใบแจ้งหนี้ในรอบบิลที่เลือก
            ไม่ใช่ยอดย้อนหลัง ณ สิ้นเดือน
          </p>
        </Card>
      </div>
    </>
  );

  const invoiceRows = data.invoices.rows.map((invoice) => (
    <tr key={invoice.invoiceId}>
      <td>{invoice.number}</td>
      <td className="numeric">{amount(invoice.finalTotal)}</td>
      <td className="numeric">{amount(invoice.paidToDate)}</td>
      <td className="numeric text-red">{amount(invoice.currentOutstanding)}</td>
    </tr>
  ));
  const receiptRows = data.receipts.rows.map((receipt) => (
    <tr key={receipt.paymentId}>
      <td>{receiptDate(receipt.receivedAt)}</td>
      <td>{receipt.reference}</td>
      <td>{receipt.receiptNumber ?? "—"}</td>
      <td className="numeric">{amount(receipt.amount)}</td>
    </tr>
  ));
  const expenseRows = data.expenses.rows.map((expense) => (
    <tr key={expense.expenseId}>
      <td>{date(expense.occurredAt)}</td>
      <td>{expense.description}</td>
      <td>{expense.categoryName}</td>
      <td>{expense.kind}</td>
      <td className="numeric">{amount(expense.amount)}</td>
    </tr>
  ));

  return (
    <>
      <Tabs
        items={[
          { value: "summary", label: "สรุปรายเดือน", content: summary },
          {
            value: "invoices",
            label: "ใบแจ้งหนี้",
            content: (
              <Card title={`ใบแจ้งหนี้รอบ ${monthLabel(data.month)}`}>
                <DataTable
                  caption="ใบแจ้งหนี้ที่ออกแล้ว"
                  headers={[
                    "เลขที่บิล",
                    "ยอดบิล",
                    "ชำระแล้ว",
                    "คงค้างปัจจุบัน",
                  ]}
                  empty={data.invoices.rows.length === 0}
                >
                  {invoiceRows}
                </DataTable>
              </Card>
            ),
          },
          {
            value: "receipts",
            label: "รับชำระ",
            content: (
              <Card
                title={`รับชำระที่ยืนยันแล้ว • เดือน ${monthLabel(data.month)}`}
              >
                <DataTable
                  caption="รับชำระที่ยืนยันแล้วในเดือนที่เลือก"
                  headers={[
                    "วันที่รับเงิน",
                    "อ้างอิง",
                    "เลขที่ใบเสร็จ",
                    "จำนวนเงิน",
                  ]}
                  empty={data.receipts.rows.length === 0}
                >
                  {receiptRows}
                </DataTable>
              </Card>
            ),
          },
          {
            value: "expenses",
            label: "ค่าใช้จ่าย",
            content: (
              <Card title={`ค่าใช้จ่าย • เดือน ${monthLabel(data.month)}`}>
                <DataTable
                  caption="ค่าใช้จ่ายที่ลงบัญชีในเดือนที่เลือก"
                  headers={[
                    "วันที่เกิดรายการ",
                    "รายละเอียด",
                    "หมวด",
                    "ประเภท",
                    "จำนวนเงิน",
                  ]}
                  empty={data.expenses.rows.length === 0}
                >
                  {expenseRows}
                </DataTable>
              </Card>
            ),
          },
          {
            value: "export",
            label: "ส่งออก",
            content: (
              <Card title="ส่งออกข้อมูลรายเดือน">
                <p className="report-note">
                  ดาวน์โหลด CSV
                  โดยเก็บจำนวนเงินเป็นข้อความทศนิยมเพื่อรักษาความแม่นยำ
                </p>
                <div className="toolbar-actions paragraph-gap">
                  <Button onClick={() => exportSummary(data)}>
                    <FileSpreadsheet size={16} aria-hidden="true" />
                    สรุปรายเดือน CSV
                  </Button>
                  <Button
                    variant="secondary"
                    onClick={() =>
                      exportCsv(`taky-invoices-${data.month}.csv`, [
                        ["เลขที่บิล", "ยอดบิล", "ชำระแล้ว", "คงค้างปัจจุบัน"],
                        ...data.invoices.rows.map((invoice) => [
                          invoice.number,
                          invoice.finalTotal,
                          invoice.paidToDate,
                          invoice.currentOutstanding,
                        ]),
                      ])
                    }
                  >
                    ใบแจ้งหนี้ CSV
                  </Button>
                  <Button
                    variant="secondary"
                    onClick={() =>
                      exportCsv(`taky-receipts-${data.month}.csv`, [
                        [
                          "วันที่รับเงิน",
                          "อ้างอิง",
                          "เลขที่ใบเสร็จ",
                          "จำนวนเงิน",
                        ],
                        ...data.receipts.rows.map((receipt) => [
                          receipt.receivedAt,
                          receipt.reference,
                          receipt.receiptNumber ?? "",
                          receipt.amount,
                        ]),
                      ])
                    }
                  >
                    รับชำระ CSV
                  </Button>
                  <Button
                    variant="secondary"
                    onClick={() =>
                      exportCsv(`taky-expenses-${data.month}.csv`, [
                        [
                          "วันที่เกิดรายการ",
                          "รายละเอียด",
                          "หมวด",
                          "ประเภท",
                          "จำนวนเงิน",
                        ],
                        ...data.expenses.rows.map((expense) => [
                          expense.occurredAt,
                          expense.description,
                          expense.categoryName,
                          expense.kind,
                          expense.amount,
                        ]),
                      ])
                    }
                  >
                    ค่าใช้จ่าย CSV
                  </Button>
                </div>
              </Card>
            ),
          },
        ]}
      />
      <div className="paragraph-gap">
        <Notice>
          ตัวเลขนี้แสดงรายการใบแจ้งหนี้ เงินรับ
          และค่าใช้จ่ายแยกตามวันที่ของแต่ละรายการ
          ไม่ใช่รายงานกระแสเงินสดหรือกำไร และไม่รวมเงินประกัน
        </Notice>
      </div>
    </>
  );
}
