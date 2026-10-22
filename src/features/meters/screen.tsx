"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Droplets, History, Settings2, Zap } from "lucide-react";
import { z } from "zod";
import {
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorMessage,
  Field,
  Modal,
  SuccessMessage,
} from "@/components/ui";
import {
  historySchema,
  overviewSchema,
  readingSchema,
  type MeterHistory,
  type MeterOverview,
  type MeterRoom,
  type MeterSlot,
} from "./contracts";

type Period = {
  id: string;
  startsOn: string;
  endsOn: string;
  status: "OPEN" | "CLOSED";
};

type AdminAction =
  | { kind: "REGISTER"; room: MeterRoom; slot: MeterSlot }
  | { kind: "CORRECT"; room: MeterRoom; slot: MeterSlot }
  | { kind: "REPLACE"; room: MeterRoom; slot: MeterSlot };

type OverviewState =
  | { kind: "loading"; key: string }
  | { kind: "ready"; key: string; data: MeterOverview }
  | { kind: "error"; key: string };

type MeterDraft = { value: string; readingDate: string };

const eventTime = new Intl.DateTimeFormat("th-TH", {
  dateStyle: "medium",
  timeStyle: "medium",
  timeZone: "Asia/Bangkok",
});

function EventTime({ value }: { value: string }) {
  return <time dateTime={value}>{eventTime.format(new Date(value))}</time>;
}

const responseEnvelope = <T extends z.ZodType>(schema: T) =>
  z.object({ data: schema });

async function api<T>(path: string, schema: z.ZodType<T>, init?: RequestInit) {
  const response = await fetch(path, {
    ...init,
    headers: init?.body ? { "Content-Type": "application/json" } : undefined,
  });
  const body: unknown = await response.json();
  if (!response.ok) {
    const parsed = z
      .object({ error: z.object({ message: z.string() }) })
      .safeParse(body);
    throw new Error(
      parsed.success ? parsed.data.error.message : "ทำรายการไม่สำเร็จ",
    );
  }
  return responseEnvelope(schema).parse(body).data;
}

function thaiMonth(value: string) {
  return new Intl.DateTimeFormat("th-TH", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${value.slice(0, 7)}-01T00:00:00.000Z`));
}

function localToday() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

function slotLabel(kind: MeterSlot["kind"]) {
  return kind === "WATER" ? "น้ำ" : "ไฟฟ้า";
}

function slotTone(slot: MeterSlot) {
  if (slot.reading?.status === "CONFIRMED") return "green" as const;
  if (slot.reading?.status === "DRAFT") return "amber" as const;
  return "gray" as const;
}

function slotStatus(slot: MeterSlot) {
  if (!slot.meterId) return "ยังไม่ได้ตั้งค่ามิเตอร์";
  if (slot.reading?.status === "CONFIRMED") return "ยืนยันแล้ว";
  if (slot.reading?.status === "DRAFT") return "ฉบับร่าง";
  return "ยังไม่จด";
}

function subtractDecimal(current: string, previous: string) {
  const pattern = /^(\d+)(?:\.(\d+))?$/;
  const currentMatch = pattern.exec(current);
  const previousMatch = pattern.exec(previous);
  if (!currentMatch || !previousMatch) return "—";
  const scale = Math.max(
    currentMatch[2]?.length ?? 0,
    previousMatch[2]?.length ?? 0,
  );
  const scaled = (match: RegExpExecArray) =>
    BigInt(`${match[1]}${(match[2] ?? "").padEnd(scale, "0")}`);
  const difference = scaled(currentMatch) - scaled(previousMatch);
  if (difference < 0n) return "ค่าต่ำกว่าครั้งก่อน";
  if (scale === 0) return difference.toString();
  const digits = difference.toString().padStart(scale + 1, "0");
  return `${digits.slice(0, -scale)}.${digits.slice(-scale)}`;
}

export function MeterReadingScreen({
  admin,
  propertyId,
  periods,
}: {
  admin: boolean;
  propertyId: string | null;
  periods: Period[];
}) {
  const [periodId, setPeriodId] = useState(periods[0]?.id ?? "");
  const [floor, setFloor] = useState("all");
  const queryKey = `${periodId}:${floor}`;
  const [overviewState, setOverviewState] = useState<OverviewState>({
    kind: "loading",
    key: queryKey,
  });
  const [selectedRoomId, setSelectedRoomId] = useState<string | null>(null);
  const [history, setHistory] = useState<MeterHistory | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [drafts, setDrafts] = useState<Record<string, MeterDraft>>({});
  const [floors, setFloors] = useState<number[]>([]);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [mutating, setMutating] = useState(false);
  const [hydrated, setHydrated] = useState(false);
  const [action, setAction] = useState<AdminAction | null>(null);
  const mutationLock = useRef(false);
  const mounted = useRef(true);
  const overviewRequest = useRef<AbortController | null>(null);
  const historyRequest = useRef<AbortController | null>(null);
  const overview =
    overviewState.kind === "ready" && overviewState.key === queryKey
      ? overviewState.data
      : null;
  const loading =
    overviewState.key !== queryKey || overviewState.kind === "loading";
  const navigationLocked = !hydrated || mutating || action !== null;

  const load = useCallback(async () => {
    if (!periodId) return;
    overviewRequest.current?.abort();
    historyRequest.current?.abort();
    setHistoryOpen(false);
    setHistory(null);
    const controller = new AbortController();
    overviewRequest.current = controller;
    const key = `${periodId}:${floor}`;
    setOverviewState({ kind: "loading", key });
    setError("");
    try {
      const query = new URLSearchParams({ billingPeriodId: periodId });
      if (floor !== "all") query.set("floor", floor);
      const next = await api(
        `/api/v1/meter-readings/?${query}`,
        overviewSchema,
        { signal: controller.signal },
      );
      if (controller.signal.aborted || !mounted.current) return;
      setOverviewState({ kind: "ready", key, data: next });
      setFloors((current) =>
        [
          ...new Set([
            ...current,
            ...next.rooms.map((room) => room.floor.number),
          ]),
        ].sort((a, b) => a - b),
      );
      setSelectedRoomId((current) =>
        current && next.rooms.some((room) => room.id === current)
          ? current
          : (next.rooms[0]?.id ?? null),
      );
    } catch (cause) {
      if (controller.signal.aborted || !mounted.current) return;
      setOverviewState({ kind: "error", key });
      setError(cause instanceof Error ? cause.message : "โหลดข้อมูลไม่สำเร็จ");
    }
  }, [periodId, floor]);

  useEffect(() => {
    mounted.current = true;
    setHydrated(true);
    return () => {
      mounted.current = false;
      overviewRequest.current?.abort();
      historyRequest.current?.abort();
    };
  }, []);

  useEffect(() => {
    void load();
    return () => overviewRequest.current?.abort();
  }, [load]);

  useEffect(() => {
    historyRequest.current?.abort();
    setHistoryOpen(false);
    setHistory(null);
  }, [queryKey, selectedRoomId]);

  const selectedRoom =
    overview?.rooms.find((room) => room.id === selectedRoomId) ?? null;

  function changeSelection(change: () => void) {
    if (mutationLock.current || action) return;
    historyRequest.current?.abort();
    setHistoryOpen(false);
    setHistory(null);
    setSuccess("");
    change();
  }

  function draftFor(slot: MeterSlot): MeterDraft {
    const saved = {
      value: slot.reading?.value ?? "",
      readingDate: slot.reading?.readingDate ?? localToday(),
    };
    if (!slot.meterId || slot.reading?.status === "CONFIRMED") return saved;
    return drafts[`${periodId}:${slot.meterId}`] ?? saved;
  }

  function editDraft(slot: MeterSlot, change: Partial<MeterDraft>) {
    if (!slot.meterId || !overview || mutationLock.current) return;
    const key = `${periodId}:${slot.meterId}`;
    const initial = draftFor(slot);
    setDrafts((current) => ({
      ...current,
      [key]: { ...(current[key] ?? initial), ...change },
    }));
  }

  async function save(slot: MeterSlot, confirm: boolean) {
    if (!slot.meterId || !overview || mutationLock.current || action) return;
    mutationLock.current = true;
    setMutating(true);
    setError("");
    setSuccess("");
    const key = `${periodId}:${slot.meterId}`;
    const draft = draftFor(slot);
    try {
      const reading = await api(
        "/api/v1/meter-readings/drafts/",
        readingSchema,
        {
          method: "POST",
          body: JSON.stringify({
            meterId: slot.meterId,
            billingPeriodId: periodId,
            ...draft,
            type: slot.previousReading ? "NORMAL" : "OPENING",
          }),
        },
      );
      if (!mounted.current) return;
      const confirmed =
        confirm &&
        window.confirm(
          `ยืนยันเลขมิเตอร์${slotLabel(slot.kind)} ${reading.value} หรือไม่`,
        );
      if (confirmed) {
        await api(
          `/api/v1/meter-readings/${reading.id}/confirm/`,
          readingSchema,
          { method: "POST" },
        );
      }
      if (!mounted.current) return;
      setDrafts((current) => {
        const next = { ...current };
        delete next[key];
        return next;
      });
      await load();
      if (mounted.current)
        setSuccess(
          confirmed
            ? `ยืนยันมิเตอร์${slotLabel(slot.kind)}แล้ว`
            : `บันทึกฉบับร่างมิเตอร์${slotLabel(slot.kind)}แล้ว`,
        );
    } catch (cause) {
      if (mounted.current)
        setError(cause instanceof Error ? cause.message : "บันทึกไม่สำเร็จ");
    } finally {
      mutationLock.current = false;
      if (mounted.current) setMutating(false);
    }
  }

  async function showHistory() {
    if (!selectedRoom || !overview || navigationLocked) return;
    historyRequest.current?.abort();
    const controller = new AbortController();
    historyRequest.current = controller;
    setError("");
    try {
      const next = await api(
        `/api/v1/meter-readings/history/?roomId=${selectedRoom.id}`,
        historySchema,
        { signal: controller.signal },
      );
      if (controller.signal.aborted || !mounted.current) return;
      setHistory(next);
      setHistoryOpen(true);
    } catch (cause) {
      if (!controller.signal.aborted && mounted.current)
        setError(
          cause instanceof Error ? cause.message : "โหลดประวัติไม่สำเร็จ",
        );
    }
  }

  if (!propertyId)
    return (
      <EmptyState
        title="ยังไม่มีข้อมูลอาคาร"
        description="ตั้งค่าอาคารก่อนเริ่มจดมิเตอร์"
      />
    );
  if (!periods.length)
    return (
      <EmptyState
        title="ยังไม่มีรอบเรียกเก็บ"
        description="สร้างรอบเรียกเก็บในระบบก่อนเริ่มจดมิเตอร์"
      />
    );

  return (
    <>
      {success ? <SuccessMessage>{success}</SuccessMessage> : null}
      <ErrorMessage>{error}</ErrorMessage>
      <div className="screen-toolbar">
        <div className="toolbar-actions">
          <label className="field meter-period-select">
            <span>รอบเรียกเก็บ</span>
            <select
              aria-label="รอบเรียกเก็บ"
              value={periodId}
              disabled={navigationLocked}
              onChange={(event) =>
                changeSelection(() => setPeriodId(event.target.value))
              }
            >
              {periods.map((period) => (
                <option key={period.id} value={period.id}>
                  {thaiMonth(period.startsOn)}{" "}
                  {period.status === "CLOSED" ? "(ปิดแล้ว)" : ""}
                </option>
              ))}
            </select>
          </label>
          <label className="field meter-floor-select">
            <span>ชั้น</span>
            <select
              aria-label="ชั้น"
              value={floor}
              disabled={navigationLocked}
              onChange={(event) =>
                changeSelection(() => setFloor(event.target.value))
              }
            >
              <option value="all">ทุกชั้น</option>
              {floors.map((number) => (
                <option key={number} value={String(number)}>
                  ชั้น {number}
                </option>
              ))}
            </select>
          </label>
        </div>
        <Badge
          tone={overview?.billingPeriod.status === "CLOSED" ? "gray" : "blue"}
          dot
        >
          {overview?.billingPeriod.status === "CLOSED"
            ? "รอบปิดแล้ว"
            : "รอบเปิด"}
        </Badge>
      </div>
      {overview ? (
        <>
          <div className="meter-summary" aria-label="สรุปการจดมิเตอร์">
            <Card>
              <strong>{overview.summary.confirmed}</strong>
              <span>ยืนยันแล้ว</span>
            </Card>
            <Card>
              <strong>{overview.summary.draft}</strong>
              <span>ฉบับร่าง</span>
            </Card>
            <Card>
              <strong>{overview.summary.missing}</strong>
              <span>ยังไม่ครบ</span>
            </Card>
            <Card>
              <strong>{overview.summary.totalSlots}</strong>
              <span>มิเตอร์ทั้งหมด</span>
            </Card>
          </div>
          <div className="meter-workspace">
            <Card
              title="ห้องพัก"
              description={`${overview.summary.rooms} ห้องในตัวกรองนี้`}
            >
              {loading ? (
                <p role="status">กำลังโหลด…</p>
              ) : (
                <div className="meter-room-list">
                  {overview.rooms.map((room) => (
                    <button
                      key={room.id}
                      className={`meter-room-button ${selectedRoomId === room.id ? "active" : ""}`}
                      disabled={navigationLocked}
                      onClick={() =>
                        changeSelection(() => setSelectedRoomId(room.id))
                      }
                      aria-pressed={selectedRoomId === room.id}
                    >
                      <span>
                        <strong>ห้อง {room.number}</strong>
                        <small>{room.floor.name}</small>
                      </span>
                      <span className="meter-room-statuses">
                        {room.meters.map((slot) => (
                          <Badge key={slot.kind} tone={slotTone(slot)}>
                            {slot.kind === "WATER" ? "น้ำ" : "ไฟ"}
                          </Badge>
                        ))}
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </Card>
            {selectedRoom ? (
              <section
                className="meter-entry"
                aria-label={`จดมิเตอร์ห้อง ${selectedRoom.number}`}
              >
                <Card
                  title={`ห้อง ${selectedRoom.number}`}
                  description={`${selectedRoom.floor.name} · เลขครั้งก่อนมาจากรายการที่ยืนยันแล้ว`}
                  action={
                    <Button
                      variant="ghost"
                      onClick={showHistory}
                      disabled={navigationLocked}
                    >
                      <History size={16} />
                      ประวัติ
                    </Button>
                  }
                >
                  <div className="meter-slot-list">
                    {selectedRoom.meters.map((slot) => (
                      <MeterEntry
                        key={slot.kind}
                        admin={admin}
                        closed={overview.billingPeriod.status === "CLOSED"}
                        busy={mutating || action !== null}
                        slot={slot}
                        value={draftFor(slot).value}
                        readingDate={draftFor(slot).readingDate}
                        minDate={overview.billingPeriod.startsOn}
                        maxDate={
                          overview.billingPeriod.endsOn < localToday()
                            ? overview.billingPeriod.endsOn
                            : localToday()
                        }
                        onChange={(value) => editDraft(slot, { value })}
                        onDateChange={(readingDate) =>
                          editDraft(slot, { readingDate })
                        }
                        onDraft={() => void save(slot, false)}
                        onConfirm={() => void save(slot, true)}
                        onAdminAction={(kind) =>
                          setAction({ kind, room: selectedRoom, slot })
                        }
                      />
                    ))}
                  </div>
                </Card>
              </section>
            ) : null}
          </div>
        </>
      ) : (
        <Card>
          <p role="status">
            {loading ? "กำลังโหลดข้อมูลมิเตอร์…" : "ไม่มีข้อมูล"}
          </p>
        </Card>
      )}
      <HistoryPanel
        open={historyOpen}
        onOpenChange={setHistoryOpen}
        history={history}
      />
      <AdminActionForm
        action={action}
        onClose={() => setAction(null)}
        onSaved={async (message) => {
          setAction(null);
          await load();
          if (mounted.current) setSuccess(message);
        }}
      />
    </>
  );
}

function MeterEntry({
  admin,
  closed,
  busy,
  slot,
  value,
  readingDate,
  minDate,
  maxDate,
  onChange,
  onDateChange,
  onDraft,
  onConfirm,
  onAdminAction,
}: {
  admin: boolean;
  closed: boolean;
  busy: boolean;
  slot: MeterSlot;
  value: string;
  readingDate: string;
  minDate: string;
  maxDate: string;
  onChange: (value: string) => void;
  onDateChange: (value: string) => void;
  onDraft: () => void;
  onConfirm: () => void;
  onAdminAction: (kind: AdminAction["kind"]) => void;
}) {
  const Icon = slot.kind === "WATER" ? Droplets : Zap;
  const consumption =
    slot.previousReading && value
      ? subtractDecimal(value, slot.previousReading.value)
      : "—";
  return (
    <div className="meter-slot">
      <div className="meter-slot-heading">
        <span className="meter-utility-icon">
          <Icon size={19} />
        </span>
        <span>
          <strong>มิเตอร์{slotLabel(slot.kind)}</strong>
          <small>
            {slot.serial ? `หมายเลข ${slot.serial}` : "ยังไม่มีมิเตอร์"}
          </small>
        </span>
        <Badge tone={slotTone(slot)}>{slotStatus(slot)}</Badge>
      </div>
      {slot.meterId ? (
        <>
          <div className="meter-values">
            <label>
              <span>วันที่จดจริง</span>
              <input
                type="date"
                aria-label={`วันที่จดมิเตอร์${slotLabel(slot.kind)}`}
                min={minDate}
                max={maxDate}
                value={readingDate}
                onChange={(event) => onDateChange(event.target.value)}
                disabled={
                  busy || closed || slot.reading?.status === "CONFIRMED"
                }
              />
            </label>
            <div>
              <span>ครั้งก่อน</span>
              <strong>
                {slot.previousReading?.value ?? "ต้องบันทึกค่าเริ่มต้น"}
              </strong>
            </div>
            <label>
              <span>ครั้งนี้</span>
              <input
                className="meter-number-input"
                inputMode="decimal"
                aria-label={`เลขมิเตอร์${slotLabel(slot.kind)}ปัจจุบัน`}
                value={value}
                onChange={(event) => onChange(event.target.value)}
                disabled={
                  busy || closed || slot.reading?.status === "CONFIRMED"
                }
                placeholder="0.000"
              />
            </label>
            <div>
              <span>ใช้ไป</span>
              <strong>{consumption}</strong>
            </div>
          </div>
          <div className="meter-slot-actions">
            {slot.reading?.status !== "CONFIRMED" && !closed ? (
              <>
                <Button variant="secondary" onClick={onDraft} disabled={busy}>
                  บันทึกฉบับร่าง
                </Button>
                <Button onClick={onConfirm} disabled={busy}>
                  ยืนยันค่า
                </Button>
              </>
            ) : null}
            {admin && slot.reading?.status === "CONFIRMED" && !closed ? (
              <Button
                variant="ghost"
                onClick={() => onAdminAction("CORRECT")}
                disabled={busy}
              >
                <Settings2 size={15} />
                แก้ไขพร้อมเหตุผล
              </Button>
            ) : null}
            {admin && !closed ? (
              <Button
                variant="ghost"
                onClick={() => onAdminAction("REPLACE")}
                disabled={busy}
              >
                เปลี่ยนมิเตอร์
              </Button>
            ) : null}
          </div>
        </>
      ) : admin && !closed ? (
        <Button onClick={() => onAdminAction("REGISTER")} disabled={busy}>
          ตั้งค่ามิเตอร์และค่าเริ่มต้น
        </Button>
      ) : (
        <p className="muted-text text-small">
          ติดต่อผู้ดูแลระบบเพื่อตั้งค่ามิเตอร์
        </p>
      )}
    </div>
  );
}

function HistoryPanel({
  open,
  onOpenChange,
  history,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  history: MeterHistory | null;
}) {
  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title="ประวัติมิเตอร์"
      description="รายการยืนยัน การแก้ไข และการเปลี่ยนมิเตอร์"
    >
      <div className="meter-history">
        {history?.readings.length ? (
          history.readings.map((item) => (
            <div className="history-row" key={item.id}>
              <span>
                <strong>
                  {slotLabel(item.kind)} · {item.value}
                </strong>
                <small>
                  วันที่จด {item.readingDate} · {item.serial} · ผู้บันทึก{" "}
                  {item.recordedBy.name} · บันทึกเมื่อ{" "}
                  <EventTime value={item.createdAt} />
                </small>
                {item.confirmedAt ? (
                  <small>
                    ยืนยันโดย {item.confirmedBy?.name ?? "—"} · ยืนยันเมื่อ{" "}
                    <EventTime value={item.confirmedAt} />
                  </small>
                ) : null}
              </span>
              <Badge tone="green">{item.type}</Badge>
            </div>
          ))
        ) : (
          <p className="muted-text">ยังไม่มีประวัติการจดมิเตอร์</p>
        )}
        {history?.corrections.map((item) => (
          <div className="history-row" key={item.id}>
            <span>
              <strong>
                แก้ไข {item.oldValue} เป็น {item.newValue}
              </strong>
              <small>
                วันที่จดเดิม {item.readingDate} · {item.reason} · แก้ไขโดย{" "}
                {item.correctedBy.name} · แก้ไขเมื่อ{" "}
                <EventTime value={item.createdAt} />
              </small>
            </span>
            <Badge tone="amber">แก้ไข</Badge>
          </div>
        ))}
        {history?.replacements.map((item) => (
          <div className="history-row" key={item.id}>
            <span>
              <strong>
                เปลี่ยน {item.oldMeter.serial} เป็น {item.newMeter.serial}
              </strong>
              <small>
                {item.replacementDate} · {item.reason} · {item.replacedBy.name}{" "}
                · เปลี่ยนเมื่อ <EventTime value={item.createdAt} />
              </small>
            </span>
            <Badge tone="blue">เปลี่ยนมิเตอร์</Badge>
          </div>
        ))}
      </div>
    </Modal>
  );
}

function AdminActionForm({
  action,
  onClose,
  onSaved,
}: {
  action: AdminAction | null;
  onClose: () => void;
  onSaved: (message: string) => Promise<void>;
}) {
  const [serial, setSerial] = useState("");
  const [value, setValue] = useState("");
  const [secondValue, setSecondValue] = useState("");
  const [date, setDate] = useState("");
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const submitLock = useRef(false);
  useEffect(() => {
    setSerial("");
    setValue(action?.slot.reading?.value ?? "");
    setSecondValue("");
    setDate(localToday());
    setReason("");
    setError("");
  }, [action]);
  if (!action) return null;
  const currentAction = action;
  const title =
    currentAction.kind === "REGISTER"
      ? "ตั้งค่ามิเตอร์เริ่มต้น"
      : currentAction.kind === "CORRECT"
        ? "แก้ไขเลขมิเตอร์"
        : "เปลี่ยนมิเตอร์";
  async function submit() {
    if (submitLock.current) return;
    submitLock.current = true;
    setSubmitting(true);
    setError("");
    try {
      if (currentAction.kind === "REGISTER") {
        await api("/api/v1/meters/", z.unknown(), {
          method: "POST",
          body: JSON.stringify({
            roomId: currentAction.room.id,
            kind: currentAction.slot.kind,
            serial,
            installedAt: date,
            openingReading: value,
            reason,
          }),
        });
      } else if (currentAction.kind === "CORRECT") {
        await api(
          `/api/v1/meter-readings/${currentAction.slot.reading?.id}/corrections/`,
          z.unknown(),
          { method: "POST", body: JSON.stringify({ value, reason }) },
        );
      } else {
        await api("/api/v1/meters/replacements/", z.unknown(), {
          method: "POST",
          body: JSON.stringify({
            oldMeterId: currentAction.slot.meterId,
            newSerial: serial,
            finalReading: value,
            initialReading: secondValue,
            replacementDate: date,
            reason,
          }),
        });
      }
      await onSaved(`${title}เรียบร้อยแล้ว`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "บันทึกไม่สำเร็จ");
    } finally {
      submitLock.current = false;
      setSubmitting(false);
    }
  }
  return (
    <Modal
      open
      onOpenChange={(open) => !open && !submitLock.current && onClose()}
      title={title}
      description={`ห้อง ${currentAction.room.number} · มิเตอร์${slotLabel(currentAction.slot.kind)}`}
    >
      <ErrorMessage>{error}</ErrorMessage>
      <fieldset
        className="form-grid"
        disabled={submitting}
        style={{ border: 0, padding: 0, margin: 0 }}
      >
        {currentAction.kind !== "CORRECT" ? (
          <Field label="หมายเลขมิเตอร์ใหม่">
            <input
              value={serial}
              onChange={(event) => setSerial(event.target.value)}
            />
          </Field>
        ) : null}
        <Field
          label={
            currentAction.kind === "REPLACE"
              ? "เลขสุดท้ายของมิเตอร์เดิม"
              : currentAction.kind === "CORRECT"
                ? "เลขที่แก้ไข"
                : "เลขเริ่มต้น"
          }
        >
          <input
            inputMode="decimal"
            value={value}
            onChange={(event) => setValue(event.target.value)}
          />
        </Field>
        {currentAction.kind === "REPLACE" ? (
          <Field label="เลขเริ่มต้นของมิเตอร์ใหม่">
            <input
              inputMode="decimal"
              value={secondValue}
              onChange={(event) => setSecondValue(event.target.value)}
            />
          </Field>
        ) : null}
        {currentAction.kind !== "CORRECT" ? (
          <Field
            label={
              currentAction.kind === "REGISTER"
                ? "วันที่ติดตั้ง"
                : "วันที่เปลี่ยน"
            }
          >
            <input
              type="date"
              max={localToday()}
              value={date}
              onChange={(event) => setDate(event.target.value)}
            />
          </Field>
        ) : null}
        <Field className="form-full" label="เหตุผล">
          <textarea
            required
            value={reason}
            onChange={(event) => setReason(event.target.value)}
          />
        </Field>
      </fieldset>
      <div className="form-actions">
        <Button variant="ghost" onClick={onClose} disabled={submitting}>
          ยกเลิก
        </Button>
        <Button
          onClick={() => void submit()}
          disabled={
            submitting ||
            !reason.trim() ||
            !value.trim() ||
            (currentAction.kind !== "CORRECT" && (!serial.trim() || !date)) ||
            (currentAction.kind === "REPLACE" && !secondValue.trim())
          }
        >
          ยืนยันและบันทึก
        </Button>
      </div>
    </Modal>
  );
}
