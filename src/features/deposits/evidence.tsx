"use client";
import { useEffect, useState } from "react";
import { z } from "zod";
import { Button, ErrorMessage, Field } from "@/components/ui";
import { evidenceDtoSchema } from "../../server/evidence/contracts";
import { depositRequest } from "./client";

const pageSchema = z.strictObject({
  items: z.array(evidenceDtoSchema),
  total: z.number().int().nonnegative(),
  offset: z.number().int().nonnegative(),
  limit: z.number().int().positive(),
});
export function DepositEvidencePicker({
  leaseId,
  value,
  onChange,
  onBusy,
}: {
  leaseId: string;
  value: string;
  onChange(id: string): void;
  onBusy(busy: boolean): void;
}) {
  const [page, setPage] = useState<z.infer<typeof pageSchema> | null>(null);
  const [offset, setOffset] = useState(0);
  const [refresh, setRefresh] = useState(0);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let active = true;
    void depositRequest(
      `/api/v1/deposit-evidence/?${new URLSearchParams({ leaseId, offset: String(offset), limit: "25" })}`,
      pageSchema,
    )
      .then((result) => {
        if (active) {
          setPage(result);
          setError("");
        }
      })
      .catch((failure: unknown) => {
        if (active)
          setError(
            failure instanceof Error
              ? failure.message
              : "ไม่สามารถอ่านหลักฐานได้",
          );
      });
    return () => {
      active = false;
    };
  }, [leaseId, offset, refresh]);
  async function upload(file: File) {
    if (busy) return;
    setError("");
    if (
      file.size < 1 ||
      file.size > 5242880 ||
      !["application/pdf", "image/jpeg", "image/png"].includes(file.type)
    ) {
      setError(
        "เลือกไฟล์ PDF, JPEG หรือ PNG ที่มีขนาดไม่เกิน 5 MiB และไม่ใช่ไฟล์ว่าง",
      );
      return;
    }
    setBusy(true);
    onBusy(true);
    try {
      const saved = await depositRequest(
        `/api/v1/deposit-evidence/?${new URLSearchParams({ leaseId, originalName: file.name })}`,
        evidenceDtoSchema,
        file,
      );
      onChange(saved.id);
      setOffset(0);
      setRefresh((count) => count + 1);
    } catch (failure) {
      setError(
        failure instanceof Error ? failure.message : "อัปโหลดหลักฐานไม่สำเร็จ",
      );
      setRefresh((count) => count + 1);
    } finally {
      setBusy(false);
      onBusy(false);
    }
  }
  return (
    <section aria-label="หลักฐานที่รับเก็บแล้ว">
      <Field
        label="เลือกหลักฐานของสัญญานี้"
        hint="การอัปโหลดหลักฐานยังไม่ใช่การยืนยันเงินหรือบันทึกรายการ"
      >
        <select
          value={value}
          onChange={(event) => onChange(event.target.value)}
          disabled={busy}
          required
        >
          <option value="">เลือกหลักฐานที่รับเก็บแล้ว</option>
          {value && !page?.items.some((item) => item.id === value) ? (
            <option value={value}>หลักฐานที่เลือกไว้</option>
          ) : null}
          {page?.items.map((item) => (
            <option value={item.id} key={item.id}>
              {item.originalName} ({item.bytes} ไบต์)
            </option>
          ))}
        </select>
      </Field>
      {value ? (
        <p>
          <a href={`/api/v1/deposit-evidence/${value}/download/`}>
            ดาวน์โหลดหลักฐานที่เลือก
          </a>
        </p>
      ) : null}
      <Field
        label="อัปโหลดหลักฐานใหม่"
        hint="PDF, JPEG, PNG ไม่เกิน 5 MiB ไฟล์รับเก็บส่วนตัวและไม่มีการลบตามอายุอัตโนมัติ"
      >
        <input
          type="file"
          accept="application/pdf,image/jpeg,image/png"
          disabled={busy}
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = "";
            if (file) void upload(file);
          }}
        />
      </Field>
      {busy ? <p role="status">กำลังตรวจสอบและรับเก็บไฟล์…</p> : null}
      <ErrorMessage>{error}</ErrorMessage>
      {page ? (
        <div className="form-actions">
          <span>หลักฐานทั้งหมด {page.total} ไฟล์</span>
          <Button
            variant="secondary"
            disabled={busy || offset === 0}
            onClick={() => setOffset(Math.max(0, offset - 25))}
          >
            หลักฐานก่อนหน้า
          </Button>
          <Button
            variant="secondary"
            disabled={busy || offset + page.limit >= page.total}
            onClick={() => setOffset(offset + 25)}
          >
            หลักฐานถัดไป
          </Button>
          <Button
            variant="ghost"
            disabled={busy}
            onClick={() => setRefresh((count) => count + 1)}
          >
            อ่านหลักฐานใหม่
          </Button>
        </div>
      ) : null}
    </section>
  );
}
