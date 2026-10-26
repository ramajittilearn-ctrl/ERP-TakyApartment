import { z } from "zod";
import { evidenceListQuery, uploadMetadata } from "./contracts";
const integer = z
  .string()
  .regex(/^(?:0|[1-9]\d*)$/)
  .transform(Number);
function entries(params: URLSearchParams) {
  const found = new Set<string>();
  return Object.fromEntries(
    Array.from(params, ([key, value]) => {
      if (found.has(key))
        throw new z.ZodError([
          { code: "custom", path: [key], message: "Repeated query parameter" },
        ]);
      found.add(key);
      return [
        key,
        key === "offset" || key === "limit" ? integer.parse(value) : value,
      ];
    }),
  );
}
export function parseEvidenceListQuery(params: URLSearchParams) {
  return evidenceListQuery.parse(entries(params));
}
export function parseEvidenceUploadQuery(
  params: URLSearchParams,
  contentType: string | null,
) {
  return uploadMetadata.parse({
    ...uploadMetadata.omit({ declaredMimeType: true }).parse(entries(params)),
    declaredMimeType: contentType ?? "",
  });
}
export function requireNoEvidenceQuery(params: URLSearchParams) {
  z.strictObject({}).parse(entries(params));
}
