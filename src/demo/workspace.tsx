"use client";

import {
  createContext,
  useContext,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { createFixtures } from "./fixtures";
import * as commands from "./commands";
import type {
  BillDraft,
  DemoState,
  ExpenseDraft,
  PaymentDraft,
  Result,
  Settings,
  Tenant,
  Ticket,
  TicketDraft,
} from "./model";

type Workspace = {
  state: DemoState;
  recordPayment: (draft: PaymentDraft) => Result<DemoState>;
  issueInvoice: (draft: BillDraft) => Result<DemoState>;
  addExpense: (draft: ExpenseDraft) => Result<DemoState>;
  addTicket: (draft: TicketDraft) => Result<DemoState>;
  updateTicket: (id: string, status: Ticket["status"]) => Result<DemoState>;
  saveTenant: (tenant: Tenant) => Result<DemoState>;
  saveSettings: (settings: Settings) => Result<DemoState>;
  saveRoom: (
    input: Parameters<typeof commands.saveRoom>[1],
  ) => Result<DemoState>;
  reset: () => void;
};
const Context = createContext<Workspace | null>(null);

export function DemoProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState(createFixtures);
  const current = useRef(state);
  function commit(
    command: (previous: DemoState) => Result<DemoState>,
  ): Result<DemoState> {
    const result = command(current.current);
    if (result.ok) {
      current.current = result.value;
      setState(result.value);
    }
    return result;
  }
  return (
    <Context.Provider
      value={{
        state,
        recordPayment: (draft) =>
          commit((s) => commands.recordPayment(s, draft)),
        issueInvoice: (draft) => commit((s) => commands.issueInvoice(s, draft)),
        addExpense: (draft) => commit((s) => commands.addExpense(s, draft)),
        addTicket: (draft) => commit((s) => commands.addTicket(s, draft)),
        updateTicket: (id, status) =>
          commit((s) => commands.updateTicket(s, id, status)),
        saveTenant: (tenant) => commit((s) => commands.saveTenant(s, tenant)),
        saveSettings: (settings) =>
          commit((s) => commands.saveSettings(s, settings)),
        saveRoom: (input) => commit((s) => commands.saveRoom(s, input)),
        reset: () => {
          const next = createFixtures();
          current.current = next;
          setState(next);
        },
      }}
    >
      {children}
    </Context.Provider>
  );
}
export function useDemo(): Workspace {
  const value = useContext(Context);
  if (!value) throw new Error("DemoProvider is required");
  return value;
}
