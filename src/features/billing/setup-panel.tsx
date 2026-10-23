"use client";

import { useEffect, useMemo, useState, type FormEvent } from "react";
import { z } from "zod";
import type { InvoiceOptions } from "@/server/invoices/contracts";
import styles from "./setup-panel.module.css";

const periodResponseSchema = z.object({ id: z.string() });
const rateResponseSchema = z.object({ id: z.string() });
const selectionResponseSchema = z.object({ id: z.string() });
const selectionHistorySchema = z.array(
  z.object({
    id: z.string(),
    billingPeriodId: z.string(),
    kind: z.enum(["WATER", "ELECTRICITY"]),
    utilityRateId: z.string(),
    reason: z.string(),
    revision: z.number().int(),
    approvedAt: z.string(),
    approvedById: z.string(),
    rate: z.object({
      unitPrice: z.string(),
      effectiveFrom: z.string(),
      nextEffectiveFrom: z.string().nullable(),
    }),
  }),
);
const apiErrorSchema = z.object({
  error: z.object({ code: z.string(), message: z.string() }),
});
type SelectionHistory = z.infer<typeof selectionHistorySchema>;
type UtilityKind = "WATER" | "ELECTRICITY";

type Props = {
  admin: boolean;
  options: InvoiceOptions | null;
  periodId: string;
  onSelectPeriod: (periodId: string) => void;
  onRefresh: () => void;
};

async function request<T>(
  path: string,
  schema: z.ZodType<T>,
  init?: RequestInit,
): Promise<T> {
  const response = await fetch(`/api/v1/${path}`, {
    ...init,
    cache: "no-store",
    headers: init?.body ? { "Content-Type": "application/json" } : undefined,
  });
  const payload: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    if (response.status === 401) window.location.assign("/login/");
    const parsed = apiErrorSchema.safeParse(payload);
    throw new Error(
      parsed.success
        ? `${parsed.data.error.message} (${parsed.data.error.code})`
        : "ดำเนินการไม่สำเร็จ กรุณาลองอีกครั้ง",
    );
  }
  return z.object({ data: schema }).parse(payload).data;
}

function dateLabel(value: string) {
  return new Intl.DateTimeFormat("th-TH", {
    dateStyle: "medium",
    timeZone: "UTC",
  }).format(new Date(`${value.slice(0, 10)}T00:00:00.000Z`));
}

function monthLabel(value: string) {
  return new Intl.DateTimeFormat("th-TH", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${value.slice(0, 7)}-01T00:00:00.000Z`));
}

function rateLabel(value: string) {
  return `${value} บาท`;
}

function kindLabel(kind: UtilityKind) {
  return kind === "WATER" ? "น้ำประปา" : "ไฟฟ้า";
}

function unitLabel(kind: UtilityKind) {
  return kind === "WATER" ? "บาท / ลบ.ม." : "บาท / kWh";
}

export function BillingSetupPanel({
  admin,
  options,
  periodId,
  onSelectPeriod,
  onRefresh,
}: Props) {
  const period = options?.periods.find((value) => value.id === periodId);
  const property = options?.properties.find(
    (value) => value.id === period?.propertyId,
  );
  const [createPropertyId, setCreatePropertyId] = useState("");
  const [createMonth, setCreateMonth] = useState("");
  const [createRatePropertyId, setCreateRatePropertyId] = useState("");
  const [rateKind, setRateKind] = useState<UtilityKind>("WATER");
  const [effectiveFrom, setEffectiveFrom] = useState("");
  const [unitPrice, setUnitPrice] = useState("");
  const [rateForSelection, setRateForSelection] = useState<
    Record<UtilityKind, string>
  >({ WATER: "", ELECTRICITY: "" });
  const [selectionReason, setSelectionReason] = useState<
    Record<UtilityKind, string>
  >({ WATER: "", ELECTRICITY: "" });
  const [history, setHistory] = useState<SelectionHistory>([]);
  const [historyPeriodId, setHistoryPeriodId] = useState("");
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [noticeContext, setNotice] = useState<{
    periodId: string;
    message: string;
  } | null>(null);
  const notice =
    noticeContext?.periodId === periodId ? noticeContext.message : "";
  const [historyReload, setHistoryReload] = useState(0);
  const ratesPropertyId = period?.propertyId ?? createRatePropertyId;

  function describedBy(helpId: string) {
    return error ? `${helpId} billing-setup-error` : helpId;
  }

  useEffect(() => {
    const defaultPropertyId =
      period?.propertyId ?? options?.properties[0]?.id ?? "";
    setCreatePropertyId(defaultPropertyId);
    setCreateRatePropertyId(defaultPropertyId);
  }, [options, period?.propertyId]);

  useEffect(() => {
    setRateForSelection({ WATER: "", ELECTRICITY: "" });
    setSelectionReason({ WATER: "", ELECTRICITY: "" });
    setNotice((current) => (current?.periodId === periodId ? current : null));
    setError("");
  }, [periodId]);

  useEffect(() => {
    if (!periodId) {
      setHistory([]);
      setLoadingHistory(false);
      return;
    }
    const controller = new AbortController();
    setLoadingHistory(true);
    void request(
      `billing/rate-selections?billingPeriodId=${encodeURIComponent(periodId)}`,
      selectionHistorySchema,
      { signal: controller.signal },
    )
      .then((value) => {
        if (!controller.signal.aborted) {
          setHistory(value);
          setHistoryPeriodId(periodId);
        }
      })
      .catch((reason: unknown) => {
        if (!controller.signal.aborted) {
          setHistory([]);
          setHistoryPeriodId(periodId);
          setError(
            reason instanceof Error
              ? reason.message
              : "โหลดประวัติการเลือกอัตราไม่สำเร็จ",
          );
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoadingHistory(false);
      });
    return () => controller.abort();
  }, [periodId, historyReload, options]);

  const ratesByKind = useMemo(() => {
    const rows =
      options?.rates.filter((rate) => rate.propertyId === ratesPropertyId) ??
      [];
    return {
      WATER: rows
        .filter((rate) => rate.kind === "WATER")
        .toSorted((a, b) => a.effectiveFrom.localeCompare(b.effectiveFrom)),
      ELECTRICITY: rows
        .filter((rate) => rate.kind === "ELECTRICITY")
        .toSorted((a, b) => a.effectiveFrom.localeCompare(b.effectiveFrom)),
    };
  }, [options?.rates, ratesPropertyId]);

  const eligibleRates = useMemo(() => {
    if (!period) return { WATER: [], ELECTRICITY: [] };
    const overlapsPeriod = (rate: InvoiceOptions["rates"][number]) =>
      rate.effectiveFrom <= period.endsOn &&
      (rate.nextEffectiveFrom === null ||
        rate.nextEffectiveFrom > period.startsOn);
    return {
      WATER: ratesByKind.WATER.filter(overlapsPeriod),
      ELECTRICITY: ratesByKind.ELECTRICITY.filter(overlapsPeriod),
    };
  }, [period, ratesByKind]);

  const latestSelection = useMemo(() => {
    const latest = new Map<UtilityKind, SelectionHistory[number]>();
    for (const selection of history) {
      if (selection.billingPeriodId !== periodId) continue;
      const previous = latest.get(selection.kind);
      if (!previous || selection.revision > previous.revision)
        latest.set(selection.kind, selection);
    }
    return latest;
  }, [history, periodId]);

  async function submit(
    event: FormEvent<HTMLFormElement>,
    task: () => Promise<void>,
  ) {
    event.preventDefault();
    if (saving) return;
    setSaving(true);
    setError("");
    setNotice(null);
    try {
      await task();
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "บันทึกไม่สำเร็จ กรุณาตรวจสอบข้อมูล",
      );
    } finally {
      setSaving(false);
    }
  }

  async function createPeriod(event: FormEvent<HTMLFormElement>) {
    await submit(event, async () => {
      const created = await request("billing-periods", periodResponseSchema, {
        method: "POST",
        body: JSON.stringify({
          propertyId: createPropertyId,
          month: createMonth,
        }),
      });
      onSelectPeriod(created.id);
      onRefresh();
      setNotice({
        periodId: created.id,
        message: "สร้างรอบบิลแล้ว และเลือกรอบใหม่นี้ให้แล้ว",
      });
    });
  }

  async function createRate(event: FormEvent<HTMLFormElement>) {
    await submit(event, async () => {
      await request("utility-rates", rateResponseSchema, {
        method: "POST",
        body: JSON.stringify({
          propertyId: period?.propertyId ?? createRatePropertyId,
          kind: rateKind,
          effectiveFrom,
          unitPrice,
        }),
      });
      onRefresh();
      setNotice({
        periodId,
        message: `เพิ่มอัตรา${kindLabel(rateKind)}แล้ว ประวัติเดิมยังคงเดิม`,
      });
    });
  }

  async function saveSelection(
    event: FormEvent<HTMLFormElement>,
    kind: UtilityKind,
  ) {
    await submit(event, async () => {
      if (!periodId) throw new Error("กรุณาเลือกรอบบิลก่อนเลือกอัตรา");
      await request("billing/rate-selections", selectionResponseSchema, {
        method: "POST",
        body: JSON.stringify({
          billingPeriodId: periodId,
          kind,
          utilityRateId: rateForSelection[kind],
          reason: selectionReason[kind],
        }),
      });
      setHistoryReload((value) => value + 1);
      onRefresh();
      setNotice({
        periodId,
        message: `บันทึกอัตรา${kindLabel(kind)}สำหรับรอบนี้แล้ว`,
      });
    });
  }

  const historyPending =
    Boolean(periodId) && (loadingHistory || historyPeriodId !== periodId);

  const historyForKind = (kind: UtilityKind) =>
    history
      .filter(
        (selection) =>
          selection.billingPeriodId === periodId && selection.kind === kind,
      )
      .toSorted((a, b) => a.revision - b.revision);

  return (
    <section className={styles.panel} aria-labelledby="billing-setup-title">
      <header className={styles.header}>
        <div>
          <p className={styles.eyebrow}>ตั้งค่ารอบเรียกเก็บ</p>
          <h2 id="billing-setup-title">จัดการรอบบิลและอัตราสาธารณูปโภค</h2>
        </div>
        <p className={styles.workflow}>
          รอบบิล <span aria-hidden="true">→</span> อัตรา{" "}
          <span aria-hidden="true">→</span> มิเตอร์{" "}
          <span aria-hidden="true">→</span> ตรวจสอบ/ปิดรอบ{" "}
          <span aria-hidden="true">→</span> ใบแจ้งหนี้
        </p>
      </header>

      {error ? (
        <p className={styles.error} id="billing-setup-error" role="alert">
          {error}
        </p>
      ) : null}
      {notice ? (
        <p className={styles.success} role="status">
          {notice}
        </p>
      ) : null}

      <div className={styles.periodGrid}>
        <div className={styles.block}>
          <h3>เลือกรอบบิล</h3>
          <label className={styles.field} htmlFor="setup-period">
            รอบบิลที่มีอยู่
          </label>
          <select
            id="setup-period"
            value={periodId}
            onChange={(event) => onSelectPeriod(event.target.value)}
            aria-describedby={error ? "billing-setup-error" : undefined}
          >
            <option value="">เลือกรอบบิล</option>
            {options?.periods.map((value) => {
              const building = options.properties.find(
                (candidate) => candidate.id === value.propertyId,
              );
              return (
                <option key={value.id} value={value.id}>
                  {monthLabel(value.startsOn)} · {building?.name ?? "อาคาร"} ·{" "}
                  {value.status === "OPEN" ? "เปิด" : "ปิด"}
                </option>
              );
            })}
          </select>
          {period ? (
            <div className={styles.periodSummary}>
              <div>
                <span>อาคาร</span>
                <strong>{property?.name ?? "ไม่พบข้อมูลอาคาร"}</strong>
              </div>
              <div>
                <span>ช่วงวันที่</span>
                <strong>
                  {dateLabel(period.startsOn)} – {dateLabel(period.endsOn)}
                </strong>
              </div>
              <div>
                <span>สถานะ</span>
                <strong
                  className={
                    period.status === "OPEN"
                      ? styles.openStatus
                      : styles.closedStatus
                  }
                >
                  {period.status === "OPEN" ? "เปิดรอบ" : "ปิดรอบ"}
                </strong>
              </div>
            </div>
          ) : (
            <p className={styles.muted}>
              เลือกรอบเดิมเพื่อดูสถานะและอัตราที่บันทึกไว้
            </p>
          )}
        </div>

        {admin ? (
          <form className={styles.block} onSubmit={createPeriod}>
            <h3>สร้างรอบบิลรายเดือน</h3>
            <label className={styles.field} htmlFor="setup-create-property">
              อาคาร
            </label>
            <select
              id="setup-create-property"
              value={createPropertyId}
              onChange={(event) => setCreatePropertyId(event.target.value)}
              required
              disabled={!options?.properties.length || saving}
              aria-describedby={describedBy("setup-create-period-help")}
            >
              <option value="">เลือกอาคาร</option>
              {options?.properties.map((value) => (
                <option key={value.id} value={value.id}>
                  {value.name}
                </option>
              ))}
            </select>
            <label className={styles.field} htmlFor="setup-create-month">
              เดือนที่เรียกเก็บ
            </label>
            <input
              id="setup-create-month"
              type="month"
              value={createMonth}
              onChange={(event) => setCreateMonth(event.target.value)}
              required
              disabled={saving}
              aria-describedby={describedBy("setup-create-period-help")}
            />
            <p className={styles.help} id="setup-create-period-help">
              ระบบกำหนดวันเริ่มและสิ้นสุดตามเดือนปฏิทิน และปฏิเสธรอบซ้ำ
            </p>
            <button
              className={styles.primaryButton}
              type="submit"
              disabled={saving || !createPropertyId || !createMonth}
            >
              {saving ? "กำลังบันทึก…" : "สร้างและเลือกรอบบิล"}
            </button>
          </form>
        ) : null}
      </div>

      <div className={styles.ratesSection}>
        <div className={styles.sectionHeading}>
          <div>
            <h3>อัตราน้ำและไฟฟ้า</h3>
            <p>
              ประวัติอัตราเป็นข้อมูลอ่านอย่างเดียว
              การเปลี่ยนแปลงจะเพิ่มรายการใหม่
            </p>
          </div>
          {property ? (
            <span className={styles.propertyTag}>{property.name}</span>
          ) : null}
        </div>
        {!ratesPropertyId ? (
          <p className={styles.muted}>เลือกอาคารหรือรอบบิลเพื่อดูอัตรา</p>
        ) : (
          <div className={styles.rateGrid}>
            {(["WATER", "ELECTRICITY"] as const).map((kind) => (
              <section
                className={styles.rateCard}
                key={kind}
                aria-labelledby={`rate-title-${kind}`}
              >
                <h4 id={`rate-title-${kind}`}>{kindLabel(kind)}</h4>
                <p className={styles.unit}>{unitLabel(kind)}</p>
                {ratesByKind[kind].length ? (
                  <ol className={styles.rateHistory}>
                    {ratesByKind[kind].map((rate) => (
                      <li key={rate.id}>
                        <strong>{rateLabel(rate.value)}</strong>
                        <span>
                          เริ่ม {dateLabel(rate.effectiveFrom)}
                          {rate.nextEffectiveFrom
                            ? ` · ถึงก่อน ${dateLabel(rate.nextEffectiveFrom)}`
                            : " · ใช้อยู่จนกว่าจะมีอัตราใหม่"}
                        </span>
                      </li>
                    ))}
                  </ol>
                ) : (
                  <p className={styles.muted}>ยังไม่มีอัตราที่ตั้งค่าไว้</p>
                )}
              </section>
            ))}
          </div>
        )}

        {admin ? (
          <form className={styles.rateForm} onSubmit={createRate}>
            <h4>เพิ่มอัตราใหม่</h4>
            {!period ? (
              <>
                <label className={styles.field} htmlFor="setup-rate-property">
                  อาคารของอัตรา
                </label>
                <select
                  id="setup-rate-property"
                  value={createRatePropertyId}
                  onChange={(event) =>
                    setCreateRatePropertyId(event.target.value)
                  }
                  required
                  disabled={!options?.properties.length || saving}
                  aria-describedby={describedBy("setup-rate-help")}
                >
                  <option value="">เลือกอาคาร</option>
                  {options?.properties.map((value) => (
                    <option key={value.id} value={value.id}>
                      {value.name}
                    </option>
                  ))}
                </select>
              </>
            ) : (
              <p className={styles.help}>
                อัตรานี้จะเพิ่มให้กับ {property?.name ?? "อาคารของรอบ"}
              </p>
            )}
            <div className={styles.inlineFields}>
              <div>
                <label className={styles.field} htmlFor="setup-rate-kind">
                  ประเภท
                </label>
                <select
                  id="setup-rate-kind"
                  value={rateKind}
                  onChange={(event) => {
                    const value = event.target.value;
                    if (value === "WATER" || value === "ELECTRICITY")
                      setRateKind(value);
                  }}
                  disabled={saving}
                  aria-describedby={describedBy("setup-rate-help")}
                >
                  <option value="WATER">น้ำประปา</option>
                  <option value="ELECTRICITY">ไฟฟ้า</option>
                </select>
              </div>
              <div>
                <label className={styles.field} htmlFor="setup-rate-effective">
                  วันที่เริ่มใช้
                </label>
                <input
                  id="setup-rate-effective"
                  type="date"
                  value={effectiveFrom}
                  onChange={(event) => setEffectiveFrom(event.target.value)}
                  required
                  disabled={saving}
                  aria-describedby={describedBy("setup-rate-help")}
                />
              </div>
              <div>
                <label className={styles.field} htmlFor="setup-rate-price">
                  ราคา ({unitLabel(rateKind)})
                </label>
                <input
                  id="setup-rate-price"
                  type="number"
                  min="0"
                  max="9999999999"
                  step="0.0001"
                  inputMode="decimal"
                  value={unitPrice}
                  onChange={(event) => setUnitPrice(event.target.value)}
                  required
                  disabled={saving}
                  aria-describedby={describedBy("setup-rate-help")}
                />
              </div>
            </div>
            <p className={styles.help} id="setup-rate-help">
              ราคาเป็นบาทต่อหน่วย รองรับทศนิยมไม่เกิน 4 ตำแหน่ง
              วันที่มีผลซ้ำจะถูกปฏิเสธ
            </p>
            <button
              className={styles.secondaryButton}
              type="submit"
              disabled={
                saving ||
                (!period && !createRatePropertyId) ||
                !effectiveFrom ||
                !unitPrice
              }
            >
              {saving ? "กำลังบันทึก…" : "เพิ่มอัตรา"}
            </button>
          </form>
        ) : null}
      </div>

      <section
        className={styles.selectionSection}
        aria-labelledby="selection-title"
      >
        <div className={styles.sectionHeading}>
          <div>
            <h3 id="selection-title">อัตราที่เลือกใช้ในรอบนี้</h3>
            <p>
              การเลือกอัตราจะบันทึกเป็นประวัติและโหลดกลับมาได้เมื่อเปิดหน้านี้อีกครั้ง
            </p>
          </div>
          {historyPending ? <span role="status">กำลังโหลดประวัติ…</span> : null}
        </div>
        {!period ? (
          <p className={styles.muted}>เลือกรอบบิลเพื่อดูหรือกำหนดอัตราที่ใช้</p>
        ) : (
          <div className={styles.selectionGrid}>
            {(["WATER", "ELECTRICITY"] as const).map((kind) => {
              const selected = latestSelection.get(kind);
              return (
                <article className={styles.selectionCard} key={kind}>
                  <h4>{kindLabel(kind)}</h4>
                  {historyPending ? (
                    <p className={styles.muted}>
                      กำลังโหลดอัตราที่เลือกสำหรับรอบนี้…
                    </p>
                  ) : selected ? (
                    <div className={styles.selectedRate}>
                      <strong>
                        {rateLabel(selected.rate.unitPrice)} /{" "}
                        {kind === "WATER" ? "ลบ.ม." : "kWh"}
                      </strong>
                      <span>
                        เริ่มใช้ {dateLabel(selected.rate.effectiveFrom)}
                      </span>
                      <span>
                        อนุมัติครั้งที่ {selected.revision} ·{" "}
                        {dateLabel(selected.approvedAt)}
                      </span>
                      <span className={styles.reason}>
                        เหตุผล: {selected.reason}
                      </span>
                    </div>
                  ) : (
                    <p className={styles.muted}>
                      ยังไม่ได้เลือกอัตราสำหรับรอบนี้
                    </p>
                  )}
                  {admin && period.status === "OPEN" ? (
                    <form onSubmit={(event) => saveSelection(event, kind)}>
                      <label
                        className={styles.field}
                        htmlFor={`selection-rate-${kind}`}
                      >
                        เลือกอัตราที่มีผลทับซ้อนกับรอบนี้
                      </label>
                      <select
                        id={`selection-rate-${kind}`}
                        value={rateForSelection[kind]}
                        onChange={(event) =>
                          setRateForSelection((current) => ({
                            ...current,
                            [kind]: event.target.value,
                          }))
                        }
                        required
                        disabled={saving || eligibleRates[kind].length === 0}
                        aria-describedby={describedBy(`selection-help-${kind}`)}
                      >
                        <option value="">เลือกอัตรา</option>
                        {eligibleRates[kind].map((rate) => (
                          <option key={rate.id} value={rate.id}>
                            {rateLabel(rate.value)} · เริ่ม{" "}
                            {dateLabel(rate.effectiveFrom)}
                          </option>
                        ))}
                      </select>
                      <label
                        className={styles.field}
                        htmlFor={`selection-reason-${kind}`}
                      >
                        เหตุผลในการเลือกอัตรา
                      </label>
                      <textarea
                        id={`selection-reason-${kind}`}
                        value={selectionReason[kind]}
                        onChange={(event) =>
                          setSelectionReason((current) => ({
                            ...current,
                            [kind]: event.target.value,
                          }))
                        }
                        required
                        maxLength={1000}
                        rows={2}
                        disabled={saving}
                        aria-describedby={describedBy(`selection-help-${kind}`)}
                      />
                      <p className={styles.help} id={`selection-help-${kind}`}>
                        {eligibleRates[kind].length
                          ? "เลือกรายการที่ครอบคลุมวันใดวันหนึ่งในรอบบิล"
                          : "ไม่มีอัตราที่มีผลในรอบนี้ กรุณาเพิ่มอัตราที่มีผลก่อนหรือระหว่างรอบ"}
                      </p>
                      <button
                        className={styles.secondaryButton}
                        type="submit"
                        disabled={
                          saving ||
                          !rateForSelection[kind] ||
                          !selectionReason[kind].trim() ||
                          eligibleRates[kind].length === 0
                        }
                      >
                        {saving ? "กำลังบันทึก…" : "บันทึกการเลือก"}
                      </button>
                    </form>
                  ) : (
                    <p className={styles.readOnly}>
                      {period.status === "CLOSED"
                        ? "รอบปิดแล้ว · การเลือกอัตราเป็นแบบอ่านอย่างเดียว"
                        : "การจัดการอัตราสำหรับ ADMIN เท่านั้น"}
                    </p>
                  )}
                  {historyForKind(kind).length > 1 ? (
                    <details className={styles.historyDetails}>
                      <summary>
                        ดูประวัติการเลือก ({historyForKind(kind).length} รายการ)
                      </summary>
                      <ol>
                        {historyForKind(kind).map((entry) => (
                          <li key={entry.id}>
                            ครั้งที่ {entry.revision}:{" "}
                            {rateLabel(entry.rate.unitPrice)} ·{" "}
                            {dateLabel(entry.approvedAt)} · {entry.reason}
                          </li>
                        ))}
                      </ol>
                    </details>
                  ) : null}
                </article>
              );
            })}
          </div>
        )}
      </section>
    </section>
  );
}
