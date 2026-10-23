"""Read actual rendered artifacts; no DB or application writes."""
from pathlib import Path
from decimal import Decimal
import json
from pypdf import PdfReader
root = Path(__file__).parent
checks=[]
def check(name,passed,detail=''):
    checks.append(dict(name=name,passed=bool(passed),detail=detail))
fixtures=json.loads((root/'fixtures.json').read_text())
for name,fixture in fixtures.items():
    reader=PdfReader(root/f'{name}.pdf')
    text='\n'.join(page.extract_text() for page in reader.pages)
    (root/f'{name}.txt').write_text(text)
    check(f'{name}: A4 pages',all(abs(float(p.mediabox.width)-595.28)<.1 and abs(float(p.mediabox.height)-841.89)<.1 for p in reader.pages),f'{len(reader.pages)} pages')
    check(f'{name}: frozen total exact',f'{Decimal(fixture["total"]):,.2f}' in text,fixture['total'])
    check(f'{name}: frozen line amounts exact',all(f'{Decimal(line["amount"]):,.2f}' in text for line in fixture['lines']))
    check(f'{name}: Thai invoice heading','ใบแจ้งหนี้ / INVOICE' in text)
    check(f'{name}: no missing glyphs','\x00' not in text,f'{text.count(chr(0))} U+0000 characters')
    check(f'{name}: baht currency visible','฿' in text)
    check(f'{name}: water unit visible','m³' in text)
    check(f'{name}: revision footer','Revision 1' in text)
    check(f'{name}: line sum equals total',sum(Decimal(line['amount']) for line in fixture['lines'])==Decimal(fixture['total']))
    if name=='void':
        check('void: watermark/status/reason','VOID / ยกเลิก' in text and 'บันทึกผิด' in text and text.count('VOID')>=3)
check('approved sample formula: water',Decimal('3.500')*Decimal('18.00')==Decimal('63.00'))
check('approved sample formula: electricity',Decimal('125.250')*Decimal('7.00')==Decimal('876.75'))
(root/'checks.json').write_text(json.dumps(checks,indent=2,ensure_ascii=False)+'\n')
for row in checks: print(('PASS' if row['passed'] else 'FAIL')+' '+row['name']+' '+row['detail'])
print(f"{sum(row['passed'] for row in checks)}/{len(checks)} checks passed")
raise SystemExit(0 if all(row['passed'] for row in checks) else 1)
