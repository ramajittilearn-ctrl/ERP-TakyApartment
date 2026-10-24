import type { ExpenseDto, ExpenseExportDto } from "./contracts";

export const expenseCsvColumns = [
  "recordType",
  "scope",
  "generatedAt",
  "filtersJson",
  "excludedLegacyCount",
  "approvedOpex",
  "approvedCapex",
  "approvedTotal",
  "id",
  "propertyId",
  "categoryId",
  "categoryName",
  "categoryKind",
  "status",
  "version",
  "description",
  "vendor",
  "amount",
  "occurredAt",
  "method",
  "note",
  "possibleDuplicateCount",
  "recordedById",
  "createdAt",
  "correctionOfId",
  "postedById",
  "postedAt",
  "cancelledById",
  "cancelledAt",
  "cancelReason",
  "reversedById",
  "reversedAt",
  "reverseReason",
] as const;

export function expenseCsvCell(value: string | number | null | undefined) {
  const text = value === null || value === undefined ? "" : String(value);
  const first = Array.from(text).find(
    (character) =>
      character.charCodeAt(0) > 32 &&
      character.charCodeAt(0) !== 127 &&
      !/\s/u.test(character),
  );
  const safe = first && "=+-@".includes(first) ? `'${text}` : text;
  return `"${safe.replaceAll('"', '""')}"`;
}
type CsvRow = Partial<
  Record<(typeof expenseCsvColumns)[number], string | number | null>
>;
export function expenseCsv(data: ExpenseExportDto) {
  const row = (value: CsvRow) =>
    expenseCsvColumns.map((key) => expenseCsvCell(value[key])).join(",");
  const lines = [
    expenseCsvColumns.map(expenseCsvCell).join(","),
    row({
      recordType: "summary",
      scope: data.scope,
      generatedAt: data.generatedAt,
      filtersJson: JSON.stringify({
        ...data.filters,
        viewSemantics:
          "current-approved-expenses-restated-on-original-occurred-date",
      }),
      excludedLegacyCount: data.excludedLegacyCount,
      approvedOpex: data.totals.opex,
      approvedCapex: data.totals.capex,
      approvedTotal: data.totals.total,
    }),
  ];
  for (const item of data.items) {
    const lifecycle = (expense: ExpenseDto): CsvRow => {
      switch (expense.status) {
        case "PENDING":
          return {};
        case "POSTED":
          return { postedById: expense.postedById, postedAt: expense.postedAt };
        case "CANCELLED":
          return {
            cancelledById: expense.cancelledById,
            cancelledAt: expense.cancelledAt,
            cancelReason: expense.cancelReason,
          };
        case "REVERSED":
          return {
            postedById: expense.postedById,
            postedAt: expense.postedAt,
            reversedById: expense.reversedById,
            reversedAt: expense.reversedAt,
            reverseReason: expense.reverseReason,
          };
      }
    };
    lines.push(
      row({
        ...item,
        ...lifecycle(item),
        recordType: "expense",
        scope: data.scope,
        generatedAt: data.generatedAt,
      }),
    );
  }
  return "\uFEFF" + lines.join("\r\n") + "\r\n";
}
