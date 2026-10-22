"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
} from "react";
import { z } from "zod";
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
  SuccessMessage,
} from "@/components/ui";
import {
  invoiceDtoSchema,
  invoiceOptionsSchema,
  type InvoiceDto,
  type InvoiceOptions,
} from "@/server/invoices/contracts";
import type { BillingConsumption } from "@/server/billing/contracts";
import styles from "./screen.module.css";

const errorSchema = z.object({
  error: z.object({ code: z.string(), message: z.string() }),
});
const previewSchema = z.object({
  complete: z.boolean(),
  issues: z.array(z.object({ code: z.string(), message: z.string() })),
  results: z.array(
    z.object({
      leaseId: z.string(),
      result: z.object({
        complete: z.boolean(),
        issues: z.array(z.object({ code: z.string(), message: z.string() })),
      }),
    }),
  ),
});
async function api<T>(
  path: string,
  schema: z.ZodType<T>,
  init?: RequestInit,
): Promise<T> {
  const response = await fetch(`/api/v1/${path}`, {
    ...init,
    cache: "no-store",
    headers: init?.body ? { "Content-Type": "application/json" } : undefined,
  });
  const body: unknown = await response.json();
  if (!response.ok) {
    if (response.status === 401) window.location.assign("/login/");
    const parsed = errorSchema.safeParse(body);
    throw new Error(
      parsed.success
        ? `${parsed.data.error.message} (${parsed.data.error.code})`
        : "ไม่สามารถเชื่อมต่อระบบได้ กรุณาลองอีกครั้ง",
    );
  }
  return z.object({ data: schema }).parse(body).data;
}
function amount(value: string | null) {
  if (value === null) return "ยังไม่คำนวณ";
  const [whole, fraction] = value.split(".");
  return `${whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",")}${fraction === undefined ? "" : `.${fraction}`} บาท`;
}
function periodLabel(value: string) {
  return new Intl.DateTimeFormat("th-TH", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${value.slice(0, 7)}-01T00:00:00Z`));
}
function dateLabel(value: string | null) {
  return value
    ? new Intl.DateTimeFormat("th-TH", {
        dateStyle: "medium",
        timeZone: "UTC",
      }).format(new Date(`${value.slice(0, 10)}T00:00:00Z`))
    : "ยังไม่กำหนด";
}
function Status({ status }: Pick<InvoiceDto, "status">) {
  return (
    <Badge
      tone={status === "ISSUED" ? "green" : status === "VOID" ? "red" : "amber"}
    >
      {status === "ISSUED"
        ? "ออกแล้ว"
        : status === "VOID"
          ? "ยกเลิก"
          : "ฉบับร่าง"}
    </Badge>
  );
}
function sourceLabel(source: BillingConsumption) {
  switch (source.kind) {
    case "ACTUAL":
      return "มิเตอร์จริง";
    case "ALLOCATED_ACTUAL":
      return "ADMIN จัดสรรต่อสัญญา";
    case "ESTIMATE":
      return "ประมาณการที่ ADMIN อนุมัติ";
    case "REPLACEMENT":
      return "เปลี่ยนมิเตอร์ · แยกช่วงอนุมัติ";
  }
}
type Period = InvoiceOptions["periods"][number];
type Property = InvoiceOptions["properties"][number];
type Action =
  | { kind: "PREPARE"; period: Period }
  | { kind: "CLOSE"; period: Period }
  | { kind: "POLICY"; property: Property }
  | {
      kind: "ISSUE" | "VOID" | "REVISE" | "EDIT" | "REFRESH";
      invoice: InvoiceDto;
    };
const titles = {
  PREPARE: "เตรียมใบแจ้งหนี้",
  CLOSE: "ตรวจสอบและปิดรอบ",
  POLICY: "กำหนดวันครบกำหนด",
  ISSUE: "ยืนยันออกใบแจ้งหนี้",
  VOID: "ยืนยันยกเลิกใบแจ้งหนี้",
  REVISE: "อนุมัติและออกฉบับแก้ไข",
  EDIT: "แก้ไขข้อมูลฉบับร่าง",
  REFRESH: "ปรับปรุงฉบับร่าง",
};

export function InvoiceScreen({ admin }: { admin: boolean }) {
  const [options, setOptions] = useState<InvoiceOptions | null>(null);
  const [periodId, setPeriodId] = useState("");
  const [roomId, setRoomId] = useState("");
  const [leaseId, setLeaseId] = useState("");
  const [status, setStatus] = useState("");
  const [rows, setRows] = useState<InvoiceDto[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [detail, setDetail] = useState<InvoiceDto | null>(null);
  const [history, setHistory] = useState<InvoiceDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [action, setAction] = useState<Action | null>(null);
  const [busy, setBusy] = useState(false);
  const [downloadingInvoiceId, setDownloadingInvoiceId] = useState<
    string | null
  >(null);
  const [revision, setRevision] = useState(0);
  const lock = useRef(false);
  const retry = useRef<{ signature: string; key: string } | null>(null);
  const reload = useCallback(() => setRevision((value) => value + 1), []);
  useEffect(() => {
    const controller = new AbortController();
    void api("invoices/options", invoiceOptionsSchema, {
      signal: controller.signal,
    })
      .then((value) => {
        if (controller.signal.aborted) return;
        setOptions(value);
        setPeriodId((current) => current || value.periods[0]?.id || "");
      })
      .catch((e) => {
        if (!controller.signal.aborted)
          setError(e instanceof Error ? e.message : "โหลดรอบบิลไม่สำเร็จ");
      });
    return () => controller.abort();
  }, [revision]);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setRows([]);
    setSelectedId("");
    setDetail(null);
    const query = new URLSearchParams();
    if (periodId) query.set("billingPeriodId", periodId);
    if (roomId) query.set("roomId", roomId);
    if (leaseId) query.set("leaseId", leaseId);
    if (status) query.set("status", status);
    void api(`invoices?${query}`, z.array(invoiceDtoSchema), {
      signal: controller.signal,
    })
      .then((value) => {
        if (controller.signal.aborted) return;
        setRows(value);
        setError("");
      })
      .catch((e) => {
        if (!controller.signal.aborted)
          setError(e instanceof Error ? e.message : "โหลดใบแจ้งหนี้ไม่สำเร็จ");
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [periodId, roomId, leaseId, status, revision]);
  useEffect(() => {
    if (!selectedId) {
      setDetailLoading(false);
      setHistory([]);
      return;
    }
    const controller = new AbortController();
    setDetailLoading(true);
    setDetail(null);
    void Promise.all([
      api(`invoices/${selectedId}`, invoiceDtoSchema, {
        signal: controller.signal,
      }),
      api(`invoices/${selectedId}/history`, z.array(invoiceDtoSchema), {
        signal: controller.signal,
      }),
    ])
      .then(([invoice, chain]) => {
        if (controller.signal.aborted) return;
        setDetail(invoice);
        setHistory(chain);
      })
      .catch((e) => {
        if (!controller.signal.aborted)
          setError(e instanceof Error ? e.message : "โหลดรายละเอียดไม่สำเร็จ");
      })
      .finally(() => {
        if (!controller.signal.aborted) setDetailLoading(false);
      });
    return () => controller.abort();
  }, [selectedId]);
  const period = options?.periods.find((value) => value.id === periodId);
  const property = options?.properties.find(
    (value) => value.id === period?.propertyId,
  );
  const candidates = period?.candidates ?? [];
  const rooms = [
    ...new Map(candidates.map((value) => [value.roomId, value])).values(),
  ];
  async function execute(path: string, method: string, input: object) {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError("");
    setSuccess("");
    const signature = JSON.stringify({ path, method, input });
    const key =
      retry.current?.signature === signature
        ? retry.current.key
        : crypto.randomUUID();
    retry.current = { signature, key };
    try {
      await api(path, z.unknown(), {
        method,
        body: JSON.stringify({ ...input, commandKey: key }),
      });
      retry.current = null;
      setAction(null);
      setSuccess("บันทึกเรียบร้อยแล้ว กรุณาเลือกรายการเพื่อดูข้อมูลล่าสุด");
      reload();
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "บันทึกไม่สำเร็จ กรุณาลองอีกครั้ง",
      );
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  async function downloadInvoicePdf(invoice: InvoiceDto) {
    setDownloadingInvoiceId(invoice.id);
    setError("");
    try {
      const response = await fetch(
        `/api/v1/invoices/${encodeURIComponent(invoice.id)}/pdf`,
        { cache: "no-store" },
      );
      if (!response.ok) {
        if (response.status === 401) window.location.assign("/login/");
        const payload: unknown = await response.json().catch(() => null);
        const parsed = errorSchema.safeParse(payload);
        throw new Error(
          parsed.success
            ? `${parsed.data.error.message} (${parsed.data.error.code})`
            : "ดาวน์โหลดใบแจ้งหนี้ไม่สำเร็จ กรุณาลองอีกครั้ง",
        );
      }
      if (!response.headers.get("content-type")?.includes("application/pdf"))
        throw new Error("ระบบส่งไฟล์ PDF ไม่ถูกต้อง กรุณาลองอีกครั้ง");

      const disposition = response.headers.get("content-disposition") ?? "";
      const match = disposition.match(
        /filename="(Invoice_INV-\d{6}-\d{4}\.pdf)"/,
      );
      const filename = match?.[1] ?? `Invoice_${invoice.number}.pdf`;
      const url = URL.createObjectURL(await response.blob());
      const link = document.createElement("a");
      link.href = url;
      link.download = filename;
      link.hidden = true;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (e) {
      setError(e instanceof Error ? e.message : "ดาวน์โหลดใบแจ้งหนี้ไม่สำเร็จ");
    } finally {
      setDownloadingInvoiceId(null);
    }
  }
  return (
    <div className={styles.screen}>
      <Notice>
        ข้อมูลใบแจ้งหนี้จากระบบจริงในสภาพแวดล้อมนี้
        การใช้งานเรียกเก็บจริงยังรออนุมัติความพร้อมด้านข้อมูลและการปฏิบัติงาน
      </Notice>
      {error ? <ErrorMessage>{error}</ErrorMessage> : null}
      {success ? <SuccessMessage>{success}</SuccessMessage> : null}
      <Card
        title="ใบแจ้งหนี้"
        description="ตรวจสอบรอบบิล เตรียมฉบับร่าง และติดตามประวัติเอกสาร"
        action={
          <Button
            variant="secondary"
            disabled={busy || loading}
            onClick={reload}
          >
            โหลดข้อมูลใหม่
          </Button>
        }
      >
        <div className={styles.filters}>
          <Field label="รอบบิล">
            <select
              value={periodId}
              disabled={busy}
              onChange={(e) => {
                setPeriodId(e.target.value);
                setRoomId("");
                setLeaseId("");
              }}
            >
              <option value="">ทุกรอบ</option>
              {options?.periods.map((value) => (
                <option key={value.id} value={value.id}>
                  {periodLabel(value.startsOn)} ·{" "}
                  {
                    options.properties.find((p) => p.id === value.propertyId)
                      ?.name
                  }{" "}
                  · {value.status === "OPEN" ? "เปิด" : "ปิด"}
                </option>
              ))}
            </select>
          </Field>
          <Field label="ห้อง">
            <select
              value={roomId}
              disabled={busy || !period}
              onChange={(e) => {
                setRoomId(e.target.value);
                setLeaseId("");
              }}
            >
              <option value="">ทุกห้อง</option>
              {rooms.map((value) => (
                <option key={value.roomId} value={value.roomId}>
                  {value.room}
                </option>
              ))}
            </select>
          </Field>
          <Field label="สัญญา / ผู้เช่า">
            <select
              value={leaseId}
              disabled={busy || !period}
              onChange={(e) => setLeaseId(e.target.value)}
            >
              <option value="">ทุกสัญญา</option>
              {candidates
                .filter((value) => !roomId || value.roomId === roomId)
                .map((value) => (
                  <option key={value.leaseId} value={value.leaseId}>
                    {value.room} · {value.tenant}
                  </option>
                ))}
            </select>
          </Field>
          <Field label="สถานะ">
            <select
              value={status}
              disabled={busy}
              onChange={(e) => setStatus(e.target.value)}
            >
              <option value="">ทุกสถานะ</option>
              <option value="DRAFT">ฉบับร่าง</option>
              <option value="ISSUED">ออกแล้ว</option>
              <option value="VOID">ยกเลิก</option>
            </select>
          </Field>
        </div>
        {period ? (
          <div className={styles.period}>
            <div>
              <Badge tone={period.freezeId ? "green" : "amber"}>
                {period.freezeId
                  ? "มีชุดข้อมูลตรึงแล้ว"
                  : "ยังไม่มีชุดข้อมูลตรึง"}
              </Badge>
              <p className="text-small muted-text">
                {dateLabel(period.startsOn)} ถึง {dateLabel(period.endsOn)}
              </p>
            </div>
            <div className={styles.actions}>
              {admin && period.status === "OPEN" ? (
                <Button
                  variant="secondary"
                  disabled={busy}
                  onClick={() => setAction({ kind: "CLOSE", period })}
                >
                  ตรวจสอบและปิดรอบ
                </Button>
              ) : null}
              <Button
                disabled={
                  busy ||
                  period.status !== "CLOSED" ||
                  !period.freezeId ||
                  !candidates.length
                }
                onClick={() => setAction({ kind: "PREPARE", period })}
              >
                เตรียมฉบับร่าง
              </Button>
            </div>
          </div>
        ) : null}
        {period?.status === "CLOSED" && !period.freezeId ? (
          <Notice>
            รอบปิดเดิมไม่มีชุดข้อมูลตรึงที่ตรวจสอบแล้ว
            จึงยังเตรียมหรือออกใบแจ้งหนี้ไม่ได้
          </Notice>
        ) : null}
        {property ? (
          <div className={styles.policy}>
            <span>
              วันครบกำหนด ·{" "}
              {property.duePolicy
                ? `${property.duePolicy.offsetDays} วันหลังวันสิ้นรอบ · รุ่น ${property.duePolicy.version}`
                : "ยังไม่ได้กำหนดนโยบาย จึงยังออกใบแจ้งหนี้ไม่ได้"}
            </span>
            {admin ? (
              <Button
                variant="ghost"
                disabled={busy}
                onClick={() => setAction({ kind: "POLICY", property })}
              >
                ตั้งค่าวันครบกำหนด
              </Button>
            ) : null}
          </div>
        ) : null}
        {loading ? (
          <p role="status" className={styles.loading}>
            กำลังโหลดใบแจ้งหนี้…
          </p>
        ) : (
          <DataTable
            caption="รายการใบแจ้งหนี้"
            headers={[
              "เลขที่ / รอบ",
              "ห้อง / ผู้เช่า",
              "ครบกำหนด",
              "ยอดเรียกเก็บ",
              "สถานะ",
              "รายละเอียด",
            ]}
            empty={!rows.length}
          >
            {rows.map((invoice) => (
              <tr key={invoice.id}>
                <td>
                  <strong>{invoice.number ?? "ฉบับร่าง"}</strong>
                  <span className={styles.sub}>
                    {periodLabel(invoice.period)} · ฉบับ {invoice.revision}
                  </span>
                  {!invoice.managed ? (
                    <Badge tone="gray">ข้อมูลเดิม · อ่านอย่างเดียว</Badge>
                  ) : null}
                </td>
                <td>
                  {invoice.labels?.room ?? "ข้อมูลเดิม"}
                  <span className={styles.sub}>
                    {invoice.labels?.tenant ?? invoice.leaseId}
                  </span>
                </td>
                <td>{dateLabel(invoice.dueDate)}</td>
                <td className={styles.numeric}>{amount(invoice.finalTotal)}</td>
                <td>
                  <Status status={invoice.status} />
                </td>
                <td>
                  <Button
                    variant="ghost"
                    disabled={busy}
                    onClick={() => setSelectedId(invoice.id)}
                  >
                    ดูรายละเอียด
                  </Button>
                </td>
              </tr>
            ))}
          </DataTable>
        )}
      </Card>
      {detailLoading ? (
        <p role="status">กำลังโหลดรายละเอียด…</p>
      ) : detail ? (
        <InvoiceDetail
          invoice={detail}
          history={history}
          admin={admin}
          busy={busy}
          downloading={downloadingInvoiceId === detail.id}
          onDownload={() => void downloadInvoicePdf(detail)}
          onAction={setAction}
          onSelect={setSelectedId}
        />
      ) : (
        <Card>
          <EmptyState
            title="เลือกรายการเพื่อดูรายละเอียด"
            description="ดูแหล่งข้อมูล ยอดดิบ วันครบกำหนด และประวัติฉบับแก้ไข"
          />
        </Card>
      )}
      {action ? (
        <Modal
          open
          onOpenChange={(open) => {
            if (!open && !busy) setAction(null);
          }}
          title={titles[action.kind]}
          description="ตรวจสอบข้อมูลก่อนยืนยัน ระบบจะบันทึกผู้ดำเนินการและประวัติการเปลี่ยนแปลง"
          wide={action.kind === "REVISE"}
        >
          <ActionForm
            key={`${action.kind}-${"invoice" in action ? action.invoice.id : "period" in action ? action.period.id : action.property.id}`}
            action={action}
            rates={options?.rates ?? []}
            serverError={error}
            admin={admin}
            busy={busy}
            onExecute={execute}
            onCancel={() => setAction(null)}
          />
        </Modal>
      ) : null}
    </div>
  );
}

function InvoiceDetail({
  invoice,
  history,
  admin,
  busy,
  downloading,
  onDownload,
  onAction,
  onSelect,
}: {
  invoice: InvoiceDto;
  history: InvoiceDto[];
  admin: boolean;
  busy: boolean;
  downloading: boolean;
  onDownload: () => void;
  onAction: (action: Action) => void;
  onSelect: (id: string) => void;
}) {
  const snapshot = invoice.snapshot;
  return (
    <Card
      title={invoice.number ?? "รายละเอียดฉบับร่าง"}
      description={`${invoice.labels?.property ?? "ข้อมูลเดิม"} · ${invoice.labels?.room ?? ""} · ${invoice.labels?.tenant ?? ""}`}
      action={<Status status={invoice.status} />}
    >
      <div className={styles.detailGrid}>
        <dl className={styles.metadata}>
          <div>
            <dt>รอบบิล</dt>
            <dd>{periodLabel(invoice.period)}</dd>
          </div>
          <div>
            <dt>วันครบกำหนด</dt>
            <dd>{dateLabel(invoice.dueDate)}</dd>
          </div>
          <div>
            <dt>ที่มาวันครบกำหนด</dt>
            <dd>
              {invoice.dueProvenance?.kind === "POLICY"
                ? `นโยบายรุ่น ${invoice.dueProvenance.version} · ${invoice.dueProvenance.offsetDays} วันหลังสิ้นรอบ`
                : invoice.dueProvenance?.kind === "OVERRIDE"
                  ? `ADMIN กำหนดเฉพาะใบ · ${invoice.dueProvenance.reason}`
                  : "ยังไม่มีนโยบายหรือวันครบกำหนด"}
            </dd>
          </div>
          <div>
            <dt>หมายเหตุ</dt>
            <dd>{invoice.notes || "ไม่มี"}</dd>
          </div>
          <div>
            <dt>รุ่นข้อมูล</dt>
            <dd>{invoice.version}</dd>
          </div>
        </dl>
        <div className={styles.total}>
          <span>ยอดเรียกเก็บสุดท้าย</span>
          <strong>{amount(invoice.finalTotal)}</strong>
          <small>รวมยอดดิบทุกบรรทัด แล้วปัด HALF_UP สองตำแหน่งครั้งเดียว</small>
        </div>
      </div>
      {!invoice.managed ? (
        <Notice>
          เอกสารเดิมยังไม่มีข้อมูลอ้างอิงรอบและชุดข้อมูลตรึง
          ระบบเก็บรักษาให้อ่านอย่างเดียว
        </Notice>
      ) : null}
      {invoice.managed && !invoice.dueDate && invoice.status === "DRAFT" ? (
        <Notice>
          ยังออกใบแจ้งหนี้ไม่ได้ กรุณาให้ ADMIN กำหนดนโยบายวันครบกำหนด
          แล้วปรับปรุงฉบับร่าง หรือกำหนดเฉพาะใบพร้อมเหตุผล
        </Notice>
      ) : null}
      {snapshot ? (
        <>
          <DataTable
            caption="รายละเอียดการคำนวณใบแจ้งหนี้"
            headers={["รายการ", "ยอดดิบที่แน่นอน", "ยอดแสดงอ้างอิง"]}
          >
            {snapshot.lines.map((line) => (
              <tr key={line.kind}>
                <td>
                  {line.kind === "RENT"
                    ? "ค่าเช่าตามสัญญา"
                    : line.kind === "WATER"
                      ? "ค่าน้ำ"
                      : "ค่าไฟฟ้า"}
                </td>
                <td className={styles.fraction}>
                  <code>
                    {line.rawAmount.numerator} / {line.rawAmount.denominator}
                  </code>
                  <span className={styles.sub}>{line.rawAmount.decimal}</span>
                </td>
                <td className={styles.numeric}>{amount(line.displayAmount)}</td>
              </tr>
            ))}
          </DataTable>
          <dl className={styles.reconciliation}>
            <div>
              <dt>รวมยอดแสดงรายบรรทัด · ใช้อ้างอิง</dt>
              <dd>{amount(snapshot.totals.displayLineTotal)}</dd>
            </div>
            <div>
              <dt>ส่วนต่างการปัดเศษกับยอดเรียกเก็บ</dt>
              <dd>{amount(snapshot.totals.reconciliationDelta)}</dd>
            </div>
            <div>
              <dt>วันคิดค่าเช่า</dt>
              <dd>
                {snapshot.rentProration.occupiedDays} /{" "}
                {snapshot.rentProration.periodDays} วัน ·{" "}
                {dateLabel(snapshot.rentProration.occupiedStartsOn)} ถึง{" "}
                {dateLabel(snapshot.rentProration.occupiedEndsOn)}
              </dd>
            </div>
          </dl>
          <h3 className={styles.sectionTitle}>แหล่งข้อมูลที่บันทึกไว้</h3>
          <div className={styles.sources}>
            {snapshot.source.utilities.map((utility) => (
              <section key={utility.kind} className={styles.source}>
                <h4>{utility.kind === "WATER" ? "น้ำ" : "ไฟฟ้า"}</h4>
                <p>
                  {utility.consumption
                    ? sourceLabel(utility.consumption)
                    : "ไม่มีข้อมูล"}
                </p>
                <p className="text-small">
                  อัตรา {utility.rate?.value ?? "ไม่ระบุ"} บาทต่อหน่วย
                </p>
                {utility.consumption ? (
                  <details>
                    <summary>ดูปริมาณ เหตุผล และหลักฐาน</summary>
                    <pre>{JSON.stringify(utility.consumption, null, 2)}</pre>
                  </details>
                ) : null}
              </section>
            ))}
          </div>
          <details className={styles.fingerprint}>
            <summary>ลายนิ้วมือชุดข้อมูลและยอดดิบรวม</summary>
            <code>{invoice.fingerprint}</code>
            <p>
              {snapshot.totals.rawTotal.numerator} /{" "}
              {snapshot.totals.rawTotal.denominator}
            </p>
          </details>
        </>
      ) : null}
      {invoice.correction ? (
        <Notice>
          <strong>ฉบับแก้ไข</strong> · {invoice.correction.reason}
          <br />
          หลักฐาน: {invoice.correction.evidence.join(" · ")}
          <details>
            <summary>ความเปลี่ยนแปลงที่อนุมัติ</summary>
            <pre className={styles.json}>
              {JSON.stringify(invoice.correction.differences, null, 2)}
            </pre>
          </details>
        </Notice>
      ) : null}
      {invoice.voidReason ? (
        <p className={styles.voidReason}>
          เหตุผลยกเลิก: {invoice.voidReason} · {dateLabel(invoice.voidedAt)}
        </p>
      ) : null}
      {invoice.managed ? (
        <div className={styles.actions}>
          <Button
            variant="secondary"
            aria-label={`ดาวน์โหลดใบแจ้งหนี้ ${invoice.number ?? ""} เป็น PDF`}
            disabled={
              busy ||
              downloading ||
              invoice.status === "DRAFT" ||
              !invoice.number
            }
            onClick={onDownload}
          >
            {downloading ? "กำลังเตรียม PDF…" : "ดาวน์โหลด PDF"}
          </Button>
          {invoice.status === "DRAFT" ? (
            <span className={styles.downloadHint}>
              ดาวน์โหลดได้หลังออกใบแจ้งหนี้แล้ว
            </span>
          ) : null}
          {invoice.status === "DRAFT" ? (
            <>
              <Button
                variant="secondary"
                disabled={busy}
                onClick={() => onAction({ kind: "EDIT", invoice })}
              >
                แก้ไขหมายเหตุ{admin ? " / วันครบกำหนด" : ""}
              </Button>
              <Button
                variant="secondary"
                disabled={busy}
                onClick={() => onAction({ kind: "REFRESH", invoice })}
              >
                ปรับปรุงฉบับร่าง
              </Button>
              {admin ? (
                <Button
                  disabled={busy || !invoice.dueDate}
                  onClick={() => onAction({ kind: "ISSUE", invoice })}
                >
                  ออกใบแจ้งหนี้
                </Button>
              ) : null}
            </>
          ) : invoice.status === "ISSUED" && admin ? (
            <>
              <Button
                variant="secondary"
                disabled={busy || !!invoice.nextInvoiceId}
                onClick={() => onAction({ kind: "REVISE", invoice })}
              >
                ออกฉบับแก้ไข
              </Button>
              <Button
                variant="danger"
                disabled={busy}
                onClick={() => onAction({ kind: "VOID", invoice })}
              >
                ยกเลิกใบแจ้งหนี้
              </Button>
            </>
          ) : null}
        </div>
      ) : null}
      <h3 className={styles.sectionTitle}>ประวัติฉบับเอกสาร</h3>
      <ol className={styles.history}>
        {history.map((value) => (
          <li key={value.id}>
            <Button
              variant="ghost"
              disabled={busy || value.id === invoice.id}
              onClick={() => onSelect(value.id)}
            >
              {value.number ?? "ฉบับร่าง"} · ฉบับ {value.revision}
            </Button>
            <Status status={value.status} />
            <span>{amount(value.finalTotal)}</span>
          </li>
        ))}
      </ol>
    </Card>
  );
}

function ActionForm({
  action,
  rates,
  serverError,
  admin,
  busy,
  onExecute,
  onCancel,
}: {
  action: Action;
  rates: InvoiceOptions["rates"];
  serverError: string;
  admin: boolean;
  busy: boolean;
  onExecute: (path: string, method: string, input: object) => Promise<void>;
  onCancel: () => void;
}) {
  const invoice = "invoice" in action ? action.invoice : null;
  const [leaseId, setLeaseId] = useState(
    action.kind === "PREPARE"
      ? (action.period.candidates[0]?.leaseId ?? "")
      : "",
  );
  const [offset, setOffset] = useState(
    action.kind === "POLICY"
      ? (action.property.duePolicy?.offsetDays.toString() ?? "")
      : "",
  );
  const [notes, setNotes] = useState(invoice?.notes ?? "");
  const [dueMode, setDueMode] = useState<"KEEP" | "OVERRIDE" | "POLICY">(
    "KEEP",
  );
  const [dueDate, setDueDate] = useState(invoice?.dueDate ?? "");
  const [reason, setReason] = useState("");
  const [evidence, setEvidence] = useState("");
  const [currentContract, setCurrentContract] = useState(false);
  const [waterRate, setWaterRate] = useState("");
  const [electricRate, setElectricRate] = useState("");
  const [waterQty, setWaterQty] = useState("");
  const [electricQty, setElectricQty] = useState("");
  const [segmentQuantities, setSegmentQuantities] = useState<
    Record<string, string>
  >({});
  const [formError, setFormError] = useState("");
  const [preview, setPreview] = useState<z.infer<typeof previewSchema> | null>(
    null,
  );
  const [checking, setChecking] = useState(false);
  async function validatePeriod() {
    if (action.kind !== "CLOSE") return;
    setChecking(true);
    setFormError("");
    try {
      setPreview(
        await api(
          `billing/preview?billingPeriodId=${action.period.id}`,
          previewSchema,
        ),
      );
    } catch (e) {
      setFormError(e instanceof Error ? e.message : "ตรวจสอบไม่สำเร็จ");
    } finally {
      setChecking(false);
    }
  }
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError("");
    const base = invoice ? { expectedVersion: invoice.version } : {};
    const root = invoice ? `invoices/${invoice.id}` : "invoices";
    switch (action.kind) {
      case "PREPARE":
        return onExecute("invoices/drafts", "POST", {
          billingPeriodId: action.period.id,
          leaseId,
        });
      case "CLOSE":
        return onExecute(
          `billing-periods/${action.period.id}/close`,
          "POST",
          {},
        );
      case "POLICY":
        return onExecute("invoices/due-policy", "PUT", {
          propertyId: action.property.id,
          expectedVersion: action.property.duePolicy?.version ?? 0,
          offsetDays: Number(offset),
        });
      case "REFRESH":
        return onExecute(`${root}/refresh`, "POST", base);
      case "ISSUE":
        return onExecute(`${root}/issue`, "POST", base);
      case "VOID":
        return onExecute(`${root}/void`, "POST", {
          ...base,
          reason: reason.trim(),
        });
      case "EDIT":
        return onExecute(root, "PATCH", {
          ...base,
          notes,
          ...(admin && dueMode === "OVERRIDE"
            ? { dueOverride: { dueDate, reason: reason.trim() } }
            : admin && dueMode === "POLICY"
              ? { dueOverride: null }
              : {}),
        });
      case "REVISE": {
        const utilities = [
          {
            kind: "WATER",
            utilityRateId: waterRate.trim(),
            quantity: waterQty.trim(),
          },
          {
            kind: "ELECTRICITY",
            utilityRateId: electricRate.trim(),
            quantity: electricQty.trim(),
          },
        ]
          .map((value) => {
            const source = invoice?.snapshot?.source.utilities.find(
              (utility) => utility.kind === value.kind,
            )?.consumption;
            const segments =
              source?.kind === "REPLACEMENT"
                ? source.segments.flatMap((segment) => {
                    const quantity =
                      segmentQuantities[
                        `${value.kind}:${segment.meterId}`
                      ]?.trim();
                    return quantity
                      ? [{ meterId: segment.meterId, quantity }]
                      : [];
                  })
                : [];
            return {
              kind: value.kind,
              ...(value.utilityRateId
                ? { utilityRateId: value.utilityRateId }
                : {}),
              ...(value.quantity ? { quantity: value.quantity } : {}),
              ...(segments.length ? { segmentQuantities: segments } : {}),
            };
          })
          .filter(
            (value) =>
              "utilityRateId" in value ||
              "quantity" in value ||
              "segmentQuantities" in value,
          );
        if (!currentContract && !utilities.length) {
          setFormError(
            "เลือกข้อมูลสัญญาปัจจุบัน หรือระบุอัตรา/ปริมาณที่ต้องแก้ไข",
          );
          return;
        }
        return onExecute(`${root}/revise`, "POST", {
          ...base,
          reason: reason.trim(),
          evidence: evidence
            .split("\n")
            .map((value) => value.trim())
            .filter(Boolean),
          correction: { useCurrentContract: currentContract, utilities },
        });
      }
    }
  }
  const needsReason =
    action.kind === "VOID" ||
    action.kind === "REVISE" ||
    (action.kind === "EDIT" && dueMode === "OVERRIDE");
  return (
    <form className={styles.form} onSubmit={(event) => void submit(event)}>
      <fieldset disabled={busy} className={styles.formFields}>
        <ErrorMessage>{formError || serverError}</ErrorMessage>
        {action.kind === "PREPARE" ? (
          <Field label="สัญญาจากชุดข้อมูลตรึง">
            <select
              required
              value={leaseId}
              onChange={(e) => setLeaseId(e.target.value)}
            >
              {action.period.candidates.map((value) => (
                <option key={value.leaseId} value={value.leaseId}>
                  {value.room} · {value.tenant}
                </option>
              ))}
            </select>
          </Field>
        ) : null}
        {action.kind === "POLICY" ? (
          <>
            <Notice>
              เลือกจำนวนวันนับจากวันสิ้นรอบ
              ระบบจะไม่นำค่านี้ไปแก้ไขใบแจ้งหนี้ที่ออกแล้ว
              ฉบับร่างต้องกดปรับปรุงเพื่อรับนโยบายล่าสุด
            </Notice>
            <Field
              label="จำนวนวันหลังสิ้นรอบ"
              hint="ระบุ 0 ถึง 365 วัน โดย 0 หมายถึงครบกำหนดในวันสิ้นรอบ"
            >
              <input
                type="number"
                required
                min="0"
                max="365"
                step="1"
                value={offset}
                onChange={(e) => setOffset(e.target.value)}
              />
            </Field>
          </>
        ) : null}
        {action.kind === "CLOSE" ? (
          <>
            <Notice>
              ระบบตรวจสอบข้อมูลทุกสัญญา
              แล้วตรึงแหล่งข้อมูลและปิดรอบในรายการเดียว
              หลังปิดจะแก้ไขแหล่งข้อมูลในรอบนี้ไม่ได้
            </Notice>
            <Button
              disabled={busy || checking}
              variant="secondary"
              onClick={() => void validatePeriod()}
            >
              {checking ? "กำลังตรวจสอบ…" : "ตรวจสอบข้อมูลก่อนปิดรอบ"}
            </Button>
            {preview ? (
              <div role="status">
                <p>
                  {preview.complete
                    ? "ข้อมูลเรียกเก็บครบ ระบบจะตรวจสอบอีกครั้งเมื่อยืนยัน"
                    : "ยังมีข้อมูลต้องตรวจสอบ หรือไม่มีสัญญาที่เรียกเก็บได้"}
                </p>
                <ul>
                  {[
                    ...preview.issues,
                    ...preview.results.flatMap((value) => value.result.issues),
                  ].map((value, index) => (
                    <li key={`${value.code}-${index}`}>
                      {value.message} · {value.code}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </>
        ) : null}
        {invoice ? (
          <p>
            เอกสาร {invoice.number ?? "ฉบับร่าง"} · ยอด{" "}
            {amount(invoice.finalTotal)} · รุ่น {invoice.version}
          </p>
        ) : null}
        {action.kind === "ISSUE" ? (
          <Notice>
            ยืนยันออกเอกสารและจองเลขที่ใหม่ ยอดและวันครบกำหนดจะถูกเก็บถาวร
            ครบกำหนด {dateLabel(invoice?.dueDate ?? null)}
          </Notice>
        ) : null}
        {action.kind === "VOID" ? (
          <Notice>
            เอกสารและเลขที่จะคงอยู่ในประวัติ
            การยกเลิกไม่คืนปริมาณมิเตอร์เพื่อจัดสรรซ้ำ
          </Notice>
        ) : null}
        {action.kind === "REFRESH" ? (
          <Notice>
            ใช้แหล่งข้อมูลที่ตรึงไว้เดิม และรับนโยบายวันครบกำหนดล่าสุด
            โดยคงวันครบกำหนดที่ ADMIN ระบุเฉพาะใบ
          </Notice>
        ) : null}
        {action.kind === "EDIT" ? (
          <>
            <Field label="หมายเหตุ">
              <textarea
                maxLength={2000}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={3}
              />
            </Field>
            {admin ? (
              <>
                <Field label="วันครบกำหนด">
                  <select
                    value={dueMode}
                    onChange={(e) => {
                      const value = e.target.value;
                      if (
                        value === "KEEP" ||
                        value === "OVERRIDE" ||
                        value === "POLICY"
                      )
                        setDueMode(value);
                    }}
                  >
                    <option value="KEEP">คงค่าปัจจุบัน</option>
                    <option value="OVERRIDE">ADMIN กำหนดเฉพาะใบ</option>
                    <option value="POLICY">ใช้ค่าจากนโยบาย</option>
                  </select>
                </Field>
                {dueMode === "OVERRIDE" ? (
                  <Field label="วันที่ครบกำหนดเฉพาะใบ">
                    <input
                      required
                      type="date"
                      value={dueDate}
                      onChange={(e) => setDueDate(e.target.value)}
                    />
                  </Field>
                ) : null}
              </>
            ) : null}
          </>
        ) : null}
        {action.kind === "REVISE" ? (
          <>
            <Notice>
              ระบบอนุมัติข้อมูลแก้ไข ยกเลิกฉบับเดิม
              และออกฉบับใหม่พร้อมเลขที่ใหม่ในรายการเดียว
              การกระทบยอดประมาณการกับมิเตอร์จริงภายหลังต้องทำในรอบอนาคต
            </Notice>
            <label className={styles.checkbox}>
              <input
                type="checkbox"
                checked={currentContract}
                onChange={(e) => setCurrentContract(e.target.checked)}
              />
              ใช้ค่าเช่าและวันที่จากสัญญาปัจจุบันที่ตรวจสอบแล้ว
            </label>
            <div className={styles.correctionGrid}>
              {invoice?.snapshot?.source.utilities.map((utility) => {
                const water = utility.kind === "WATER";
                const label = water ? "น้ำ" : "ไฟฟ้า";
                const source = utility.consumption;
                const period = invoice.snapshot?.source.period;
                const eligibleRates = rates.filter(
                  (rate) =>
                    rate.propertyId === invoice.snapshot?.source.propertyId &&
                    rate.kind === utility.kind &&
                    period &&
                    rate.effectiveFrom <= period.endsOn &&
                    (!rate.nextEffectiveFrom ||
                      rate.nextEffectiveFrom > period.startsOn),
                );
                return (
                  <section className={styles.source} key={utility.kind}>
                    <h4>{label}</h4>
                    <Field
                      label={`อัตรา${label}ใหม่`}
                      hint="เลือกอัตราที่มีผลในรอบบิล หรือคงอัตราเดิม"
                    >
                      <select
                        value={water ? waterRate : electricRate}
                        onChange={(e) =>
                          (water ? setWaterRate : setElectricRate)(
                            e.target.value,
                          )
                        }
                      >
                        <option value="">
                          คงอัตราเดิม {utility.rate?.value} บาทต่อหน่วย
                        </option>
                        {eligibleRates.map((rate) => (
                          <option key={rate.id} value={rate.id}>
                            {rate.value} บาทต่อหน่วย · เริ่ม{" "}
                            {dateLabel(rate.effectiveFrom)}
                          </option>
                        ))}
                      </select>
                    </Field>
                    {source?.kind === "REPLACEMENT" ? (
                      source.segments.map((segment) => (
                        <Field
                          key={segment.meterId}
                          label={`ปริมาณช่วงมิเตอร์ ${segment.meterId}`}
                          hint={`เดิม ${segment.quantity} หน่วย · เว้นว่างเพื่อคงเดิม`}
                        >
                          <input
                            inputMode="decimal"
                            pattern="(0|[1-9][0-9]{0,10})([.][0-9]{1,3})?"
                            value={
                              segmentQuantities[
                                `${utility.kind}:${segment.meterId}`
                              ] ?? ""
                            }
                            onChange={(e) =>
                              setSegmentQuantities((current) => ({
                                ...current,
                                [`${utility.kind}:${segment.meterId}`]:
                                  e.target.value,
                              }))
                            }
                            placeholder="คงปริมาณเดิม"
                          />
                        </Field>
                      ))
                    ) : (
                      <Field
                        label={`ปริมาณ${label}ที่อนุมัติ`}
                        hint={
                          source
                            ? `เดิม ${source.quantity} หน่วย · เว้นว่างเพื่อคงเดิม`
                            : "ไม่มีแหล่งข้อมูล"
                        }
                      >
                        <input
                          inputMode="decimal"
                          pattern="(0|[1-9][0-9]{0,10})([.][0-9]{1,3})?"
                          value={water ? waterQty : electricQty}
                          onChange={(e) =>
                            (water ? setWaterQty : setElectricQty)(
                              e.target.value,
                            )
                          }
                          placeholder="คงปริมาณเดิม"
                        />
                      </Field>
                    )}
                  </section>
                );
              })}
            </div>
            <Field
              label="หลักฐานการแก้ไข"
              hint="หนึ่งรายการต่อบรรทัด ระบุเอกสารหรือข้อมูลที่ตรวจสอบย้อนกลับได้"
            >
              <textarea
                required
                maxLength={10000}
                rows={3}
                value={evidence}
                onChange={(e) => setEvidence(e.target.value)}
              />
            </Field>
          </>
        ) : null}
        {needsReason ? (
          <Field label="เหตุผล">
            <textarea
              required
              maxLength={1000}
              rows={3}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          </Field>
        ) : null}
        <div className={styles.actions}>
          <Button
            type="submit"
            disabled={
              busy ||
              checking ||
              (action.kind === "CLOSE" && !preview) ||
              (action.kind === "PREPARE" && !leaseId)
            }
            variant={action.kind === "VOID" ? "danger" : "primary"}
          >
            {busy
              ? "กำลังบันทึก…"
              : action.kind === "REVISE"
                ? "ยืนยันอนุมัติและออกฉบับใหม่"
                : "ยืนยัน"}
          </Button>
          <Button variant="secondary" disabled={busy} onClick={onCancel}>
            กลับ
          </Button>
        </div>
      </fieldset>
    </form>
  );
}
