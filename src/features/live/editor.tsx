"use client";
import { useState, type FormEvent } from "react";
import { z } from "zod";
import { Button, ErrorMessage, Field, Modal, Notice } from "@/components/ui";
import { request } from "./workspace";
import type { LiveWorkspace } from "./contracts";
type Entity = "rooms" | "tenants" | "leases";
type Draft = {
  entity: Entity;
  id?: string;
  values: Record<string, string | boolean>;
};
export type { Draft };
export function RecordEditor({
  draft,
  data,
  onClose,
  onSaved,
}: {
  draft: Draft;
  data: LiveWorkspace;
  onClose: () => void;
  onSaved: (id?: string) => Promise<void>;
}) {
  const [values, setValues] = useState(draft.values);
  const activeAssignments = data.leases.filter(
    (l) => l.tenantId === draft.id && l.status === "ACTIVE",
  );
  const current =
    activeAssignments.length === 1 ? activeAssignments[0] : undefined;
  const originalLease = data.leases.find((l) => l.id === draft.id);
  const [assign, setAssign] = useState(!!current);
  const [assignment, setAssignment] = useState({
    roomId: current?.roomId || "",
    number: current?.number || "",
    startDate: current?.startDate.slice(0, 10) || "",
    endDate: current?.endDate.slice(0, 10) || "",
    rent: current?.rent || "0.00",
    deposit: current?.deposit || "0.00",
    previousEndDate: "",
  });
  const [floorId, setFloorId] = useState(
    data.rooms.find(
      (r) =>
        r.id ===
        (draft.entity === "tenants" ? current?.roomId : draft.values.roomId),
    )?.floorId || "",
  );
  const transfer =
    !!current && !!assignment.roomId && current.roomId !== assignment.roomId;
  const assignSet = (key: keyof typeof assignment, value: string) =>
    setAssignment((old) => ({ ...old, [key]: value }));
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const set = (key: string, value: string | boolean) =>
    setValues((previous) => ({ ...previous, [key]: value }));
  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const result = await request(
        `${draft.entity}${draft.id ? `/${draft.id}` : ""}`,
        draft.id ? "PUT" : "POST",
        draft.entity === "tenants" && assign
          ? {
              ...values,
              assignment: {
                roomId: assignment.roomId,
                number: assignment.number,
                startDate: assignment.startDate,
                endDate: assignment.endDate,
                rent: assignment.rent,
                deposit: assignment.deposit,
                ...(current ? { leaseId: current.id } : {}),
                ...(transfer
                  ? { previousEndDate: assignment.previousEndDate }
                  : {}),
              },
            }
          : values,
      );
      await onSaved(z.object({ id: z.uuid() }).parse(result).id);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "ไม่สามารถบันทึกข้อมูลได้");
    } finally {
      setBusy(false);
    }
  }
  const input = (
    key: string,
    label: string,
    type = "text",
    required = true,
  ) => (
    <Field key={key} label={label}>
      <input
        type={type}
        value={String(values[key] ?? "")}
        required={required}
        maxLength={key === "notes" ? 1000 : key === "address" ? 500 : 254}
        onChange={(e) => set(key, e.target.value)}
      />
    </Field>
  );
  const select = (
    key: string,
    label: string,
    options: { id: string; label: string }[],
  ) => (
    <Field key={key} label={label}>
      <select
        value={String(values[key] ?? "")}
        onChange={(e) => set(key, e.target.value)}
        required
      >
        <option value="">เลือก{label}</option>
        {options.map((o) => (
          <option key={o.id} value={o.id}>
            {o.label}
          </option>
        ))}
      </select>
    </Field>
  );
  const roomSelector = (
    selectedRoom: string,
    change: (id: string) => void,
    locked = false,
  ) => (
    <>
      <Field label="ชั้นสำหรับเลือกห้อง">
        <select
          value={floorId}
          required
          disabled={locked}
          onChange={(e) => {
            setFloorId(e.target.value);
            change("");
          }}
        >
          <option value="">เลือกชั้น</option>
          {data.floors.map((f) => (
            <option key={f.id} value={f.id}>
              {f.name}
            </option>
          ))}
        </select>
      </Field>
      <Field label="ห้องพัก">
        <select
          value={selectedRoom}
          required
          disabled={locked || !floorId}
          onChange={(e) => change(e.target.value)}
        >
          <option value="">เลือกห้องพัก</option>
          {data.rooms
            .filter(
              (r) =>
                r.floorId === floorId &&
                (r.id ===
                  (draft.entity === "tenants"
                    ? current?.roomId
                    : originalLease?.status !== "DRAFT"
                      ? originalLease?.roomId
                      : undefined) ||
                  (r.status === "AVAILABLE" && !r.leases.length)),
            )
            .map((r) => (
              <option key={r.id} value={r.id}>
                {r.number}
              </option>
            ))}
        </select>
      </Field>
    </>
  );
  return (
    <Modal
      open
      onOpenChange={(open) => {
        if (!open && !busy) onClose();
      }}
      title={`${draft.id ? "แก้ไข" : "เพิ่ม"}${draft.entity === "rooms" ? "ห้องพัก" : draft.entity === "tenants" ? "ผู้เช่า" : "สัญญาเช่า"}`}
      description="ข้อมูลจะบันทึกในฐานข้อมูลภายในเครื่อง"
    >
      <form onSubmit={submit}>
        <div className="form-grid">
          {draft.entity === "rooms" && (
            <>
              <Field label="ชั้น">
                <select value={String(values.floorId)} disabled>
                  <option value={String(values.floorId)}>
                    {data.floors.find((f) => f.id === values.floorId)?.name}
                  </option>
                </select>
              </Field>
              <Field label="เลขห้อง">
                <select value={String(values.number)} disabled>
                  {data.rooms
                    .filter((r) => r.floorId === values.floorId)
                    .map((r) => (
                      <option key={r.id} value={r.number}>
                        {r.number}
                      </option>
                    ))}
                </select>
              </Field>
              {input("rent", "ค่าเช่ารายเดือน")}
              {select("status", "สถานะห้อง", [
                { id: "AVAILABLE", label: "พร้อมใช้งาน" },
                { id: "RESERVED", label: "จอง" },
                { id: "MAINTENANCE", label: "ซ่อมบำรุง" },
              ])}
              {input("notes", "หมายเหตุ", "text", false)}
              {data.rooms.find((r) => r.id === draft.id)?.leases.length ? (
                <Notice>
                  มีผู้เช่าตามสัญญา ACTIVE การบันทึกพร้อมใช้งานจะไม่สิ้นสุดสัญญา
                  หากต้องการคืนห้องว่างให้จัดการในหน้าสัญญาเช่า
                </Notice>
              ) : null}
            </>
          )}
          {draft.entity === "tenants" && (
            <>
              {input("name", "ชื่อผู้เช่า")}
              {input("phone", "เบอร์โทรศัพท์", "tel", false)}
              {input("email", "อีเมล", "email", false)}
              {input("address", "ที่อยู่", "text", false)}
              {input("notes", "หมายเหตุ", "text", false)}
              <Field label="กำหนดห้องพัก">
                <input
                  type="checkbox"
                  checked={assign}
                  disabled={!!current || activeAssignments.length > 1}
                  onChange={(e) => setAssign(e.target.checked)}
                />
              </Field>
              {activeAssignments.length > 1 && (
                <Notice>
                  ผู้เช่ามีหลายสัญญาปัจจุบัน แก้ไขข้อมูลส่วนตัวได้ที่นี่
                  และจัดการห้องในหน้าสัญญาเช่าเพื่อไม่เลือกสัญญาผิด
                </Notice>
              )}
              {current && (
                <Notice>
                  การนำห้องออกต้องสิ้นสุดสัญญาในหน้าสัญญาเช่า
                  การเลือกห้องใหม่จะเก็บสัญญาเดิมเป็นประวัติ
                </Notice>
              )}
              {assign && (
                <>
                  {roomSelector(assignment.roomId, (id) =>
                    setAssignment((old) => ({
                      ...old,
                      roomId: id,
                      rent:
                        data.rooms.find((r) => r.id === id)?.rent || old.rent,
                      number:
                        current && id !== current.roomId
                          ? ""
                          : current?.number || old.number,
                    })),
                  )}
                  {(
                    [
                      ["number", "เลขที่สัญญา", "text"],
                      ["startDate", "วันเริ่มสัญญา", "date"],
                      ["endDate", "วันสิ้นสุดสัญญา", "date"],
                      ["rent", "ค่าเช่าตามสัญญา", "text"],
                      ["deposit", "เงินประกันตามสัญญา", "text"],
                    ] as const
                  ).map(([key, label, type]) => (
                    <Field key={key} label={label}>
                      <input
                        type={type}
                        required
                        value={assignment[key]}
                        onChange={(e) => assignSet(key, e.target.value)}
                      />
                    </Field>
                  ))}
                  {transfer && (
                    <>
                      <Notice>
                        ย้ายห้อง: สิ้นสุดสัญญา {current.number} และสร้างสัญญา
                        ACTIVE ใหม่ในครั้งเดียว
                        วันเริ่มใหม่ต้องหลังวันสิ้นสุดเดิม
                      </Notice>
                      <Field label="วันสิ้นสุดสัญญาเดิม">
                        <input
                          type="date"
                          required
                          value={assignment.previousEndDate}
                          onChange={(e) =>
                            assignSet("previousEndDate", e.target.value)
                          }
                        />
                      </Field>
                      <Field label="ยืนยันสิ้นสุดสัญญาเดิมและย้ายห้อง">
                        <input
                          key={assignment.roomId}
                          type="checkbox"
                          required
                        />
                      </Field>
                    </>
                  )}
                </>
              )}
            </>
          )}
          {draft.entity === "leases" && (
            <>
              {input("number", "เลขที่สัญญา")}
              {roomSelector(
                String(values.roomId || ""),
                (id) => set("roomId", id),
                !!originalLease && originalLease.status !== "DRAFT",
              )}
              {select(
                "tenantId",
                "ผู้เช่า",
                data.tenants.map((t) => ({ id: t.id, label: t.name })),
              )}
              {input("startDate", "วันเริ่มสัญญา", "date")}
              {input("endDate", "วันสิ้นสุดสัญญา", "date")}
              {input("rent", "ค่าเช่าตามสัญญา")}
              {input("deposit", "เงินประกันตามสัญญา")}
              {select("status", "สถานะสัญญา", [
                { id: "DRAFT", label: "ฉบับร่าง" },
                { id: "ACTIVE", label: "ใช้งาน" },
                { id: "ENDED", label: "สิ้นสุด" },
                { id: "CANCELLED", label: "ยกเลิก" },
              ])}
            </>
          )}
          {draft.entity !== "rooms" && (
            <Field label="ข้อมูลตัวอย่าง (Demo)">
              <input
                type="checkbox"
                checked={values.isDemo === true}
                onChange={(e) => set("isDemo", e.target.checked)}
              />
            </Field>
          )}
        </div>
        <ErrorMessage>{error}</ErrorMessage>
        <div className="form-actions">
          <Button variant="secondary" disabled={busy} onClick={onClose}>
            ยกเลิก
          </Button>
          <Button type="submit" disabled={busy}>
            {busy ? "กำลังบันทึก…" : "บันทึกข้อมูล"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
export function DeleteRecord({
  entity,
  id,
  name,
  onClose,
  onSaved,
}: {
  entity: Entity;
  id: string;
  name: string;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <Modal
      open
      onOpenChange={(open) => {
        if (!open && !busy) onClose();
      }}
      title="ยืนยันการลบ"
      description={`ลบ ${name} เฉพาะข้อมูลที่ไม่มีประวัติอ้างอิงเท่านั้น`}
    >
      <ErrorMessage>{error}</ErrorMessage>
      <div className="form-actions">
        <Button variant="secondary" onClick={onClose}>
          ยกเลิก
        </Button>
        <Button
          variant="danger"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            try {
              await request(`${entity}/${id}`, "DELETE");
              await onSaved();
              onClose();
            } catch (e) {
              setError(e instanceof Error ? e.message : "ลบไม่ได้");
            } finally {
              setBusy(false);
            }
          }}
        >
          ยืนยันลบ
        </Button>
      </div>
    </Modal>
  );
}
