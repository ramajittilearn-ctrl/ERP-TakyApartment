"use client";

import * as Dialog from "@radix-ui/react-dialog";
import * as RadixTabs from "@radix-ui/react-tabs";
import { X, Search, Inbox, Info, ChevronDown, Plus } from "lucide-react";
import {
  cloneElement,
  useId,
  useRef,
  type ReactElement,
  type ReactNode,
  type ButtonHTMLAttributes,
} from "react";
import { months } from "@/demo/model";
import { monthLabel } from "@/lib/format";

export function Button({
  children,
  variant = "primary",
  className = "",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "ghost" | "danger";
}) {
  return (
    <button
      type="button"
      {...props}
      className={`btn btn-${variant} ${className}`}
    >
      {children}
    </button>
  );
}
export function AddButton({
  children,
  onClick,
}: {
  children: ReactNode;
  onClick: () => void;
}) {
  return (
    <Button onClick={onClick}>
      <Plus size={17} aria-hidden="true" />
      {children}
    </Button>
  );
}
export function Card({
  title,
  description,
  action,
  children,
  className = "",
}: {
  title?: ReactNode;
  description?: string;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`card ${className}`}>
      {(title || action) && (
        <div className="card-heading">
          <div>
            {title && <h2>{title}</h2>}
            {description && (
              <p className="text-small muted-text">{description}</p>
            )}
          </div>
          {action}
        </div>
      )}
      {children}
    </section>
  );
}
export type Tone = "green" | "blue" | "red" | "amber" | "gray" | "purple";
export function Badge({
  children,
  tone = "green",
  dot = false,
}: {
  children: ReactNode;
  tone?: Tone;
  dot?: boolean;
}) {
  return (
    <span className={`badge badge-${tone}`}>
      {dot && <span className="status-dot" aria-hidden="true" />}
      {children}
    </span>
  );
}
export function Field({
  label,
  hint,
  children,
  className = "",
}: {
  label: string;
  hint?: string;
  children: ReactElement<{ id?: string; "aria-describedby"?: string }>;
  className?: string;
}) {
  const id = useId();
  return (
    <div className={`field ${className}`}>
      <label htmlFor={id}>{label}</label>
      {cloneElement(children, {
        id,
        "aria-describedby": hint
          ? `${id}-hint`
          : children.props["aria-describedby"],
      })}
      {hint && <small id={`${id}-hint`}>{hint}</small>}
    </div>
  );
}
export function ErrorMessage({ children }: { children: ReactNode }) {
  return children ? (
    <p className="error-message" role="alert">
      {children}
    </p>
  ) : null;
}
export function SuccessMessage({ children }: { children: ReactNode }) {
  return (
    <div className="success-message" role="status">
      {children}
    </div>
  );
}
export function Notice({ children }: { children: ReactNode }) {
  return (
    <div className="notice">
      <Info size={16} aria-hidden="true" />
      <span>{children}</span>
    </div>
  );
}
export function SearchField({
  value,
  onChange,
  placeholder = "ค้นหา...",
  label = "ค้นหา",
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  label?: string;
}) {
  return (
    <label className="search-field">
      <Search size={16} aria-hidden="true" />
      <span className="sr-only">{label}</span>
      <input
        type="search"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
      />
    </label>
  );
}
export function MonthSelect({
  value,
  onChange,
  next = false,
}: {
  value: string;
  onChange: (value: string) => void;
  next?: boolean;
}) {
  const options = [
    ...new Set([...months, ...(next ? ["2026-11", "2026-12"] : []), value]),
  ]
    .sort()
    .toReversed();
  return (
    <label className="select-wrap">
      <span className="sr-only">เดือน</span>
      <select
        aria-label="เดือน"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      >
        {options.map((m) => (
          <option key={m} value={m}>
            {monthLabel(m)}
          </option>
        ))}
      </select>
      <ChevronDown size={15} aria-hidden="true" />
    </label>
  );
}
export function EmptyState({
  title = "ไม่พบรายการ",
  description = "ลองเปลี่ยนคำค้นหาหรือตัวกรอง",
  action,
}: {
  title?: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="empty-state">
      <span className="empty-icon">
        <Inbox size={25} />
      </span>
      <h3>{title}</h3>
      <p>{description}</p>
      {action}
    </div>
  );
}
export function DataTable({
  caption,
  headers,
  children,
  empty = false,
}: {
  caption: string;
  headers: string[];
  children: ReactNode;
  empty?: boolean;
}) {
  return empty ? (
    <EmptyState />
  ) : (
    <div
      className="table-scroll"
      role="region"
      aria-label={caption}
      tabIndex={0}
    >
      <table>
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr>
            {headers.map((h) => (
              <th key={h} scope="col">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}
export function Modal({
  open,
  onOpenChange,
  title,
  description = "ข้อมูลสาธิต การเปลี่ยนแปลงจะอยู่เฉพาะรอบการใช้งานนี้",
  children,
  wide = false,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  children: ReactNode;
  wide?: boolean;
}) {
  const returnFocus = useRef<HTMLElement | null>(null);
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="modal-overlay" />
        <Dialog.Content
          className={`modal-content ${wide ? "modal-wide" : ""}`}
          onOpenAutoFocus={() => {
            if (document.activeElement instanceof HTMLElement)
              returnFocus.current = document.activeElement;
          }}
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            returnFocus.current?.focus();
          }}
        >
          <div className="modal-heading">
            <Dialog.Title>{title}</Dialog.Title>
            <Dialog.Close className="icon-button" aria-label="ปิดหน้าต่าง">
              <X size={20} />
            </Dialog.Close>
          </div>
          <Dialog.Description className="modal-description">
            {description}
          </Dialog.Description>
          <div className="modal-body">{children}</div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
export function Tabs({
  items,
  defaultValue,
}: {
  items: { value: string; label: string; content: ReactNode }[];
  defaultValue?: string;
}) {
  return (
    <RadixTabs.Root defaultValue={defaultValue || items[0]?.value}>
      <RadixTabs.List className="tabs-list" aria-label="หมวดข้อมูล">
        {items.map((item) => (
          <RadixTabs.Trigger
            key={item.value}
            value={item.value}
            className="tab-trigger"
          >
            {item.label}
          </RadixTabs.Trigger>
        ))}
      </RadixTabs.List>
      {items.map((item) => (
        <RadixTabs.Content
          className="tab-content"
          key={item.value}
          value={item.value}
        >
          {item.content}
        </RadixTabs.Content>
      ))}
    </RadixTabs.Root>
  );
}
