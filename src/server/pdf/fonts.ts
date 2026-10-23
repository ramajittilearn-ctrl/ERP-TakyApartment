import type PDFDocument from "pdfkit";
import { resolve } from "node:path";

export function registerPdfFonts(doc: InstanceType<typeof PDFDocument>): void {
  doc.registerFont(
    "Thai",
    resolve(
      process.cwd(),
      "node_modules/@fontsource/noto-sans-thai/files/noto-sans-thai-thai-400-normal.woff",
    ),
  );
  doc.registerFont(
    "Latin",
    resolve(
      process.cwd(),
      "node_modules/@fontsource/noto-sans-thai/files/noto-sans-thai-latin-400-normal.woff",
    ),
  );
}

export function pdfFontRuns(text: string): Array<{
  text: string;
  font: "Thai" | "Latin" | "Helvetica";
}> {
  const runs: ReturnType<typeof pdfFontRuns> = [];
  for (const { segment } of new Intl.Segmenter("th", {
    granularity: "grapheme",
  }).segment(text)) {
    // Baht is Script=Common but belongs to the packaged Thai subset.
    // Superscript three is absent from both subsets and exists in Helvetica.
    const font = /[\p{Script=Thai}\u0e3f]/u.test(segment)
      ? "Thai"
      : segment === "³"
        ? "Helvetica"
        : "Latin";
    const previous = runs[runs.length - 1];
    if (previous && previous.font === font) previous.text += segment;
    else runs.push({ text: segment, font });
  }
  return runs;
}
