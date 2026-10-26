import Link from "next/link";
import { Card, DataTable, Notice } from "@/components/ui";
import { depositSsrQuery } from "@/server/deposit-api/boundary";
import { listDepositLeases } from "@/server/deposit-api/leases";
import { requirePageActor } from "@/server/http";

const statuses = {
  DRAFT: "ร่าง",
  ACTIVE: "ใช้งาน",
  ENDED: "สิ้นสุด",
  CANCELLED: "ยกเลิก",
};
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const actor = await requirePageActor();
  const query = depositSsrQuery(await searchParams);
  const page = await listDepositLeases(actor, query);
  return (
    <>
      <h1>เงินประกันผู้เช่า</h1>
      <Notice>
        เลือกสัญญาเพื่อดูยอดตามสัญญา เงินประกันคงถือ
        และข้อมูลเก่าที่ยังไม่ยืนยัน เงินประกันไม่ใช่รายได้ค่าเช่า
      </Notice>
      <Card
        title="สัญญาสำหรับเงินประกัน"
        description={`ทั้งหมด ${page.total} สัญญา แสดง ${page.offset + (page.items.length ? 1 : 0)} ถึง ${page.offset + page.items.length}`}
      >
        <DataTable
          caption="สัญญาสำหรับเงินประกัน"
          headers={["เลขที่สัญญา", "ห้อง", "ผู้เช่า", "สถานะ", "เงินประกัน"]}
          empty={!page.items.length}
        >
          {page.items.map((lease) => (
            <tr key={lease.id}>
              <td>
                <Link href={`/leases/?lease=${lease.id}`}>{lease.number}</Link>
              </td>
              <td>{lease.room.number}</td>
              <td>{lease.tenant.name}</td>
              <td>{statuses[lease.status]}</td>
              <td>
                <Link href={`/deposits/${lease.id}/`}>ดูบัญชีเงินประกัน</Link>
              </td>
            </tr>
          ))}
        </DataTable>
        <div className="form-actions">
          {page.offset > 0 ? (
            <Link
              href={`/deposits/?offset=${Math.max(0, page.offset - page.limit)}&limit=${page.limit}`}
            >
              หน้าก่อนหน้า
            </Link>
          ) : null}
          {page.offset + page.limit < page.total ? (
            <Link
              href={`/deposits/?offset=${page.offset + page.limit}&limit=${page.limit}`}
            >
              หน้าถัดไป
            </Link>
          ) : null}
        </div>
      </Card>
    </>
  );
}
