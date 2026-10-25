import Link from "next/link";
import { notFound } from "next/navigation";
import { Card, Notice } from "@/components/ui";
import {
  depositLabels,
  depositMoneyLabel,
  depositTime,
} from "@/features/deposits/form";
import { depositId } from "@/server/deposits/contracts";
import { depositService } from "@/server/deposit-api/service";
import { requirePageActor } from "@/server/http";

export default async function Page({
  params,
}: {
  params: Promise<{ entryId: string }>;
}) {
  const actor = await requirePageActor();
  const entryId = depositId.safeParse((await params).entryId);
  if (!entryId.success) notFound();
  const document = await depositService.getDepositDocument(actor, {
    entryId: entryId.data,
  });
  const snapshot = document.documentSnapshot;
  return (
    <>
      <div className="screen-toolbar">
        <h1>เอกสารเงินประกัน {snapshot.documentNumber}</h1>
        <Link href={`/deposits/${snapshot.leaseId}/`}>
          กลับไปบัญชีเงินประกัน
        </Link>
      </div>
      <Notice>
        เอกสารภายในจากข้อมูล ณ วันที่บันทึก
        ข้อมูลผู้ออกเอกสารตามกฎหมายยังไม่ได้ยืนยัน
      </Notice>
      <Card
        title={`${depositLabels[snapshot.kind]} ${snapshot.documentNumber}`}
        description="ข้อมูลต้นฉบับที่ระบบตรวจสอบความครบถ้วนแล้ว"
      >
        <dl className="detail-grid">
          <div>
            <dt>สัญญาตอนบันทึก</dt>
            <dd>{snapshot.leaseNumber}</dd>
          </div>
          <div>
            <dt>ผู้เช่าตอนบันทึก</dt>
            <dd>{snapshot.tenantName}</dd>
          </div>
          <div>
            <dt>ห้องตอนบันทึก</dt>
            <dd>{snapshot.roomNumber}</dd>
          </div>
          <div>
            <dt>จำนวนเงิน</dt>
            <dd>{depositMoneyLabel(snapshot.amount)}</dd>
          </div>
          <div>
            <dt>วันที่เกิดรายการ</dt>
            <dd>{depositTime(snapshot.occurredAt)}</dd>
          </div>
          <div>
            <dt>วันที่บันทึก</dt>
            <dd>{depositTime(snapshot.postedAt)}</dd>
          </div>
          <div>
            <dt>ผู้บันทึก</dt>
            <dd>{snapshot.postedByName}</dd>
          </div>
          <div>
            <dt>เหตุผล</dt>
            <dd>{snapshot.reason}</dd>
          </div>
          {snapshot.method ? (
            <div>
              <dt>วิธีรับหรือคืนเงิน</dt>
              <dd>{snapshot.method === "CASH" ? "เงินสด" : "โอนธนาคาร"}</dd>
            </div>
          ) : null}
          {snapshot.receivingAccountKey ? (
            <div>
              <dt>บัญชีรับเงิน</dt>
              <dd>{snapshot.receivingAccountKey}</dd>
            </div>
          ) : null}
          {snapshot.externalReference ? (
            <div>
              <dt>
                {snapshot.kind === "REFUND"
                  ? "เลขอ้างอิงเงินโอนออก"
                  : "เลขอ้างอิงเงินโอนเข้า"}
              </dt>
              <dd>{snapshot.externalReference}</dd>
            </div>
          ) : null}
          {snapshot.payeeName ? (
            <div>
              <dt>ชื่อผู้รับเงินคืน</dt>
              <dd>{snapshot.payeeName}</dd>
            </div>
          ) : null}
          {snapshot.destination ? (
            <div>
              <dt>ปลายทางรับเงินคืน</dt>
              <dd>{snapshot.destination}</dd>
            </div>
          ) : null}
          <div>
            <dt>หลักฐาน</dt>
            <dd>
              <a
                href={`/api/v1/deposit-evidence/${snapshot.evidenceId}/download/`}
              >
                ดาวน์โหลดหลักฐานต้นฉบับ
              </a>
            </dd>
          </div>
          {snapshot.reverseOfId ? (
            <div>
              <dt>เอกสารที่กลับรายการ</dt>
              <dd>
                <Link href={`/deposit-entries/${snapshot.reverseOfId}/`}>
                  {snapshot.originalDocumentNumber}
                </Link>
              </dd>
            </div>
          ) : null}
        </dl>
        {document.reversedBy ? (
          <p>
            สถานะปัจจุบัน: กลับรายการแล้วโดย{" "}
            <Link href={`/deposit-entries/${document.reversedBy.id}/`}>
              {document.reversedBy.documentNumber}
            </Link>{" "}
            เมื่อ {depositTime(document.reversedBy.postedAt)} ต้นฉบับยังคงอยู่
          </p>
        ) : (
          <p>สถานะปัจจุบัน: บันทึกแล้ว</p>
        )}
      </Card>
    </>
  );
}
