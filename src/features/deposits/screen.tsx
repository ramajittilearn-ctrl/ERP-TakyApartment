"use client";
import Link from "next/link";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import { Badge, Button, Card, DataTable, Notice } from "@/components/ui";
import type {
  DepositEntryDto,
  DepositLedgerDto,
} from "../../server/deposits/contracts";
import { DepositCommandDialog } from "./command";
import {
  depositLabels,
  depositMoneyLabel,
  depositTime,
  operationLabels,
  type DepositOperation,
} from "./form";
import {
  bindDepositActor,
  depositJournal,
  dismissDepositAttempt,
  subscribeDeposits,
} from "./journal";
import styles from "./screen.module.css";

export function DepositScreen({
  initialLedger: ledger,
  actorId,
  admin,
  leaseStatus,
}: {
  initialLedger: DepositLedgerDto;
  actorId: string;
  admin: boolean;
  leaseStatus: string;
}) {
  const router = useRouter();
  const attempt = useSyncExternalStore(
    subscribeDeposits,
    () => depositJournal(actorId),
    () => null,
  );
  const [dialog, setDialog] = useState<{
    operation: DepositOperation;
    original?: DepositEntryDto;
    generation: number;
  } | null>(null);
  const [open, setOpen] = useState(false);
  const refreshed = useRef("");
  useEffect(() => {
    bindDepositActor(actorId);
  }, [actorId]);
  useEffect(() => {
    if (attempt?.state === "success" && refreshed.current !== attempt.key) {
      refreshed.current = attempt.key;
      router.refresh();
    }
  }, [attempt, router]);
  const pending =
    attempt?.state === "submitting" || attempt?.state === "uncertain";
  function begin(operation: DepositOperation, original?: DepositEntryDto) {
    if (pending) return;
    dismissDepositAttempt(actorId);
    setDialog((prior) => ({
      operation,
      original,
      generation: (prior?.generation ?? 0) + 1,
    }));
    setOpen(true);
  }
  function recover() {
    if (!attempt) return;
    if (attempt.leaseId !== ledger.leaseId) {
      router.push(`/deposits/${attempt.leaseId}/`);
      return;
    }
    if (!dialog || dialog.operation !== attempt.operation)
      setDialog({ operation: attempt.operation, generation: 0 });
    setOpen(true);
  }
  const reviewed = ledger.account.reviewState === "REVIEWED";
  const canPost = admin && !pending && leaseStatus !== "DRAFT";
  const totals = ledger.totals;
  return (
    <div className={styles.screen}>
      {attempt ? (
        <Card title="ผลการทำรายการล่าสุด">
          <p role="status">
            {attempt.state === "success"
              ? "บันทึกรายการสำเร็จแล้ว"
              : attempt.state === "rejected"
                ? attempt.message
                : attempt.message}
          </p>
          <Button variant="secondary" onClick={recover}>
            {pending ? "เปิดการตรวจสอบผลรายการเดิม" : "ดูผลรายการ"}
          </Button>
          {!pending ? (
            <Button
              variant="ghost"
              onClick={() => dismissDepositAttempt(actorId)}
            >
              รับทราบ
            </Button>
          ) : null}
        </Card>
      ) : null}
      <div className={styles.metrics}>
        <Card title="เงินประกันตามสัญญา">
          <p className={styles.amount}>
            {depositMoneyLabel(ledger.contractualRequirement)}
          </p>
          <p>เป็นข้อกำหนดตามสัญญา ยังไม่ใช่เงินรับ</p>
        </Card>
        <Card title="เงินประกันคงถือที่จัดการในระบบ">
          <p className={styles.amount}>
            {depositMoneyLabel(totals.heldLiability)}
          </p>
          <p>
            {reviewed
              ? "ผ่านการทบทวนยอดตั้งต้นแล้ว"
              : "ยังไม่ผ่านการทบทวนยอดตั้งต้น"}
          </p>
        </Card>
        <Card title="ข้อมูลเก่าที่ยังไม่ยืนยัน">
          <p className={styles.amount}>
            {ledger.unverifiedLegacy.count} รายการ
          </p>
          <p>แยกจากยอดที่จัดการในระบบ ไม่ใช่ยอดพร้อมคืนหรือหัก</p>
        </Card>
      </div>
      {ledger.dataQualityIssues.length ? (
        <div role="alert">
          <Notice>
            พบจำนวนเงินต้นทางที่ไม่เป็นค่าจำกัด ต้องตรวจสอบข้อมูลก่อนทำรายการ
            ระบบไม่แสดงค่าที่ผิดเป็นยอดศูนย์
          </Notice>
          <ul>
            {ledger.dataQualityIssues.map((issue, index) => (
              <li key={index}>
                {issue.code === "NON_FINITE_CONTRACTUAL_REQUIREMENT"
                  ? "เงินประกันตามสัญญา"
                  : `ข้อมูลเก่า ${issue.legacyDepositId}`}
                : {issue.rawAmount}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      <Notice>
        เงินประกันเป็นหนี้สิน แยกจากรายได้ค่าเช่า การหักไม่สร้างรายได้
        ค่าใช้จ่าย หรือหักค่าเช่าอัตโนมัติ
        การคืนเงินต้องดำเนินการและตรวจสอบเงินจริงโดยผู้ดูแล
      </Notice>
      <Card
        title="การทบทวนยอดตั้งต้น"
        action={
          <Badge tone={reviewed ? "green" : "amber"}>
            {reviewed ? "ทบทวนแล้ว" : "ยังไม่ทบทวน"}
          </Badge>
        }
      >
        {reviewed ? (
          <dl className="detail-grid">
            <div>
              <dt>ยอดตั้งต้นที่ตรวจสอบแล้ว</dt>
              <dd>{depositMoneyLabel(ledger.account.openingAmount)}</dd>
            </div>
            <div>
              <dt>วันที่ทบทวน</dt>
              <dd>
                {ledger.account.reviewedAt
                  ? depositTime(ledger.account.reviewedAt)
                  : "ไม่ระบุ"}
              </dd>
            </div>
            <div>
              <dt>รายละเอียดการทบทวน</dt>
              <dd>{ledger.account.reviewReason}</dd>
            </div>
            <div>
              <dt>หลักฐานการทบทวน</dt>
              <dd>
                {ledger.account.evidenceId ? (
                  <a
                    href={`/api/v1/deposit-evidence/${ledger.account.evidenceId}/download/`}
                  >
                    ดาวน์โหลดหลักฐาน
                  </a>
                ) : (
                  "ไม่ระบุ"
                )}
              </dd>
            </div>
          </dl>
        ) : (
          <>
            <p>
              ตรวจสอบยอดหนี้สินที่ถือจริงก่อนรับเพิ่ม หัก หรือคืนเงิน
              รวมถึงสัญญาที่ไม่มีข้อมูลเก่าก็ต้องทบทวนยอดศูนย์อย่างชัดเจน
            </p>
            {admin ? (
              <Button disabled={!canPost} onClick={() => begin("review")}>
                ทบทวนยอดตั้งต้น
              </Button>
            ) : null}
          </>
        )}
        {admin && reviewed ? (
          <div className="form-actions">
            <Button
              disabled={!canPost || leaseStatus !== "ACTIVE"}
              onClick={() => begin("receipts")}
            >
              รับเงินประกัน
            </Button>
            <Button
              variant="secondary"
              disabled={!canPost}
              onClick={() => begin("deductions")}
            >
              หักเงินประกัน
            </Button>
            <Button
              variant="secondary"
              disabled={!canPost}
              onClick={() => begin("refunds")}
            >
              คืนเงินประกัน
            </Button>
          </div>
        ) : null}
        {!admin ? (
          <p>เจ้าหน้าที่มีสิทธิ์อ่านข้อมูล ผู้ดูแลระบบเป็นผู้ยืนยันรายการ</p>
        ) : null}
        {leaseStatus !== "ACTIVE" ? (
          <p>
            รับเงินเพิ่มได้เฉพาะสัญญาที่ใช้งาน
            สัญญาสิ้นสุดหรือยกเลิกรับเฉพาะการชำระบัญชีและแก้ไขตามนโยบาย
          </p>
        ) : null}
      </Card>
      <Card
        title="กระทบยอดเงินประกันทั้งหมด"
        description={`ยอดรวมจากทุกรายการ ไม่จำกัดเฉพาะหน้าที่เปิด ข้อมูล ณ ${depositTime(ledger.asOfPostedAt)}`}
      >
        <DataTable
          caption="ยอดรวมเงินประกัน"
          headers={["ประเภท", "ยอดเดิมรวม", "กลับรายการรวม", "ยอดสุทธิ"]}
        >
          {[
            [
              "รับเงิน",
              totals.grossReceipts,
              totals.reversedReceipts,
              totals.netReceipts,
            ],
            [
              "คืนเงิน",
              totals.grossRefunds,
              totals.reversedRefunds,
              totals.netRefunds,
            ],
            [
              "หักเงิน",
              totals.grossDeductions,
              totals.reversedDeductions,
              totals.netDeductions,
            ],
            [
              "ยอดตั้งต้น",
              totals.grossOpening,
              totals.reversedOpening,
              totals.netOpening,
            ],
          ].map(([label, gross, reversed, net]) => (
            <tr key={label}>
              <th scope="row">{label}</th>
              <td>{depositMoneyLabel(gross)}</td>
              <td>{depositMoneyLabel(reversed)}</td>
              <td>{depositMoneyLabel(net)}</td>
            </tr>
          ))}
        </DataTable>
      </Card>
      <Card
        title="ประวัติรายการที่จัดการในระบบ"
        description={`ทั้งหมด ${ledger.total} รายการ`}
      >
        <DataTable
          caption="ประวัติเงินประกัน"
          headers={[
            "เอกสาร",
            "ประเภท",
            "จำนวนเงิน",
            "วันที่เกิดรายการ",
            "รายละเอียด",
            "หลักฐาน",
            "สถานะ / จัดการ",
          ]}
          empty={!ledger.items.length}
        >
          {ledger.items.map((entry) => (
            <tr key={entry.id}>
              <td>
                <Link href={`/deposit-entries/${entry.id}/`}>
                  {entry.documentNumber}
                </Link>
              </td>
              <td>{depositLabels[entry.kind]}</td>
              <td>{depositMoneyLabel(entry.amount)}</td>
              <td>{depositTime(entry.occurredAt)}</td>
              <td>{entry.reason}</td>
              <td>
                <a
                  href={`/api/v1/deposit-evidence/${entry.evidenceId}/download/`}
                >
                  ดาวน์โหลด
                </a>
              </td>
              <td>
                {entry.reversedBy ? (
                  <Link href={`/deposit-entries/${entry.reversedBy.id}/`}>
                    กลับแล้ว {entry.reversedBy.documentNumber}
                  </Link>
                ) : entry.reverseOfId ? (
                  <Link href={`/deposit-entries/${entry.reverseOfId}/`}>
                    รายการต้นฉบับ
                  </Link>
                ) : (
                  <>
                    <span>บันทึกแล้ว</span>
                    {admin && reviewed ? (
                      <Button
                        variant="ghost"
                        disabled={!canPost}
                        onClick={() => begin("reverse", entry)}
                      >
                        กลับรายการ
                      </Button>
                    ) : null}
                  </>
                )}
              </td>
            </tr>
          ))}
        </DataTable>
        <div className="form-actions">
          {ledger.offset > 0 ? (
            <Link
              href={`/deposits/${ledger.leaseId}/?offset=${Math.max(0, ledger.offset - ledger.limit)}&limit=${ledger.limit}`}
            >
              หน้าก่อนหน้า
            </Link>
          ) : null}
          {ledger.offset + ledger.limit < ledger.total ? (
            <Link
              href={`/deposits/${ledger.leaseId}/?offset=${ledger.offset + ledger.limit}&limit=${ledger.limit}`}
            >
              หน้าถัดไป
            </Link>
          ) : null}
        </div>
      </Card>
      <Card
        title="ข้อมูลเดิมที่ยังไม่ยืนยัน"
        description="คงข้อมูลเก่าตามที่บันทึกไว้ ไม่แปลงเป็นเงินรับใหม่หรือยอดคงถืออัตโนมัติ"
      >
        <p>
          รับเดิม {depositMoneyLabel(ledger.unverifiedLegacy.grossReceived)} ·
          คืนเดิม {depositMoneyLabel(ledger.unverifiedLegacy.grossRefunded)} ·
          หักเดิม {depositMoneyLabel(ledger.unverifiedLegacy.grossDeducted)}
        </p>
        <DataTable
          caption="ข้อมูลเงินประกันเดิม"
          headers={["รหัสเดิม", "ประเภทเดิม", "จำนวนเงินเดิม", "วันที่เดิม"]}
          empty={!ledger.unverifiedLegacy.rows.length}
        >
          {ledger.unverifiedLegacy.rows.map((row) => (
            <tr key={row.id}>
              <td>{row.id}</td>
              <td>{row.kind}</td>
              <td>{row.amount}</td>
              <td>{depositTime(row.occurredAt)}</td>
            </tr>
          ))}
        </DataTable>
      </Card>
      {dialog ? (
        <DepositCommandDialog
          key={`${dialog.operation}:${dialog.generation}`}
          actorId={actorId}
          ledger={ledger}
          operation={dialog.operation}
          original={dialog.original}
          open={open}
          onOpenChange={setOpen}
          attempt={attempt?.leaseId === ledger.leaseId ? attempt : null}
          onRefresh={() => router.refresh()}
        />
      ) : null}
      {pending ? (
        <p className="muted-text">
          {operationLabels[attempt.operation]}ยังไม่ทราบผล
          กรุณาตรวจสอบคำสั่งเดิมก่อนทำรายการอื่น
        </p>
      ) : null}
    </div>
  );
}
