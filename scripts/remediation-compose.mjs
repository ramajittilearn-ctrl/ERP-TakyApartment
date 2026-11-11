import { spawnSync } from "node:child_process";

export function cleanupFailedRemediationProject(
  project,
  composePath,
  spawn = spawnSync,
) {
  return spawn(
    "docker",
    ["compose", "-p", project, "-f", composePath, "down", "--remove-orphans"],
    { encoding: "utf8" },
  );
}
