"use client";
import { useState, type FormEvent } from "react";
import { Building2 } from "lucide-react";
import { Button, Card, ErrorMessage, Field } from "@/components/ui";
export function LoginScreen() {
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    const data = new FormData(event.currentTarget);
    try {
      const response = await fetch("/api/auth/login/", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          identifier: data.get("identifier"),
          password: data.get("password"),
        }),
      });
      if (!response.ok) {
        setError(
          response.status === 429
            ? "ลองเข้าสู่ระบบมากเกินไป กรุณารอ 15 นาที"
            : "ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง หรือระบบยังไม่พร้อม",
        );
        return;
      }
      window.location.assign("/rooms/");
    } catch {
      setError("ไม่สามารถเชื่อมต่อระบบได้");
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="login-page">
      <Card className="login-card">
        <div className="login-brand">
          <Building2 size={32} />
          <strong>Taky Apartment</strong>
        </div>
        <h1>เข้าสู่ระบบ</h1>
        <p className="muted-text">ระบบบริหารหอพัก • Local-first ERP</p>
        <form className="paragraph-gap" onSubmit={submit}>
          <Field label="ชื่อผู้ใช้หรืออีเมล">
            <input
              name="identifier"
              autoComplete="username"
              required
              maxLength={254}
            />
          </Field>
          <Field label="รหัสผ่าน">
            <input
              name="password"
              type="password"
              autoComplete="current-password"
              required
              maxLength={128}
            />
          </Field>
          <ErrorMessage>{error}</ErrorMessage>
          <div className="form-actions">
            <Button type="submit" disabled={busy}>
              {busy ? "กำลังเข้าสู่ระบบ…" : "เข้าสู่ระบบ"}
            </Button>
          </div>
        </form>
        <p className="text-small muted-text paragraph-gap">
          ใช้งานครั้งแรก: ให้ผู้ดูแลเครื่องสร้างบัญชีด้วยคำสั่ง admin:setup ตาม
          README
        </p>
      </Card>
    </main>
  );
}
