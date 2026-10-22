import {
  baht,
  type DemoState,
  type Invoice,
  type Payment,
  type Room,
  months,
} from "./model";

export function createFixtures(): DemoState {
  const rooms: Room[] = Array.from({ length: 15 }, (_, i) => ({
    number: String((Math.floor(i / 5) + 1) * 100 + (i % 5) + 1),
    floor: Math.floor(i / 5) + 1,
    rent: baht(3500),
    status: [2, 8].includes(i)
      ? "vacant"
      : i === 13
        ? "maintenance"
        : "occupied",
  }));
  const occupied = rooms.filter((r) => r.status === "occupied");
  const tenants = occupied.map((r, i) => ({
    id: `tenant-${r.number}`,
    name: `ผู้เช่าตัวอย่าง ${String.fromCharCode(65 + i)}`,
    phone: `080-000-${String(i + 1).padStart(4, "0")}`,
    email: `tenant${i + 1}@example.com`,
    address: "ที่อยู่ตัวอย่างสำหรับสาธิตระบบเท่านั้น",
  }));
  const leases = occupied.map((r, i) => ({
    id: `CT-2026-${r.number}`,
    room: r.number,
    tenantId: tenants[i].id,
    start: "2026-01-01",
    end: i === 0 ? "2026-10-31" : "2026-12-31",
    rent: r.rent,
    deposit: baht(7000),
    status: "active" as const,
  }));
  const amounts = [
    4600, 4500, 4200, 4300, 4400, 4350, 4450, 4500, 4200, 4250, 4300, 4450,
  ];
  const invoices: Invoice[] = [];
  const payments: Payment[] = [];
  months.forEach((month, monthIndex) => {
    occupied.forEach((r, i) => {
      const amount = amounts[i] - (5 - monthIndex) * 40;
      const invoice: Invoice = {
        id: `inv-${month}-${r.number}`,
        number: `INV-${month.replace("-", "")}-${r.number}`,
        room: r.number,
        month,
        date: `${month}-01`,
        dueDate: `${month}-05`,
        lines: [
          { label: "ค่าเช่าห้อง", quantity: 1, unitPrice: baht(3500) },
          { label: "ค่าน้ำ", quantity: 10, unitPrice: baht(20) },
          { label: "ค่าไฟ", quantity: 1, unitPrice: baht(amount - 3800) },
          { label: "ค่าส่วนกลาง", quantity: 1, unitPrice: baht(100) },
        ],
      };
      invoices.push(invoice);
      const outstanding =
        monthIndex === 5
          ? r.number === "102"
            ? 1500
            : r.number === "203"
              ? 3000
              : 0
          : 0;
      payments.push({
        id: `pay-${month}-${r.number}`,
        date: `${month}-0${(i % 4) + 2}`,
        method: i % 3 === 0 ? "cash" : i % 3 === 1 ? "transfer" : "qr",
        status: "confirmed",
        reference: `DEMO-${month.replace("-", "")}-${r.number}`,
        allocations: [
          { invoiceId: invoice.id, amount: baht(amount - outstanding) },
        ],
      });
    });
  });
  payments.push({
    id: "pending-203",
    date: "2026-10-10",
    method: "transfer",
    status: "pending",
    reference: "DEMO-PENDING-203",
    allocations: [{ invoiceId: "inv-2026-10-203", amount: baht(1000) }],
  });
  return {
    rooms,
    tenants,
    leases,
    invoices,
    payments,
    expenses: months.flatMap((month) => [
      {
        id: `${month}-1`,
        date: `${month}-05`,
        title: "ค่าไฟส่วนกลาง",
        vendor: "ผู้ให้บริการตัวอย่าง",
        category: "สาธารณูปโภค",
        kind: "OPEX" as const,
        amount: baht(2500),
        method: "transfer" as const,
        note: "",
      },
      {
        id: `${month}-2`,
        date: `${month}-03`,
        title: "ค่าทำความสะอาด",
        vendor: "ผู้รับจ้างตัวอย่าง",
        category: "บริการ",
        kind: "OPEX" as const,
        amount: baht(800),
        method: "cash" as const,
        note: "",
      },
      {
        id: `${month}-3`,
        date: `${month}-01`,
        title: "อินเทอร์เน็ต",
        vendor: "ผู้ให้บริการตัวอย่าง",
        category: "บริการ",
        kind: "OPEX" as const,
        amount: baht(900),
        method: "transfer" as const,
        note: "",
      },
      {
        id: `${month}-4`,
        date: `${month}-09`,
        title: "ซ่อมก๊อกน้ำ ห้อง 201",
        vendor: "ช่างตัวอย่าง",
        category: "ซ่อมบำรุง",
        kind: "OPEX" as const,
        amount: baht(1500),
        method: "cash" as const,
        note: "",
      },
      {
        id: `${month}-5`,
        date: `${month}-12`,
        title: "อุปกรณ์ทำความสะอาด",
        vendor: "ร้านค้าตัวอย่าง",
        category: "วัสดุสิ้นเปลือง",
        kind: "OPEX" as const,
        amount: baht(1000),
        method: "cash" as const,
        note: "",
      },
      ...(month === "2026-10"
        ? [
            {
              id: `${month}-6`,
              date: `${month}-15`,
              title: "ซื้อแอร์ใหม่ ห้อง 304",
              vendor: "ร้านเครื่องปรับอากาศตัวอย่าง",
              category: "ครุภัณฑ์",
              kind: "CAPEX" as const,
              amount: baht(18000),
              method: "transfer" as const,
              note: "ทรัพย์สินตัวอย่าง",
            },
          ]
        : []),
    ]),
    tickets: [
      {
        id: "MT-001",
        date: "2026-10-05",
        room: "203",
        issue: "แอร์ไม่เย็น",
        priority: "high",
        status: "in-progress",
        assignee: "ช่างตัวอย่าง A",
      },
      {
        id: "MT-002",
        date: "2026-10-02",
        room: "204",
        issue: "ท่อน้ำรั่ว",
        priority: "high",
        status: "pending",
        assignee: "ยังไม่มอบหมาย",
      },
      {
        id: "MT-003",
        date: "2026-09-28",
        room: "101",
        issue: "หลอดไฟเสีย",
        priority: "medium",
        status: "resolved",
        assignee: "ช่างตัวอย่าง B",
      },
      {
        id: "MT-004",
        date: "2026-09-22",
        room: "203",
        issue: "กลอนประตูเสีย",
        priority: "medium",
        status: "resolved",
        assignee: "ช่างตัวอย่าง A",
      },
      {
        id: "MT-005",
        date: "2026-09-15",
        room: "205",
        issue: "อินเทอร์เน็ตช้า",
        priority: "low",
        status: "resolved",
        assignee: "ผู้ดูแลตัวอย่าง",
      },
    ],
    settings: {
      waterRate: baht(20),
      electricRate: baht(8),
      commonFee: baht(100),
      propertyName: "Taky Apartment",
      phone: "080-000-0000",
    },
  };
}
