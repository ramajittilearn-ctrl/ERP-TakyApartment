import {
  paymentDtoSchema,
  type PaymentDto,
} from "../../server/payments/contracts";
import { PaymentApiError, paymentRequest } from "./client";
export type Attempt = Readonly<
  {
    actorId: string;
    mayHaveCommitted: boolean;
    generation: number;
    key: string;
    path: string;
    body: string;
    operation: "create" | "confirm" | "cancel" | "reverse";
  } & (
    | { state: "submitting" | "uncertain"; message: string }
    | { state: "rejected"; code: string; message: string }
    | { state: "success"; result: PaymentDto }
  )
>;
let actor: string | null = null;
let generation = 0;
let attempt: Attempt | null = null;
const listeners = new Set<() => void>();
let watching = false;
const unload = (event: BeforeUnloadEvent) => {
  if (attempt?.state === "submitting" || attempt?.state === "uncertain") {
    event.preventDefault();
    event.returnValue = "";
  }
};
function emit() {
  const required =
    attempt?.state === "submitting" || attempt?.state === "uncertain";
  if (typeof window !== "undefined" && required !== watching) {
    if (required) window.addEventListener("beforeunload", unload);
    else window.removeEventListener("beforeunload", unload);
    watching = required;
  }
  for (const listener of listeners) listener();
}
export function clearJournal() {
  generation++;
  actor = null;
  attempt = null;
  emit();
}
if (typeof window !== "undefined")
  window.addEventListener("pagehide", clearJournal);
export function bindActor(actorId: string) {
  if (actor !== actorId) {
    clearJournal();
    actor = actorId;
  }
}
export function journalSnapshot(actorId: string): Attempt | null {
  return actor === actorId ? attempt : null;
}
export function subscribeJournal(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
export function dismissSettled(actorId: string) {
  if (
    actor === actorId &&
    attempt?.state !== "submitting" &&
    attempt?.state !== "uncertain" &&
    !(attempt?.state === "rejected" && attempt.code === "IDEMPOTENCY_CONFLICT")
  ) {
    attempt = null;
    emit();
  }
}
async function execute(frozen: Attempt) {
  try {
    const result = await paymentRequest({
      path: frozen.path,
      schema: paymentDtoSchema,
      body: frozen.body,
    });
    if (actor === frozen.actorId && generation === frozen.generation)
      attempt = { ...frozen, state: "success", result };
  } catch (error) {
    if (actor !== frozen.actorId || generation !== frozen.generation) return;
    if (error instanceof PaymentApiError && error.status === 401) {
      clearJournal();
      if (typeof window !== "undefined")
        window.location.assign("/login/?payment-reconcile=1");
      return;
    }
    const definite =
      error instanceof PaymentApiError &&
      error.status >= 400 &&
      error.status < 500 &&
      error.code !== "INVALID_RESPONSE";
    attempt =
      definite && !frozen.mayHaveCommitted
        ? {
            ...frozen,
            state: "rejected",
            code: error.code,
            message: error.message,
          }
        : {
            ...frozen,
            state: "uncertain",
            mayHaveCommitted: true,
            message:
              "ยังไม่ทราบผล รายการอาจบันทึกแล้ว ให้ลองส่งคำสั่งเดิมอีกครั้ง ห้ามบันทึกซ้ำเป็นรายการใหม่" +
              (definite ? ` (${error.code}: ${error.message})` : ""),
          };
  } finally {
    emit();
  }
}
export function submitAttempt(input: {
  actorId: string;
  path: string;
  body: object;
  operation: Attempt["operation"];
  key: string;
}) {
  bindActor(input.actorId);
  if (
    attempt?.state === "submitting" ||
    attempt?.state === "uncertain" ||
    (attempt?.state === "rejected" && attempt.code === "IDEMPOTENCY_CONFLICT")
  )
    return;
  const frozen: Attempt = {
    ...input,
    body: JSON.stringify(input.body),
    generation,
    mayHaveCommitted: false,
    state: "submitting",
    message: "กำลังส่งรายการ",
  };
  attempt = frozen;
  emit();
  void execute(frozen);
}
export function retryAttempt(actorId: string) {
  if (actor !== actorId || attempt?.state !== "uncertain") return;
  const frozen: Attempt = {
    ...attempt,
    state: "submitting",
    message: "กำลังส่งคำสั่งเดิมอีกครั้ง",
  };
  attempt = frozen;
  emit();
  void execute(frozen);
}
