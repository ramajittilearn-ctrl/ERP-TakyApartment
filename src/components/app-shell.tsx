"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Building2, Menu, ShieldCheck, CircleHelp } from "lucide-react";
import { useState, type ReactNode } from "react";
import { navigation } from "@/lib/navigation";
import { Modal } from "./ui";

export function AppShell({
  children,
  actor,
}: {
  children: ReactNode;
  actor: { name: string; role: "ADMIN" | "STAFF" };
}) {
  const path = usePathname();
  const normalizedPath = path.replace(/\/+$/, "") || "/";
  const isRoute = (route: string) =>
    normalizedPath === route || normalizedPath.startsWith(`${route}/`);
  const readOnly = normalizedPath === "/" || isRoute("/reports");
  const persisted = [
    "/rooms",
    "/tenants",
    "/leases",
    "/meters",
    "/billing",
    "/payments",
    "/deposits",
    "/deposit-entries",
    "/expenses",
  ].some(isRoute);
  const mode = readOnly ? "read-only" : persisted ? "persisted" : "demo";
  const isDemo = mode === "demo";
  const [menu, setMenu] = useState(false);
  const [help, setHelp] = useState(false);
  const current =
    navigation.find(
      (n) => n.href === (path.endsWith("/") ? path : `${path}/`),
    ) || navigation[0];
  const links = (
    <nav aria-label="เมนูหลัก">
      {navigation.map(({ href, label, icon: Icon }) => (
        <Link
          key={href}
          href={href}
          className={`nav-link ${current.href === href ? "active" : ""}`}
          aria-current={current.href === href ? "page" : undefined}
          onClick={() => setMenu(false)}
        >
          <Icon size={19} strokeWidth={1.8} aria-hidden="true" />
          <span>{label}</span>
        </Link>
      ))}
    </nav>
  );
  return (
    <div className="app-shell">
      <a className="skip-link" href="#main-content">
        ข้ามไปเนื้อหาหลัก
      </a>
      <aside className="sidebar">
        <Link href="/" className="brand">
          <span className="brand-icon">
            <Building2 size={24} aria-hidden="true" />
          </span>
          <span>
            Taky Apartment<small>DORMITORY ERP</small>
          </span>
        </Link>
        <div className="nav-group-label">จัดการหอพัก</div>
        {links}
        <div className="sidebar-bottom">
          <div className="sidebar-status">
            <span />
            ระบบภายในพร้อมใช้งาน
          </div>
          <div className="admin-profile">
            <span className="avatar">AD</span>
            <div>
              <strong>{actor.name}</strong>
              <small>{actor.role}</small>
            </div>
            <ShieldCheck size={17} aria-hidden="true" />
          </div>
        </div>
      </aside>
      <div className="workspace">
        <header className="workspace-header">
          <div className="header-title">
            <button
              className="icon-button mobile-menu"
              onClick={() => setMenu(true)}
              aria-label="เปิดเมนูหลัก"
            >
              <Menu size={22} />
            </button>
            <div>
              <div className="breadcrumb">
                Taky Apartment <span>/</span> {current.label}
              </div>
              <h1>
                {current.title}
                {path === "/" && <span className="greeting-dot" />}
              </h1>
              <p>{current.subtitle}</p>
            </div>
          </div>
          <div className="header-actions">
            <span className="demo-badge">
              <span />
              {mode === "read-only"
                ? "ฐานข้อมูลจริง • อ่านอย่างเดียว"
                : isDemo
                  ? "หน้าจอสาธิต"
                  : "ฐานข้อมูลจริง"}
            </span>
            <button
              className="icon-button help-button"
              aria-label={
                mode === "read-only"
                  ? "เกี่ยวกับการอ่านข้อมูล"
                  : isDemo
                    ? "เกี่ยวกับโหมดสาธิต"
                    : "เกี่ยวกับการบันทึกข้อมูล"
              }
              onClick={() => setHelp(true)}
            >
              <CircleHelp size={21} />
            </button>
            <button
              className="btn btn-secondary"
              onClick={async () => {
                const response = await fetch("/api/auth/logout/", {
                  method: "POST",
                });
                if (response.ok) window.location.assign("/login/");
              }}
            >
              ออกจากระบบ
            </button>
          </div>
        </header>
        <main id="main-content" tabIndex={-1}>
          {children}
        </main>
        <footer className="app-footer">
          <span>
            {mode === "read-only"
              ? "อ่านข้อมูลจาก PostgreSQL • หน้านี้ไม่แก้ไขข้อมูล"
              : isDemo
                ? "ข้อมูลสาธิต • หน้านี้ไม่บันทึกลงฐานข้อมูลจริง"
                : "อ่านและบันทึกข้อมูลใน PostgreSQL"}
          </span>
          <span>
            Taky Apartment <span className="footer-dot">•</span> ERP
          </span>
        </footer>
      </div>
      <Modal
        open={menu}
        onOpenChange={setMenu}
        title="เมนูหลัก"
        description="เลือกหน้าที่ต้องการจัดการ"
      >
        <div className="mobile-navigation">{links}</div>
      </Modal>
      <Modal
        open={help}
        onOpenChange={setHelp}
        title={
          mode === "read-only"
            ? "เกี่ยวกับการอ่านข้อมูล"
            : isDemo
              ? "เกี่ยวกับโหมดสาธิต"
              : "เกี่ยวกับการบันทึกข้อมูล"
        }
        description={
          mode === "read-only"
            ? "อ่านข้อมูลจากฐานข้อมูล PostgreSQL โดยไม่แก้ไขข้อมูล"
            : isDemo
              ? "หน้าจอสาธิตแยกจากข้อมูลจริง"
              : "ข้อมูลของหน้านี้อ่านและบันทึกในฐานข้อมูล PostgreSQL"
        }
      >
        {mode === "read-only" ? (
          <p>หน้านี้แสดงข้อมูลที่บันทึกไว้ โดยไม่มีคำสั่งแก้ไขข้อมูล</p>
        ) : isDemo ? (
          <p>
            หน้านี้แสดงข้อมูลสาธิต การเปลี่ยนแปลงไม่ถูกบันทึกลงฐานข้อมูลจริง
          </p>
        ) : (
          <p>การเปลี่ยนแปลงในหน้านี้จะถูกบันทึกในฐานข้อมูล PostgreSQL</p>
        )}
        <p className="text-small muted-text paragraph-gap">
          Dashboard และรายงานการเงินเป็นแบบอ่านอย่างเดียว
          หน้าจัดการข้อมูลที่เชื่อมต่อฐานข้อมูลจะแสดงสถานะฐานข้อมูลจริง
          ส่วนแจ้งซ่อมและการตั้งค่าเป็นหน้าจอสาธิต
        </p>
      </Modal>
    </div>
  );
}
