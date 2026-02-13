import { execFile } from "child_process";
import { promisify } from "util";

const execFileAsync = promisify(execFile);

export interface FileChange {
  path: string;
  additions: number;
  deletions: number;
  status: "modified" | "added" | "deleted" | "renamed";
}

// Cached result for synchronous initial render
let cachedModifiedFiles: FileChange[] = [];

/**
 * Returns the last cached modified files synchronously (for initial state).
 */
export function getModifiedFiles(): FileChange[] {
  return cachedModifiedFiles;
}

/**
 * Fetches modified files asynchronously without blocking the event loop.
 * Updates the internal cache and returns the result.
 */
export async function getModifiedFilesAsync(): Promise<FileChange[]> {
  try {
    // Get list of changed files with numstat
    const { stdout } = await execFileAsync("git", ["diff", "--numstat", "HEAD"], {
      encoding: "utf8",
    });
    const diffOutput = stdout.trim();

    if (!diffOutput) {
      cachedModifiedFiles = [];
      return cachedModifiedFiles;
    }

    const files: FileChange[] = [];
    const lines = diffOutput.split("\n");

    for (const line of lines) {
      const parts = line.split(/\s+/);
      if (parts.length < 3) continue;

      const [additions, deletions, ...pathParts] = parts;
      const filePath = pathParts.join(" ");

      // Binary files show "-" for additions/deletions
      const adds = additions === "-" ? 0 : parseInt(additions, 10);
      const dels = deletions === "-" ? 0 : parseInt(deletions, 10);

      // Determine status
      let status: FileChange["status"] = "modified";
      if (adds > 0 && dels === 0) {
        // Check if it's a new file
        try {
          await execFileAsync("git", ["ls-files", "--error-unmatch", filePath]);
        } catch {
          status = "added";
        }
      } else if (adds === 0 && dels > 0) {
        status = "deleted";
      }

      files.push({
        path: filePath,
        additions: adds,
        deletions: dels,
        status,
      });
    }

    cachedModifiedFiles = files;
    return cachedModifiedFiles;
  } catch {
    cachedModifiedFiles = [];
    return cachedModifiedFiles;
  }
}
