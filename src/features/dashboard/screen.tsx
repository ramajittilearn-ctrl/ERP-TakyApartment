"use client";

import { useEffect, useState } from "react";
import { Building2, CalendarDays, RotateCw } from "lucide-react";
import { Button, Card, DataTable, EmptyState } from "@/components/ui";
import { Kpi } from "@/components/charts";
import { date, monthLabel } from "@/lib/format";
import {
  dashboardEnvelopeSchema,
  type DashboardDto,
} from "@/server/dashboard/contracts";

type DashboardState =
  | { status: "loading" }
  | { status: "error" }
  | { status: "ready"; data: DashboardDto };

function amount(value: string): string {
  const match = /^(-?)(\d+)(?:\.(\d{1,2}))?$/.exec(value);
  if (!match) throw new Error("Invalid decimal amount in dashboard response");

  const [, sign, whole, fraction = ""] = match;
  const formattedWhole = new Intl.NumberFormat("th-TH").format(BigInt(whole));
  return `${sign}${formattedWhole}.${fraction.padEnd(2, "0")} บาท`;
}

export function DashboardScreen({ initialMonth }: { initialMonth: string }) {
  const [month, setMonth] = useState(initialMonth);
  const [reload, setReload] = useState(0);
  const [dashboard, setDashboard] = useState<DashboardState>({
    status: "loading",
  });

  useEffect(() => {
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) {
      setDashboard({ status: "error" });
      return;
    }

    const controller = new AbortController();
    setDashboard({ status: "loading" });

    void fetch(`/api/v1/dashboard/?month=${encodeURIComponent(month)}`, {
      signal: controller.signal,
      cache: "no-store",
    })
      .then(async (response) => {
        if (!response.ok) throw new Error("Dashboard request failed");
        const body: unknown = await response.json();
        return dashboardEnvelopeSchema.parse(body).data;
      })
      .then((data) => setDashboard({ status: "ready", data }))
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError")
          return;
        setDashboard({ status: "error" });
      });

    return () => controller.abort();
  }, [month, reload]);

  return (
    <>
      <div className="screen-toolbar">
        <div className="toolbar-label">
          <CalendarDays size={16} aria-hidden="true" />
          <span>
            ภาพรวมประจำเดือน
            {/^\d{4}-(0[1-9]|1[0-2])$/.test(month)
              ? ` ${monthLabel(month)}`
              : ""}
          </span>
        </div>
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

      {dashboard.status === "loading" && (
        <p role="status" aria-live="polite">
          กำลังโหลดภาพรวม…
        </p>
      )}

      {dashboard.status === "error" && (
        <Card title="โหลดภาพรวมไม่สำเร็จ">
          <p className="report-note">ตรวจสอบการเชื่อมต่อแล้วลองใหม่อีกครั้ง</p>
          <div className="paragraph-gap">
            <Button onClick={() => setReload((value) => value + 1)}>
              <RotateCw size={15} aria-hidden="true" />
              ลองอีกครั้ง
            </Button>
          </div>
        </Card>
      )}

      {dashboard.status === "ready" && (
        <DashboardContent data={dashboard.data} />
      )}
    </>
  );
}

function DashboardContent({ data }: { data: DashboardDto }) {
  const monthSummary = data.financials.selectedMonth;
  const roomCounts = [
    { label: "ห้องว่าง", value: data.rooms.available },
    { label: "ห้องซ่อมบำรุง", value: data.rooms.maintenance },
    { label: "ห้องที่สำรองไว้", value: data.rooms.reserved },
  ];
  const hasFinancialData = data.financials.trend.some(
    (row) => row.invoiceCount + row.receiptCount + row.expenseCount > 0,
  );

  return (
    <>
      <div className="metric-grid">
        <Kpi
          label="ยอดใบแจ้งหนี้ที่ออก"
          value={amount(monthSummary.issuedTotal)}
          note={`${monthSummary.invoiceCount} ใบ • ตามรอบบิล`}
          tone="blue"
        />
        <Kpi
          label="รับชำระที่ยืนยันแล้ว"
          value={amount(monthSummary.confirmedTotal)}
          note={`${monthSummary.receiptCount} รายการ • ตามวันที่รับเงิน`}
          tone="green"
        />
        <Kpi
          label="ยอดคงค้างปัจจุบัน"
          value={amount(monthSummary.currentOutstanding)}
          note="ของใบแจ้งหนี้ในรอบบิลที่เลือก • ยอด ณ ตอนนี้"
          tone="red"
        />
        <Kpi
          label="ค่าใช้จ่าย OPEX"
          value={amount(monthSummary.opexTotal)}
          note="ตามวันที่เกิดรายการ"
          tone="purple"
        />
        <Kpi
          label="ค่าใช้จ่าย CAPEX"
          value={amount(monthSummary.capexTotal)}
          note="ตามวันที่เกิดรายการ • แยกจาก OPEX"
          tone="blue"
        />
      </div>

      <div className="dashboard-middle">
        <Card title="สถานะห้อง" description="นับจากห้องที่บันทึกไว้ในระบบ">
          <div className="occupancy-content">
            <div className="occupancy-stats">
              <div className="donut-percentage">
                {data.rooms.listed}
                <span className="text-small"> ห้อง</span>
              </div>
              <p className="muted-text text-small">ห้องที่ลงทะเบียนไว้</p>
              <p>
                <strong>{data.rooms.activeLeaseStatus}</strong> ห้องมีสัญญาเช่า
                สถานะ ACTIVE
              </p>
              <p className="muted-text text-small">
                จำนวนสัญญา ACTIVE แสดงตามสถานะในระบบ
                ไม่ได้ยืนยันการเข้าพักตามวันที่
              </p>
            </div>
            <div className="legend-list">
              {roomCounts.map(({ label, value }) => (
                <div className="legend-item" key={label}>
                  <span className="legend-label">
                    <Building2 size={14} aria-hidden="true" />
                    {label}
                  </span>
                  <strong className="legend-value">{value}</strong>
                </div>
              ))}
            </div>
          </div>
        </Card>

        <Card
          title="ยอดตามเดือนย้อนหลัง 6 เดือน"
          description="ยอดแยกตามวันที่ทางบัญชีของแต่ละรายการ • หน่วย: บาท"
        >
          {hasFinancialData ? (
            <DataTable
              caption="ยอดรายเดือนย้อนหลัง 6 เดือน"
              headers={[
                "เดือน",
                "ออกบิลตามรอบบิล",
                "รับชำระตามวันที่รับเงิน",
                "OPEX ตามวันที่เกิดรายการ",
                "CAPEX ตามวันที่เกิดรายการ",
              ]}
            >
              {data.financials.trend.map((row) => (
                <tr key={row.month}>
                  <th scope="row">{monthLabel(row.month)}</th>
                  <td className="numeric">{amount(row.issuedTotal)}</td>
                  <td className="numeric">{amount(row.confirmedTotal)}</td>
                  <td className="numeric">{amount(row.opexTotal)}</td>
                  <td className="numeric">{amount(row.capexTotal)}</td>
                </tr>
              ))}
            </DataTable>
          ) : (
            <EmptyState
              title="ยังไม่มีข้อมูลการเงิน"
              description="ไม่มีใบแจ้งหนี้ การรับชำระ หรือค่าใช้จ่ายในช่วง 6 เดือนนี้"
            />
          )}
        </Card>
      </div>

      <Card
        title={`รายการค้างชำระ • รอบบิล ${monthLabel(data.month)}`}
        description="ยอดคงค้างปัจจุบัน ไม่ใช่ยอดย้อนหลัง ณ สิ้นเดือน"
      >
        {data.financials.outstanding.length > 0 ? (
          <DataTable
            caption="ใบแจ้งหนี้ที่มียอดคงค้างในรอบเดือนที่เลือก"
            headers={[
              "เลขที่ใบแจ้งหนี้",
              "ห้อง",
              "กำหนดชำระ",
              "คงค้างปัจจุบัน",
            ]}
          >
            {data.financials.outstanding.map((invoice) => (
              <tr key={invoice.invoiceId}>
                <td>{invoice.number}</td>
                <td>ห้อง {invoice.roomNumber}</td>
                <td>{invoice.dueDate ? date(invoice.dueDate) : "—"}</td>
                <td className="numeric text-red">
                  {amount(invoice.currentOutstanding)}
                </td>
              </tr>
            ))}
          </DataTable>
        ) : (
          <EmptyState
            title="ไม่มีใบแจ้งหนี้คงค้าง"
            description="ไม่มีรายการคงค้างในรอบบิลนี้"
          />
        )}
      </Card>
    </>
  );
}
