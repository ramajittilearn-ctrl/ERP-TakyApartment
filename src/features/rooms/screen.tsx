"use client";
import { useState } from "react";
import Link from "next/link";
import {
  Building2,
  SlidersHorizontal,
  DoorOpen,
  ChevronRight,
} from "lucide-react";
import {
  Badge,
  Card,
  EmptyState,
  Modal,
  SearchField,
  Button,
} from "@/components/ui";
import { useDemo } from "@/demo/workspace";
import { DEFAULT_MONTH } from "@/demo/model";
import { roomOutstanding, tenantForRoom } from "@/demo/finance";
import { money, date } from "@/lib/format";

export function RoomsScreen() {
  const { state } = useDemo();
  const [floor, setFloor] = useState("all");
  const [status, setStatus] = useState("all");
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const rooms = state.rooms.filter(
    (r) =>
      (floor === "all" || String(r.floor) === floor) &&
      (status === "all" ||
        (status === "overdue"
          ? roomOutstanding(state, r.number, DEFAULT_MONTH) > 0
          : r.status === status)) &&
      `${r.number} ${tenantForRoom(state, r.number)?.name || ""}`
        .toLowerCase()
        .includes(query.toLowerCase()),
  );
  const room = state.rooms.find((r) => r.number === selected);
  const tenant = room && tenantForRoom(state, room.number);
  const lease = state.leases.find(
    (l) => l.room === selected && l.status === "active",
  );
  return (
    <>
      <div className="screen-toolbar">
        <p className="toolbar-label">
          ทั้งหมด 15 ห้อง <span className="muted-text">/ 3 ชั้น</span>
        </p>
        <Link className="btn btn-secondary" href="/settings/">
          <SlidersHorizontal size={16} />
          ตั้งค่าห้องพัก
        </Link>
      </div>
      <Card>
        <div className="filter-bar">
          <select
            aria-label="ชั้น"
            value={floor}
            onChange={(e) => setFloor(e.target.value)}
          >
            <option value="all">ทุกชั้น</option>
            {[1, 2, 3].map((f) => (
              <option key={f} value={f}>
                ชั้น {f}
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
            <option value="maintenance">ซ่อมบำรุง</option>
            <option value="overdue">ค้างชำระ</option>
          </select>
          <SearchField
            value={query}
            onChange={setQuery}
            label="ค้นหาห้องหรือผู้เช่า"
            placeholder="ค้นหาห้อง / ผู้เช่า..."
          />
        </div>
        <div className="room-summary">
          <span>
            <span className="legend-swatch" style={{ background: "#18b48a" }} />
            มีผู้เช่า{" "}
            {state.rooms.filter((r) => r.status === "occupied").length} ห้อง
          </span>
          <span>
            <span className="legend-swatch" style={{ background: "#9cafc5" }} />
            ว่าง {state.rooms.filter((r) => r.status === "vacant").length} ห้อง
          </span>
          <span>
            <span className="legend-swatch" style={{ background: "#e6b555" }} />
            ซ่อมบำรุง{" "}
            {state.rooms.filter((r) => r.status === "maintenance").length} ห้อง
          </span>
        </div>
        <div className="paragraph-gap">
          {rooms.length === 0 ? (
            <EmptyState
              action={
                <Button
                  variant="secondary"
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
            [1, 2, 3]
              .filter((f) => rooms.some((r) => r.floor === f))
              .map((f) => (
                <section
                  className="floor-section"
                  key={f}
                  aria-label={`ห้องพักชั้น ${f}`}
                >
                  <div className="floor-heading">
                    <Building2
                      size={15}
                      className="muted-text"
                      aria-hidden="true"
                    />
                    <h3>ชั้น {f}</h3>
                    <small>
                      {rooms.filter((r) => r.floor === f).length} ห้อง
                    </small>
                    <span />
                  </div>
                  <div className="room-grid">
                    {rooms
                      .filter((r) => r.floor === f)
                      .map((r) => {
                        const due = roomOutstanding(
                          state,
                          r.number,
                          DEFAULT_MONTH,
                        );
                        const t = tenantForRoom(state, r.number);
                        const l = state.leases.find(
                          (l) => l.room === r.number && l.status === "active",
                        );
                        return (
                          <button
                            key={r.number}
                            className={`room-card ${due > 0 ? "overdue" : r.status}`}
                            onClick={() => setSelected(r.number)}
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
                                due > 0
                                  ? "red"
                                  : r.status === "occupied"
                                    ? "green"
                                    : r.status === "maintenance"
                                      ? "amber"
                                      : "gray"
                              }
                            >
                              {due > 0
                                ? "ค้างชำระ"
                                : r.status === "occupied"
                                  ? "มีผู้เช่า"
                                  : r.status === "vacant"
                                    ? "ว่าง"
                                    : "ซ่อมบำรุง"}
                            </Badge>
                            <span className="room-tenant">
                              {t?.name || `${money(r.rent)} / เดือน`}
                            </span>
                            <span className="room-meta">
                              {l
                                ? `หมดสัญญา ${date(l.end)}`
                                : r.status === "vacant"
                                  ? "พร้อมเข้าพัก"
                                  : "อยู่ระหว่างเตรียมห้อง"}
                            </span>
                          </button>
                        );
                      })}
                  </div>
                </section>
              ))
          )}
        </div>
      </Card>
      <Modal
        open={!!room}
        onOpenChange={(open) => {
          if (!open) setSelected(null);
        }}
        title={`รายละเอียดห้อง ${room?.number || ""}`}
      >
        {room && (
          <>
            <div className="room-detail-title">
              <span className="avatar">
                <Building2 size={24} />
              </span>
              <strong>{room.number}</strong>
              <Badge
                tone={
                  room.status === "occupied"
                    ? "green"
                    : room.status === "vacant"
                      ? "gray"
                      : "amber"
                }
              >
                {room.status === "occupied"
                  ? "มีผู้เช่า"
                  : room.status === "vacant"
                    ? "ว่าง"
                    : "ซ่อมบำรุง"}
              </Badge>
            </div>
            <dl className="detail-grid">
              <div>
                <dt>ชั้น</dt>
                <dd>ชั้น {room.floor}</dd>
              </div>
              <div>
                <dt>{lease ? "ค่าเช่ารายเดือนตามสัญญา" : "ค่าเช่ารายเดือน"}</dt>
                <dd>{money(lease?.rent || room.rent)}</dd>
              </div>
              <div>
                <dt>ผู้เช่า</dt>
                <dd>{tenant?.name || "ไม่มีผู้เช่า"}</dd>
              </div>
              <div>
                <dt>ยอดค้างเดือนตุลาคม</dt>
                <dd className="text-red">
                  {money(roomOutstanding(state, room.number, DEFAULT_MONTH))}
                </dd>
              </div>
              {lease && (
                <>
                  <div>
                    <dt>เลขที่สัญญา</dt>
                    <dd>{lease.id}</dd>
                  </div>
                  <div>
                    <dt>วันสิ้นสุดสัญญา</dt>
                    <dd>{date(lease.end)}</dd>
                  </div>
                </>
              )}
            </dl>
            <div className="form-actions">
              <Link
                className="btn btn-secondary"
                href={tenant ? "/tenants/" : "/settings/"}
                onClick={() => setSelected(null)}
              >
                {tenant ? "ดูข้อมูลผู้เช่า" : "ดูการตั้งค่า"}
                <ChevronRight size={15} />
              </Link>
              <Button onClick={() => setSelected(null)}>ปิด</Button>
            </div>
          </>
        )}
      </Modal>
    </>
  );
}
