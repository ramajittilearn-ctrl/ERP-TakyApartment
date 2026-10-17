export const money = (satang: number) =>
  new Intl.NumberFormat("th-TH", {
    style: "currency",
    currency: "THB",
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(satang / 100);
export const number = (value: number) =>
  new Intl.NumberFormat("th-TH").format(value);
export const date = (value: string) =>
  new Intl.DateTimeFormat("th-TH-u-ca-gregory", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    timeZone: "Asia/Bangkok",
  }).format(new Date(`${value}T00:00:00+07:00`));
export const monthLabel = (value: string) =>
  new Intl.DateTimeFormat("th-TH-u-ca-gregory", {
    month: "long",
    year: "numeric",
    timeZone: "Asia/Bangkok",
  }).format(new Date(`${value}-01T00:00:00+07:00`));
export const shortMonth = (value: string) =>
  new Intl.DateTimeFormat("th-TH", {
    month: "short",
    timeZone: "Asia/Bangkok",
  }).format(new Date(`${value}-01T00:00:00+07:00`));
export function exportCsv(filename: string, rows: (string | number)[][]) {
  const csv = rows
    .map((row) =>
      row
        .map((value) => {
          let text = String(value);
          if (typeof value === "string" && /^[=+\-@\t\r]/.test(text))
            text = `'${text}`;
          return `"${text.replaceAll('"', '""')}"`;
        })
        .join(","),
    )
    .join("\r\n");
  const url = URL.createObjectURL(
    new Blob(["\uFEFF", csv], { type: "text/csv;charset=utf-8;" }),
  );
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
