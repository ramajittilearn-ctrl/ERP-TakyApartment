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
import { leaseSchema } from "@/features/live/contracts";
import { invoiceDtoSchema } from "@/server/invoices/contracts";
import {
  cancelPaymentInput,
  confirmPaymentInput,
  createPaymentInput,
  paymentDtoSchema,
  receiptDtoSchema,
  type BalanceDto,
  type PaymentDto,
  type ReceiptDto,
} from "@/server/payments/contracts";
import {
  balancePageSchema,
  paymentPageSchema,
  PaymentApiError,
  paymentRequest,
} from "./client";
import {
  amountLabel,
  bangkokNow,
  bangkokTimestamp,
  canonicalAmount,
  minorText,
  minorUnits,
  timeLabel,
} from "./form";
import {
  bindActor,
  clearJournal,
  dismissSettled,
  journalSnapshot,
  submitAttempt,
  subscribeJournal,
  type Attempt,
} from "./journal";
import { methodLabels, ReceiptView } from "./receipt";
import { CommandRecovery } from "./recovery";
import styles from "./screen.module.css";

type Lease = z.infer<typeof leaseSchema>;
type Allocation = {
  balance: BalanceDto;
  version: number | null;
  amount: string;
};
type Action =
  | { kind: "create" }
  | { kind: "confirm"; payment: PaymentDto }
  | { kind: "cancel" | "reverse"; payment: PaymentDto };
const statusLabels = {
  PENDING: "รอตรวจสอบ",
  CONFIRMED: "ยืนยันแล้ว",
  CANCELLED: "ยกเลิกรายการ",
  REVERSED: "กลับรายการแล้ว",
};
const titles = {
  create: "บันทึกรับชำระรอตรวจสอบ",
  confirm: "ยืนยันและออกใบเสร็จ",
  cancel: "ยกเลิกรายการรอตรวจสอบ",
  reverse: "กลับรายการและยกเลิกใบเสร็จ",
};
const reviewCodes = new Set([
  "STALE_VERSION",
  "PAYMENT_STATE",
  "ALLOCATION_EXCEEDS_BALANCE",
  "INVOICE_NOT_PAYABLE",
]);
const emptyDraft = {
  leaseId: "",
  amount: "",
  method: "CASH",
  receivedAt: "",
  externalReference: "",
  receivingAccountKey: "",
};
function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "ไม่สามารถติดต่อระบบได้";
}

export function PaymentsScreen({
  actorId,
  admin,
}: {
  actorId: string;
  admin: boolean;
}) {
  const [leases, setLeases] = useState<Lease[]>([]);
  const [leaseError, setLeaseError] = useState("");
  const [rows, setRows] = useState<PaymentDto[]>([]);
  const [filterLease, setFilterLease] = useState("");
  const [status, setStatus] = useState("");
  const [offset, setOffset] = useState(0);
  const [revision, setRevision] = useState(0);
  const [loading, setLoading] = useState(true);
  const [listError, setListError] = useState("");
  const [selectedId, setSelectedId] = useState("");
  const [detail, setDetail] = useState<PaymentDto | null>(null);
  const [receipt, setReceipt] = useState<ReceiptDto | null>(null);
  const [detailError, setDetailError] = useState("");
  const [detailLoading, setDetailLoading] = useState(false);
  const [action, setAction] = useState<Action | null>(null);
  const [draft, setDraft] = useState(emptyDraft);
  const [balances, setBalances] = useState<BalanceDto[]>([]);
  const [allocations, setAllocations] = useState<Allocation[]>([]);
  const [reason, setReason] = useState("");
  const [overrideReason, setOverrideReason] = useState("");
  const [duplicateReview, setDuplicateReview] = useState(false);
  const [mustRefresh, setMustRefresh] = useState(false);
  const [reviewed, setReviewed] = useState(false);
  const [readBusy, setReadBusy] = useState(false);
  const [formError, setFormError] = useState("");
  const [success, setSuccess] = useState("");
  const [permissionDenied, setPermissionDenied] = useState(false);
  const [attempt, setAttempt] = useState<Attempt | null>(null);
  const formGeneration = useRef(0);
  const invoiceReads = useRef(new Map<string, number>());
  const handled = useRef<Attempt | null>(null);
  const canAdmin = admin && !permissionDenied;
  const blocked =
    attempt?.state === "submitting" ||
    attempt?.state === "uncertain" ||
    (attempt?.state === "rejected" && attempt.code === "IDEMPOTENCY_CONFLICT");
  const reload = useCallback(() => setRevision((value) => value + 1), []);
  const readError = useCallback((error: unknown) => {
    if (error instanceof PaymentApiError && error.status === 401) {
      clearJournal();
      window.location.assign("/login/?payment-reconcile=1");
    }
    return errorMessage(error);
  }, []);

  useEffect(() => {
    bindActor(actorId);
    const update = () => setAttempt(journalSnapshot(actorId));
    const unsubscribe = subscribeJournal(update);
    update();
    return unsubscribe;
  }, [actorId]);
  useEffect(() => {
    if (!attempt || handled.current === attempt) return;
    handled.current = attempt;
    if (attempt.state === "success") {
      setSuccess("บันทึกผลแล้ว กำลังอ่านข้อมูลปัจจุบันจากระบบ");
      formGeneration.current++;
      setAction(null);
      setSelectedId(attempt.result.id);
      reload();
      dismissSettled(actorId);
    } else if (attempt.state === "rejected") {
      setFormError(`${attempt.message} (${attempt.code})`);
      if (attempt.code === "CASH_DUPLICATE_REVIEW_REQUIRED")
        setDuplicateReview(true);
      if (reviewCodes.has(attempt.code)) {
        setMustRefresh(true);
        reload();
      }
      if (attempt.code === "FORBIDDEN") {
        setPermissionDenied(true);
        reload();
      }
    }
  }, [attempt, actorId, reload]);
  useEffect(() => {
    const controller = new AbortController();
    void paymentRequest({
      path: "leases",
      schema: z.array(leaseSchema),
      signal: controller.signal,
    })
      .then((values) => {
        if (!controller.signal.aborted) {
          setLeases(
            values.filter((value) => !value.isDemo && !value.tenant.isDemo),
          );
          setLeaseError("");
        }
      })
      .catch((error) => {
        if (!controller.signal.aborted) setLeaseError(readError(error));
      });
    return () => controller.abort();
  }, [readError, revision]);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setListError("");
    const query = new URLSearchParams({ offset: String(offset), limit: "50" });
    if (status) query.set("status", status);
    if (filterLease) query.set("leaseId", filterLease);
    void paymentRequest({
      path: `payments?${query}`,
      schema: paymentPageSchema,
      signal: controller.signal,
    })
      .then((page) => {
        if (!controller.signal.aborted) setRows(page.items);
      })
      .catch((error) => {
        if (!controller.signal.aborted) setListError(readError(error));
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [offset, status, filterLease, revision, readError]);
  useEffect(() => {
    const controller = new AbortController();
    setDetail(null);
    setReceipt(null);
    setDetailError("");
    if (!selectedId) return () => controller.abort();
    setDetailLoading(true);
    void (async () => {
      const value = await paymentRequest({
        path: `payments/${selectedId}`,
        schema: paymentDtoSchema,
        signal: controller.signal,
      });
      if (controller.signal.aborted) return;
      setDetail(value);
      if (value.receipt) {
        const saved = await paymentRequest({
          path: `receipts/${value.receipt.id}`,
          schema: receiptDtoSchema,
          signal: controller.signal,
        });
        if (!controller.signal.aborted) setReceipt(saved);
      }
    })()
      .catch((error) => {
        if (!controller.signal.aborted) setDetailError(readError(error));
      })
      .finally(() => {
        if (!controller.signal.aborted) setDetailLoading(false);
      });
    return () => controller.abort();
  }, [selectedId, revision, readError]);
  useEffect(
    () => () => {
      formGeneration.current++;
    },
    [],
  );

  function closeForm() {
    formGeneration.current++;
    setAction(null);
    setReadBusy(false);
  }
  function begin(next: Action) {
    if (blocked) return;
    formGeneration.current++;
    setAction(next);
    setFormError("");
    setReason("");
    setOverrideReason("");
    setReviewed(false);
    setMustRefresh(false);
    setDuplicateReview(false);
    setBalances([]);
    setAllocations([]);
    dismissSettled(actorId);
    if (next.kind === "create")
      setDraft({
        ...emptyDraft,
        leaseId: leases[0]?.id || "",
        receivedAt: bangkokNow(new Date()),
      });
    if (next.kind === "confirm") {
      setReadBusy(true);
      const generation = formGeneration.current;
      void (async () => {
        const all: BalanceDto[] = [];
        for (let skip = 0; skip <= 100000; skip += 100) {
          const page = await paymentRequest({
            path: `outstanding-balances?leaseId=${next.payment.leaseId}&offset=${skip}&limit=100`,
            schema: balancePageSchema,
          });
          all.push(...page.items);
          if (page.items.length < 100) {
            if (generation === formGeneration.current)
              setBalances(
                all.filter(
                  (item) =>
                    item.status === "ISSUED" &&
                    minorUnits(item.outstanding) > 0n,
                ),
              );
            return;
          }
        }
        throw new Error(
          "ประวัติเกินขอบเขตการอ่าน กรุณาติดต่อผู้ดูแล ไม่สามารถใช้ข้อมูลบางส่วนเพื่อยืนยันได้",
        );
      })()
        .catch((error) => {
          if (generation === formGeneration.current) {
            setFormError(readError(error));
            setMustRefresh(true);
          }
        })
        .finally(() => {
          if (generation === formGeneration.current) setReadBusy(false);
        });
    }
  }
  async function toggleInvoice(balance: BalanceDto, checked: boolean) {
    setReviewed(false);
    const token = (invoiceReads.current.get(balance.invoiceId) ?? 0) + 1;
    invoiceReads.current.set(balance.invoiceId, token);
    if (!checked) {
      setAllocations((current) =>
        current.filter((item) => item.balance.invoiceId !== balance.invoiceId),
      );
      return;
    }
    if (allocations.length >= 100) {
      setFormError("เลือกได้ไม่เกิน 100 ใบแจ้งหนี้");
      return;
    }
    const generation = formGeneration.current;
    setAllocations((current) => [
      ...current,
      { balance, version: null, amount: "" },
    ]);
    try {
      const invoice = await paymentRequest({
        path: `invoices/${balance.invoiceId}`,
        schema: invoiceDtoSchema,
      });
      if (
        generation !== formGeneration.current ||
        invoiceReads.current.get(balance.invoiceId) !== token
      )
        return;
      if (
        !invoice.managed ||
        invoice.status !== "ISSUED" ||
        invoice.leaseId !== balance.leaseId ||
        invoice.finalTotal !== balance.finalTotal ||
        !invoice.labels
      )
        throw new Error("ใบแจ้งหนี้เปลี่ยนแปลง กรุณาปิดและเปิดตรวจสอบใหม่");
      setAllocations((current) =>
        current.map((item) =>
          item.balance.invoiceId === balance.invoiceId
            ? { ...item, version: invoice.version }
            : item,
        ),
      );
    } catch (error) {
      if (
        generation === formGeneration.current &&
        invoiceReads.current.get(balance.invoiceId) === token
      ) {
        setFormError(readError(error));
        setAllocations((current) =>
          current.filter(
            (item) => item.balance.invoiceId !== balance.invoiceId,
          ),
        );
      }
    }
  }
  function command(key: string): {
    path: string;
    body: object;
    operation: Attempt["operation"];
  } {
    if (!action) throw new Error("กรุณาเลือกรายการ");
    if (action.kind === "create") {
      const input = createPaymentInput.parse({
        leaseId: draft.leaseId,
        amount: canonicalAmount(draft.amount),
        method: draft.method,
        receivedAt: bangkokTimestamp(draft.receivedAt),
        commandKey: key,
        ...(draft.method === "BANK_TRANSFER"
          ? {
              externalReference: draft.externalReference.trim(),
              receivingAccountKey: draft.receivingAccountKey.trim(),
            }
          : {}),
      });
      return { path: "payments", body: input, operation: "create" };
    }
    if (action.kind === "confirm") {
      const values = allocations.map((item) => {
        if (item.version === null)
          throw new Error("รออ่านรุ่นของใบแจ้งหนี้ให้ครบ");
        const amount = canonicalAmount(item.amount);
        if (minorUnits(amount) > minorUnits(item.balance.outstanding))
          throw new Error("ยอดจัดสรรเกินยอดค้างของใบแจ้งหนี้");
        return {
          invoiceId: item.balance.invoiceId,
          expectedVersion: item.version,
          amount,
        };
      });
      if (
        values.reduce((total, item) => total + minorUnits(item.amount), 0n) !==
        minorUnits(action.payment.amount)
      )
        throw new Error("ยอดจัดสรรต้องเท่ากับยอดรับชำระทั้งหมด");
      if (duplicateReview && !overrideReason.trim())
        throw new Error("ระบุเหตุผลอนุมัติรายการเงินสดที่อาจซ้ำ");
      const input = confirmPaymentInput.parse({
        paymentId: action.payment.id,
        expectedVersion: action.payment.version,
        commandKey: key,
        allocations: values,
        ...(duplicateReview
          ? { duplicateOverrideReason: overrideReason.trim() }
          : {}),
      });
      const { paymentId, ...body } = input;
      return {
        path: `payments/${paymentId}/confirm`,
        body,
        operation: "confirm",
      };
    }
    const input = cancelPaymentInput.parse({
      paymentId: action.payment.id,
      expectedVersion: action.payment.version,
      reason: reason.trim(),
      commandKey: key,
    });
    const { paymentId, ...body } = input;
    return {
      path: `payments/${paymentId}/${action.kind}`,
      body,
      operation: action.kind,
    };
  }
  function submit(event: FormEvent) {
    event.preventDefault();
    if (
      blocked ||
      mustRefresh ||
      readBusy ||
      (action?.kind !== "create" && !canAdmin)
    )
      return;
    try {
      const key = crypto.randomUUID();
      const value = command(key);
      if (!reviewed) {
        setReviewed(true);
        setFormError("");
        return;
      }
      submitAttempt({ actorId, key, ...value });
    } catch (error) {
      setFormError(
        error instanceof z.ZodError
          ? "ข้อมูลไม่ครบหรือไม่ถูกต้อง กรุณาตรวจสอบช่องกรอกทั้งหมด"
          : errorMessage(error),
      );
    }
  }
  const allocationTotal = allocations.reduce((total, item) => {
    try {
      return total + minorUnits(canonicalAmount(item.amount));
    } catch {
      return total;
    }
  }, 0n);
  const leaseLabel = (lease: Lease) =>
    `${lease.number} · ห้อง ${lease.room.number} · ${lease.tenant.name}`;

  return (
    <>
      {success && <SuccessMessage>{success}</SuccessMessage>}
      {!action && <CommandRecovery attempt={attempt} actorId={actorId} />}
      <Notice>
        ข้อมูลรับชำระจากฐานข้อมูล เฉพาะรายการที่ระบบจัดการ
        ไม่รวมรายการสาธิตและข้อมูลเดิมที่ยังไม่ได้จับคู่
        รายการรอตรวจสอบไม่ใช่รายรับยืนยันและยังไม่มีใบเสร็จ
      </Notice>
      <div className="screen-toolbar">
        <p>บันทึกรับชำระและตรวจสอบการจัดสรรใบแจ้งหนี้</p>
        <Button
          disabled={blocked || !!leaseError || leases.length === 0}
          onClick={() => begin({ kind: "create" })}
        >
          บันทึกรับชำระ
        </Button>
      </div>
      <ErrorMessage>
        {leaseError && `ไม่สามารถอ่านสัญญา: ${leaseError}`}
      </ErrorMessage>
      <Card
        title="รายการรับชำระ"
        action={
          <Button variant="secondary" onClick={reload}>
            อ่านข้อมูลล่าสุด
          </Button>
        }
      >
        <div className={styles.filters}>
          <Field label="สถานะรายการ">
            <select
              value={status}
              onChange={(event) => {
                setStatus(event.target.value);
                setOffset(0);
              }}
            >
              <option value="">ทุกสถานะ</option>
              {Object.entries(statusLabels).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </Field>
          <Field label="สัญญาเช่า (ข้อมูลปัจจุบัน)">
            <select
              value={filterLease}
              onChange={(event) => {
                setFilterLease(event.target.value);
                setOffset(0);
              }}
            >
              <option value="">ทุกสัญญา</option>
              {leases.map((lease) => (
                <option key={lease.id} value={lease.id}>
                  {leaseLabel(lease)}
                </option>
              ))}
            </select>
          </Field>
        </div>
        <div aria-busy={loading}>
          <ErrorMessage>{listError}</ErrorMessage>
          {loading ? (
            <p role="status">กำลังอ่านรายการรับชำระ…</p>
          ) : listError ? null : rows.length === 0 ? (
            <EmptyState
              title="ไม่มีรายการรับชำระในหน้านี้"
              description="เลือกสถานะหรือสัญญาอื่น หรือกลับหน้าก่อนหน้า"
            />
          ) : (
            <div
              className={styles.table}
              role="region"
              aria-label="ตารางรายการรับชำระ"
              tabIndex={0}
            >
              <DataTable
                caption="รายการรับชำระที่บันทึกในระบบ"
                headers={[
                  "รับชำระ (กรุงเทพฯ)",
                  "เลขอ้างอิง / สัญญา",
                  "จำนวนเงิน",
                  "วิธีชำระ",
                  "สถานะ",
                  "ใบเสร็จ",
                  "รายการ",
                ]}
              >
                {rows.map((row) => (
                  <tr key={row.id}>
                    <td>{timeLabel(row.receivedAt)}</td>
                    <td>
                      {row.reference}
                      <br />
                      <small>
                        {leases.find((lease) => lease.id === row.leaseId)
                          ?.number || row.leaseId}
                      </small>
                    </td>
                    <td className={styles.amount}>{amountLabel(row.amount)}</td>
                    <td>{methodLabels[row.method]}</td>
                    <td>
                      <Badge
                        tone={
                          row.status === "CONFIRMED"
                            ? "green"
                            : row.status === "PENDING"
                              ? "amber"
                              : "gray"
                        }
                      >
                        {statusLabels[row.status]}
                      </Badge>
                    </td>
                    <td>{row.receipt?.number || "ยังไม่มี"}</td>
                    <td>
                      <Button
                        variant="ghost"
                        onClick={() => setSelectedId(row.id)}
                        aria-label={`ดูรายการ ${row.reference}`}
                      >
                        ดูรายการ
                      </Button>
                    </td>
                  </tr>
                ))}
              </DataTable>
            </div>
          )}
        </div>
        <div className={styles.actions}>
          <Button
            variant="secondary"
            disabled={loading || offset === 0}
            onClick={() => setOffset((value) => Math.max(0, value - 50))}
          >
            หน้าก่อน
          </Button>
          <span>
            เริ่มรายการที่ {offset + 1} · หน้านี้ {loading ? "…" : rows.length}{" "}
            รายการ
          </span>
          <Button
            variant="secondary"
            disabled={loading || rows.length < 50 || offset >= 100000}
            onClick={() => setOffset((value) => value + 50)}
          >
            หน้าถัดไป
          </Button>
        </div>
      </Card>
      {selectedId && (
        <Card
          title="รายละเอียดรับชำระ"
          action={
            <Button variant="ghost" onClick={() => setSelectedId("")}>
              ปิดรายละเอียด
            </Button>
          }
        >
          {detailLoading && <p role="status">กำลังอ่านรายละเอียด…</p>}
          <ErrorMessage>{detailError}</ErrorMessage>
          {detail && (
            <>
              <h3>
                {detail.reference} · {statusLabels[detail.status]}
              </h3>
              <dl className="detail-grid">
                <div>
                  <dt>ยอดรับชำระ</dt>
                  <dd>{amountLabel(detail.amount)}</dd>
                </div>
                <div>
                  <dt>วิธีชำระ</dt>
                  <dd>{methodLabels[detail.method]}</dd>
                </div>
                <div>
                  <dt>เวลารับชำระ (กรุงเทพฯ)</dt>
                  <dd>{timeLabel(detail.receivedAt)}</dd>
                </div>
                <div>
                  <dt>เวลาบันทึก (กรุงเทพฯ)</dt>
                  <dd>{timeLabel(detail.createdAt)}</dd>
                </div>
                <div>
                  <dt>สัญญา</dt>
                  <dd>
                    {leases.find((lease) => lease.id === detail.leaseId)
                      ?.number || detail.leaseId}
                  </dd>
                </div>
                <div>
                  <dt>ผู้บันทึก</dt>
                  <dd>{detail.recordedById}</dd>
                </div>
                {detail.externalReference && (
                  <div>
                    <dt>เลขอ้างอิงธนาคาร</dt>
                    <dd>{detail.externalReference}</dd>
                  </div>
                )}
                {detail.receivingAccountKey && (
                  <div>
                    <dt>บัญชีรับเงิน</dt>
                    <dd>{detail.receivingAccountKey}</dd>
                  </div>
                )}
                {detail.confirmedAt && (
                  <div>
                    <dt>ยืนยัน (กรุงเทพฯ)</dt>
                    <dd>
                      {timeLabel(detail.confirmedAt)} · {detail.confirmedById}
                    </dd>
                  </div>
                )}
                {detail.cancelledAt && (
                  <div>
                    <dt>ยกเลิก (กรุงเทพฯ)</dt>
                    <dd>
                      {timeLabel(detail.cancelledAt)} · {detail.cancelledById} ·{" "}
                      {detail.cancelReason}
                    </dd>
                  </div>
                )}
              </dl>
              {detail.status === "PENDING" && (
                <p>รอผู้ดูแลตรวจสอบ ยังไม่ตัดยอดใบแจ้งหนี้และยังไม่มีใบเสร็จ</p>
              )}
              {detail.reversal && (
                <p>
                  กลับรายการ {timeLabel(detail.reversal.createdAt)} ·{" "}
                  {detail.reversal.actorId} · {detail.reversal.reason}
                </p>
              )}
              {detail.allocations.length > 0 && (
                <p>
                  เก็บประวัติการจัดสรร {detail.allocations.length}{" "}
                  ใบแจ้งหนี้ตามข้อมูลใบเสร็จด้านล่าง
                </p>
              )}
              {canAdmin && !detailLoading && (
                <div className={styles.actions}>
                  {detail.status === "PENDING" && (
                    <>
                      <Button
                        disabled={blocked}
                        onClick={() =>
                          begin({ kind: "confirm", payment: detail })
                        }
                      >
                        ตรวจสอบและยืนยัน
                      </Button>
                      <Button
                        variant="danger"
                        disabled={blocked}
                        onClick={() =>
                          begin({ kind: "cancel", payment: detail })
                        }
                      >
                        ยกเลิกรายการรอตรวจสอบ
                      </Button>
                    </>
                  )}
                  {detail.status === "CONFIRMED" && (
                    <Button
                      variant="danger"
                      disabled={blocked}
                      onClick={() =>
                        begin({ kind: "reverse", payment: detail })
                      }
                    >
                      กลับรายการทั้งหมด
                    </Button>
                  )}
                </div>
              )}
              {receipt && <ReceiptView receipt={receipt} />}
            </>
          )}
        </Card>
      )}
      <Modal
        open={action !== null}
        onOpenChange={(open) => {
          if (!open) closeForm();
        }}
        title={action ? titles[action.kind] : "รับชำระ"}
        description="รายการนี้บันทึกในฐานข้อมูลจริง ตรวจสอบยอดและรายละเอียดก่อนยืนยัน"
        wide
      >
        {action && (
          <form onSubmit={submit}>
            {attempt?.state !== "rejected" && (
              <CommandRecovery attempt={attempt} actorId={actorId} />
            )}
            {action.kind === "create" ? (
              <>
                <div className="form-grid">
                  <Field label="สัญญาเช่า (ข้อมูลปัจจุบัน)">
                    <select
                      required
                      value={draft.leaseId}
                      disabled={blocked || reviewed}
                      onChange={(event) =>
                        setDraft({ ...draft, leaseId: event.target.value })
                      }
                    >
                      <option value="">เลือกสัญญา</option>
                      {leases.map((lease) => (
                        <option key={lease.id} value={lease.id}>
                          {leaseLabel(lease)}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <Field
                    label="ยอดรับชำระ (บาท)"
                    hint="ทศนิยมไม่เกิน 2 ตำแหน่ง ไม่ปัดเศษ"
                  >
                    <input
                      required
                      inputMode="decimal"
                      value={draft.amount}
                      disabled={blocked || reviewed}
                      onChange={(event) =>
                        setDraft({ ...draft, amount: event.target.value })
                      }
                    />
                  </Field>
                  <Field label="วันเวลารับชำระ (กรุงเทพฯ UTC+07:00)">
                    <input
                      type="datetime-local"
                      required
                      value={draft.receivedAt}
                      disabled={blocked || reviewed}
                      onChange={(event) =>
                        setDraft({ ...draft, receivedAt: event.target.value })
                      }
                    />
                  </Field>
                  <Field label="วิธีรับชำระ">
                    <select
                      value={draft.method}
                      disabled={blocked || reviewed}
                      onChange={(event) =>
                        setDraft({
                          ...draft,
                          method: event.target.value,
                          externalReference: "",
                          receivingAccountKey: "",
                        })
                      }
                    >
                      <option value="CASH">เงินสด</option>
                      <option value="BANK_TRANSFER">โอนเงิน</option>
                    </select>
                  </Field>
                  {draft.method === "BANK_TRANSFER" && (
                    <>
                      <Field label="เลขอ้างอิงธนาคาร">
                        <input
                          required
                          maxLength={120}
                          value={draft.externalReference}
                          disabled={blocked || reviewed}
                          onChange={(event) =>
                            setDraft({
                              ...draft,
                              externalReference: event.target.value,
                            })
                          }
                        />
                      </Field>
                      <Field
                        label="รหัสบัญชีรับเงิน"
                        hint="รหัสที่ผู้ปฏิบัติงานระบุ ระบบยังไม่ตรวจสอบธนาคารอัตโนมัติ"
                      >
                        <input
                          required
                          maxLength={80}
                          value={draft.receivingAccountKey}
                          disabled={blocked || reviewed}
                          onChange={(event) =>
                            setDraft({
                              ...draft,
                              receivingAccountKey: event.target.value,
                            })
                          }
                        />
                      </Field>
                    </>
                  )}
                </div>
                <Notice>
                  บันทึกเงินรอตรวจสอบเท่านั้น ยังไม่ออกใบเสร็จ
                  ไม่ใช่เงินมัดจำหรือเครดิต หากไม่มีใบแจ้งหนี้ที่รับชำระได้
                  รายการจะยังยืนยันไม่ได้
                </Notice>
              </>
            ) : action.kind === "confirm" ? (
              <>
                <p>
                  ยอดรับชำระ {amountLabel(action.payment.amount)} ·{" "}
                  {action.payment.reference}
                </p>
                {readBusy && (
                  <p role="status">กำลังอ่านใบแจ้งหนี้ที่รับชำระได้…</p>
                )}
                {!readBusy && balances.length === 0 && (
                  <p>ไม่มีใบแจ้งหนี้ที่รับชำระได้ รายการยังคงรอตรวจสอบ</p>
                )}
                <div className={styles.allocations}>
                  {balances.map((balance) => {
                    const allocation = allocations.find(
                      (item) => item.balance.invoiceId === balance.invoiceId,
                    );
                    return (
                      <fieldset
                        key={balance.invoiceId}
                        disabled={blocked || reviewed || mustRefresh}
                      >
                        <legend>
                          {balance.number} · ห้อง {balance.labels.room} ·{" "}
                          {balance.labels.tenant}
                        </legend>
                        <p>
                          ยอดใบแจ้งหนี้ {amountLabel(balance.finalTotal)} ·
                          รับชำระแล้ว {amountLabel(balance.activePaid)} · ค้าง{" "}
                          {amountLabel(balance.outstanding)}
                        </p>
                        <label>
                          <input
                            type="checkbox"
                            checked={!!allocation}
                            onChange={(event) =>
                              void toggleInvoice(balance, event.target.checked)
                            }
                          />{" "}
                          จัดสรรให้ {balance.number}
                        </label>
                        {allocation && (
                          <>
                            <Field
                              label={`ยอดจัดสรร ${balance.number} (บาท)`}
                              hint={
                                allocation.version === null
                                  ? "กำลังอ่านรุ่นของใบแจ้งหนี้"
                                  : `รุ่นใบแจ้งหนี้ ${allocation.version}`
                              }
                            >
                              <input
                                required
                                inputMode="decimal"
                                value={allocation.amount}
                                disabled={allocation.version === null}
                                onChange={(event) =>
                                  setAllocations((current) =>
                                    current.map((item) =>
                                      item.balance.invoiceId ===
                                      balance.invoiceId
                                        ? {
                                            ...item,
                                            amount: event.target.value,
                                          }
                                        : item,
                                    ),
                                  )
                                }
                              />
                            </Field>
                            <Button
                              variant="secondary"
                              onClick={() =>
                                setAllocations((current) =>
                                  current.map((item) =>
                                    item.balance.invoiceId === balance.invoiceId
                                      ? { ...item, amount: balance.outstanding }
                                      : item,
                                  ),
                                )
                              }
                            >
                              ใช้ยอดค้างของ {balance.number}
                            </Button>
                          </>
                        )}
                      </fieldset>
                    );
                  })}
                </div>
                <p role="status">
                  จัดสรร {amountLabel(minorText(allocationTotal))} · เหลือ{" "}
                  {amountLabel(
                    minorText(
                      minorUnits(action.payment.amount) - allocationTotal,
                    ),
                  )}
                </p>
                {duplicateReview && (
                  <>
                    <Notice>
                      มีเงินสดที่อาจซ้ำในสัญญา ยอดเงิน และวันกรุงเทพฯ เดียวกัน
                      ให้ผู้ดูแลตรวจสอบด้วยตนเองก่อนระบุเหตุผลยืนยัน
                    </Notice>
                    <Field label="เหตุผลอนุมัติเงินสดที่อาจซ้ำ">
                      <textarea
                        required
                        maxLength={1000}
                        disabled={blocked}
                        value={overrideReason}
                        onChange={(event) => {
                          setOverrideReason(event.target.value);
                          setReviewed(false);
                        }}
                      />
                    </Field>
                  </>
                )}
                <Notice>
                  เมื่อยืนยัน ระบบจะจัดสรรยอดทั้งหมดและออกใบเสร็จพร้อมกัน
                </Notice>
              </>
            ) : (
              <>
                <p>
                  {action.payment.reference} ·{" "}
                  {amountLabel(action.payment.amount)}
                </p>
                {action.kind === "reverse" && (
                  <Notice>
                    กลับรายการเต็มจำนวน การจัดสรรทั้งหมดจะหยุดนับยอดรับชำระ
                    และใบเสร็จเดิมจะมีสถานะยกเลิก ประวัติเดิมยังคงอยู่
                  </Notice>
                )}
                <Field label="เหตุผล">
                  <textarea
                    required
                    maxLength={1000}
                    disabled={blocked || reviewed}
                    value={reason}
                    onChange={(event) => setReason(event.target.value)}
                  />
                </Field>
              </>
            )}
            {reviewed && (
              <div role="status" className={styles.review}>
                ตรวจสอบข้อมูลด้านบนแล้ว กดปุ่มยืนยันเพื่อบันทึกจริง
                {action.kind === "create" && (
                  <p>
                    ยอด {amountLabel(canonicalAmount(draft.amount))} ·{" "}
                    {draft.method === "CASH" ? "เงินสด" : "โอนเงิน"} ·
                    เวลารับชำระ {draft.receivedAt.replace("T", " ")} กรุงเทพฯ
                  </p>
                )}
              </div>
            )}
            <ErrorMessage>{formError}</ErrorMessage>
            {mustRefresh && (
              <p>
                ข้อมูลเปลี่ยนแปลงหรืออ่านไม่ครบ กรุณาปิดหน้าต่าง
                อ่านข้อมูลล่าสุด และเริ่มตรวจสอบใหม่ ห้ามส่งยืนยันด้วยข้อมูลเดิม
              </p>
            )}
            <div className={styles.actions}>
              <Button variant="ghost" onClick={closeForm}>
                ปิด
              </Button>
              {reviewed && (
                <Button
                  variant="secondary"
                  disabled={blocked}
                  onClick={() => setReviewed(false)}
                >
                  กลับไปแก้ไข
                </Button>
              )}
              <Button
                type="submit"
                disabled={
                  blocked ||
                  mustRefresh ||
                  readBusy ||
                  (action.kind !== "create" && !canAdmin) ||
                  (attempt?.state === "rejected" &&
                    attempt.code === "IDEMPOTENCY_CONFLICT")
                }
              >
                {reviewed
                  ? action.kind === "create"
                    ? "ยืนยันบันทึกรอตรวจสอบ"
                    : titles[action.kind]
                  : "ตรวจสอบก่อนบันทึก"}
              </Button>
            </div>
          </form>
        )}
      </Modal>
    </>
  );
}
