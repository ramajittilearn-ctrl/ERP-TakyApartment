import { checkOrigin, handle, json, requireActor } from "@/server/http";
import { AppError } from "@/server/errors";
import { MAX_EVIDENCE_BYTES } from "@/server/evidence/contracts";
import { listDepositEvidence, uploadDepositEvidence } from "@/server/evidence";
import {
  parseEvidenceListQuery,
  parseEvidenceUploadQuery,
} from "@/server/evidence/query";
export function GET(request: Request) {
  return handle(async () =>
    json(
      await listDepositEvidence(
        await requireActor(),
        parseEvidenceListQuery(new URL(request.url).searchParams),
      ),
    ),
  );
}
export function POST(request: Request) {
  return handle(async () => {
    checkOrigin(request);
    const actor = await requireActor();
    if (actor.role !== "ADMIN")
      throw new AppError(403, "FORBIDDEN", "เฉพาะผู้ดูแลระบบเท่านั้น");
    const encoding = request.headers.get("content-encoding");
    if (encoding && encoding !== "identity")
      throw new AppError(
        415,
        "EVIDENCE_ENCODING",
        "ต้องส่งไฟล์หลักฐานโดยไม่บีบอัดคำขอ",
      );
    const metadata = parseEvidenceUploadQuery(
      new URL(request.url).searchParams,
      request.headers.get("content-type"),
    );
    const length = request.headers.get("content-length");
    if (
      length !== null &&
      (!/^(?:0|[1-9]\d*)$/.test(length) ||
        BigInt(length) > BigInt(MAX_EVIDENCE_BYTES))
    )
      throw new AppError(
        413,
        "EVIDENCE_TOO_LARGE",
        "ไฟล์หลักฐานมีขนาดเกินกำหนด",
      );
    if (!request.body)
      throw new AppError(400, "EVIDENCE_EMPTY", "ต้องส่งไฟล์หลักฐาน");
    return json(
      await uploadDepositEvidence({
        actor,
        metadata,
        body: request.body,
        signal: request.signal,
      }),
      201,
    );
  });
}
