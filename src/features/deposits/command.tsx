"use client";
import { useState } from "react";
import { Button, ErrorMessage, Field, Modal, Notice } from "@/components/ui";
import type {
  DepositEntryDto,
  DepositLedgerDto,
} from "../../server/deposits/contracts";
import { DepositEvidencePicker } from "./evidence";
import {
  commandTransport,
  depositCommand,
  depositMoneyLabel,
  depositNow,
  operationLabels,
  type DepositDraft,
  type DepositOperation,
} from "./form";
import {
  dismissDepositAttempt,
  retryDepositAttempt,
  submitDepositAttempt,
  type DepositAttempt,
} from "./journal";
import styles from "./screen.module.css";

export function DepositCommandDialog({
  actorId,
  ledger,
  operation,
  original,
  open,
  onOpenChange,
  attempt,
  onRefresh,
}: {
  actorId: string;
  ledger: DepositLedgerDto;
  operation: DepositOperation;
  original?: DepositEntryDto;
  open: boolean;
  onOpenChange(open: boolean): void;
  attempt: DepositAttempt | null;
  onRefresh(): void;
}) {
  const [draft, setDraft] = useState<DepositDraft>({
    amount: "",
    occurredAt: depositNow(),
    reason: "",
    evidenceId: "",
    method: "CASH",
    receivingAccountKey: "",
    externalReference: "",
    payeeName: "",
    outgoingReference: "",
    destination: "",
    verified: false,
  });
  const [error, setError] = useState("");
  const [uploading, setUploading] = useState(false);
  const pending =
    attempt?.state === "submitting" || attempt?.state === "uncertain";
  function update<K extends keyof DepositDraft>(
    key: K,
    value: DepositDraft[K],
  ) {
    setDraft((prior) => ({ ...prior, [key]: value }));
  }
  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    if (pending || uploading) return;
    try {
      const key = crypto.randomUUID();
      const command = depositCommand(operation, draft, {
        leaseId: ledger.leaseId,
        expectedVersion: ledger.account.version,
        commandKey: key,
        entryId: original?.id,
      });
      const transport = commandTransport(operation, command);
      submitDepositAttempt({
        actorId,
        leaseId: ledger.leaseId,
        operation,
        key,
        ...transport,
      });
    } catch (failure) {
      setError(
        failure instanceof Error ? failure.message : "ตรวจสอบข้อมูลก่อนบันทึก",
      );
    }
  }
  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title={operationLabels[operation]}
      description="รายการเงินประกันที่ยืนยันแล้วแก้ไขหรือลบไม่ได้ หากผิดให้กลับรายการเต็มจำนวน"
      wide
    >
      {pending ? (
        <>
          <Notice>{attempt.message}</Notice>
          <p>
            ระบบเก็บข้อมูลและรหัสคำสั่งเดิมไว้ในรอบการใช้งานนี้
            ปิดหน้าต่างได้แล้วเปิดการตรวจสอบผลอีกครั้ง
            หลีกเลี่ยงการรีโหลดหรือออกจากหน้านี้จนทราบผล
          </p>
          <ErrorMessage>{error}</ErrorMessage>
          <div className="form-actions">
            <Button
              disabled={attempt.state === "submitting"}
              onClick={() => retryDepositAttempt(actorId)}
            >
              ตรวจสอบผลด้วยคำสั่งเดิม
            </Button>
            <Button variant="secondary" onClick={() => onOpenChange(false)}>
              ปิดหน้าต่างชั่วคราว
            </Button>
          </div>
        </>
      ) : attempt?.state === "success" ? (
        <>
          <p role="status">บันทึกสำเร็จแล้ว กำลังแสดงข้อมูลล่าสุดจากระบบ</p>
          <div className="form-actions">
            <Button
              onClick={() => {
                dismissDepositAttempt(actorId);
                onOpenChange(false);
              }}
            >
              ปิด
            </Button>
          </div>
        </>
      ) : (
        <form onSubmit={submit} className={styles.form}>
          <ErrorMessage>
            {error || (attempt?.state === "rejected" ? attempt.message : "")}
          </ErrorMessage>
          {attempt?.state === "rejected" && attempt.code === "STALE_VERSION" ? (
            <Notice>
              มีรายการเปลี่ยนแปลงในระบบ คำสั่งนี้ไม่ถูกบันทึก
              กรุณาอ่านยอดล่าสุดและตรวจสอบก่อนเริ่มคำสั่งใหม่{" "}
              <Button
                variant="secondary"
                onClick={() => {
                  onRefresh();
                  onOpenChange(false);
                }}
              >
                อ่านยอดล่าสุด
              </Button>
            </Notice>
          ) : null}
          {operation === "review" ? (
            <Notice>
              ทบทวนยอดหนี้สินเงินประกันที่ตรวจสอบแล้วครั้งเดียว
              ไม่ใช้ยอดตามสัญญาหรือยอดเก่าเป็นเงินรับอัตโนมัติ ระบุ 0
              ได้หากตรวจสอบแล้วว่าไม่มีเงินประกันคงถือ
            </Notice>
          ) : null}
          {operation === "reverse" ? (
            <Notice>
              กลับรายการเดิมเต็มจำนวน{" "}
              {original
                ? `${original.documentNumber} ${depositMoneyLabel(original.amount)}`
                : "ตามเอกสารต้นฉบับ"}{" "}
              ระบบจะไม่ลบประวัติเดิมและอาจปฏิเสธหากทำให้ยอดคงถือเป็นลบ
            </Notice>
          ) : (
            <Field
              label={
                operation === "review"
                  ? "ยอดตั้งต้นที่ตรวจสอบแล้ว (บาท)"
                  : "จำนวนเงิน (บาท)"
              }
            >
              <input
                inputMode="decimal"
                value={draft.amount}
                required
                onChange={(event) => update("amount", event.target.value)}
                autoComplete="off"
              />
            </Field>
          )}
          {operation !== "review" ? (
            <Field label="วันและเวลาเกิดรายการ (เวลาไทย)">
              <input
                type="datetime-local"
                required
                value={draft.occurredAt}
                onChange={(event) => update("occurredAt", event.target.value)}
              />
            </Field>
          ) : null}
          {operation === "receipts" || operation === "refunds" ? (
            <Field label="วิธีรับหรือคืนเงิน">
              <select
                value={draft.method}
                onChange={(event) =>
                  update(
                    "method",
                    event.target.value === "BANK_TRANSFER"
                      ? "BANK_TRANSFER"
                      : "CASH",
                  )
                }
              >
                <option value="CASH">เงินสด</option>
                <option value="BANK_TRANSFER">โอนธนาคาร</option>
              </select>
            </Field>
          ) : null}
          {operation === "receipts" && draft.method === "BANK_TRANSFER" ? (
            <>
              <Field label="รหัสบัญชีผู้รับเงิน">
                <input
                  value={draft.receivingAccountKey}
                  maxLength={120}
                  required
                  onChange={(event) =>
                    update("receivingAccountKey", event.target.value)
                  }
                />
              </Field>
              <Field label="เลขอ้างอิงเงินโอนเข้า">
                <input
                  value={draft.externalReference}
                  maxLength={120}
                  required
                  onChange={(event) =>
                    update("externalReference", event.target.value)
                  }
                />
              </Field>
              <Notice>
                เงินโอนหนึ่งรายการห้ามนำมาบันทึกทั้งค่าเช่าและเงินประกัน
                หากเป็นยอดรวมต้องแยกการชำระที่ตรวจสอบได้ก่อน
              </Notice>
            </>
          ) : null}
          {operation === "refunds" ? (
            <Field label="ชื่อผู้รับเงินคืน">
              <input
                value={draft.payeeName}
                maxLength={200}
                required
                onChange={(event) => update("payeeName", event.target.value)}
              />
            </Field>
          ) : null}
          {operation === "refunds" && draft.method === "BANK_TRANSFER" ? (
            <>
              <Field label="เลขอ้างอิงเงินโอนออก">
                <input
                  value={draft.outgoingReference}
                  maxLength={120}
                  required
                  onChange={(event) =>
                    update("outgoingReference", event.target.value)
                  }
                />
              </Field>
              <Field label="รายละเอียดปลายทางรับเงินคืน">
                <input
                  value={draft.destination}
                  maxLength={200}
                  required
                  onChange={(event) =>
                    update("destination", event.target.value)
                  }
                />
              </Field>
            </>
          ) : null}
          <Field label="เหตุผลและรายละเอียด">
            <textarea
              value={draft.reason}
              maxLength={1000}
              required
              onChange={(event) => update("reason", event.target.value)}
            />
          </Field>
          <DepositEvidencePicker
            leaseId={ledger.leaseId}
            value={draft.evidenceId}
            onChange={(id) => update("evidenceId", id)}
            onBusy={setUploading}
          />
          <label className={styles.assertion}>
            <input
              type="checkbox"
              checked={draft.verified}
              onChange={(event) => update("verified", event.target.checked)}
              required
            />
            {operation === "refunds"
              ? "ยืนยันว่าได้ตรวจสอบการชำระบัญชี ผู้รับเงิน และการคืนเงินจริงพร้อมหลักฐานแล้ว ระบบนี้ไม่ได้โอนเงินแทน"
              : "ยืนยันว่าได้ตรวจสอบเงินจริงหรือยอดหนี้สิน เหตุผล และหลักฐานของรายการนี้แล้ว"}
          </label>
          <div className="form-actions">
            <Button
              type="submit"
              disabled={uploading || !draft.evidenceId || !draft.verified}
            >
              ยืนยัน{operationLabels[operation]}
            </Button>
            <Button
              variant="secondary"
              disabled={uploading}
              onClick={() => onOpenChange(false)}
            >
              ยกเลิก
            </Button>
          </div>
        </form>
      )}
    </Modal>
  );
}
