import { execFile } from "child_process";
import { promisify } from "util";

const execFileAsync = promisify(execFile);

export interface GitInfo {
  branch: string | null;
  hasChanges: boolean;
  ahead: number;
  behind: number;
  staged: number;
  unstaged: number;
  untracked: number;
}

// Cached result for synchronous initial render
let cachedGitInfo: GitInfo = {
  branch: null,
  hasChanges: false,
  ahead: 0,
  behind: 0,
  staged: 0,
  unstaged: 0,
  untracked: 0,
};

/**
 * Returns the last cached git info synchronously (for initial state).
 */
export function getGitInfo(): GitInfo {
  return cachedGitInfo;
}

/**
 * Fetches git info asynchronously without blocking the event loop.
 * Updates the internal cache and returns the result.
 */
export async function getGitInfoAsync(): Promise<GitInfo> {
  const result: GitInfo = {
    branch: null,
    hasChanges: false,
    ahead: 0,
    behind: 0,
    staged: 0,
    unstaged: 0,
    untracked: 0,
  };

  try {
    // Get current branch
    const { stdout: branchOut } = await execFileAsync("git", ["rev-parse", "--abbrev-ref", "HEAD"], {
      encoding: "utf8",
    });
    result.branch = branchOut.trim();

    // Check for uncommitted changes and count file types
    const { stdout: statusOut } = await execFileAsync("git", ["status", "--porcelain"], {
      encoding: "utf8",
    });
    const status = statusOut.trim();

    if (status.length > 0) {
      result.hasChanges = true;
      const lines = status.split("\n");
      for (const line of lines) {
        const indexStatus = line[0];
        const workingStatus = line[1];

        // Staged changes (index has modification)
        if (indexStatus && indexStatus !== " " && indexStatus !== "?") {
          result.staged++;
        }
        // Unstaged changes (working tree modified)
        if (workingStatus && workingStatus !== " " && workingStatus !== "?") {
          result.unstaged++;
        }
        // Untracked files
        if (indexStatus === "?") {
          result.untracked++;
        }
      }
    }

    // Get ahead/behind count
    try {
      const { stdout: revOut } = await execFileAsync("git", ["rev-list", "--left-right", "--count", "@{u}...HEAD"], {
        encoding: "utf8",
      });
      const [behind, ahead] = revOut.trim().split(/\s+/).map(Number);
      result.behind = behind;
      result.ahead = ahead;
    } catch {
      // No upstream branch or other error
    }
  } catch {
    // Not in a git repo or git not available
  }

  cachedGitInfo = result;
  return result;
}
