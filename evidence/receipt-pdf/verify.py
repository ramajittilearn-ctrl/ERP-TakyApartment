"""Verify actual receipt PDF text and page facts, independently of PDFKit helpers."""
from decimal import Decimal
from pathlib import Path
import json
from pypdf import PdfReader

root = Path(__file__).parent
fixtures = json.loads((root / "fixtures.json").read_text())
checks = []


def check(name, passed, detail=""):
    checks.append(dict(name=name, passed=bool(passed), detail=detail))


for name, receipt in fixtures.items():
    reader = PdfReader(root / "artifacts" / f"{name}.pdf")
    # The font's ToUnicode mapping repeats the AA component of shaped Thai SARA AM.
    # Normalize only that extraction representation; rendered pages need visual review.
    pages = [page.extract_text().replace("ำา", "ำ") for page in reader.pages]
    text = "\n".join(pages)
    (root / "artifacts" / f"{name}.txt").write_text(text)
    snapshot = receipt["snapshot"]
    check(f"{name}: A4", all(abs(float(p.mediabox.width) - 595.28) < .1 and abs(float(p.mediabox.height) - 841.89) < .1 for p in reader.pages), str(len(pages)))
    check(f"{name}: exact received amount", f'฿{Decimal(snapshot["amount"]):,.2f}' in text)
    check(f"{name}: exact allocations and original invoice totals", all(f'฿{Decimal(invoice[field]):,.2f}' in text for invoice in snapshot["invoices"] for field in ["finalTotal", "allocatedAmount"]))
    check(f"{name}: allocation sum", sum(Decimal(i["allocatedAmount"]) for i in snapshot["invoices"]) == Decimal(snapshot["amount"]))
    check(f"{name}: all original invoice numbers", all(i["number"] in text for i in snapshot["invoices"]))
    check(f"{name}: snapshot number on every page", all(snapshot["number"] in page for page in pages))
    check(f"{name}: operator and bank reference", snapshot["issuedBy"]["name"] in text and snapshot["externalReference"] in text)
    check(f"{name}: frozen receipt timestamps in Bangkok", "23/10/2026 01:01:02" in text and "23/10/2026 01:05:06" in text)
    check(f"{name}: fingerprint", receipt["fingerprint"] in text.replace("\n", ""))
    check(f"{name}: no missing glyphs", "\x00" not in text)
    check(f"{name}: actual Baht and superscript-three glyph", "฿" in text and "m³" in text)
    check(f"{name}: record notice every page", all("ข้อมูลผู้ออกเอกสารตามกฎหมายยังไม่ได้กำหนด" in page for page in pages))
    check(f"{name}: page numbering", all(f"หน้า / Page {index + 1} / {len(pages)}" in page for index, page in enumerate(pages)))
    cancellation = receipt["cancellation"]
    if cancellation:
        check(f"{name}: cancellation every page", all("ยกเลิก / CANCELLED" in page for page in pages))
        check(f"{name}: cancellation provenance", cancellation["actorId"] in text and cancellation["reversalId"] in text and "24/10/2026 02:01:02" in text)
    else:
        check(f"{name}: no false cancellation", "CANCELLED" not in text)
    if name == "long":
        check("long: full oversized blocks retained", all(sentinel in text for sentinel in ["ADDRESS-END", "TENANT-END", "REASON-END"]) and len(pages) > 1)
    if name == "hundred":
        check("hundred: continuation table heading", len(pages) > 1 and all("ใบแจ้งหนี้ / Invoice" in page for page in pages))

(root / "checks.json").write_text(json.dumps(checks, ensure_ascii=False, indent=2) + "\n")
for row in checks:
    print(("PASS " if row["passed"] else "FAIL ") + row["name"] + " " + row["detail"])
print(f'{sum(row["passed"] for row in checks)}/{len(checks)} checks passed')
raise SystemExit(0 if all(row["passed"] for row in checks) else 1)
