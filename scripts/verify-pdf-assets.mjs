import { createHash } from "node:crypto";
import { lstat, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const fonts = [
  "node_modules/@fontsource/noto-sans-thai/files/noto-sans-thai-thai-400-normal.woff",
  "node_modules/@fontsource/noto-sans-thai/files/noto-sans-thai-latin-400-normal.woff",
];
const routes = ["invoices", "receipts"];
async function fontBytes(file, asset) {
  let stat;
  try {
    stat = await lstat(file);
  } catch {
    throw new Error(`Missing PDF font asset: ${asset}`);
  }
  if (!stat.isFile() || stat.isSymbolicLink())
    throw new Error(`PDF font must be a regular file: ${asset}`);
  try {
    return await readFile(file);
  } catch {
    throw new Error(`Unreadable PDF font asset: ${asset}`);
  }
}
export async function verifyPdfAssets({
  projectRoot = fileURLToPath(new URL("../", import.meta.url)),
} = {}) {
  const root = path.resolve(projectRoot);
  const build = path.join(root, ".next");
  for (const route of routes) {
    const trace = path.join(
      build,
      "server/app/api/v1",
      route,
      "[id]/pdf/route.js.nft.json",
    );
    let data;
    try {
      data = JSON.parse(await readFile(trace, "utf8"));
    } catch {
      throw new Error(`Missing or invalid PDF route trace: ${route}`);
    }
    if (
      !data ||
      !Array.isArray(data.files) ||
      data.files.some((file) => typeof file !== "string")
    )
      throw new Error(`Invalid PDF route trace files: ${route}`);
    const included = new Set(
      data.files.map((file) => path.resolve(path.dirname(trace), file)),
    );
    for (const font of fonts)
      if (!included.has(path.join(root, font)))
        throw new Error(
          `PDF route trace omits font: ${route}/${path.basename(font)}`,
        );
  }
  const assets = [];
  for (const font of fonts) {
    const asset = path.basename(font);
    const source = await fontBytes(path.join(root, font), asset);
    const copied = await fontBytes(path.join(build, "standalone", font), asset);
    if (!source.length || !source.equals(copied))
      throw new Error(`Standalone PDF font differs from source: ${asset}`);
    assets.push({
      asset,
      bytes: copied.length,
      sha256: createHash("sha256").update(copied).digest("hex"),
    });
  }
  return { verified: true, routes, fonts: assets };
}
if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    process.stdout.write(JSON.stringify(await verifyPdfAssets()) + "\n");
  } catch (error) {
    process.stderr.write(
      JSON.stringify({
        verified: false,
        message:
          error instanceof Error
            ? error.message
            : "PDF asset verification failed",
      }) + "\n",
    );
    process.exitCode = 1;
  }
}
