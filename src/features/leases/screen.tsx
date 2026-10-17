"use client";
import { useState } from "react";
import { Download, FileText, CalendarClock, ShieldCheck } from "lucide-react";
import {
  Badge,
  Button,
  Card,
  DataTable,
  Modal,
  Notice,
  SearchField,
} from "@/components/ui";
import { Kpi } from "@/components/charts";
import { useDemo } from "@/demo/workspace";
import { date, exportCsv, money } from "@/lib/format";

export function LeasesScreen() {
  const { state } = useDemo();
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("all");
  const [selected, setSelected] = useState<string | null>(null);
  const active = state.leases.filter((l) => l.status === "active");
  const rows = state.leases.filter(
    (l) =>
      `${l.id} ${l.room} ${state.tenants.find((t) => t.id === l.tenantId)?.name}`
        .toLowerCase()
        .includes(query.toLowerCase()) &&
      (filter === "all" ||
        (filter === "expiring"
          ? l.end <= "2026-11-14" && l.status === "active"
          : l.status === filter)),
  );
  const lease = state.leases.find((l) => l.id === selected);
  const tenant = state.tenants.find((t) => t.id === lease?.tenantId);
  return (
    <>
      <div className="metric-grid">
        <Kpi
          label="สัญญาที่ใช้งาน"
          value={`${active.length} สัญญา`}
          note="หนึ่งสัญญาปัจจุบันต่อหนึ่งห้อง"
          tone="green"
          icon={FileText}
        />
        <Kpi
          label="ใกล้หมดอายุใน 30 วัน"
          value={`${active.filter((l) => l.end <= "2026-11-14").length} สัญญา`}
          note="อ้างอิงวันที่สาธิต 15 ต.ค. 2026"
          tone="blue"
          icon={CalendarClock}
        />
        <Kpi
          label="เงินประกันที่ถืออยู่"
          value={money(active.reduce((s, l) => s + l.deposit, 0))}
          note="ภาระหนี้สิน ไม่ใช่รายรับ"
          tone="purple"
          icon={ShieldCheck}
        />
        <Kpi
          label="ค่าเช่ารวมตามสัญญา"
          value={money(active.reduce((s, l) => s + l.rent, 0))}
          note="ต่อเดือน ไม่รวมค่าน้ำและค่าไฟ"
          tone="blue"
        />
      </div>
      <Card
        title="รายการสัญญาเช่า"
        action={
          <Button
            variant="secondary"
            onClick={() =>
              exportCsv("taky-demo-leases.csv", [
                [
                  "เลขที่สัญญา",
                  "ห้อง",
                  "ผู้เช่า",
                  "เริ่ม",
                  "สิ้นสุด",
                  "ค่าเช่า",
                  "เงินประกัน",
                ],
                ...rows.map((l) => [
                  l.id,
                  l.room,
                  state.tenants.find((t) => t.id === l.tenantId)?.name || "",
                  l.start,
                  l.end,
                  l.rent / 100,
                  l.deposit / 100,
                ]),
              ])
            }
          >
            <Download size={15} />
            ส่งออก CSV
          </Button>
        }
      >
        <div className="filter-bar">
          <select
            aria-label="สถานะสัญญา"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          >
            <option value="all">สัญญาทั้งหมด</option>
            <option value="active">ใช้งาน</option>
            <option value="expiring">ใกล้หมดอายุ</option>
            <option value="ended">สิ้นสุดแล้ว</option>
          </select>
          <SearchField
            value={query}
            onChange={setQuery}
            label="ค้นหาสัญญา"
            placeholder="ค้นหาสัญญา / ห้อง / ผู้เช่า..."
          />
        </div>
        <DataTable
          caption="รายการสัญญาเช่า"
          headers={[
            "เลขที่สัญญา",
            "ห้อง",
            "ผู้เช่า",
            "ระยะเวลาสัญญา",
            "ค่าเช่า",
            "เงินประกัน",
            "สถานะ",
            "รายละเอียด",
          ]}
          empty={rows.length === 0}
        >
          {rows.map((l) => (
            <tr key={l.id}>
              <td>
                <span className="font-semibold">{l.id}</span>
              </td>
              <td className="table-room">{l.room}</td>
              <td>{state.tenants.find((t) => t.id === l.tenantId)?.name}</td>
              <td>
                {date(l.start)}
                <span className="table-subtitle">ถึง {date(l.end)}</span>
              </td>
              <td>{money(l.rent)}</td>
              <td>{money(l.deposit)}</td>
              <td>
                <Badge tone={l.end <= "2026-11-14" ? "amber" : "green"}>
                  {l.end <= "2026-11-14" ? "ใกล้หมดอายุ" : "ใช้งาน"}
                </Badge>
              </td>
              <td>
                <button
                  className="text-link"
                  onClick={() => setSelected(l.id)}
                  aria-label={`ดูสัญญา ${l.id}`}
                >
                  ดูสัญญา
                </button>
              </td>
            </tr>
          ))}
        </DataTable>
        <div className="table-footer">
          <span>
            แสดง {rows.length} จาก {state.leases.length} สัญญา
          </span>
          <span>ข้อมูลสัญญาสมมติ</span>
        </div>
      </Card>
      <Modal
        open={!!lease}
        onOpenChange={(open) => {
          if (!open) setSelected(null);
        }}
        title="รายละเอียดสัญญาเช่า"
      >
        {lease && (
          <>
            <div className="lease-summary">
              <Badge>ใช้งาน</Badge>
              <strong>{lease.id}</strong>
            </div>
            <dl className="detail-grid">
              <div>
                <dt>ห้องพัก</dt>
                <dd>{lease.room}</dd>
              </div>
              <div>
                <dt>ผู้เช่า</dt>
                <dd>{tenant?.name}</dd>
              </div>
              <div>
                <dt>เริ่มสัญญา</dt>
                <dd>{date(lease.start)}</dd>
              </div>
              <div>
                <dt>สิ้นสุดสัญญา</dt>
                <dd>{date(lease.end)}</dd>
              </div>
              <div>
                <dt>ค่าเช่ารายเดือน</dt>
                <dd>{money(lease.rent)}</dd>
              </div>
              <div>
                <dt>เงินประกัน</dt>
                <dd>{money(lease.deposit)}</dd>
              </div>
            </dl>
            <div className="paragraph-gap">
              <Notice>
                สรุปข้อมูลสัญญาสาธิต การสร้างและลงนามสัญญาจริงจะพัฒนาในระยะถัดไป
              </Notice>
            </div>
            <div className="form-actions">
              <Button onClick={() => setSelected(null)}>ปิด</Button>
            </div>
          </>
        )}
      </Modal>
    </>
  );
}
