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
  Button,
  Card,
  DataTable,
  ErrorMessage,
  Field,
  Modal,
  Notice,
  SuccessMessage,
} from "@/components/ui";
import { propertySchema } from "@/features/live/contracts";
import {
  categoryDtoSchema,
  expenseDtoSchema,
  createExpenseInput,
  createExpenseCategoryInput,
  setExpenseCategoryActiveInput,
  postExpenseInput,
  cancelExpenseInput,
  expenseListInput,
  type CategoryDto,
  type ExpenseDto,
} from "@/server/expenses/contracts";
import { ExpensesScreen } from "./screen";
import { expensePageSchema, expenseRequest, ExpenseApiError } from "./client";
import { amountLabel, canonicalAmount, today, timeLabel } from "./form";
import {
  bindActor,
  clearJournal,
  journalSnapshot,
  subscribeJournal,
  submitAttempt,
  dismissSettled,
  type Attempt,
} from "./journal";
import { CommandRecovery } from "./recovery";
import styles from "./live-screen.module.css";

type Property = z.infer<typeof propertySchema>;
type ExpensePage = z.infer<typeof expensePageSchema>;
type Filters = {
  propertyId: string;
  from: string;
  to: string;
  kind: string;
  categoryId: string;
  status: string;
  query: string;
};
type Action =
  | { kind: "create"; correction?: ExpenseDto }
  | { kind: "post" | "cancel" | "reverse"; expense: ExpenseDto }
  | { kind: "categoryCreate" }
  | { kind: "categoryActive"; category: CategoryDto; active: boolean };
const labels = {
  PENDING: "รออนุมัติ",
  POSTED: "อนุมัติแล้ว",
  CANCELLED: "ยกเลิกแล้ว",
  REVERSED: "กลับรายการแล้ว",
};
const titles = {
  create: "บันทึกค่าใช้จ่ายรออนุมัติ",
  post: "อนุมัติค่าใช้จ่าย",
  cancel: "ยกเลิกค่าใช้จ่ายรออนุมัติ",
  reverse: "กลับรายการค่าใช้จ่าย",
  categoryCreate: "สร้างหมวดค่าใช้จ่าย",
  categoryActive: "เปลี่ยนสถานะหมวดค่าใช้จ่าย",
};
const blankFilters: Filters = {
  propertyId: "",
  from: "",
  to: "",
  kind: "",
  categoryId: "",
  status: "",
  query: "",
};
const blankDraft = {
  propertyId: "",
  categoryId: "",
  description: "",
  vendor: "",
  amount: "",
  occurredAt: "",
  method: "CASH",
  note: "",
  name: "",
  kind: "OPEX",
};
function message(error: unknown) {
  return error instanceof Error ? error.message : "ไม่สามารถติดต่อระบบได้";
}
function parameters(filters: Filters) {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(filters))
    if (value.trim()) query.set(key, value.trim());
  return query;
}
export function ExpenseWorkspace({
  actorId,
  admin,
}: {
  actorId: string;
  admin: boolean;
}) {
  const [demo, setDemo] = useState(false);
  const [attempt, setAttempt] = useState<Attempt | null>(null);
  useEffect(() => {
    bindActor(actorId);
    const update = () => setAttempt(journalSnapshot(actorId));
    const unsubscribe = subscribeJournal(update);
    update();
    return unsubscribe;
  }, [actorId]);
  const blocked =
    attempt?.state === "submitting" ||
    attempt?.state === "uncertain" ||
    (attempt?.state === "rejected" && attempt.code === "IDEMPOTENCY_CONFLICT");
  return (
    <>
      <div className={styles.actions} aria-label="เลือกโหมดค่าใช้จ่าย">
        <Button
          variant={demo ? "secondary" : "primary"}
          onClick={() => setDemo(false)}
        >
          ค่าใช้จ่ายฐานข้อมูลจริง
        </Button>
        <Button
          variant={demo ? "primary" : "secondary"}
          disabled={blocked}
          onClick={() => setDemo(true)}
        >
          เปิดข้อมูลสาธิตแยกต่างหาก
        </Button>
      </div>
      {demo ? (
        <>
          <Notice>
            โหมดสาธิตแยกต่างหาก ข้อมูลและยอดเงินด้านล่างไม่บันทึกในฐานข้อมูลจริง
          </Notice>
          <ExpensesScreen />
        </>
      ) : (
        <LiveExpenses actorId={actorId} admin={admin} attempt={attempt} />
      )}
    </>
  );
}
function LiveExpenses({
  actorId,
  admin,
  attempt,
}: {
  actorId: string;
  admin: boolean;
  attempt: Attempt | null;
}) {
  const [properties, setProperties] = useState<Property[]>([]);
  const [categories, setCategories] = useState<CategoryDto[]>([]);
  const [optionsError, setOptionsError] = useState("");
  const [filters, setFilters] = useState(blankFilters);
  const [offset, setOffset] = useState(0);
  const [page, setPage] = useState<ExpensePage | null>(null);
  const [loadedQuery, setLoadedQuery] = useState("");
  const [listError, setListError] = useState("");
  const [revision, setRevision] = useState(0);
  const [selectedId, setSelectedId] = useState("");
  const [detail, setDetail] = useState<ExpenseDto | null>(null);
  const [detailError, setDetailError] = useState("");
  const [action, setAction] = useState<Action | null>(null);
  const [draft, setDraft] = useState(blankDraft);
  const [reason, setReason] = useState("");
  const [formError, setFormError] = useState("");
  const [success, setSuccess] = useState("");
  const [permissionDenied, setPermissionDenied] = useState(false);
  const [mustRefresh, setMustRefresh] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [exporting, setExporting] = useState(false);
  const handled = useRef<Attempt | null>(null);
  const actionGeneration = useRef(0);
  const canAdmin = admin && !permissionDenied;
  const blocked =
    attempt?.state === "submitting" ||
    attempt?.state === "uncertain" ||
    (attempt?.state === "rejected" && attempt.code === "IDEMPOTENCY_CONFLICT");
  const filterQuery = parameters(filters).toString();
  const listQuery = `${filterQuery}${filterQuery ? "&" : ""}offset=${offset}&limit=50`;
  const current = loadedQuery === listQuery && page !== null && !listError;
  const reload = useCallback(() => setRevision((value) => value + 1), []);
  const errorMessage = useCallback((error: unknown) => {
    if (error instanceof ExpenseApiError && error.status === 401) {
      clearJournal();
      window.location.assign("/login/?expense-reconcile=1");
    }
    if (error instanceof ExpenseApiError && error.code === "FORBIDDEN")
      setPermissionDenied(true);
    return message(error);
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    void Promise.all([
      expenseRequest({
        path: "properties",
        schema: z.array(propertySchema),
        signal: controller.signal,
      }),
      expenseRequest({
        path: "expense-categories",
        schema: z.array(categoryDtoSchema),
        signal: controller.signal,
      }),
    ])
      .then(([p, c]) => {
        if (!controller.signal.aborted) {
          setProperties(p);
          setCategories(c);
          setOptionsError("");
        }
      })
      .catch((error) => {
        if (!controller.signal.aborted) setOptionsError(errorMessage(error));
      });
    return () => controller.abort();
  }, [revision, errorMessage]);
  useEffect(() => {
    const controller = new AbortController();
    setLoadedQuery("");
    setListError("");
    void expenseRequest({
      path: `expenses?${listQuery}`,
      schema: expensePageSchema,
      signal: controller.signal,
    })
      .then((data) => {
        if (!controller.signal.aborted) {
          setPage(data);
          setLoadedQuery(listQuery);
        }
      })
      .catch((error) => {
        if (!controller.signal.aborted) setListError(errorMessage(error));
      });
    return () => controller.abort();
  }, [listQuery, revision, errorMessage]);
  useEffect(() => {
    setDetail(null);
    setDetailError("");
    if (!selectedId) return;
    const controller = new AbortController();
    void expenseRequest({
      path: `expenses/${selectedId}`,
      schema: expenseDtoSchema,
      signal: controller.signal,
    })
      .then((data) => {
        if (!controller.signal.aborted) setDetail(data);
      })
      .catch((error) => {
        if (!controller.signal.aborted) setDetailError(errorMessage(error));
      });
    return () => controller.abort();
  }, [selectedId, revision, errorMessage]);
  useEffect(() => {
    if (!attempt || handled.current === attempt) return;
    handled.current = attempt;
    if (attempt.state === "success") {
      setSuccess("บันทึกผลแล้ว กำลังอ่านข้อมูลปัจจุบันจากระบบ");
      actionGeneration.current++;
      setAction(null);
      setMustRefresh(false);
      if (attempt.result.kind === "expense")
        setSelectedId(attempt.result.value.id);
      reload();
      dismissSettled(actorId);
    } else if (attempt.state === "rejected") {
      setFormError(`${attempt.message} (${attempt.code})`);
      if (
        ["STALE_VERSION", "INVALID_TRANSITION", "INACTIVE_CATEGORY"].includes(
          attempt.code,
        )
      ) {
        setMustRefresh(true);
        reload();
      }
      if (attempt.code === "FORBIDDEN") {
        setPermissionDenied(true);
        reload();
      }
    }
  }, [attempt, actorId, reload]);
  function filter(key: keyof Filters, value: string) {
    setFilters((previous) => ({ ...previous, [key]: value }));
    setOffset(0);
  }
  function open(next: Action) {
    if (blocked) return;
    dismissSettled(actorId);
    actionGeneration.current++;
    setFormError("");
    setRefreshing(false);
    setReason("");
    setMustRefresh(false);
    setSelectedId("");
    setDraft({
      ...blankDraft,
      propertyId:
        next.kind === "create"
          ? (next.correction?.propertyId ?? filters.propertyId)
          : "",
      occurredAt: today(),
    });
    setAction(next);
  }
  function closeAction() {
    setRefreshing(false);
    actionGeneration.current++;
    setAction(null);
  }
  function submit(event: FormEvent) {
    event.preventDefault();
    if (!action || blocked || mustRefresh || refreshing) return;
    try {
      const commandKey = crypto.randomUUID();
      let path: string, body: object;
      switch (action.kind) {
        case "create":
          path = "expenses";
          body = createExpenseInput.parse({
            propertyId: draft.propertyId,
            categoryId: draft.categoryId,
            description: draft.description,
            vendor: draft.vendor,
            amount: canonicalAmount(draft.amount),
            occurredAt: draft.occurredAt,
            method: draft.method,
            note: draft.note,
            ...(action.correction
              ? { correctionOfId: action.correction.id }
              : {}),
            commandKey,
          });
          break;
        case "categoryCreate":
          path = "expense-categories";
          body = createExpenseCategoryInput.parse({
            name: draft.name,
            kind: draft.kind,
            commandKey,
          });
          break;
        case "categoryActive":
          path = `expense-categories/${action.category.id}/active`;
          body = setExpenseCategoryActiveInput
            .omit({ categoryId: true })
            .parse({
              active: action.active,
              expectedVersion: action.category.version,
              commandKey,
            });
          break;
        case "post":
          path = `expenses/${action.expense.id}/post`;
          body = postExpenseInput
            .omit({ expenseId: true })
            .parse({ expectedVersion: action.expense.version, commandKey });
          break;
        case "cancel":
        case "reverse":
          path = `expenses/${action.expense.id}/${action.kind}`;
          body = cancelExpenseInput.omit({ expenseId: true }).parse({
            expectedVersion: action.expense.version,
            reason,
            commandKey,
          });
          break;
      }
      setFormError("");
      submitAttempt({
        actorId,
        operation: action.kind,
        key: commandKey,
        path,
        body,
      });
    } catch (error) {
      setFormError(
        error instanceof z.ZodError
          ? error.issues.map((issue) => issue.message).join(" · ")
          : message(error),
      );
    }
  }
  async function refreshAction() {
    if (!action || blocked) return;
    const generation = actionGeneration.current;
    setRefreshing(true);
    setFormError("");
    try {
      if ("expense" in action) {
        const value = await expenseRequest({
          path: `expenses/${action.expense.id}`,
          schema: expenseDtoSchema,
        });
        if (generation === actionGeneration.current)
          setAction({ ...action, expense: value });
      } else {
        const value = await expenseRequest({
          path: "expense-categories",
          schema: z.array(categoryDtoSchema),
        });
        if (generation === actionGeneration.current) {
          setCategories(value);
          if (action.kind === "categoryActive") {
            const category = value.find(
              (item) => item.id === action.category.id,
            );
            if (!category) throw new Error("ไม่พบหมวดค่าใช้จ่าย");
            setAction({ ...action, category });
          }
        }
      }
      if (generation === actionGeneration.current) {
        dismissSettled(actorId);
        setMustRefresh(false);
      }
    } catch (error) {
      if (generation === actionGeneration.current)
        setFormError(errorMessage(error));
    } finally {
      if (generation === actionGeneration.current) setRefreshing(false);
    }
  }
  async function download() {
    if (!current || exporting) return;
    setExporting(true);
    setListError("");
    try {
      expenseListInput.parse(Object.fromEntries(parameters(filters)));
      const response = await fetch(`/api/v1/expenses/export/?${filterQuery}`, {
        credentials: "same-origin",
        cache: "no-store",
      });
      if (!response.ok) {
        const value: unknown = await response.json();
        const parsed = z
          .object({
            error: z.object({ code: z.string(), message: z.string() }),
          })
          .safeParse(value);
        throw new ExpenseApiError(
          response.status,
          parsed.success ? parsed.data.error.code : "INVALID_RESPONSE",
          parsed.success ? parsed.data.error.message : "ไม่สามารถส่งออกได้",
        );
      }
      if (!response.headers.get("content-type")?.startsWith("text/csv"))
        throw new Error("รูปแบบไฟล์ส่งออกไม่ถูกต้อง");
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download =
        response.headers
          .get("content-disposition")
          ?.match(/filename="(expenses-[A-Za-z0-9]+\.csv)"/)?.[1] ??
        "expenses.csv";
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (error) {
      setListError(errorMessage(error));
    } finally {
      setExporting(false);
    }
  }
  const propName = (id: string) =>
    properties.find((p) => p.id === id)?.name ?? id;
  return (
    <>
      <Notice>
        ค่าใช้จ่ายฐานข้อมูลจริง แยกจากข้อมูลสาธิต
        ยอดเป็นค่าใช้จ่ายที่อนุมัติแล้วตามวันที่เกิดรายการ
        การกลับรายการภายหลังแก้ยอดปัจจุบันของวันเดิม ไม่ใช่การบันทึกเงินคืน
      </Notice>
      {success && <SuccessMessage>{success}</SuccessMessage>}
      {!action && <CommandRecovery attempt={attempt} actorId={actorId} />}
      <div className={styles.actions}>
        <Button
          disabled={blocked || !!optionsError || !properties.length}
          onClick={() => open({ kind: "create" })}
        >
          เพิ่มค่าใช้จ่ายรออนุมัติ
        </Button>
        <Button
          variant="secondary"
          disabled={!current || exporting}
          onClick={() => void download()}
        >
          {exporting ? "กำลังส่งออก…" : "ส่งออก CSV ตามตัวกรองทั้งหมด"}
        </Button>
        <Button variant="ghost" onClick={reload}>
          โหลดข้อมูลใหม่
        </Button>
      </div>
      {optionsError && <ErrorMessage>{optionsError}</ErrorMessage>}
      <Card title="ตัวกรองค่าใช้จ่าย">
        <div className={styles.filters}>
          <Field label="อาคารที่แสดง">
            <select
              value={filters.propertyId}
              onChange={(e) => filter("propertyId", e.target.value)}
            >
              <option value="">ทุกอาคาร</option>
              {properties.map((p) => (
                <option value={p.id} key={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="ประเภทที่แสดง">
            <select
              value={filters.kind}
              onChange={(e) => filter("kind", e.target.value)}
            >
              <option value="">ทุกประเภท</option>
              <option>OPEX</option>
              <option>CAPEX</option>
            </select>
          </Field>
          <Field label="ตั้งแต่วันที่">
            <input
              type="date"
              value={filters.from}
              onChange={(e) => filter("from", e.target.value)}
            />
          </Field>
          <Field label="ถึงวันที่">
            <input
              type="date"
              value={filters.to}
              onChange={(e) => filter("to", e.target.value)}
            />
          </Field>
          <Field label="หมวดที่แสดง">
            <select
              value={filters.categoryId}
              onChange={(e) => filter("categoryId", e.target.value)}
            >
              <option value="">ทุกหมวด</option>
              {categories.map((c) => (
                <option value={c.id} key={c.id}>
                  {c.name} · {c.kind}
                  {c.active ? "" : " · ปิดใช้งาน"}
                </option>
              ))}
            </select>
          </Field>
          <Field label="สถานะที่แสดง">
            <select
              value={filters.status}
              onChange={(e) => filter("status", e.target.value)}
            >
              <option value="">ทุกสถานะ</option>
              {Object.entries(labels).map(([value, label]) => (
                <option value={value} key={value}>
                  {label}
                </option>
              ))}
            </select>
          </Field>
          <Field label="ค้นหารายการหรือผู้รับเงิน">
            <input
              type="search"
              maxLength={100}
              value={filters.query}
              onChange={(e) => filter("query", e.target.value)}
            />
          </Field>
        </div>
      </Card>
      {listError ? (
        <ErrorMessage>{listError}</ErrorMessage>
      ) : !current ? (
        <p role="status">กำลังโหลดค่าใช้จ่ายตามตัวกรอง…</p>
      ) : (
        <>
          <Card title="ค่าใช้จ่ายที่อนุมัติแล้วตามตัวกรอง">
            <dl className="detail-grid">
              <div>
                <dt>OPEX</dt>
                <dd>{amountLabel(page.totals.opex)}</dd>
              </div>
              <div>
                <dt>CAPEX</dt>
                <dd>{amountLabel(page.totals.capex)}</dd>
              </div>
              <div>
                <dt>รวม</dt>
                <dd>{amountLabel(page.totals.total)}</dd>
              </div>
            </dl>
            <p>
              ยอดทั้งผลการค้นหา ไม่ใช่เฉพาะหน้านี้ รายการรออนุมัติ ยกเลิก
              และกลับรายการไม่รวมในยอด
            </p>
            <p>
              ไม่รวมข้อมูลเดิมที่ยังไม่ตรวจสอบ {page.excludedLegacyCount} รายการ
              สำหรับ{filters.propertyId ? "อาคารที่เลือก" : "ทุกอาคาร"}{" "}
              จำนวนที่ไม่รวมนี้ไม่จำกัดด้วยตัวกรองวันที่หรือสถานะ
            </p>
          </Card>
          <Card>
            <DataTable
              caption="รายการค่าใช้จ่ายฐานข้อมูลจริง"
              headers={[
                "วันที่",
                "อาคาร / รายการ",
                "หมวด",
                "ผู้รับเงิน",
                "จำนวนเงิน",
                "สถานะ",
                "รายละเอียด",
              ]}
              empty={!page.items.length}
            >
              {page.items.map((item) => (
                <tr key={item.id}>
                  <td>{item.occurredAt}</td>
                  <td>
                    {propName(item.propertyId)}
                    <br />
                    {item.description}
                  </td>
                  <td>
                    {item.categoryName}
                    <br />
                    {item.categoryKind}
                  </td>
                  <td>{item.vendor}</td>
                  <td className={styles.amount}>{amountLabel(item.amount)}</td>
                  <td>{labels[item.status]}</td>
                  <td>
                    <Button
                      variant="ghost"
                      onClick={() => setSelectedId(item.id)}
                      aria-label={`ดูค่าใช้จ่าย ${item.description}`}
                    >
                      ดูรายละเอียด
                    </Button>
                  </td>
                </tr>
              ))}
            </DataTable>
            <div className={styles.actions} aria-label="หน้ารายการค่าใช้จ่าย">
              <Button
                variant="secondary"
                disabled={!offset}
                onClick={() => setOffset((value) => Math.max(0, value - 50))}
              >
                หน้าก่อน
              </Button>
              <p>
                {page.total
                  ? `${offset + 1}–${Math.min(offset + page.items.length, page.total)}`
                  : "0"}{" "}
                จาก {page.total} รายการ
              </p>
              <Button
                variant="secondary"
                disabled={
                  offset + page.items.length >= page.total ||
                  offset + 50 > 100000
                }
                onClick={() => setOffset((value) => value + 50)}
              >
                หน้าถัดไป
              </Button>
            </div>
          </Card>
        </>
      )}
      <p className="muted-text">
        CSV เป็นข้อมูลรายการปัจจุบันตามตัวกรองทั้งหมด
        รวมประวัติยกเลิก/กลับรายการตามสถานะที่เลือก จำกัด 10,000 รายการ
        เกินกว่านี้ต้องลดขอบเขต ไฟล์มีแถวสรุปก่อนแถวรายการ
        หากใช้สเปรดชีตให้ตั้งคอลัมน์จำนวนเงินเป็นข้อความเพื่อเก็บจำนวนเงินขนาดใหญ่ครบทุกหลัก
      </p>
      {canAdmin && (
        <Card
          title="หมวดค่าใช้จ่ายส่วนกลาง"
          description="ใช้ร่วมทุกอาคาร ชื่อและประเภทคงเดิม ปิดใช้งานได้โดยไม่เปลี่ยนประวัติ"
        >
          <Button
            disabled={blocked}
            onClick={() => open({ kind: "categoryCreate" })}
          >
            สร้างหมวดค่าใช้จ่าย
          </Button>
          <ul className={styles.categories}>
            {categories.map((category) => (
              <li key={category.id}>
                <span>
                  {category.name} · {category.kind} ·{" "}
                  {category.active ? "เปิดใช้งาน" : "ปิดใช้งาน"}
                </span>
                <Button
                  variant="secondary"
                  disabled={blocked}
                  onClick={() =>
                    open({
                      kind: "categoryActive",
                      category,
                      active: !category.active,
                    })
                  }
                >
                  {category.active ? "ปิดใช้งาน" : "เปิดใช้งาน"} {category.name}
                </Button>
              </li>
            ))}
          </ul>
        </Card>
      )}
      <Modal
        open={!!selectedId}
        onOpenChange={(value) => {
          if (!value) setSelectedId("");
        }}
        title="รายละเอียดค่าใช้จ่าย"
        description="ข้อมูลต้นฉบับและประวัติที่บันทึกในฐานข้อมูลจริง"
        wide
      >
        {detailError ? (
          <ErrorMessage>{detailError}</ErrorMessage>
        ) : !detail || detail.id !== selectedId ? (
          <p role="status">กำลังโหลดรายละเอียดค่าใช้จ่าย…</p>
        ) : (
          <>
            <ExpenseDetail
              expense={detail}
              property={propName(detail.propertyId)}
              onCorrection={(id) => setSelectedId(id)}
            />
            <div className={styles.actions}>
              {canAdmin && detail.status === "PENDING" && (
                <>
                  <Button
                    disabled={blocked}
                    onClick={() => open({ kind: "post", expense: detail })}
                  >
                    ตรวจสอบและอนุมัติ
                  </Button>
                  <Button
                    variant="danger"
                    disabled={blocked}
                    onClick={() => open({ kind: "cancel", expense: detail })}
                  >
                    ยกเลิกรายการรออนุมัติ
                  </Button>
                </>
              )}
              {canAdmin && detail.status === "POSTED" && (
                <Button
                  variant="danger"
                  disabled={blocked}
                  onClick={() => open({ kind: "reverse", expense: detail })}
                >
                  กลับรายการที่อนุมัติแล้ว
                </Button>
              )}
              {(detail.status === "CANCELLED" ||
                detail.status === "REVERSED") && (
                <Button
                  disabled={blocked}
                  onClick={() => open({ kind: "create", correction: detail })}
                >
                  สร้างรายการแก้ไขอ้างอิงรายการนี้
                </Button>
              )}
            </div>
          </>
        )}
      </Modal>
      <Modal
        open={!!action}
        onOpenChange={(value) => {
          if (!value) closeAction();
        }}
        title={action ? titles[action.kind] : "ค่าใช้จ่าย"}
        description="คำสั่งบันทึกฐานข้อมูลจริง กรุณาตรวจสอบข้อมูลก่อนส่ง"
        wide
      >
        <CommandRecovery attempt={attempt} actorId={actorId} />
        {action && (
          <form onSubmit={submit}>
            {action.kind === "create" && (
              <>
                {action.correction && (
                  <Notice>
                    รายการใหม่อ้างอิง {action.correction.id}{" "}
                    โดยไม่เปลี่ยนต้นฉบับ กรุณาระบุข้อมูลที่ถูกต้องใหม่
                  </Notice>
                )}
                <div className="form-grid">
                  <Field label="อาคาร">
                    <select
                      required
                      disabled={blocked || !!action.correction}
                      value={draft.propertyId}
                      onChange={(e) =>
                        setDraft({ ...draft, propertyId: e.target.value })
                      }
                    >
                      <option value="">เลือกอาคาร</option>
                      {properties.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <Field label="หมวดค่าใช้จ่าย">
                    <select
                      required
                      disabled={blocked}
                      value={draft.categoryId}
                      onChange={(e) =>
                        setDraft({ ...draft, categoryId: e.target.value })
                      }
                    >
                      <option value="">เลือกหมวดที่เปิดใช้งาน</option>
                      {categories
                        .filter((c) => c.active)
                        .map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.name} · {c.kind}
                          </option>
                        ))}
                    </select>
                  </Field>
                  <Field label="รายการค่าใช้จ่าย">
                    <input
                      required
                      maxLength={200}
                      disabled={blocked}
                      value={draft.description}
                      onChange={(e) =>
                        setDraft({ ...draft, description: e.target.value })
                      }
                    />
                  </Field>
                  <Field label="ผู้รับเงิน">
                    <input
                      required
                      maxLength={120}
                      disabled={blocked}
                      value={draft.vendor}
                      onChange={(e) =>
                        setDraft({ ...draft, vendor: e.target.value })
                      }
                    />
                  </Field>
                  <Field label="จำนวนเงิน (บาท)">
                    <input
                      required
                      inputMode="decimal"
                      disabled={blocked}
                      value={draft.amount}
                      onChange={(e) =>
                        setDraft({ ...draft, amount: e.target.value })
                      }
                    />
                  </Field>
                  <Field label="วันที่เกิดค่าใช้จ่าย">
                    <input
                      required
                      type="date"
                      disabled={blocked}
                      value={draft.occurredAt}
                      onChange={(e) =>
                        setDraft({ ...draft, occurredAt: e.target.value })
                      }
                    />
                  </Field>
                  <Field label="วิธีจ่าย">
                    <select
                      disabled={blocked}
                      value={draft.method}
                      onChange={(e) =>
                        setDraft({ ...draft, method: e.target.value })
                      }
                    >
                      <option value="CASH">เงินสด</option>
                      <option value="BANK_TRANSFER">โอนเงิน</option>
                    </select>
                  </Field>
                  <Field label="หมายเหตุ">
                    <textarea
                      maxLength={500}
                      disabled={blocked}
                      value={draft.note}
                      onChange={(e) =>
                        setDraft({ ...draft, note: e.target.value })
                      }
                    />
                  </Field>
                </div>
                <p>บันทึกเป็นรายการรออนุมัติ ยังไม่รวมยอดที่อนุมัติแล้ว</p>
              </>
            )}
            {action.kind === "categoryCreate" && (
              <>
                <Field label="ชื่อหมวด">
                  <input
                    required
                    maxLength={100}
                    disabled={blocked}
                    value={draft.name}
                    onChange={(e) =>
                      setDraft({ ...draft, name: e.target.value })
                    }
                  />
                </Field>
                <Field label="ประเภทหมวด">
                  <select
                    disabled={blocked}
                    value={draft.kind}
                    onChange={(e) =>
                      setDraft({ ...draft, kind: e.target.value })
                    }
                  >
                    <option>OPEX</option>
                    <option>CAPEX</option>
                  </select>
                </Field>
                <p>หมวดนี้ใช้ร่วมทุกอาคาร ชื่อและประเภทแก้ไขไม่ได้หลังบันทึก</p>
              </>
            )}
            {action.kind === "categoryActive" && (
              <p>
                {action.active ? "เปิด" : "ปิด"}ใช้งาน {action.category.name} ·{" "}
                {action.category.kind} รุ่น {action.category.version}{" "}
                ประวัติเดิมยังคงอยู่
              </p>
            )}
            {"expense" in action && (
              <ExpenseDetail
                expense={action.expense}
                property={propName(action.expense.propertyId)}
              />
            )}
            {(action.kind === "cancel" || action.kind === "reverse") && (
              <>
                <Notice>
                  {action.kind === "reverse"
                    ? "การกลับรายการจะแก้ยอดปัจจุบันของวันที่เกิดค่าใช้จ่ายเดิม ไม่ยืนยันการคืนเงินจริง และกลับรายการนี้ซ้ำไม่ได้"
                    : "ยกเลิกรายการรออนุมัติ โดยเก็บต้นฉบับและเหตุผลไว้"}
                </Notice>
                <Field label="เหตุผล">
                  <textarea
                    required
                    maxLength={1000}
                    disabled={blocked}
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                  />
                </Field>
              </>
            )}
            {formError && <ErrorMessage>{formError}</ErrorMessage>}
            {mustRefresh && (
              <>
                <Notice>
                  ข้อมูลเปลี่ยนแล้ว
                  ต้องโหลดข้อมูลปัจจุบันและตรวจสอบอีกครั้งก่อนส่งคำสั่งใหม่
                </Notice>
                <Button
                  disabled={blocked || refreshing}
                  onClick={() => void refreshAction()}
                >
                  โหลดและตรวจสอบข้อมูลปัจจุบัน
                </Button>
              </>
            )}
            <div className={styles.actions}>
              <Button
                type="submit"
                disabled={
                  blocked ||
                  mustRefresh ||
                  refreshing ||
                  (action.kind !== "create" && !canAdmin)
                }
              >
                {titles[action.kind]}
              </Button>
              <Button variant="ghost" onClick={closeAction}>
                ปิดแบบฟอร์ม
              </Button>
            </div>
          </form>
        )}
      </Modal>
    </>
  );
}
function ExpenseDetail({
  expense,
  property,
  onCorrection,
}: {
  expense: ExpenseDto;
  property: string;
  onCorrection?: (id: string) => void;
}) {
  return (
    <section aria-label="ข้อมูลและประวัติค่าใช้จ่าย">
      <dl className="detail-grid">
        <div>
          <dt>รายการ</dt>
          <dd>{expense.description}</dd>
        </div>
        <div>
          <dt>อาคาร</dt>
          <dd>{property}</dd>
        </div>
        <div>
          <dt>เลขอ้างอิง</dt>
          <dd className={styles.identifier}>{expense.id}</dd>
        </div>
        <div>
          <dt>สถานะ / รุ่น</dt>
          <dd>
            {labels[expense.status]} / {expense.version}
          </dd>
        </div>
        <div>
          <dt>หมวดที่บันทึก</dt>
          <dd>
            {expense.categoryName} · {expense.categoryKind}
          </dd>
        </div>
        <div>
          <dt>จำนวนเงิน</dt>
          <dd>{amountLabel(expense.amount)}</dd>
        </div>
        <div>
          <dt>ผู้รับเงิน</dt>
          <dd>{expense.vendor}</dd>
        </div>
        <div>
          <dt>วันที่เกิดค่าใช้จ่าย</dt>
          <dd>{expense.occurredAt}</dd>
        </div>
        <div>
          <dt>วิธีจ่าย</dt>
          <dd>{expense.method === "CASH" ? "เงินสด" : "โอนเงิน"}</dd>
        </div>
        <div>
          <dt>หมายเหตุ</dt>
          <dd>{expense.note || "ไม่มี"}</dd>
        </div>
        <div>
          <dt>ผู้บันทึก / เวลา</dt>
          <dd className={styles.identifier}>
            {expense.recordedById}
            <br />
            {timeLabel(expense.createdAt)}
          </dd>
        </div>
        {(expense.status === "POSTED" || expense.status === "REVERSED") && (
          <div>
            <dt>ผู้อนุมัติ / เวลา</dt>
            <dd className={styles.identifier}>
              {expense.postedById}
              <br />
              {timeLabel(expense.postedAt)}
            </dd>
          </div>
        )}
        {expense.status === "CANCELLED" && (
          <div>
            <dt>ผู้ยกเลิก / เวลา / เหตุผล</dt>
            <dd className={styles.identifier}>
              {expense.cancelledById}
              <br />
              {timeLabel(expense.cancelledAt)}
              <br />
              {expense.cancelReason}
            </dd>
          </div>
        )}
        {expense.status === "REVERSED" && (
          <div>
            <dt>ผู้กลับรายการ / เวลา / เหตุผล</dt>
            <dd className={styles.identifier}>
              {expense.reversedById}
              <br />
              {timeLabel(expense.reversedAt)}
              <br />
              {expense.reverseReason}
            </dd>
          </div>
        )}
        {expense.correctionOfId && (
          <div>
            <dt>แก้ไขอ้างอิงรายการเดิม</dt>
            <dd>
              {onCorrection ? (
                <Button
                  variant="ghost"
                  onClick={() => onCorrection(expense.correctionOfId ?? "")}
                >
                  {expense.correctionOfId}
                </Button>
              ) : (
                expense.correctionOfId
              )}
            </dd>
          </div>
        )}
      </dl>
      {expense.possibleDuplicateCount > 0 && (
        <Notice>
          พบ {expense.possibleDuplicateCount} รายการที่อาจซ้ำตามอาคาร ผู้รับเงิน
          วันที่ และจำนวนเงิน เป็นเพียงคำเตือน ไม่ใช่การยืนยันว่าซ้ำ
        </Notice>
      )}
    </section>
  );
}
