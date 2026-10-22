"use client";

import Link from "next/link";
import {
  Banknote,
  CreditCard,
  CircleAlert,
  Wallet,
  ChevronRight,
  ReceiptText,
  Wrench,
  CalendarDays,
} from "lucide-react";
import { useState } from "react";
import { Badge, Card, MonthSelect } from "@/components/ui";
import { BarChart, Donut, Kpi, Legend } from "@/components/charts";
import { useDemo } from "@/demo/workspace";
import { DEFAULT_MONTH, months } from "@/demo/model";
import { invoiceBalance, summarizeMonth } from "@/demo/finance";
import { money, monthLabel, shortMonth, date } from "@/lib/format";

export function DashboardScreen() {
  const { state } = useDemo();
  const [month, setMonth] = useState(DEFAULT_MONTH);
  const totals = summarizeMonth(state, month);
  const occupied = state.rooms.filter((r) => r.status === "occupied").length;
  const segments = [
    { label: "มีผู้เช่า", value: occupied, color: "#17b18a" },
    {
      label: "ห้องว่าง",
      value: state.rooms.filter((r) => r.status === "vacant").length,
      color: "#a5c7d6",
    },
    {
      label: "ซ่อมบำรุง",
      value: state.rooms.filter((r) => r.status === "maintenance").length,
      color: "#f2c768",
    },
  ];
  const outstanding = state.invoices.filter(
    (i) => i.month === month && invoiceBalance(state, i) > 0,
  );
  const openTickets = state.tickets.filter((t) => t.status !== "resolved");
  const chartMonths = months.filter((m) => m <= month).slice(-6);
  return (
    <>
      <div className="screen-toolbar">
        <p className="toolbar-label">
          <CalendarDays size={16} aria-hidden="true" />
          ภาพรวมประจำเดือน {monthLabel(month)}
        </p>
        <MonthSelect value={month} onChange={setMonth} />
      </div>
      <div className="metric-grid">
        <Kpi
          label="รายรับตามบิล"
          value={money(totals.billed)}
          note="ยอดออกบิลทั้งหมดในเดือน"
          tone="green"
          icon={Banknote}
        />
        <Kpi
          label="รับชำระแล้ว"
          value={money(totals.received)}
          note="เฉพาะรายการที่ยืนยันแล้ว"
          tone="blue"
          icon={CreditCard}
        />
        <Kpi
          label="ค้างชำระ"
          value={money(totals.outstanding)}
          note={`${outstanding.length} ห้องที่มียอดค้าง`}
          tone="red"
          icon={CircleAlert}
        />
        <Kpi
          label="ค่าใช้จ่ายดำเนินงาน"
          value={money(totals.opex)}
          note="OPEX ไม่รวมเงินลงทุน"
          tone="purple"
          icon={Wallet}
        />
      </div>
      <div className="dashboard-middle">
        <Card
          title="อัตราการเข้าพัก"
          action={
            <Link href="/rooms/" className="section-link">
              ดูห้องพัก
              <ChevronRight size={13} />
            </Link>
          }
        >
          <div className="occupancy-content">
            <Donut
              segments={segments}
              primary={`${occupied}/15`}
              secondary="ห้องที่มีผู้เช่า"
              label={`มีผู้เช่า ${occupied} จาก 15 ห้อง`}
            />
            <div className="occupancy-stats">
              <div className="donut-percentage">
                {((occupied / 15) * 100).toFixed(0)}
                <span className="text-small">%</span>
              </div>
              <Legend segments={segments} />
            </div>
          </div>
        </Card>
        <Card
          title="รายรับ - รายจ่าย"
          description="ย้อนหลังสูงสุด 6 เดือน • หน่วย: บาท"
        >
          <BarChart
            label="เปรียบเทียบรายรับและรายจ่ายย้อนหลัง"
            series={[
              { label: "รายรับจริง", color: "#16b48c" },
              { label: "รายจ่ายรวม", color: "#f16b75" },
            ]}
            rows={chartMonths.map((m) => {
              const t = summarizeMonth(state, m);
              return {
                label: shortMonth(m),
                values: [t.received / 100, (t.opex + t.capex) / 100],
              };
            })}
          />
          <p className="chart-caption">
            รายจ่ายรวม OPEX และ CAPEX • ข้อมูลสมมติสำหรับสาธิต
          </p>
        </Card>
      </div>
      <div className="two-column dashboard-bottom">
        <Card
          title="รายการที่ต้องดำเนินการ"
          action={<Badge tone="red">{outstanding.length} รายการ</Badge>}
        >
          <div className="action-list">
            {outstanding.length === 0 ? (
              <p className="muted-text text-small">
                ไม่มีรายการค้างชำระในเดือนนี้
              </p>
            ) : (
              outstanding.map((i) => (
                <Link
                  href="/payments/"
                  key={i.id}
                  className="action-row action-row-link"
                >
                  <div className="action-info">
                    <span className="action-icon">
                      <ReceiptText size={16} />
                    </span>
                    <div>
                      <strong>
                        ห้อง {i.room} ค้างชำระ {money(invoiceBalance(state, i))}
                      </strong>
                      <small>กำหนดชำระ {date(i.dueDate)}</small>
                    </div>
                  </div>
                  <Badge tone="red">ค้างชำระ</Badge>
                </Link>
              ))
            )}
          </div>
        </Card>
        <Card
          title="แจ้งซ่อมล่าสุด"
          action={
            <Link href="/maintenance/" className="section-link">
              ดูทั้งหมด
              <ChevronRight size={13} />
            </Link>
          }
        >
          <div className="action-list">
            {openTickets.map((t) => (
              <Link
                href="/maintenance/"
                key={t.id}
                className="action-row action-row-link"
              >
                <div className="action-info">
                  <span className="action-icon blue">
                    <Wrench size={16} />
                  </span>
                  <div>
                    <strong>ห้อง {t.room}</strong>
                    <small>{t.issue}</small>
                  </div>
                </div>
                <Badge tone={t.status === "in-progress" ? "blue" : "amber"}>
                  {t.status === "in-progress" ? "กำลังดำเนินการ" : "รออนุมัติ"}
                </Badge>
              </Link>
            ))}
          </div>
        </Card>
      </div>
      <Card title="กระแสเงินสดประจำเดือน">
        <div className="summary-strip">
          <div>
            <p>เงินลงทุน CAPEX</p>
            <strong>{money(totals.capex)}</strong>
          </div>
          <div>
            <p>กระแสเงินสดดำเนินงาน</p>
            <strong className="text-green">
              {money(totals.operatingCash)}
            </strong>
          </div>
          <div>
            <p>กระแสเงินสดสุทธิ</p>
            <strong className="text-blue">{money(totals.netCash)}</strong>
          </div>
          <div>
            <p>เงินประกันที่ถืออยู่</p>
            <strong>
              {money(
                state.leases
                  .filter((l) => l.status === "active")
                  .reduce((s, l) => s + l.deposit, 0),
              )}
            </strong>
            <small className="text-small muted-text">
              ภาระหนี้สิน ไม่ใช่รายรับ
            </small>
          </div>
        </div>
      </Card>
    </>
  );
}
