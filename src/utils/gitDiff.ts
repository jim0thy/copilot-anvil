import { execSync } from "child_process";

export interface FileChange {
  path: string;
  additions: number;
  deletions: number;
  status: "modified" | "added" | "deleted" | "renamed";
}

export function getModifiedFiles(): FileChange[] {
  try {
    // Get list of changed files with numstat
    const diffOutput = execSync("git diff --numstat HEAD", {
      encoding: "utf8",
      stdio: ["pipe", "pipe", "ignore"],
    }).trim();

    if (!diffOutput) return [];

    const files: FileChange[] = [];
    const lines = diffOutput.split("\n");

    for (const line of lines) {
      const parts = line.split(/\s+/);
      if (parts.length < 3) continue;

      const [additions, deletions, ...pathParts] = parts;
      const path = pathParts.join(" ");

      // Binary files show "-" for additions/deletions
      const adds = additions === "-" ? 0 : parseInt(additions, 10);
      const dels = deletions === "-" ? 0 : parseInt(deletions, 10);

      // Determine status
      let status: FileChange["status"] = "modified";
      if (adds > 0 && dels === 0) {
        // Check if it's a new file
        try {
          execSync(`git ls-files --error-unmatch "${path}"`, {
            stdio: ["pipe", "pipe", "ignore"],
          });
        } catch {
          status = "added";
        }
      } else if (adds === 0 && dels > 0) {
        status = "deleted";
      }

      files.push({
        path,
        additions: adds,
        deletions: dels,
        status,
      });
    }

    return files;
  } catch {
    return [];
  }
}
