import { Button } from "@/components/ui";
import { dismissSettled, retryAttempt, type Attempt } from "./journal";
import styles from "./screen.module.css";

export function CommandRecovery({
  attempt,
  actorId,
}: {
  attempt: Attempt | null;
  actorId: string;
}) {
  if (!attempt || attempt.state === "success") return null;
  return (
    <section
      className={styles.recovery}
      aria-label="ติดตามผลคำสั่งรับชำระ"
      aria-busy={attempt.state === "submitting"}
    >
      <h2>ติดตามผลรายการ</h2>
      <p role={attempt.state === "rejected" ? "alert" : "status"}>
        {attempt.message}
      </p>
      {attempt.state === "uncertain" && (
        <>
          <p>
            คำสั่งเดิมยังอยู่ในแท็บนี้แม้เปลี่ยนเมนู
            การโหลดใหม่หรือปิดแท็บจะสูญเสียคำสั่ง
            กรุณาตรวจรายการที่บันทึกแล้วก่อนทำใหม่
          </p>
          <Button onClick={() => retryAttempt(actorId)}>
            ลองส่งคำสั่งเดิมอีกครั้ง
          </Button>
        </>
      )}
      {attempt.state === "rejected" &&
        attempt.code !== "IDEMPOTENCY_CONFLICT" && (
          <Button variant="ghost" onClick={() => dismissSettled(actorId)}>
            รับทราบผลที่ปฏิเสธ
          </Button>
        )}
    </section>
  );
}
