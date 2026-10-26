import { writeFile } from "node:fs/promises";

export async function publishLegacyEnvironmentOnSuccess(
  exitCode,
  values,
  path = ".local/remediation.env",
) {
  if (exitCode !== 0) return false;
  const contents =
    Object.entries(values)
      .map(([key, value]) => `${key}=${value}`)
      .join("\n") + "\n";
  try {
    await writeFile(path, contents, { mode: 0o600, flag: "wx" });
    return true;
  } catch (error) {
    if (error.code === "EEXIST") return false;
    throw error;
  }
}
