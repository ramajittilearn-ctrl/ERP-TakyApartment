import Link from "next/link";
export default function NotFound() {
  return (
    <section className="card empty-state">
      <h2>ไม่พบหน้าที่ต้องการ</h2>
      <p>ตรวจสอบที่อยู่หรือกลับไปที่หน้าภาพรวม</p>
      <Link className="btn btn-primary" href="/">
        กลับหน้าภาพรวม
      </Link>
    </section>
  );
}
