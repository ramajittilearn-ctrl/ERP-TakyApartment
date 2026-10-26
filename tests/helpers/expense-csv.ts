// Independent CSV reader recognizes quoted separators, escaped quotes and embedded newlines.
export function parseCsv(csv: string) {
  const rows: string[][] = [];
  let row: string[] = [],
    cell = "",
    quoted = false,
    fieldStarted = false;
  const input = csv.replace(/^\uFEFF/, "");
  for (let i = 0; i < input.length; i++) {
    const c = input[i];
    if (c === '"') {
      if (quoted && input[i + 1] === '"') {
        cell += '"';
        i++;
      } else quoted = !quoted;
      fieldStarted = true;
    } else if (c === "," && !quoted) {
      row.push(cell);
      cell = "";
      fieldStarted = false;
    } else if (c === "\n" && !quoted) {
      row.push(cell.replace(/\r$/, ""));
      rows.push(row);
      row = [];
      cell = "";
      fieldStarted = false;
    } else {
      cell += c;
      fieldStarted = true;
    }
  }
  if (quoted) throw new Error("Incomplete CSV record");
  if (row.length || fieldStarted) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}
