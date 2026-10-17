"use client";
import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { date } from "@/lib/format";
import { leaseLabels } from "./lease-summary";
import { ChevronRight, UserRound } from "lucide-react";
import {
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorMessage,
  SearchField,
  Tabs,
  DataTable,
  Notice,
} from "@/components/ui";
import { useLiveWorkspace, baht } from "./workspace";
import { RecordEditor, DeleteRecord, type Draft } from "./editor";
export function LiveTenants({
  admin,
  initialId = "",
}: {
  admin: boolean;
  initialId?: string;
}) {
  const router = useRouter();
  const { data, error, reload } = useLiveWorkspace();
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState(initialId);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [deleting, setDeleting] = useState(false);
  if (!data)
    return (
      <Card>
        <ErrorMessage>{error}</ErrorMessage>
        <p role="status">กำลังโหลดผู้เช่า…</p>
        {error && <Button onClick={reload}>ลองอีกครั้ง</Button>}
      </Card>
    );
  const filtered = data.tenants.filter((t) =>
    `${t.name} ${t.phone}`.toLowerCase().includes(query.toLowerCase()),
  );
  const tenant = filtered.find((t) => t.id === selected) || filtered[0];
  const leases = data.leases.filter((l) => l.tenantId === tenant?.id);
  const active = leases.find((l) => l.status === "ACTIVE");
  return (
    <>
      <ErrorMessage>{error}</ErrorMessage>
      <div className="screen-toolbar">
        <p className="toolbar-label">ข้อมูลผู้เช่าจากฐานข้อมูล</p>
        <Button
          onClick={() =>
            setDraft({
              entity: "tenants",
              values: {
                name: "",
                phone: "",
                email: "",
                address: "",
                notes: "",
                isDemo: false,
              },
            })
          }
        >
          เพิ่มผู้เช่า
        </Button>
      </div>
      <div className="tenant-top">
        <Card
          title="รายชื่อผู้เช่า"
          action={<span className="table-count">{data.tenants.length} คน</span>}
        >
          <SearchField
            value={query}
            onChange={setQuery}
            label="ค้นหาผู้เช่า"
            placeholder="ค้นหาชื่อ / เบอร์โทร..."
          />
          <div className="tenant-list paragraph-gap">
            {filtered.length ? (
              filtered.map((t) => (
                <button
                  className={`tenant-option ${t.id === tenant?.id ? "selected" : ""}`}
                  key={t.id}
                  onClick={() => setSelected(t.id)}
                  aria-pressed={t.id === tenant?.id}
                >
                  <span className="avatar">
                    <UserRound size={20} />
                  </span>
                  <span>
                    <strong>{t.name}</strong>
                    <small>{t.isDemo ? "ข้อมูลตัวอย่าง" : "ผู้เช่า"}</small>
                  </span>
                  <ChevronRight size={16} />
                </button>
              ))
            ) : (
              <EmptyState
                title="ยังไม่มีผู้เช่า"
                description="เพิ่มข้อมูลผู้เช่าเพื่อเริ่มทำสัญญา"
              />
            )}
          </div>
        </Card>
        {tenant ? (
          <Card className="tenant-profile">
            <div className="tenant-profile-heading">
              <span className="avatar">
                <UserRound size={29} />
              </span>
              <div>
                <h2>{tenant.name}</h2>
                <Badge tone={active ? "green" : "gray"}>
                  {active ? "มีสัญญาปัจจุบัน" : "ไม่มีสัญญาปัจจุบัน"}
                </Badge>
                {tenant.isDemo && <Badge tone="amber">Demo</Badge>}
              </div>
              <Button
                variant="secondary"
                onClick={() =>
                  setDraft({
                    entity: "tenants",
                    id: tenant.id,
                    values: {
                      name: tenant.name,
                      phone: tenant.phone,
                      email: tenant.email,
                      address: tenant.address,
                      notes: tenant.notes,
                      isDemo: tenant.isDemo,
                    },
                  })
                }
              >
                แก้ไขข้อมูล
              </Button>
            </div>
            <dl className="detail-grid">
              <div>
                <dt>ห้องพัก</dt>
                <dd>
                  {leases
                    .filter((l) => l.status === "ACTIVE")
                    .map((l) => (
                      <div key={l.id}>
                        <Link href={`/rooms/?room=${l.roomId}`}>
                          ห้อง {l.room.number}
                        </Link>{" "}
                        ·{" "}
                        <Link href={`/leases/?lease=${l.id}`}>{l.number}</Link>
                      </div>
                    ))}
                  {!active && "ยังไม่กำหนดห้อง"}
                </dd>
              </div>
              <div>
                <dt>เบอร์โทรศัพท์</dt>
                <dd>{tenant.phone || "—"}</dd>
              </div>
              <div>
                <dt>ค่าเช่า</dt>
                <dd>{active ? baht(active.rent) : "—"}</dd>
              </div>
              <div>
                <dt>อีเมล</dt>
                <dd>{tenant.email || "—"}</dd>
              </div>
              <div>
                <dt>ที่อยู่</dt>
                <dd>{tenant.address || "—"}</dd>
              </div>
              <div>
                <dt>หมายเหตุ</dt>
                <dd>{tenant.notes || "—"}</dd>
              </div>
            </dl>
            {admin && (
              <div className="form-actions">
                <Button variant="danger" onClick={() => setDeleting(true)}>
                  ลบผู้เช่า
                </Button>
              </div>
            )}
          </Card>
        ) : (
          <Card>
            <EmptyState
              title="เลือกหรือเพิ่มผู้เช่า"
              description="ข้อมูลจะถูกจัดเก็บในเครื่องนี้"
            />
          </Card>
        )}
      </div>
      {tenant && (
        <Card>
          <Tabs
            items={[
              {
                value: "leases",
                label: "สัญญาเช่า",
                content: (
                  <DataTable
                    caption="สัญญาของผู้เช่า"
                    headers={[
                      "เลขที่สัญญา",
                      "ห้อง",
                      "เริ่ม",
                      "สิ้นสุด",
                      "สถานะ",
                    ]}
                    empty={!leases.length}
                  >
                    {leases.map((l) => (
                      <tr key={l.id}>
                        <td>
                          <Link href={`/leases/?lease=${l.id}`}>
                            {l.number}
                          </Link>
                        </td>
                        <td>
                          <Link href={`/rooms/?room=${l.roomId}`}>
                            {l.room.number}
                          </Link>
                        </td>
                        <td>{date(l.startDate.slice(0, 10))}</td>
                        <td>{date(l.endDate.slice(0, 10))}</td>
                        <td>{leaseLabels[l.status]}</td>
                      </tr>
                    ))}
                  </DataTable>
                ),
              },
              ...[
                "การชำระเงิน",
                "ใบแจ้งหนี้",
                "ค่าน้ำ / ค่าไฟ",
                "การแจ้งซ่อม",
                "เอกสาร",
              ].map((label, i) => ({
                value: `future-${i}`,
                label,
                content: (
                  <Notice>
                    ส่วนนี้จะเชื่อมต่อข้อมูลในระยะถัดไป
                    ยังไม่มีรายการจากฐานข้อมูล
                  </Notice>
                ),
              })),
            ]}
          />
        </Card>
      )}
      {draft && (
        <RecordEditor
          key={draft.id || "new"}
          draft={draft}
          data={data}
          onClose={() => setDraft(null)}
          onSaved={async (id) => {
            await reload();
            if (id) {
              setSelected(id);
              setQuery("");
              router.replace(`/tenants/?tenant=${id}`, { scroll: false });
            }
          }}
        />
      )}
      {deleting && tenant && (
        <DeleteRecord
          entity="tenants"
          id={tenant.id}
          name={tenant.name}
          onClose={() => setDeleting(false)}
          onSaved={reload}
        />
      )}
    </>
  );
}
