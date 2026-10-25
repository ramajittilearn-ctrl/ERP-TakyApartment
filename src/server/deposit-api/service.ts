import { createDepositService } from "../deposits";
import { lockAndVerifyDepositEvidence } from "../evidence";

export const depositService = createDepositService(
  lockAndVerifyDepositEvidence,
);
