"use client";
import { useState, type FormEvent } from "react";
import { Button, ErrorMessage, Field, Modal } from "@/components/ui";
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
  onSaved: () => Promise<void>;
}) {
  const [values, setValues] = useState(draft.values);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const set = (key: string, value: string | boolean) =>
    setValues((previous) => ({ ...previous, [key]: value }));
  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      await request(
        `${draft.entity}${draft.id ? `/${draft.id}` : ""}`,
        draft.id ? "PUT" : "POST",
        values,
      );
      await onSaved();
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
              {select(
                "floorId",
                "ชั้น",
                data.floors.map((f) => ({ id: f.id, label: f.name })),
              )}
              {input("number", "เลขห้อง")}
              {input("rent", "ค่าเช่ารายเดือน")}
              {select("status", "สถานะห้อง", [
                { id: "AVAILABLE", label: "พร้อมใช้งาน" },
                { id: "MAINTENANCE", label: "ซ่อมบำรุง" },
              ])}
              {input("notes", "หมายเหตุ", "text", false)}
            </>
          )}
          {draft.entity === "tenants" && (
            <>
              {input("name", "ชื่อผู้เช่า")}
              {input("phone", "เบอร์โทรศัพท์", "tel", false)}
              {input("email", "อีเมล", "email", false)}
              {input("address", "ที่อยู่", "text", false)}
              {input("notes", "หมายเหตุ", "text", false)}
            </>
          )}
          {draft.entity === "leases" && (
            <>
              {input("number", "เลขที่สัญญา")}
              {select(
                "roomId",
                "ห้องพัก",
                data.rooms.map((r) => ({ id: r.id, label: r.number })),
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
