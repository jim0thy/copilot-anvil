import { memo } from "react";
import type { Theme } from "../theme.js";
import type { FileChange } from "../../utils/gitDiff.js";

interface FilesModifiedPaneProps {
  files: FileChange[];
  height: number;
  theme: Theme;
}

function getStatusIcon(status: FileChange["status"]): string {
  switch (status) {
    case "modified":
      return "●";
    case "added":
      return "✚";
    case "deleted":
      return "✖";
    case "renamed":
      return "➜";
  }
}

function getStatusLabel(status: FileChange["status"]): string {
  switch (status) {
    case "modified":
      return "M";
    case "added":
      return "A";
    case "deleted":
      return "D";
    case "renamed":
      return "R";
  }
}

function getStatusColor(status: FileChange["status"], theme: Theme): string {
  const c = theme.colors;
  switch (status) {
    case "modified":
      return c.warning;
    case "added":
      return c.success;
    case "deleted":
      return c.error;
    case "renamed":
      return c.info;
  }
}

function truncatePath(path: string, maxLength: number): string {
  if (path.length <= maxLength) return path;
  
  const parts = path.split("/");
  if (parts.length === 1) {
    return "…" + path.slice(-(maxLength - 1));
  }
  
  // Show filename and truncate directory path
  const filename = parts[parts.length - 1];
  const dir = parts.slice(0, -1).join("/");
  
  const maxDirLength = maxLength - filename.length - 2; // 2 for "/…"
  
  if (maxDirLength <= 0) {
    return "…" + filename.slice(-(maxLength - 1));
  }
  
  if (dir.length <= maxDirLength) {
    return path;
  }
  
  return "…" + dir.slice(-(maxDirLength)) + "/" + filename;
}

function formatStats(additions: number, deletions: number): { add: string; del: string } {
  const add = additions > 0 ? `+${additions}` : "";
  const del = deletions > 0 ? `-${deletions}` : "";
  return { add, del };
}

// Fixed-width stat column (e.g., "+999 -999" = 10 chars max)
const STAT_COL_WIDTH = 12;

export const FilesModifiedPane = memo(function FilesModifiedPane({ 
  files, 
  height, 
  theme 
}: FilesModifiedPaneProps) {
  const c = theme.colors;
  const maxFilePathLength = 30;
  const displayFiles = files.slice(0, Math.max(1, height - 4));
  
  const totalAdditions = files.reduce((sum, f) => sum + f.additions, 0);
  const totalDeletions = files.reduce((sum, f) => sum + f.deletions, 0);

  const stats = files.reduce(
    (acc, f) => {
      acc[f.status]++;
      return acc;
    },
    { modified: 0, added: 0, deleted: 0, renamed: 0 } as Record<FileChange["status"], number>
  );

  return (
    <box
      flexDirection="column"
      width="100%"
      height={height}
      borderStyle="rounded"
      borderColor={c.border}
      paddingLeft={1}
      paddingRight={1}
      overflow="hidden"
    >
      {/* Header */}
      <box flexDirection="row" width="100%">
        <text fg={c.primary}>
          <b>Files Modified</b>
        </text>
        {files.length > 0 && (
          <text fg={c.subtext0}> ({files.length})</text>
        )}
      </box>

      {/* Empty state */}
      {files.length === 0 && (
        <box marginTop={1}>
          <text fg={c.subtle}>  No changes yet</text>
        </box>
      )}

      {/* File list */}
      <box flexDirection="column" marginTop={0} gap={0}>
        {displayFiles.map((file, idx) => {
          const { add, del } = formatStats(file.additions, file.deletions);
          return (
            <box key={idx} flexDirection="row" width="100%" height={1} justifyContent="space-between">
              {/* Left: status + filename */}
              <box flexDirection="row" flexShrink={1} overflow="hidden" height={1}>
                <text>
                  <span fg={getStatusColor(file.status, theme)}>
                    <b>{getStatusLabel(file.status)}</b>
                  </span>
                  <span fg={c.subtle}> │ </span>
                  <span fg={c.text}>{truncatePath(file.path, maxFilePathLength)}</span>
                </text>
              </box>
              {/* Right: stats (fixed width, right-aligned) */}
              {(file.additions > 0 || file.deletions > 0) && (
                <box width={STAT_COL_WIDTH} height={1} justifyContent="flex-end" flexShrink={0}>
                  <text>
                    {add && <span fg={c.success}>{add}</span>}
                    {add && del && <span fg={c.subtle}> </span>}
                    {del && <span fg={c.error}>{del}</span>}
                  </text>
                </box>
              )}
            </box>
          );
        })}
      </box>

      {/* Overflow indicator */}
      {files.length > displayFiles.length && (
        <text fg={c.subtle}>
          ⋯ {files.length - displayFiles.length} more
        </text>
      )}

      {/* Summary footer */}
      {files.length > 0 && (
        <box marginTop={0} flexDirection="row" width="100%" height={1} justifyContent="space-between">
          {/* Left: "Total:" label */}
          <text fg={c.subtext0}>Total:</text>
          {/* Right: stats (fixed width, right-aligned) */}
          <box width={STAT_COL_WIDTH} justifyContent="flex-end" flexShrink={0}>
            <text>
              {totalAdditions > 0 && <span fg={c.success}>+{totalAdditions}</span>}
              {totalAdditions > 0 && totalDeletions > 0 && <span fg={c.subtle}> </span>}
              {totalDeletions > 0 && <span fg={c.error}>-{totalDeletions}</span>}
            </text>
          </box>
        </box>
      )}
    </box>
  );
});
