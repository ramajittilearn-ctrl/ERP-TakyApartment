"use client";
import { useState } from "react";
import Link from "next/link";
import { paymentStatusLabels } from "./payment-status";
import { Download, FileText, CalendarClock, ShieldCheck } from "lucide-react";
import { Kpi } from "@/components/charts";
import { date, exportCsv } from "@/lib/format";
import {
  leaseLabels as labels,
  sumMoney,
  expiringWithin30Days,
} from "./lease-summary";
import {
  Badge,
  Button,
  Card,
  DataTable,
  ErrorMessage,
  SearchField,
  Notice,
  Modal,
} from "@/components/ui";
import { useLiveWorkspace, baht } from "./workspace";
import { RecordEditor, DeleteRecord, type Draft } from "./editor";
export function LiveLeases({
  admin,
  initialId = "",
}: {
  admin: boolean;
  initialId?: string;
}) {
  const { data, error, reload } = useLiveWorkspace();
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("all");
  const [draft, setDraft] = useState<Draft | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [selected, setSelected] = useState(initialId);
  if (!data)
    return (
      <Card>
        <ErrorMessage>{error}</ErrorMessage>
        <p role="status">กำลังโหลดสัญญา…</p>
        {error && <Button onClick={reload}>ลองอีกครั้ง</Button>}
      </Card>
    );
  const today = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Bangkok",
  }).format(new Date());
  const active = data.leases.filter((l) => l.status === "ACTIVE");
  const leases = data.leases.filter(
    (l) =>
      (status === "all" ||
        (status === "expiring"
          ? expiringWithin30Days(l, today)
          : l.status === status)) &&
      `${l.number} ${l.tenant.name} ${l.room.number}`
        .toLowerCase()
        .includes(query.toLowerCase()),
  );
  const deleted = data.leases.find((l) => l.id === deleting);
  const detail = data.leases.find((l) => l.id === selected);
  return (
    <>
      <ErrorMessage>{error}</ErrorMessage>
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
          value={`${active.filter((l) => expiringWithin30Days(l, today)).length} สัญญา`}
          note={`อ้างอิงวันที่ ${date(today)}`}
          tone="blue"
          icon={CalendarClock}
        />
        <Kpi
          label="เงินประกันตามสัญญา"
          value={baht(sumMoney(active.map((l) => l.deposit)))}
          note="ยอดตามสัญญา ยังไม่ใช่ยอดรับเงินจริง"
          tone="purple"
          icon={ShieldCheck}
        />
        <Kpi
          label="ค่าเช่ารวมตามสัญญา"
          value={baht(sumMoney(active.map((l) => l.rent)))}
          note="ต่อเดือน ไม่รวมค่าน้ำและค่าไฟ"
          tone="blue"
        />
      </div>
      <div className="screen-toolbar">
        <p className="toolbar-label">ทั้งหมด {data.leases.length} สัญญา</p>
        <Button
          disabled={!data.tenants.length || !data.rooms.length}
          onClick={() =>
            setDraft({
              entity: "leases",
              values: {
                number: "",
                roomId: "",
                tenantId: "",
                startDate: "",
                endDate: "",
                rent: "0.00",
                deposit: "0.00",
                status: "DRAFT",
                isDemo: false,
              },
            })
          }
        >
          เพิ่มสัญญาเช่า
        </Button>
      </div>
      {!data.tenants.length && <Notice>เพิ่มผู้เช่าก่อนสร้างสัญญาเช่า</Notice>}
      <Card
        title="รายการสัญญาเช่า"
        action={
          <Button
            variant="secondary"
            onClick={() =>
              exportCsv("taky-leases.csv", [
                [
                  "เลขที่สัญญา",
                  "ห้อง",
                  "ผู้เช่า",
                  "เริ่ม",
                  "สิ้นสุด",
                  "ค่าเช่า",
                  "เงินประกัน",
                  "สถานะ",
                  "Demo",
                ],
                ...leases.map((l) => [
                  l.number,
                  l.room.number,
                  l.tenant.name,
                  l.startDate.slice(0, 10),
                  l.endDate.slice(0, 10),
                  l.rent,
                  l.deposit,
                  labels[l.status],
                  l.isDemo ? "Demo" : "",
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
            value={status}
            onChange={(e) => setStatus(e.target.value)}
          >
            <option value="all">สถานะทั้งหมด</option>
            <option value="expiring">ใกล้หมดอายุใน 30 วัน</option>
            {Object.entries(labels).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
          <SearchField
            value={query}
            onChange={setQuery}
            label="ค้นหาสัญญา"
            placeholder="ค้นหาห้อง / ผู้เช่า / สัญญา..."
          />
        </div>
        <DataTable
          caption="สัญญาเช่า"
          headers={[
            "เลขที่สัญญา",
            "ห้อง",
            "ผู้เช่า",
            "ระยะสัญญา",
            "ค่าเช่า",
            "เงินประกัน",
            "สถานะ",
            "จัดการ",
          ]}
          empty={!leases.length}
        >
          {leases.map((l) => (
            <tr key={l.id}>
              <td>
                <button
                  className="text-button"
                  onClick={() => setSelected(l.id)}
                >
                  {l.number}
                </button>
                {l.isDemo && <Badge tone="amber">Demo</Badge>}
              </td>
              <td>
                <Link className="room-label" href={`/rooms/?room=${l.roomId}`}>
                  {l.room.number}
                </Link>
              </td>
              <td>
                <Link href={`/tenants/?tenant=${l.tenantId}`}>
                  {l.tenant.name}
                </Link>
              </td>
              <td>
                {date(l.startDate.slice(0, 10))}
                <br />
                {date(l.endDate.slice(0, 10))}
              </td>
              <td>{baht(l.rent)}</td>
              <td>{baht(l.deposit)}</td>
              <td>
                <Badge tone={l.status === "ACTIVE" ? "green" : "gray"}>
                  {labels[l.status]}
                </Badge>
              </td>
              <td>
                <div className="live-actions">
                  <Button
                    variant="secondary"
                    onClick={() =>
                      setDraft({
                        entity: "leases",
                        id: l.id,
                        values: {
                          number: l.number,
                          roomId: l.roomId,
                          tenantId: l.tenantId,
                          startDate: l.startDate.slice(0, 10),
                          endDate: l.endDate.slice(0, 10),
                          rent: l.rent,
                          deposit: l.deposit,
                          status: l.status,
                          isDemo: l.isDemo,
                        },
                      })
                    }
                  >
                    แก้ไข
                  </Button>
                  {admin && l.status === "DRAFT" && (
                    <Button variant="danger" onClick={() => setDeleting(l.id)}>
                      ลบ
                    </Button>
                  )}
                </div>
              </td>
            </tr>
          ))}
        </DataTable>
      </Card>
      <Notice>
        เงินประกันในหน้านี้แสดงยอดตามสัญญา ดูยอดคงถือและการรับ หัก คืนเงินได้ใน{" "}
        <Link href="/deposits/">บัญชีเงินประกัน</Link>
      </Notice>
      <Modal
        open={!!detail}
        onOpenChange={(open) => {
          if (!open) setSelected("");
        }}
        title={`รายละเอียดสัญญา ${detail?.number || ""}`}
        description="ข้อมูลตามสัญญาจาก PostgreSQL"
      >
        {detail && (
          <>
            <dl className="detail-grid">
              <div>
                <dt>ผู้เช่า</dt>
                <dd>
                  <Link href={`/tenants/?tenant=${detail.tenantId}`}>
                    {detail.tenant.name}
                  </Link>
                </dd>
              </div>
              <div>
                <dt>ห้องพัก</dt>
                <dd>
                  <Link href={`/rooms/?room=${detail.roomId}`}>
                    ห้อง {detail.room.number}
                  </Link>
                </dd>
              </div>
              <div>
                <dt>สถานะสัญญา</dt>
                <dd>{labels[detail.status]}</dd>
              </div>
              <div>
                <dt>วันเริ่มสัญญา</dt>
                <dd>{date(detail.startDate.slice(0, 10))}</dd>
              </div>
              <div>
                <dt>วันสิ้นสุดสัญญา</dt>
                <dd>{date(detail.endDate.slice(0, 10))}</dd>
              </div>
              <div>
                <dt>ค่าเช่าตามสัญญา</dt>
                <dd>{baht(detail.rent)}</dd>
              </div>
              <div>
                <dt>เงินประกันตามสัญญา</dt>
                <dd>{baht(detail.deposit)}</dd>
              </div>
              <div>
                <dt>สถานะการชำระเงิน</dt>
                <dd>{paymentStatusLabels.UNAVAILABLE}</dd>
              </div>
            </dl>
            <div className="form-actions">
              {!detail.isDemo && (
                <Link
                  className="btn btn-secondary"
                  href={`/deposits/${detail.id}/`}
                >
                  บัญชีเงินประกันสัญญานี้
                </Link>
              )}
              <Button onClick={() => setSelected("")}>ปิด</Button>
            </div>
          </>
        )}
      </Modal>
      {draft && (
        <RecordEditor
          key={draft.id || "new"}
          draft={draft}
          data={data}
          onClose={() => setDraft(null)}
          onSaved={reload}
        />
      )}
      {deleted && (
        <DeleteRecord
          entity="leases"
          id={deleted.id}
          name={deleted.number}
          onClose={() => setDeleting(null)}
          onSaved={reload}
        />
      )}
    </>
  );
}
