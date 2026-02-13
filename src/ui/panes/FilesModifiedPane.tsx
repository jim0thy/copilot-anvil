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

export const FilesModifiedPane = memo(function FilesModifiedPane({ 
  files, 
  height, 
  theme 
}: FilesModifiedPaneProps) {
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
      borderColor={theme.colors.border}
      paddingLeft={1}
      paddingRight={1}
      overflow="hidden"
    >
      {/* Header */}
      <box flexDirection="row" width="100%">
        <text fg={theme.colors.primary}>
          <b>Files Modified</b>
        </text>
        {files.length > 0 && (
          <text fg={theme.colors.muted}> {files.length} file{files.length !== 1 ? "s" : ""}</text>
        )}
      </box>

      {/* Empty state */}
      {files.length === 0 && (
        <box marginTop={1}>
          <text fg={theme.colors.muted}>  No changes yet</text>
        </box>
      )}

      {/* File list */}
      <box flexDirection="column" gap={0} marginTop={files.length > 0 ? 1 : 0}>
        {displayFiles.map((file, idx) => (
          <box key={idx} flexDirection="row" width="100%">
            <text>
              <span fg={getStatusColor(file.status, theme)}>
                <b>{getStatusLabel(file.status)}</b>
              </span>
              <span fg={theme.colors.muted}> │ </span>
              <span>{truncatePath(file.path, maxFilePathLength)}</span>
              {(file.additions > 0 || file.deletions > 0) && (
                <>
                  <span fg={theme.colors.muted}> </span>
                  {file.additions > 0 && (
                    <span fg={theme.colors.success}>+{file.additions}</span>
                  )}
                  {file.additions > 0 && file.deletions > 0 && (
                    <span fg={theme.colors.muted}>/</span>
                  )}
                  {file.deletions > 0 && (
                    <span fg={theme.colors.error}>-{file.deletions}</span>
                  )}
                </>
              )}
            </text>
          </box>
        ))}
      </box>

      {/* Overflow indicator */}
      {files.length > displayFiles.length && (
        <text fg={theme.colors.muted}>
          ⋯ {files.length - displayFiles.length} more
        </text>
      )}

      {/* Summary footer */}
      {files.length > 0 && (
        <box marginTop={1} paddingTop={1}>
          <text>
            <span fg={theme.colors.borderDim}>───</span>
          </text>
          <text fg={theme.colors.muted}>
            {stats.added > 0 && (
              <span>
                <span fg={theme.colors.success}>+{stats.added}</span>
                {" "}
              </span>
            )}
            {stats.modified > 0 && (
              <span>
                <span fg={theme.colors.warning}>~{stats.modified}</span>
                {" "}
              </span>
            )}
            {stats.deleted > 0 && (
              <span>
                <span fg={theme.colors.error}>-{stats.deleted}</span>
                {" "}
              </span>
            )}
            {stats.renamed > 0 && (
              <span>
                <span fg={theme.colors.info}>→{stats.renamed}</span>
                {" "}
              </span>
            )}
            <span fg={theme.colors.borderDim}>│</span>
            {" "}
            {totalAdditions > 0 && (
              <span fg={theme.colors.success}>+{totalAdditions}</span>
            )}
            {totalAdditions > 0 && totalDeletions > 0 && (
              <span fg={theme.colors.muted}>/</span>
            )}
            {totalDeletions > 0 && (
              <span fg={theme.colors.error}>-{totalDeletions}</span>
            )}
          </text>
        </box>
      )}
    </box>
  );
});
