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
      return "✎";
    case "added":
      return "+";
    case "deleted":
      return "✗";
    case "renamed":
      return "→";
  }
}

function getStatusColor(status: FileChange["status"], theme: Theme): string {
  switch (status) {
    case "modified":
      return theme.colors.warning;
    case "added":
      return theme.colors.success;
    case "deleted":
      return theme.colors.error;
    case "renamed":
      return theme.colors.info;
  }
}

function truncatePath(path: string, maxLength: number): string {
  if (path.length <= maxLength) return path;
  
  const parts = path.split("/");
  if (parts.length === 1) {
    return "..." + path.slice(-(maxLength - 3));
  }
  
  // Show first and last parts
  const filename = parts[parts.length - 1];
  const remaining = maxLength - filename.length - 6; // 6 for ".../" and spacing
  
  if (remaining <= 0) {
    return "..." + filename.slice(-(maxLength - 3));
  }
  
  return ".../" + parts.slice(0, Math.floor(parts.length / 2)).join("/").slice(0, remaining) + "/" + filename;
}

export const FilesModifiedPane = memo(function FilesModifiedPane({ 
  files, 
  height, 
  theme 
}: FilesModifiedPaneProps) {
  const maxFilePathLength = 28; // Adjust based on column width
  const displayFiles = files.slice(0, Math.max(1, height - 3));
  
  const totalAdditions = files.reduce((sum, f) => sum + f.additions, 0);
  const totalDeletions = files.reduce((sum, f) => sum + f.deletions, 0);

  return (
    <box
      flexDirection="column"
      width="100%"
      height={height}
      borderStyle="rounded"
      borderColor={theme.colors.border}
      paddingLeft={1}
      paddingRight={1}
      overflow="hidden"
    >
      <text fg={theme.colors.primary}>
        <b>Files Modified</b>
        {files.length > 0 && (
          <span fg={theme.colors.muted}> ({files.length})</span>
        )}
      </text>

      {files.length === 0 && (
        <text fg={theme.colors.muted}>No changes</text>
      )}

      {displayFiles.map((file, idx) => (
        <box key={idx} flexDirection="row" justifyContent="space-between">
          <box flexDirection="row" flexShrink={1}>
            <text fg={getStatusColor(file.status, theme)}>
              {getStatusIcon(file.status)}{" "}
            </text>
            <text>{truncatePath(file.path, maxFilePathLength)}</text>
          </box>
          <text fg={theme.colors.muted}>
            {file.additions > 0 && (
              <span fg={theme.colors.success}>+{file.additions}</span>
            )}
            {file.additions > 0 && file.deletions > 0 && <span> </span>}
            {file.deletions > 0 && (
              <span fg={theme.colors.error}>-{file.deletions}</span>
            )}
          </text>
        </box>
      ))}

      {files.length > displayFiles.length && (
        <text fg={theme.colors.muted}>
          ...and {files.length - displayFiles.length} more
        </text>
      )}

      {files.length > 0 && (
        <box marginTop={1} paddingTop={1}>
          <text>
            <span fg={theme.colors.muted}>Total: </span>
            {totalAdditions > 0 && (
              <span fg={theme.colors.success}>+{totalAdditions}</span>
            )}
            {totalAdditions > 0 && totalDeletions > 0 && <span> </span>}
            {totalDeletions > 0 && (
              <span fg={theme.colors.error}>-{totalDeletions}</span>
            )}
          </text>
        </box>
      )}
    </box>
  );
});
