import { ParserUnavailable, validateEvidenceFile } from "./validate.mjs";

if (
  process.argv.length !== 3 ||
  !process.argv[2].startsWith("/tmp/taky-validator-")
) {
  process.exitCode = 3;
} else {
  try {
    const result = await validateEvidenceFile(process.argv[2]);
    process.stdout.write(JSON.stringify(result));
  } catch (error) {
    process.exitCode = error instanceof ParserUnavailable ? 3 : 2;
  }
}
