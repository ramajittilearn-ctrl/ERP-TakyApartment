"use client";
import { useState, type FormEvent } from "react";
import {
  Database,
  HardDrive,
  ShieldCheck,
  Cloud,
  Save,
  RotateCcw,
  UserRound,
} from "lucide-react";
import {
  Badge,
  Button,
  Card,
  DataTable,
  ErrorMessage,
  Field,
  Modal,
  Notice,
  SuccessMessage,
  Tabs,
} from "@/components/ui";
import { useDemo } from "@/demo/workspace";
import { parseAmount } from "@/demo/finance";
import { baht, type Room } from "@/demo/model";
import { money } from "@/lib/format";

export function SettingsScreen() {
  const { state, saveSettings, saveRoom, reset } = useDemo();
  const [name, setName] = useState(state.settings.propertyName);
  const [phone, setPhone] = useState(state.settings.phone);
  const [water, setWater] = useState(String(state.settings.waterRate / 100));
  const [electric, setElectric] = useState(
    String(state.settings.electricRate / 100),
  );
  const [fee, setFee] = useState(String(state.settings.commonFee / 100));
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [resetOpen, setResetOpen] = useState(false);
  const [room, setRoom] = useState<Room | null>(null);
  const [rent, setRent] = useState("");
  const [roomStatus, setRoomStatus] = useState<Room["status"]>("vacant");
  function saveProperty(e: FormEvent) {
    e.preventDefault();
    const r = saveSettings({
      ...state.settings,
      propertyName: name.trim(),
      phone,
    });
    if (!r.ok) {
      setError(r.error);
      return;
    }
    setError("");
    setSuccess("บันทึกข้อมูลหอพักสาธิตแล้ว");
  }
  function saveRates(e: FormEvent) {
    e.preventDefault();
    const w = parseAmount(water);
    const el = parseAmount(electric);
    const f =
      fee.trim() === "0"
        ? { ok: true as const, value: baht(0) }
        : parseAmount(fee);
    if (!w.ok || !el.ok || !f.ok) {
      setError(
        "กรุณาระบุอัตราน้ำและไฟมากกว่า 0 ค่าส่วนกลางตั้งแต่ 0 และไม่เกิน 2 ตำแหน่งทศนิยม",
      );
      return;
    }
    const r = saveSettings({
      ...state.settings,
      waterRate: w.value,
      electricRate: el.value,
      commonFee: f.value,
    });
    if (!r.ok) {
      setError(r.error);
      return;
    }
    setError("");
    setSuccess(
      "บันทึกอัตราสาธิตแล้ว มีผลกับบิลใหม่เท่านั้น บิลที่ออกแล้วคงยอดเดิม",
    );
  }
  function submitRoom(e: FormEvent) {
    e.preventDefault();
    if (!room) return;
    const r = saveRoom({ number: room.number, rent, status: roomStatus });
    if (!r.ok) {
      setError(r.error);
      return;
    }
    setRoom(null);
    setError("");
    setSuccess("บันทึกข้อมูลห้องสาธิตแล้ว ค่าเช่าในสัญญาเดิมไม่เปลี่ยน");
  }
  const backup = (
    <div className="settings-layout">
      <div>
        <div className="settings-status">
          <div className="settings-status-heading">
            <h2>การสำรองข้อมูลอัตโนมัติ (รายสัปดาห์)</h2>
            <Badge tone="gray">ยังไม่เปิดใช้งาน</Badge>
          </div>
          <div className="backup-info">
            <div>
              <p className="text-small muted-text">
                เป้าหมายเมื่อพัฒนาระบบจริง
              </p>
              <dl className="backup-facts">
                <dt>กำหนดเวลา</dt>
                <dd>ทุกสัปดาห์ (ตั้งค่าในระยะถัดไป)</dd>
                <dt>ปลายทาง</dt>
                <dd>
                  <Cloud
                    size={14}
                    style={{ display: "inline", marginRight: 5 }}
                  />
                  Google Drive (เลือกเชื่อมต่อได้)
                </dd>
                <dt>การเข้ารหัส</dt>
                <dd>เข้ารหัสภายในเครื่องก่อนส่ง</dd>
                <dt>สำรองล่าสุด</dt>
                <dd>ยังไม่มีการสำรองข้อมูล</dd>
                <dt>สถานะการเชื่อมต่อ</dt>
                <dd>
                  <Badge tone="amber">ยังไม่ได้เชื่อมต่อ</Badge>
                </dd>
              </dl>
            </div>
            <Button disabled title="ต้องมีฐานข้อมูลและระบบเข้ารหัสใน Phase 5">
              <HardDrive size={15} />
              สำรองข้อมูลทันที
            </Button>
          </div>
          <Notice>
            Phase 1 เป็นหน้าจอสาธิต จึงยังไม่มีฐานข้อมูล ไฟล์สำรอง
            หรือการเชื่อมต่อ Google Drive
          </Notice>
        </div>
        <div className="settings-status">
          <div className="settings-status-heading">
            <h2>กู้คืนข้อมูล (Restore)</h2>
            <Button
              variant="ghost"
              disabled
              title="เปิดใช้หลังทดสอบระบบกู้คืนใน Phase 5"
            >
              <Database size={15} />
              เลือกไฟล์เพื่อกู้คืน
            </Button>
          </div>
          <p className="text-small muted-text">
            ระบบจริงจะตรวจสอบไฟล์ ขอการยืนยันจากผู้ดูแล
            และสร้างสำเนาความปลอดภัยก่อนกู้คืน
          </p>
        </div>
      </div>
      <Card className="settings-side">
        <div className="settings-info-icon">
          <ShieldCheck size={24} />
        </div>
        <h2>ข้อมูลอยู่กับคุณ</h2>
        <p className="paragraph-gap">
          ระบบจริงจะทำงานภายในเครือข่ายหอพัก
          และใช้งานประจำวันได้แม้ไม่มีอินเทอร์เน็ต
        </p>
        <ul>
          <li>ฐานข้อมูลไม่เปิดให้เข้าถึงจาก LAN โดยตรง</li>
          <li>ไฟล์สำรองเข้ารหัสก่อนส่งออก</li>
          <li>ทดสอบการกู้คืนก่อนเริ่มใช้งานจริง</li>
        </ul>
      </Card>
    </div>
  );
  return (
    <>
      {success && <SuccessMessage>{success}</SuccessMessage>}
      <Card>
        <Tabs
          defaultValue="backup"
          items={[
            {
              value: "property",
              label: "ข้อมูลหอพัก",
              content: (
                <div className="stack">
                  <form onSubmit={saveProperty}>
                    <h2>ข้อมูลทั่วไป</h2>
                    <div className="form-grid paragraph-gap">
                      <Field label="ชื่อหอพัก">
                        <input
                          required
                          value={name}
                          maxLength={80}
                          onChange={(e) => setName(e.target.value)}
                        />
                      </Field>
                      <Field label="เบอร์โทรศัพท์หอพัก">
                        <input
                          required
                          type="tel"
                          pattern="[0-9+\- ]{9,15}"
                          value={phone}
                          onChange={(e) => setPhone(e.target.value)}
                        />
                      </Field>
                    </div>
                    <ErrorMessage>{error}</ErrorMessage>
                    <div className="form-actions">
                      <Button type="submit">
                        <Save size={15} />
                        บันทึกข้อมูลสาธิต
                      </Button>
                    </div>
                  </form>
                  <div>
                    <h2 className="paragraph-gap">
                      ข้อมูลห้องพัก 15 ห้อง / 3 ชั้น
                    </h2>
                    <div className="paragraph-gap">
                      <DataTable
                        caption="การตั้งค่าห้องพัก"
                        headers={[
                          "ห้อง",
                          "ชั้น",
                          "ค่าเช่าสำหรับสัญญาใหม่",
                          "สถานะ",
                          "แก้ไข",
                        ]}
                      >
                        {state.rooms.map((r) => (
                          <tr key={r.number}>
                            <td className="table-room">{r.number}</td>
                            <td>{r.floor}</td>
                            <td>{money(r.rent)}</td>
                            <td>
                              <Badge
                                tone={
                                  r.status === "occupied"
                                    ? "green"
                                    : r.status === "vacant"
                                      ? "gray"
                                      : "amber"
                                }
                              >
                                {r.status === "occupied"
                                  ? "มีผู้เช่า"
                                  : r.status === "vacant"
                                    ? "ว่าง"
                                    : "ซ่อมบำรุง"}
                              </Badge>
                            </td>
                            <td>
                              <button
                                className="text-link"
                                onClick={() => {
                                  setError("");
                                  setRoom(r);
                                  setRent(String(r.rent / 100));
                                  setRoomStatus(r.status);
                                }}
                              >
                                แก้ไขห้อง {r.number}
                              </button>
                            </td>
                          </tr>
                        ))}
                      </DataTable>
                    </div>
                  </div>
                </div>
              ),
            },
            {
              value: "rates",
              label: "อัตราค่าน้ำ - ไฟ",
              content: (
                <form onSubmit={saveRates}>
                  <h2>อัตราสาธิตสำหรับบิลใหม่</h2>
                  <div className="form-grid paragraph-gap">
                    <Field label="ค่าน้ำ (บาท / หน่วย)">
                      <input
                        required
                        type="number"
                        min="0.01"
                        step="0.01"
                        value={water}
                        onChange={(e) => setWater(e.target.value)}
                      />
                    </Field>
                    <Field label="ค่าไฟ (บาท / หน่วย)">
                      <input
                        required
                        type="number"
                        min="0.01"
                        step="0.01"
                        value={electric}
                        onChange={(e) => setElectric(e.target.value)}
                      />
                    </Field>
                    <Field label="ค่าส่วนกลาง (บาท / เดือน)">
                      <input
                        required
                        type="number"
                        min="0"
                        step="0.01"
                        value={fee}
                        onChange={(e) => setFee(e.target.value)}
                      />
                    </Field>
                  </div>
                  <div className="paragraph-gap">
                    <Notice>
                      อัตราเหล่านี้เป็นตัวอย่างสำหรับทดสอบเท่านั้น
                      มีผลกับบิลใหม่ ใบแจ้งหนี้ที่ออกแล้วเก็บอัตราเดิมไว้
                    </Notice>
                  </div>
                  <ErrorMessage>{error}</ErrorMessage>
                  <div className="form-actions">
                    <Button type="submit">
                      <Save size={15} />
                      บันทึกอัตราสาธิต
                    </Button>
                  </div>
                </form>
              ),
            },
            {
              value: "users",
              label: "ผู้ใช้งาน",
              content: (
                <>
                  <h2>ผู้ใช้งานตัวอย่าง</h2>
                  <div className="user-row">
                    <span className="avatar">
                      <UserRound size={22} />
                    </span>
                    <div>
                      <strong>ผู้ดูแลตัวอย่าง</strong>
                      <p>บัญชีประกอบการออกแบบเท่านั้น</p>
                    </div>
                    <Badge tone="blue">ADMIN</Badge>
                  </div>
                  <Notice>
                    การเข้าสู่ระบบ การจัดการรหัสผ่าน และสิทธิ์ ADMIN / STAFF
                    จะพัฒนาใน Phase 2
                    ไม่มีบัญชีหรือรหัสผ่านเริ่มต้นในหน้าสาธิตนี้
                  </Notice>
                </>
              ),
            },
            { value: "backup", label: "สำรองข้อมูล", content: backup },
            {
              value: "system",
              label: "ระบบ",
              content: (
                <>
                  <h2>ข้อมูลระบบสาธิต</h2>
                  <dl className="detail-grid paragraph-gap">
                    <div>
                      <dt>เวอร์ชัน</dt>
                      <dd>0.1.0 / Phase 1</dd>
                    </div>
                    <div>
                      <dt>เขตเวลาแสดงผล</dt>
                      <dd>Asia/Bangkok</dd>
                    </div>
                    <div>
                      <dt>ข้อมูล</dt>
                      <dd>สมมติ เก็บในหน่วยความจำ</dd>
                    </div>
                    <div>
                      <dt>การเชื่อมต่อฐานข้อมูล</dt>
                      <dd>ยังไม่เปิดใช้งาน</dd>
                    </div>
                  </dl>
                  <div className="paragraph-gap">
                    <Notice>
                      รีเซ็ตเพื่อล้างการเปลี่ยนแปลงสาธิตและเริ่มจากข้อมูลตัวอย่างเดิม
                    </Notice>
                  </div>
                  <div className="paragraph-gap">
                    <Button variant="danger" onClick={() => setResetOpen(true)}>
                      <RotateCcw size={15} />
                      รีเซ็ตข้อมูลสาธิต
                    </Button>
                  </div>
                </>
              ),
            },
          ]}
        />
      </Card>
      <Modal
        open={resetOpen}
        onOpenChange={setResetOpen}
        title="รีเซ็ตข้อมูลสาธิต"
      >
        <p>การเปลี่ยนแปลงในแท็บนี้จะถูกล้าง และคืนข้อมูลตัวอย่างเริ่มต้น</p>
        <div className="form-actions">
          <Button variant="ghost" onClick={() => setResetOpen(false)}>
            ยกเลิก
          </Button>
          <Button
            variant="danger"
            onClick={() => {
              reset();
              setName("Taky Apartment");
              setPhone("080-000-0000");
              setWater("20");
              setElectric("8");
              setFee("100");
              setResetOpen(false);
              setError("");
              setSuccess("รีเซ็ตข้อมูลสาธิตแล้ว");
            }}
          >
            ยืนยันรีเซ็ต
          </Button>
        </div>
      </Modal>
      <Modal
        open={room !== null}
        onOpenChange={(open) => {
          if (!open) setRoom(null);
        }}
        title={`ตั้งค่าห้อง ${room?.number || ""}`}
      >
        {room && (
          <form onSubmit={submitRoom}>
            <div className="form-grid">
              <Field label="ค่าเช่าสำหรับสัญญาใหม่ (บาท)">
                <input
                  required
                  type="number"
                  min="0.01"
                  step="0.01"
                  value={rent}
                  onChange={(e) => setRent(e.target.value)}
                />
              </Field>
              <Field label="สถานะห้อง">
                <select
                  value={roomStatus}
                  disabled={state.leases.some(
                    (l) => l.room === room.number && l.status === "active",
                  )}
                  onChange={(e) =>
                    setRoomStatus(
                      e.target.value === "maintenance"
                        ? "maintenance"
                        : "vacant",
                    )
                  }
                >
                  <option value="vacant">ว่าง</option>
                  <option value="maintenance">ซ่อมบำรุง</option>
                  {room.status === "occupied" && (
                    <option value="occupied">มีผู้เช่า</option>
                  )}
                </select>
              </Field>
            </div>
            <div className="paragraph-gap">
              <Notice>
                ค่าเช่าในสัญญาเดิมยังคงเดิม
                ห้องที่มีสัญญาใช้งานจะเปลี่ยนสถานะผ่านการจัดการสัญญาในระยะถัดไป
              </Notice>
            </div>
            <ErrorMessage>{error}</ErrorMessage>
            <div className="form-actions">
              <Button variant="ghost" onClick={() => setRoom(null)}>
                ยกเลิก
              </Button>
              <Button type="submit">บันทึกห้องสาธิต</Button>
            </div>
          </form>
        )}
      </Modal>
    </>
  );
}
