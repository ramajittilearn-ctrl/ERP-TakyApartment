import { z } from "zod";
import {
  calculateBill,
  invoiceBalance,
  parseAmount,
  validDate,
  validMonth,
} from "./finance";
import {
  DEMO_TODAY,
  type BillDraft,
  type DemoState,
  type ExpenseDraft,
  type PaymentDraft,
  type Result,
  type Settings,
  type Tenant,
  type Ticket,
  type TicketDraft,
} from "./model";

export function recordPayment(
  state: DemoState,
  draft: PaymentDraft,
): Result<DemoState> {
  const invoice = state.invoices.find((i) => i.id === draft.invoiceId);
  if (!invoice) return { ok: false, error: "กรุณาเลือกใบแจ้งหนี้" };
  const amount = parseAmount(draft.amount);
  if (!amount.ok) return amount;
  if (amount.value > invoiceBalance(state, invoice))
    return { ok: false, error: "ยอดชำระเกินยอดค้างของใบแจ้งหนี้" };
  if (!validDate.safeParse(draft.date).success || draft.date > DEMO_TODAY)
    return {
      ok: false,
      error: "กรุณาระบุวันที่รับชำระไม่เกินวันที่สาธิต 15/10/2026",
    };
  const reference = draft.reference.trim();
  if (!reference)
    return { ok: false, error: "กรุณาระบุเลขอ้างอิงเพื่อป้องกันการบันทึกซ้ำ" };
  if (state.payments.some((p) => p.reference === reference))
    return {
      ok: false,
      error: "เลขอ้างอิงนี้ถูกใช้แล้ว กรุณาตรวจสอบรายการซ้ำ",
    };
  return {
    ok: true,
    value: {
      ...state,
      payments: [
        {
          id: crypto.randomUUID(),
          date: draft.date,
          method: draft.method,
          status: "confirmed",
          reference,
          allocations: [{ invoiceId: invoice.id, amount: amount.value }],
        },
        ...state.payments,
      ],
    },
  };
}

export function issueInvoice(
  state: DemoState,
  draft: BillDraft,
): Result<DemoState> {
  if (!validMonth.safeParse(draft.month).success)
    return { ok: false, error: "กรุณาเลือกเดือนให้ถูกต้อง" };
  if (!state.leases.some((l) => l.room === draft.room && l.status === "active"))
    return { ok: false, error: "ห้องนี้ไม่มีสัญญาเช่าที่ใช้งาน" };
  if (
    state.invoices.some((i) => i.room === draft.room && i.month === draft.month)
  )
    return {
      ok: false,
      error: "ห้องนี้มีใบแจ้งหนี้ในเดือนที่เลือกแล้ว กรุณาเลือกเดือนใหม่",
    };
  const result = calculateBill(draft.meters);
  if (!result.ok) return result;
  const id = crypto.randomUUID();
  return {
    ok: true,
    value: {
      ...state,
      invoices: [
        {
          id,
          number: `INV-${draft.month.replace("-", "")}-${draft.room}`,
          room: draft.room,
          month: draft.month,
          date: `${draft.month}-01`,
          dueDate: `${draft.month}-05`,
          lines: result.value,
        },
        ...state.invoices,
      ],
    },
  };
}

export function addExpense(
  state: DemoState,
  draft: ExpenseDraft,
): Result<DemoState> {
  const amount = parseAmount(draft.amount);
  if (!amount.ok) return amount;
  if (!draft.title.trim() || !draft.vendor.trim())
    return { ok: false, error: "กรุณากรอกรายการและผู้ขาย / ผู้รับเงิน" };
  if (!validDate.safeParse(draft.date).success)
    return { ok: false, error: "กรุณาระบุวันที่ให้ถูกต้อง" };
  return {
    ok: true,
    value: {
      ...state,
      expenses: [
        {
          ...draft,
          id: crypto.randomUUID(),
          title: draft.title.trim(),
          vendor: draft.vendor.trim(),
          amount: amount.value,
        },
        ...state.expenses,
      ],
    },
  };
}

export function addTicket(
  state: DemoState,
  draft: TicketDraft,
): Result<DemoState> {
  if (!state.rooms.some((r) => r.number === draft.room) || !draft.issue.trim())
    return { ok: false, error: "กรุณาเลือกห้องและระบุปัญหาที่พบ" };
  return {
    ok: true,
    value: {
      ...state,
      tickets: [
        {
          ...draft,
          id: `MT-${crypto.randomUUID().slice(0, 6)}`,
          date: DEMO_TODAY,
          status: "pending",
          issue: draft.issue.trim(),
        },
        ...state.tickets,
      ],
    },
  };
}
export function updateTicket(
  state: DemoState,
  id: string,
  status: Ticket["status"],
): Result<DemoState> {
  if (!state.tickets.some((t) => t.id === id))
    return { ok: false, error: "ไม่พบรายการแจ้งซ่อม" };
  return {
    ok: true,
    value: {
      ...state,
      tickets: state.tickets.map((t) => (t.id === id ? { ...t, status } : t)),
    },
  };
}
const tenantSchema = z.object({
  id: z.string(),
  name: z.string().trim().min(1),
  phone: z.string().regex(/^[0-9\-+ ]{9,15}$/),
  email: z.email(),
  address: z.string().trim().min(1),
});
export function saveTenant(
  state: DemoState,
  tenant: Tenant,
): Result<DemoState> {
  const parsed = tenantSchema.safeParse(tenant);
  if (!parsed.success)
    return {
      ok: false,
      error: "กรุณากรอกชื่อ เบอร์โทร อีเมล และที่อยู่ให้ครบถ้วนและถูกต้อง",
    };
  return {
    ok: true,
    value: {
      ...state,
      tenants: state.tenants.map((t) => (t.id === tenant.id ? parsed.data : t)),
    },
  };
}
export function saveSettings(
  state: DemoState,
  settings: Settings,
): Result<DemoState> {
  if (!settings.propertyName.trim())
    return { ok: false, error: "กรุณาระบุชื่อหอพัก" };
  return { ok: true, value: { ...state, settings } };
}
export function saveRoom(
  state: DemoState,
  input: {
    number: string;
    rent: string;
    status: "vacant" | "maintenance" | "occupied";
  },
): Result<DemoState> {
  const rent = parseAmount(input.rent);
  if (!rent.ok) return rent;
  const active = state.leases.some(
    (l) => l.room === input.number && l.status === "active",
  );
  if (active && input.status !== "occupied")
    return { ok: false, error: "ห้องที่มีสัญญาใช้งานต้องมีสถานะมีผู้เช่า" };
  if (!active && input.status === "occupied")
    return { ok: false, error: "สถานะมีผู้เช่าต้องมาจากสัญญาเช่า" };
  return {
    ok: true,
    value: {
      ...state,
      rooms: state.rooms.map((r) =>
        r.number === input.number
          ? { ...r, rent: rent.value, status: input.status }
          : r,
      ),
    },
  };
}
