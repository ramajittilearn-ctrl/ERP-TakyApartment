"use client";
import { useState, type FormEvent } from "react";
import { Wrench, Eye } from "lucide-react";
import {
  AddButton,
  Badge,
  Button,
  Card,
  DataTable,
  ErrorMessage,
  Field,
  Modal,
  SearchField,
  SuccessMessage,
} from "@/components/ui";
import { Kpi } from "@/components/charts";
import { useDemo } from "@/demo/workspace";
import type { Ticket, TicketDraft } from "@/demo/model";
import { date } from "@/lib/format";

const statusLabels = {
  pending: "รออนุมัติ",
  "in-progress": "กำลังดำเนินการ",
  resolved: "เสร็จสิ้น",
};
const priorityLabels = { high: "สูง", medium: "ปานกลาง", low: "ต่ำ" };
export function MaintenanceScreen() {
  const { state, addTicket, updateTicket } = useDemo();
  const [status, setStatus] = useState("all");
  const [room, setRoom] = useState("all");
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [draft, setDraft] = useState<TicketDraft>({
    room: "101",
    issue: "",
    priority: "medium",
    assignee: "",
  });
  const rows = state.tickets.filter(
    (t) =>
      (status === "all" || status === t.status) &&
      (room === "all" || room === t.room) &&
      `${t.issue} ${t.room} ${t.assignee}`
        .toLowerCase()
        .includes(query.toLowerCase()),
  );
  const selected = state.tickets.find((t) => t.id === selectedId);
  function submit(e: FormEvent) {
    e.preventDefault();
    const result = addTicket({
      ...draft,
      assignee: draft.assignee.trim() || "ยังไม่มอบหมาย",
    });
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setOpen(false);
    setSuccess("เพิ่มรายการแจ้งซ่อมสาธิตแล้ว");
    setStatus("all");
    setRoom("all");
    setQuery("");
  }
  function changeStatus(value: string) {
    if (!selected) return;
    const next: Ticket["status"] =
      value === "resolved"
        ? "resolved"
        : value === "in-progress"
          ? "in-progress"
          : "pending";
    const result = updateTicket(selected.id, next);
    if (!result.ok) setError(result.error);
    else
      setSuccess(
        `อัปเดตงานห้อง ${selected.room} เป็น ${statusLabels[next]} แล้ว`,
      );
  }
  return (
    <>
      {success && <SuccessMessage>{success}</SuccessMessage>}
      <div className="screen-toolbar">
        <p className="toolbar-label">
          <Wrench size={16} />
          ดูแลงานซ่อมและบำรุงรักษา
        </p>
        <AddButton
          onClick={() => {
            setError("");
            setDraft({
              room: "101",
              issue: "",
              priority: "medium",
              assignee: "",
            });
            setOpen(true);
          }}
        >
          แจ้งซ่อมใหม่
        </AddButton>
      </div>
      <div className="three-column paragraph-gap" style={{ marginBottom: 20 }}>
        {(
          ["pending", "in-progress", "resolved"] satisfies Ticket["status"][]
        ).map((s, i) => (
          <Kpi
            key={s}
            label={statusLabels[s]}
            value={`${state.tickets.filter((t) => t.status === s).length} รายการ`}
            note={
              i === 0
                ? "งานที่รอตรวจสอบและมอบหมาย"
                : i === 1
                  ? "งานที่อยู่ระหว่างซ่อม"
                  : "งานที่ดำเนินการเสร็จแล้ว"
            }
            tone={
              s === "pending"
                ? "purple"
                : s === "in-progress"
                  ? "blue"
                  : "green"
            }
          />
        ))}
      </div>
      <Card>
        <div className="filter-bar">
          <select
            aria-label="สถานะแจ้งซ่อม"
            value={status}
            onChange={(e) => setStatus(e.target.value)}
          >
            <option value="all">สถานะทั้งหมด</option>
            {Object.entries(statusLabels).map(([key, label]) => (
              <option key={key} value={key}>
                {label}
              </option>
            ))}
          </select>
          <select
            aria-label="ห้องแจ้งซ่อม"
            value={room}
            onChange={(e) => setRoom(e.target.value)}
          >
            <option value="all">ทุกห้อง</option>
            {state.rooms.map((r) => (
              <option key={r.number}>{r.number}</option>
            ))}
          </select>
          <SearchField
            value={query}
            onChange={setQuery}
            label="ค้นหางานซ่อม"
            placeholder="ค้นหาปัญหา / ผู้รับผิดชอบ..."
          />
        </div>
        <DataTable
          caption="รายการแจ้งซ่อม"
          headers={[
            "วันที่",
            "ห้อง",
            "รายการ",
            "ระดับความสำคัญ",
            "สถานะ",
            "รายละเอียด",
          ]}
          empty={rows.length === 0}
        >
          {rows.map((t) => (
            <tr key={t.id}>
              <td>{date(t.date)}</td>
              <td className="table-room">{t.room}</td>
              <td className="ticket-issue">
                <span className="font-semibold">{t.issue}</span>
                <span className="table-subtitle">{t.assignee}</span>
              </td>
              <td>
                <Badge
                  tone={
                    t.priority === "high"
                      ? "red"
                      : t.priority === "medium"
                        ? "amber"
                        : "green"
                  }
                >
                  {priorityLabels[t.priority]}
                </Badge>
              </td>
              <td>
                <Badge
                  tone={
                    t.status === "resolved"
                      ? "green"
                      : t.status === "in-progress"
                        ? "blue"
                        : "amber"
                  }
                >
                  {statusLabels[t.status]}
                </Badge>
              </td>
              <td>
                <button
                  className="text-link"
                  aria-label={`ดูงาน ${t.issue} ห้อง ${t.room}`}
                  onClick={() => {
                    setError("");
                    setSelectedId(t.id);
                  }}
                >
                  <Eye size={15} />
                  ดูงาน
                </button>
              </td>
            </tr>
          ))}
        </DataTable>
        <div className="table-footer">
          <span>
            แสดง {rows.length} จาก {state.tickets.length} รายการ
          </span>
          <span>ข้อมูลและสถานะสาธิต</span>
        </div>
      </Card>
      <Modal open={open} onOpenChange={setOpen} title="แจ้งซ่อมใหม่">
        <form onSubmit={submit}>
          <div className="form-grid">
            <Field label="ห้องพัก">
              <select
                value={draft.room}
                onChange={(e) => setDraft({ ...draft, room: e.target.value })}
              >
                {state.rooms.map((r) => (
                  <option key={r.number}>{r.number}</option>
                ))}
              </select>
            </Field>
            <Field label="ความสำคัญ">
              <select
                value={draft.priority}
                onChange={(e) =>
                  setDraft({
                    ...draft,
                    priority:
                      e.target.value === "high"
                        ? "high"
                        : e.target.value === "low"
                          ? "low"
                          : "medium",
                  })
                }
              >
                {Object.entries(priorityLabels).map(([key, label]) => (
                  <option key={key} value={key}>
                    {label}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="ปัญหาที่พบ" className="form-full">
              <textarea
                required
                maxLength={500}
                placeholder="ระบุอาการและตำแหน่งที่ต้องซ่อม"
                value={draft.issue}
                onChange={(e) => setDraft({ ...draft, issue: e.target.value })}
              />
            </Field>
            <Field
              label="ผู้รับผิดชอบ"
              className="form-full"
              hint="เว้นว่างได้หากยังไม่มอบหมาย"
            >
              <input
                maxLength={100}
                value={draft.assignee}
                onChange={(e) =>
                  setDraft({ ...draft, assignee: e.target.value })
                }
              />
            </Field>
          </div>
          <ErrorMessage>{error}</ErrorMessage>
          <div className="form-actions">
            <Button variant="ghost" onClick={() => setOpen(false)}>
              ยกเลิก
            </Button>
            <Button type="submit">บันทึกแจ้งซ่อมสาธิต</Button>
          </div>
        </form>
      </Modal>
      <Modal
        open={!!selected}
        onOpenChange={(o) => {
          if (!o) setSelectedId(null);
        }}
        title="รายละเอียดงานซ่อม"
      >
        {selected && (
          <>
            <dl className="detail-grid">
              <div>
                <dt>เลขที่งาน</dt>
                <dd>{selected.id}</dd>
              </div>
              <div>
                <dt>ห้อง</dt>
                <dd>{selected.room}</dd>
              </div>
              <div>
                <dt>วันที่แจ้ง</dt>
                <dd>{date(selected.date)}</dd>
              </div>
              <div>
                <dt>ความสำคัญ</dt>
                <dd>{priorityLabels[selected.priority]}</dd>
              </div>
              <div>
                <dt>ปัญหา</dt>
                <dd>{selected.issue}</dd>
              </div>
              <div>
                <dt>ผู้รับผิดชอบ</dt>
                <dd>{selected.assignee}</dd>
              </div>
            </dl>
            <div className="paragraph-gap">
              <Field label="อัปเดตสถานะงานสาธิต">
                <select
                  value={selected.status}
                  onChange={(e) => changeStatus(e.target.value)}
                >
                  {Object.entries(statusLabels).map(([key, label]) => (
                    <option key={key} value={key}>
                      {label}
                    </option>
                  ))}
                </select>
              </Field>
            </div>
            <ErrorMessage>{error}</ErrorMessage>
            <div className="form-actions">
              <Button onClick={() => setSelectedId(null)}>ปิด</Button>
            </div>
          </>
        )}
      </Modal>
    </>
  );
}
