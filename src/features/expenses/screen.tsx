"use client";
import { useState, type FormEvent } from "react";
import { Download, Wallet, Eye } from "lucide-react";
import {
  AddButton,
  Badge,
  Button,
  Card,
  DataTable,
  ErrorMessage,
  Field,
  Modal,
  MonthSelect,
  Notice,
  SearchField,
  SuccessMessage,
} from "@/components/ui";
import { Kpi } from "@/components/charts";
import { useDemo } from "@/demo/workspace";
import { summarizeMonth } from "@/demo/finance";
import {
  DEFAULT_MONTH,
  DEMO_TODAY,
  type Expense,
  type ExpenseDraft,
} from "@/demo/model";
import { date, exportCsv, money } from "@/lib/format";

export function ExpensesScreen() {
  const { state, addExpense } = useDemo();
  const [month, setMonth] = useState(DEFAULT_MONTH);
  const [kind, setKind] = useState("all");
  const [category, setCategory] = useState("all");
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [detail, setDetail] = useState<Expense | null>(null);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const emptyDraft: ExpenseDraft = {
    title: "",
    vendor: "",
    category: "สาธารณูปโภค",
    kind: "OPEX",
    amount: "",
    date: DEMO_TODAY,
    method: "transfer",
    note: "",
  };
  const [draft, setDraft] = useState(emptyDraft);
  const categories = [...new Set(state.expenses.map((e) => e.category))];
  const rows = state.expenses
    .filter(
      (e) =>
        e.date.startsWith(month) &&
        (kind === "all" || e.kind === kind) &&
        (category === "all" || e.category === category) &&
        `${e.title} ${e.vendor}`.toLowerCase().includes(query.toLowerCase()),
    )
    .toSorted((a, b) => b.date.localeCompare(a.date));
  const summary = summarizeMonth(state, month);
  function submit(e: FormEvent) {
    e.preventDefault();
    const result = addExpense(draft);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setOpen(false);
    setSuccess(`เพิ่มค่าใช้จ่ายสาธิต ${draft.title} แล้ว`);
    setMonth(draft.date.slice(0, 7));
    setKind("all");
    setCategory("all");
    setQuery("");
  }
  return (
    <>
      {success && <SuccessMessage>{success}</SuccessMessage>}
      <div className="screen-toolbar">
        <p className="toolbar-label">
          <Wallet size={16} />
          ค่าใช้จ่ายดำเนินงานและเงินลงทุน
        </p>
        <AddButton
          onClick={() => {
            setDraft(emptyDraft);
            setError("");
            setOpen(true);
          }}
        >
          เพิ่มค่าใช้จ่าย
        </AddButton>
      </div>
      <div className="metric-grid">
        <Kpi
          label="ค่าใช้จ่ายรวม"
          value={money(summary.opex + summary.capex)}
          note="ยอดจ่ายทั้งหมดในเดือน"
          tone="blue"
        />
        <Kpi
          label="ค่าใช้จ่ายดำเนินงาน"
          value={money(summary.opex)}
          note="OPEX"
          tone="red"
        />
        <Kpi
          label="เงินลงทุน"
          value={money(summary.capex)}
          note="CAPEX"
          tone="purple"
        />
        <Kpi
          label="จำนวนรายการ"
          value={`${state.expenses.filter((e) => e.date.startsWith(month)).length} รายการ`}
          note="รายการค่าใช้จ่ายในเดือน"
          tone="green"
        />
      </div>
      <Card>
        <div className="filter-bar">
          <MonthSelect value={month} onChange={setMonth} next />
          <select
            value={kind}
            onChange={(e) => setKind(e.target.value)}
            aria-label="ประเภทค่าใช้จ่าย"
          >
            <option value="all">ทุกประเภท</option>
            <option>OPEX</option>
            <option>CAPEX</option>
          </select>
          <select
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            aria-label="หมวดค่าใช้จ่าย"
          >
            <option value="all">ทุกหมวดหมู่</option>
            {categories.map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
          <SearchField
            value={query}
            onChange={setQuery}
            label="ค้นหาค่าใช้จ่าย"
            placeholder="ค้นหารายการ / ผู้รับเงิน..."
          />
        </div>
        <DataTable
          caption="รายการค่าใช้จ่าย"
          headers={[
            "วันที่",
            "รายการ",
            "หมวดหมู่",
            "ประเภท",
            "จำนวนเงิน",
            "รายละเอียด",
          ]}
          empty={rows.length === 0}
        >
          {rows.map((e) => (
            <tr key={e.id}>
              <td>{date(e.date)}</td>
              <td className="font-semibold">
                {e.title}
                <span className="table-subtitle">{e.vendor}</span>
              </td>
              <td>{e.category}</td>
              <td>
                <Badge tone={e.kind === "OPEX" ? "green" : "red"}>
                  {e.kind}
                </Badge>
              </td>
              <td className="font-semibold">{money(e.amount)}</td>
              <td>
                <button
                  className="text-link"
                  aria-label={`ดูรายละเอียด ${e.title}`}
                  onClick={() => setDetail(e)}
                >
                  <Eye size={15} />
                  ดูรายละเอียด
                </button>
              </td>
            </tr>
          ))}
        </DataTable>
        <div className="table-footer">
          <span>
            แสดง {rows.length} รายการ • รวม{" "}
            {money(rows.reduce((s, e) => s + e.amount, 0))}
          </span>
          <Button
            variant="ghost"
            onClick={() =>
              exportCsv("taky-demo-expenses.csv", [
                [
                  "วันที่",
                  "รายการ",
                  "ผู้รับเงิน",
                  "ประเภท",
                  "หมวดหมู่",
                  "จำนวนเงิน",
                ],
                ...rows.map((e) => [
                  e.date,
                  e.title,
                  e.vendor,
                  e.kind,
                  e.category,
                  e.amount / 100,
                ]),
              ])
            }
          >
            <Download size={14} />
            ส่งออก CSV
          </Button>
        </div>
      </Card>
      <div className="paragraph-gap">
        <Notice>
          OPEX คือค่าใช้จ่ายดำเนินงานในงวด ส่วน CAPEX คือเงินลงทุนในทรัพย์สิน
          แสดงแยกกันในรายงานและกระแสเงินสด
        </Notice>
      </div>
      <Modal open={open} onOpenChange={setOpen} title="เพิ่มค่าใช้จ่าย">
        <form onSubmit={submit}>
          <div className="form-grid">
            <Field label="วันที่">
              <input
                required
                type="date"
                value={draft.date}
                onChange={(e) => setDraft({ ...draft, date: e.target.value })}
              />
            </Field>
            <Field label="ประเภท">
              <select
                value={draft.kind}
                onChange={(e) =>
                  setDraft({
                    ...draft,
                    kind: e.target.value === "CAPEX" ? "CAPEX" : "OPEX",
                  })
                }
              >
                <option>OPEX</option>
                <option>CAPEX</option>
              </select>
            </Field>
            <Field label="รายการ" className="form-full">
              <input
                required
                maxLength={160}
                value={draft.title}
                onChange={(e) => setDraft({ ...draft, title: e.target.value })}
                placeholder="เช่น ค่าซ่อมท่อน้ำ"
              />
            </Field>
            <Field label="ผู้ขาย / ผู้รับเงิน" className="form-full">
              <input
                required
                maxLength={120}
                value={draft.vendor}
                onChange={(e) => setDraft({ ...draft, vendor: e.target.value })}
              />
            </Field>
            <Field label="หมวดหมู่">
              <select
                value={draft.category}
                onChange={(e) =>
                  setDraft({ ...draft, category: e.target.value })
                }
              >
                {categories.map((c) => (
                  <option key={c}>{c}</option>
                ))}
              </select>
            </Field>
            <Field label="จำนวนเงิน (บาท)">
              <input
                required
                min="0.01"
                step="0.01"
                type="number"
                value={draft.amount}
                onChange={(e) => setDraft({ ...draft, amount: e.target.value })}
              />
            </Field>
            <Field label="วิธีชำระ">
              <select
                value={draft.method}
                onChange={(e) =>
                  setDraft({
                    ...draft,
                    method: e.target.value === "cash" ? "cash" : "transfer",
                  })
                }
              >
                <option value="transfer">โอนเงิน</option>
                <option value="cash">เงินสด</option>
              </select>
            </Field>
            <Field label="หมายเหตุ" className="form-full">
              <textarea
                maxLength={500}
                value={draft.note}
                onChange={(e) => setDraft({ ...draft, note: e.target.value })}
              />
            </Field>
          </div>
          <ErrorMessage>{error}</ErrorMessage>
          <div className="form-actions">
            <Button variant="ghost" onClick={() => setOpen(false)}>
              ยกเลิก
            </Button>
            <Button type="submit">บันทึกค่าใช้จ่ายสาธิต</Button>
          </div>
        </form>
      </Modal>
      <Modal
        open={detail !== null}
        onOpenChange={(o) => {
          if (!o) setDetail(null);
        }}
        title="รายละเอียดค่าใช้จ่าย"
      >
        {detail && (
          <>
            <dl className="detail-grid">
              <div>
                <dt>รายการ</dt>
                <dd>{detail.title}</dd>
              </div>
              <div>
                <dt>วันที่</dt>
                <dd>{date(detail.date)}</dd>
              </div>
              <div>
                <dt>ผู้ขาย / ผู้รับเงิน</dt>
                <dd>{detail.vendor}</dd>
              </div>
              <div>
                <dt>ประเภท</dt>
                <dd>
                  <Badge tone={detail.kind === "CAPEX" ? "red" : "green"}>
                    {detail.kind}
                  </Badge>
                </dd>
              </div>
              <div>
                <dt>หมวดหมู่</dt>
                <dd>{detail.category}</dd>
              </div>
              <div>
                <dt>จำนวนเงิน</dt>
                <dd>{money(detail.amount)}</dd>
              </div>
              <div>
                <dt>หมายเหตุ</dt>
                <dd>{detail.note || "-"}</dd>
              </div>
            </dl>
            <div className="paragraph-gap">
              <Notice>
                การแนบหลักฐานและประวัติการอนุมัติจะเปิดใช้งานพร้อมระบบฐานข้อมูล
              </Notice>
            </div>
            <div className="form-actions">
              <Button onClick={() => setDetail(null)}>ปิด</Button>
            </div>
          </>
        )}
      </Modal>
    </>
  );
}
