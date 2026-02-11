import { execSync } from "child_process";

export interface GitInfo {
  branch: string | null;
  hasChanges: boolean;
  ahead: number;
  behind: number;
  staged: number;
  unstaged: number;
  untracked: number;
}

export function getGitInfo(): GitInfo {
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
    const branch = execSync("git rev-parse --abbrev-ref HEAD", {
      encoding: "utf8",
      stdio: ["pipe", "pipe", "ignore"],
    }).trim();
    result.branch = branch;

    // Check for uncommitted changes and count file types
    const status = execSync("git status --porcelain", {
      encoding: "utf8",
      stdio: ["pipe", "pipe", "ignore"],
    }).trim();
    
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
      const revList = execSync("git rev-list --left-right --count @{u}...HEAD", {
        encoding: "utf8",
        stdio: ["pipe", "pipe", "ignore"],
      }).trim();
      const [behind, ahead] = revList.split(/\s+/).map(Number);
      result.behind = behind;
      result.ahead = ahead;
    } catch {
      // No upstream branch or other error
    }
  } catch {
    // Not in a git repo or git not available
  }

  return result;
}
