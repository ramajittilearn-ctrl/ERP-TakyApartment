import {
  depositLedgerDtoSchema,
  type DepositLedgerDto,
} from "../../server/deposits/contracts";
import {
  DepositApiError,
  depositRequest,
  depositSessionSchema,
} from "./client";
import type { DepositOperation } from "./form";

type Identity = Readonly<{
  actorId: string;
  leaseId: string;
  operation: DepositOperation;
  key: string;
  path: string;
  body: string;
  generation: number;
  mayHaveCommitted: boolean;
}>;
export type DepositAttempt = Identity &
  (
    | { state: "submitting" | "uncertain"; message: string }
    | { state: "rejected"; code: string; message: string }
    | { state: "success"; result: DepositLedgerDto }
  );
let actor: string | null = null;
let generation = 0;
let attempt: DepositAttempt | null = null;
const listeners = new Set<() => void>();
const pending = () =>
  attempt?.state === "submitting" || attempt?.state === "uncertain";
const unload = (event: BeforeUnloadEvent) => {
  if (pending()) {
    event.preventDefault();
    event.returnValue = "";
  }
};
if (typeof window !== "undefined")
  window.addEventListener("beforeunload", unload);
function emit() {
  for (const listener of listeners) listener();
}
export function bindDepositActor(id: string) {
  if (actor !== id) {
    actor = id;
    generation++;
    attempt = null;
    emit();
  }
}
export function depositJournal(id: string) {
  return actor === id ? attempt : null;
}
export function subscribeDeposits(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
export function dismissDepositAttempt(id: string) {
  if (actor === id && !pending()) {
    attempt = null;
    emit();
  }
}
async function execute(frozen: DepositAttempt) {
  try {
    const session = await depositRequest(
      "/api/v1/deposit-session/",
      depositSessionSchema,
    );
    if (session.id !== frozen.actorId || session.role !== "ADMIN")
      throw new DepositApiError(
        403,
        "SESSION_CHANGED",
        "ผู้ใช้หรือสิทธิ์เปลี่ยนแล้ว กรุณาเข้าสู่ระบบด้วยผู้ทำรายการเดิมและตรวจสอบผลก่อนทำรายการใหม่",
      );
    const result = await depositRequest(
      frozen.path,
      depositLedgerDtoSchema,
      frozen.body,
      frozen.actorId,
    );
    if (actor === frozen.actorId && generation === frozen.generation)
      attempt = { ...frozen, state: "success", result };
  } catch (error) {
    if (actor !== frozen.actorId || generation !== frozen.generation) return;
    const definite =
      error instanceof DepositApiError &&
      error.status >= 400 &&
      error.status < 500 &&
      error.code !== "INVALID_RESPONSE" &&
      error.code !== "IDEMPOTENCY_CONFLICT";
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
              "ยังไม่ทราบผล รายการอาจบันทึกแล้ว ให้ตรวจสอบด้วยการส่งคำสั่งเดิม ห้ามสร้างรายการใหม่" +
              (error instanceof DepositApiError ? ` (${error.message})` : ""),
          };
  } finally {
    emit();
  }
}
export function submitDepositAttempt(input: {
  actorId: string;
  leaseId: string;
  operation: DepositOperation;
  key: string;
  path: string;
  body: object;
}) {
  bindDepositActor(input.actorId);
  if (pending()) return;
  const frozen: DepositAttempt = {
    ...input,
    body: JSON.stringify(input.body),
    generation,
    mayHaveCommitted: false,
    state: "submitting",
    message: "กำลังตรวจสอบผู้ใช้และบันทึกรายการ",
  };
  attempt = frozen;
  emit();
  void execute(frozen);
}
export function retryDepositAttempt(id: string) {
  if (actor !== id || attempt?.state !== "uncertain") return;
  const frozen: DepositAttempt = {
    ...attempt,
    state: "submitting",
    message: "กำลังตรวจสอบผลด้วยคำสั่งเดิม",
  };
  attempt = frozen;
  emit();
  void execute(frozen);
}
