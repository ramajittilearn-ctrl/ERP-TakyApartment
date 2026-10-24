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
  const live = [
    "/rooms",
    "/tenants",
    "/leases",
    "/meters",
    "/billing",
    "/payments",
    "/expenses",
  ].some((route) => path.startsWith(route));
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
              {live ? "ฐานข้อมูลจริง" : "หน้าจอสาธิต"}
            </span>
            <button
              className="icon-button help-button"
              aria-label={
                live ? "เกี่ยวกับการบันทึกข้อมูล" : "เกี่ยวกับโหมดสาธิต"
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
            {live
              ? "บันทึกข้อมูลใน PostgreSQL ภายในเครื่อง"
              : "ข้อมูลสมมติ • หน้านี้ยังไม่เชื่อมต่อฐานข้อมูล • รีเซ็ตเมื่อโหลดใหม่"}
          </span>
          <span>
            Taky Apartment <span className="footer-dot">•</span> Phase 2
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
        title={live ? "เกี่ยวกับการบันทึกข้อมูล" : "เกี่ยวกับโหมดสาธิต"}
        description={
          live
            ? "ข้อมูลของหน้านี้บันทึกในฐานข้อมูล PostgreSQL"
            : "หน้าจอสาธิตแยกจากข้อมูลจริง"
        }
      >
        {live ? (
          <p>
            หน้านี้อ่านและบันทึกข้อมูลในฐานข้อมูลจริง
            รายการรับชำระรอตรวจสอบยังไม่ใช่รายรับยืนยันและยังไม่มีใบเสร็จ
          </p>
        ) : (
          <p>
            หน้านี้ยังเป็นหน้าจอสาธิต
            ข้อมูลสมมติอยู่ในหน่วยความจำของแท็บและรีเซ็ตเมื่อโหลดใหม่
          </p>
        )}
        <p className="text-small muted-text paragraph-gap">
          ห้องพัก ผู้เช่า สัญญา มิเตอร์ การออกบิล
          และรับชำระใช้ข้อมูลจากฐานข้อมูล ส่วนค่าใช้จ่าย รายงาน แจ้งซ่อม
          และการตั้งค่ายังมีหน้าจอสาธิต
        </p>
      </Modal>
    </div>
  );
}
