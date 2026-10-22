"use client";
import { Button, Card } from "@/components/ui";
export default function ErrorPage({ retry }: { retry: () => void }) {
  return (
    <Card title="ไม่สามารถแสดงข้อมูลได้">
      <p>เกิดข้อผิดพลาดในการแสดงหน้าจอ กรุณาลองอีกครั้ง</p>
      <div className="paragraph-gap">
        <Button onClick={retry}>ลองอีกครั้ง</Button>
      </div>
    </Card>
  );
}
