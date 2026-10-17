"use client";
import { useState, type FormEvent } from "react";
import { UserRound, ChevronRight, Pencil, FileText } from "lucide-react";
import {
  Badge,
  Button,
  Card,
  DataTable,
  EmptyState,
  ErrorMessage,
  Field,
  Modal,
  Notice,
  SearchField,
  SuccessMessage,
  Tabs,
} from "@/components/ui";
import { useDemo } from "@/demo/workspace";
import { invoiceBalance, invoiceTotal, paymentTotal } from "@/demo/finance";
import { type Tenant } from "@/demo/model";
import { money, date } from "@/lib/format";

export function TenantsScreen() {
  const { state, saveTenant } = useDemo();
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState(state.tenants[0]?.id || "");
  const [draft, setDraft] = useState<Tenant | null>(null);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const filtered = state.tenants.filter((t) => {
    const lease = state.leases.find(
      (l) => l.tenantId === t.id && l.status === "active",
    );
    return `${t.name} ${t.phone} ${lease?.room}`
      .toLowerCase()
      .includes(query.toLowerCase());
  });
  const tenant = filtered.find((t) => t.id === selected) || filtered[0];
  const leases = state.leases.filter((l) => l.tenantId === tenant?.id);
  const lease = leases.find((l) => l.status === "active");
  const invoices = state.invoices.filter((i) =>
    leases.some((l) => l.room === i.room),
  );
  const payments = state.payments.filter((p) =>
    p.allocations.some((a) => invoices.some((i) => i.id === a.invoiceId)),
  );
  function submit(event: FormEvent) {
    event.preventDefault();
    if (!draft) return;
    const result = saveTenant(draft);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setSelected(draft.id);
    setDraft(null);
    setSuccess("บันทึกข้อมูลผู้เช่าสาธิตแล้ว");
  }
  return (
    <>
      {success && <SuccessMessage>{success}</SuccessMessage>}
      <div className="tenant-top">
        <Card
          title="รายชื่อผู้เช่า"
          action={
            <span className="table-count">{state.tenants.length} คน</span>
          }
        >
          <SearchField
            value={query}
            onChange={setQuery}
            label="ค้นหาผู้เช่า"
            placeholder="ค้นหาชื่อ / ห้อง / เบอร์โทร..."
          />
          <div className="tenant-list paragraph-gap">
            {filtered.length === 0 ? (
              <EmptyState />
            ) : (
              filtered.map((t) => {
                const l = state.leases.find(
                  (l) => l.tenantId === t.id && l.status === "active",
                );
                return (
                  <button
                    key={t.id}
                    className={`tenant-option ${tenant?.id === t.id ? "selected" : ""}`}
                    onClick={() => setSelected(t.id)}
                    aria-pressed={tenant?.id === t.id}
                  >
                    <span className="avatar">
                      {String.fromCharCode(65 + state.tenants.indexOf(t))}
                    </span>
                    <span>
                      <strong>{t.name}</strong>
                      <small>ห้อง {l?.room || "ไม่มีสัญญาปัจจุบัน"}</small>
                    </span>
                    <ChevronRight size={16} aria-hidden="true" />
                  </button>
                );
              })
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
                <Badge dot>มีผู้เช่า</Badge>
              </div>
              <Button
                variant="secondary"
                onClick={() => {
                  setError("");
                  setDraft({ ...tenant });
                }}
              >
                <Pencil size={14} />
                แก้ไขข้อมูล
              </Button>
            </div>
            <dl className="detail-grid">
              <div>
                <dt>ห้องพัก</dt>
                <dd>
                  {lease?.room} {lease && `(ชั้น ${lease.room.slice(0, 1)})`}
                </dd>
              </div>
              <div>
                <dt>เบอร์โทรศัพท์</dt>
                <dd>{tenant.phone}</dd>
              </div>
              <div>
                <dt>ค่าเช่า</dt>
                <dd>{money(lease?.rent || 0)} / เดือน</dd>
              </div>
              <div>
                <dt>อีเมล</dt>
                <dd>{tenant.email}</dd>
              </div>
              <div>
                <dt>วันเริ่มเข้าพัก</dt>
                <dd>{lease ? date(lease.start) : "-"}</dd>
              </div>
              <div>
                <dt>ที่อยู่</dt>
                <dd>{tenant.address}</dd>
              </div>
            </dl>
            <div className="profile-note">
              ข้อมูลสมมติ •
              ไม่จัดเก็บเลขบัตรประชาชนหรือเอกสารส่วนบุคคลในระยะสาธิต
            </div>
          </Card>
        ) : (
          <Card>
            <EmptyState title="ไม่พบข้อมูลผู้เช่า" />
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
                  <>
                    <h2 className="lease-summary">
                      <FileText size={17} />
                      สัญญาเช่า
                    </h2>
                    <DataTable
                      caption="สัญญาของผู้เช่า"
                      headers={[
                        "เลขที่สัญญา",
                        "วันเริ่มสัญญา",
                        "วันสิ้นสุดสัญญา",
                        "ค่าเช่า",
                        "เงินประกัน",
                        "สถานะ",
                      ]}
                      empty={leases.length === 0}
                    >
                      {leases.map((l) => (
                        <tr key={l.id}>
                          <td>{l.id}</td>
                          <td>{date(l.start)}</td>
                          <td>{date(l.end)}</td>
                          <td>{money(l.rent)}</td>
                          <td>{money(l.deposit)}</td>
                          <td>
                            <Badge>
                              {l.status === "active" ? "ใช้งาน" : "สิ้นสุดแล้ว"}
                            </Badge>
                          </td>
                        </tr>
                      ))}
                    </DataTable>
                    <div className="paragraph-gap">
                      <Notice>
                        เงินประกันเป็นภาระหนี้สิน แสดงแยกจากรายรับค่าเช่า
                      </Notice>
                    </div>
                  </>
                ),
              },
              {
                value: "payments",
                label: "ประวัติการชำระเงิน",
                content: (
                  <DataTable
                    caption="ประวัติการชำระของผู้เช่า"
                    headers={["วันที่", "เลขอ้างอิง", "จำนวนเงิน", "สถานะ"]}
                    empty={payments.length === 0}
                  >
                    {payments.toReversed().map((p) => (
                      <tr key={p.id}>
                        <td>{date(p.date)}</td>
                        <td>{p.reference}</td>
                        <td>{money(paymentTotal(p))}</td>
                        <td>
                          <Badge
                            tone={p.status === "confirmed" ? "green" : "amber"}
                          >
                            {p.status === "confirmed"
                              ? "ยืนยันแล้ว"
                              : "รอตรวจสอบ"}
                          </Badge>
                        </td>
                      </tr>
                    ))}
                  </DataTable>
                ),
              },
              {
                value: "invoices",
                label: "ใบแจ้งหนี้",
                content: (
                  <DataTable
                    caption="ใบแจ้งหนี้ของผู้เช่า"
                    headers={[
                      "เลขที่ใบแจ้งหนี้",
                      "กำหนดชำระ",
                      "ยอดรวม",
                      "คงค้าง",
                    ]}
                    empty={invoices.length === 0}
                  >
                    {invoices.toReversed().map((i) => (
                      <tr key={i.id}>
                        <td>{i.number}</td>
                        <td>{date(i.dueDate)}</td>
                        <td>{money(invoiceTotal(i))}</td>
                        <td
                          className={
                            invoiceBalance(state, i) > 0 ? "text-red" : ""
                          }
                        >
                          {money(invoiceBalance(state, i))}
                        </td>
                      </tr>
                    ))}
                  </DataTable>
                ),
              },
              {
                value: "utilities",
                label: "ค่าน้ำ - ไฟ",
                content: (
                  <DataTable
                    caption="ค่าน้ำไฟของผู้เช่า"
                    headers={["เดือน", "ค่าน้ำ", "ค่าไฟ"]}
                    empty={invoices.length === 0}
                  >
                    {invoices.toReversed().map((i) => (
                      <tr key={i.id}>
                        <td>{i.month}</td>
                        {["ค่าน้ำ", "ค่าไฟ"].map((label) => {
                          const line = i.lines.find((l) => l.label === label);
                          return (
                            <td key={label}>
                              {money(line ? line.quantity * line.unitPrice : 0)}
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </DataTable>
                ),
              },
              {
                value: "maintenance",
                label: "แจ้งซ่อม",
                content: (
                  <DataTable
                    caption="ประวัติแจ้งซ่อมของผู้เช่า"
                    headers={["วันที่", "ปัญหา", "สถานะ"]}
                    empty={!state.tickets.some((t) => t.room === lease?.room)}
                  >
                    {state.tickets
                      .filter((t) => t.room === lease?.room)
                      .map((t) => (
                        <tr key={t.id}>
                          <td>{date(t.date)}</td>
                          <td>{t.issue}</td>
                          <td>
                            <Badge
                              tone={t.status === "resolved" ? "green" : "amber"}
                            >
                              {t.status === "resolved"
                                ? "เสร็จสิ้น"
                                : t.status === "pending"
                                  ? "รออนุมัติ"
                                  : "กำลังดำเนินการ"}
                            </Badge>
                          </td>
                        </tr>
                      ))}
                  </DataTable>
                ),
              },
              {
                value: "documents",
                label: "เอกสาร",
                content: (
                  <EmptyState
                    title="ยังไม่มีเอกสาร"
                    description="การจัดเก็บเอกสารผู้เช่าจะเปิดใช้งานพร้อมระบบฐานข้อมูลและสิทธิ์เข้าถึง"
                  />
                ),
              },
            ]}
          />
        </Card>
      )}
      <Modal
        open={draft !== null}
        onOpenChange={(open) => {
          if (!open) setDraft(null);
        }}
        title="แก้ไขข้อมูลผู้เช่า"
      >
        {draft && (
          <form onSubmit={submit}>
            <div className="form-grid">
              <Field label="ชื่อผู้เช่า">
                <input
                  required
                  value={draft.name}
                  onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                />
              </Field>
              <Field label="เบอร์โทรศัพท์">
                <input
                  required
                  type="tel"
                  value={draft.phone}
                  onChange={(e) =>
                    setDraft({ ...draft, phone: e.target.value })
                  }
                />
              </Field>
              <Field label="อีเมล" className="form-full">
                <input
                  required
                  type="email"
                  value={draft.email}
                  onChange={(e) =>
                    setDraft({ ...draft, email: e.target.value })
                  }
                />
              </Field>
              <Field label="ที่อยู่" className="form-full">
                <textarea
                  required
                  value={draft.address}
                  onChange={(e) =>
                    setDraft({ ...draft, address: e.target.value })
                  }
                />
              </Field>
            </div>
            <ErrorMessage>{error}</ErrorMessage>
            <div className="form-actions">
              <Button variant="ghost" onClick={() => setDraft(null)}>
                ยกเลิก
              </Button>
              <Button type="submit">บันทึกข้อมูลสาธิต</Button>
            </div>
          </form>
        )}
      </Modal>
    </>
  );
}
