"use client";
import { useState } from "react";
import Link from "next/link";
import { date } from "@/lib/format";
import { paymentStatusLabels } from "./payment-status";
import { Building2, DoorOpen } from "lucide-react";
import {
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorMessage,
  Modal,
  SearchField,
} from "@/components/ui";
import { useLiveWorkspace, baht } from "./workspace";
import { RecordEditor, type Draft } from "./editor";
export function LiveRooms({
  admin,
  initialId = "",
}: {
  admin: boolean;
  initialId?: string;
}) {
  const { data, error, reload } = useLiveWorkspace();
  const [floor, setFloor] = useState("all");
  const [status, setStatus] = useState("all");
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<string | null>(initialId || null);
  const [draft, setDraft] = useState<Draft | null>(null);
  if (!data)
    return (
      <Card>
        <ErrorMessage>{error}</ErrorMessage>
        <p role="status">
          {error ? "โหลดข้อมูลไม่สำเร็จ" : "กำลังโหลดห้องพัก…"}
        </p>
        {error && <Button onClick={reload}>ลองอีกครั้ง</Button>}
      </Card>
    );
  const state = (r: (typeof data.rooms)[number]) =>
    r.leases.length
      ? "occupied"
      : r.status === "MAINTENANCE"
        ? "maintenance"
        : r.status === "RESERVED"
          ? "reserved"
          : "vacant";
  const rooms = data.rooms.filter(
    (r) =>
      (floor === "all" || r.floorId === floor) &&
      (status === "all" || state(r) === status) &&
      `${r.number} ${r.leases[0]?.tenant.name || ""}`
        .toLowerCase()
        .includes(query.toLowerCase()),
  );
  const room = data.rooms.find((r) => r.id === selected);
  const lease = room?.leases[0];
  return (
    <>
      <ErrorMessage>{error}</ErrorMessage>
      <div className="screen-toolbar">
        <p className="toolbar-label">
          ทั้งหมด {data.rooms.length} ห้อง{" "}
          <span className="muted-text">/ {data.floors.length} ชั้น</span>
        </p>
        <span className="muted-text">ใช้ห้องพักที่มีอยู่ ไม่สร้างห้องซ้ำ</span>
      </div>
      <Card>
        <div className="filter-bar">
          <select
            aria-label="ชั้น"
            value={floor}
            onChange={(e) => setFloor(e.target.value)}
          >
            <option value="all">ทุกชั้น</option>
            {data.floors.map((f) => (
              <option key={f.id} value={f.id}>
                {f.name}
              </option>
            ))}
          </select>
          <select
            aria-label="สถานะห้อง"
            value={status}
            onChange={(e) => setStatus(e.target.value)}
          >
            <option value="all">สถานะทั้งหมด</option>
            <option value="occupied">มีผู้เช่า</option>
            <option value="vacant">ว่าง</option>
            <option value="reserved">จอง</option>
            <option value="maintenance">ซ่อมบำรุง</option>
          </select>
          <SearchField
            value={query}
            onChange={setQuery}
            label="ค้นหาห้องหรือผู้เช่า"
            placeholder="ค้นหาห้อง / ผู้เช่า..."
          />
        </div>
        <div className="room-summary">
          {[
            { value: "occupied", label: "มีผู้เช่า", color: "#18b48a" },
            { value: "vacant", label: "ว่าง", color: "#9cafc5" },
            { value: "reserved", label: "จอง", color: "#e6b555" },
            { value: "maintenance", label: "ซ่อมบำรุง", color: "#e6b555" },
          ].map((s) => (
            <span key={s.value}>
              <span className="legend-swatch" style={{ background: s.color }} />
              {s.label} {data.rooms.filter((r) => state(r) === s.value).length}{" "}
              ห้อง
            </span>
          ))}
        </div>
        <div className="paragraph-gap">
          {rooms.length === 0 ? (
            <EmptyState
              action={
                <Button
                  onClick={() => {
                    setFloor("all");
                    setStatus("all");
                    setQuery("");
                  }}
                >
                  ล้างตัวกรอง
                </Button>
              }
            />
          ) : (
            data.floors
              .filter((f) => rooms.some((r) => r.floorId === f.id))
              .map((f) => (
                <section
                  className="floor-section"
                  key={f.id}
                  aria-label={`ห้องพัก${f.name}`}
                >
                  <div className="floor-heading">
                    <Building2 size={15} className="muted-text" />
                    <h3>{f.name}</h3>
                    <small>
                      {rooms.filter((r) => r.floorId === f.id).length} ห้อง
                    </small>
                    <span />
                  </div>
                  <div className="room-grid">
                    {rooms
                      .filter((r) => r.floorId === f.id)
                      .map((r) => (
                        <button
                          className={`room-card ${state(r)}`}
                          key={r.id}
                          onClick={() => setSelected(r.id)}
                        >
                          <span className="room-number">
                            <strong>
                              <span className="sr-only">ห้อง </span>
                              {r.number}
                            </strong>
                            <DoorOpen size={15} />
                          </span>
                          <Badge
                            tone={
                              state(r) === "occupied"
                                ? "green"
                                : state(r) === "vacant"
                                  ? "gray"
                                  : "amber"
                            }
                          >
                            {state(r) === "occupied"
                              ? "มีผู้เช่า"
                              : state(r) === "vacant"
                                ? "ว่าง"
                                : state(r) === "reserved"
                                  ? "จอง"
                                  : "ซ่อมบำรุง"}
                          </Badge>
                          <span className="room-tenant">
                            {r.leases[0]?.tenant.name ||
                              `${baht(r.rent)} / เดือน`}
                          </span>
                          <span className="room-meta">
                            {r.leases[0]
                              ? `ถึง ${r.leases[0].endDate.slice(0, 10)}`
                              : state(r) === "vacant"
                                ? "พร้อมเข้าพัก"
                                : "อยู่ระหว่างเตรียมห้อง"}
                          </span>
                        </button>
                      ))}
                  </div>
                </section>
              ))
          )}
        </div>
      </Card>
      <Modal
        open={!!room && !draft}
        onOpenChange={(open) => {
          if (!open) setSelected(null);
        }}
        title={`รายละเอียดห้อง ${room?.number || ""}`}
        description="ข้อมูลจาก PostgreSQL"
      >
        <>
          {room && (
            <>
              <div className="room-detail-title">
                <span className="avatar">
                  <Building2 size={24} />
                </span>
                <strong>{room.number}</strong>
              </div>
              <dl className="detail-grid">
                <div>
                  <dt>ชั้น</dt>
                  <dd>{room.floor.name}</dd>
                </div>
                <div>
                  <dt>ค่าเช่ารายเดือน</dt>
                  <dd>{baht(lease?.rent || room.rent)}</dd>
                </div>
                <div>
                  <dt>ผู้เช่า</dt>
                  <dd>
                    {lease ? (
                      <Link href={`/tenants/?tenant=${lease.tenantId}`}>
                        {lease.tenant.name}
                      </Link>
                    ) : (
                      "ไม่มีผู้เช่า"
                    )}
                  </dd>
                </div>
                <div>
                  <dt>สถานะห้อง</dt>
                  <dd>
                    {lease
                      ? "มีผู้เช่า"
                      : room.status === "RESERVED"
                        ? "จอง"
                        : room.status === "MAINTENANCE"
                          ? "ซ่อมบำรุง"
                          : "ว่าง"}
                  </dd>
                </div>
                <div>
                  <dt>สัญญาปัจจุบัน</dt>
                  <dd>
                    {lease ? (
                      <Link href={`/leases/?lease=${lease.id}`}>
                        {lease.number}
                      </Link>
                    ) : (
                      "ไม่มีสัญญาปัจจุบัน"
                    )}
                  </dd>
                </div>
                <div>
                  <dt>วันเริ่มสัญญา</dt>
                  <dd>{lease ? date(lease.startDate.slice(0, 10)) : "—"}</dd>
                </div>
                <div>
                  <dt>วันสิ้นสุดสัญญา</dt>
                  <dd>{lease ? date(lease.endDate.slice(0, 10)) : "—"}</dd>
                </div>
                <div>
                  <dt>สถานะการชำระเงิน</dt>
                  <dd>{paymentStatusLabels.UNAVAILABLE}</dd>
                </div>
                <div>
                  <dt>หมายเหตุ</dt>
                  <dd>{room.notes || "—"}</dd>
                </div>
              </dl>
              <div className="form-actions">
                {admin && (
                  <>
                    <Button
                      variant="secondary"
                      onClick={() =>
                        setDraft({
                          entity: "rooms",
                          id: room.id,
                          values: {
                            floorId: room.floorId,
                            number: room.number,
                            rent: room.rent,
                            status: room.status,
                            notes: room.notes,
                          },
                        })
                      }
                    >
                      แก้ไขห้องพัก
                    </Button>
                  </>
                )}
                <Button onClick={() => setSelected(null)}>ปิด</Button>
              </div>
            </>
          )}
        </>
      </Modal>
      {draft && (
        <RecordEditor
          key={`${draft.id || "new"}`}
          draft={draft}
          data={data}
          onClose={() => setDraft(null)}
          onSaved={reload}
        />
      )}
    </>
  );
}
