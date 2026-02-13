import { createPatch } from "diff";
import { getTreeSitterClient, extToFiletype } from "@opentui/core";
import type { ChatMessage, ToolCallItem, TranscriptItem } from "../../harness/events.js";
import type { Theme } from "../theme.js";
import { getSyntaxStyle } from "../syntaxTheme.js";

// Singleton tree-sitter client for syntax highlighting
const treeSitterClient = getTreeSitterClient();

function getFiletypeFromPath(path?: string): string | undefined {
  if (!path) return undefined;
  const ext = path.split(".").pop()?.toLowerCase();
  if (!ext) return undefined;
  // Use OpenTUI's built-in extension to filetype mapping
  const filetype = extToFiletype(ext);
  // Map React variants to base filetypes since tree-sitter uses the same parser
  if (filetype === "typescriptreact") return "typescript";
  if (filetype === "javascriptreact") return "javascript";
  return filetype;
}

interface ChatPaneProps {
  transcript: TranscriptItem[];
  streamingContent: string;
  streamingReasoning: string;
  isStreaming: boolean;
  height: number;
  theme: Theme;
}

function formatRole(role: ChatMessage["role"]): string {
  switch (role) {
    case "user":
      return "You";
    case "assistant":
      return "Assistant";
    case "tool":
      return "Tool";
    case "system":
      return "System";
  }
}

function getRoleColor(role: ChatMessage["role"], theme: Theme): string {
  switch (role) {
    case "user":
      return theme.colors.info;
    case "assistant":
      return theme.colors.secondary;
    case "tool":
      return theme.colors.warning;
    case "system":
      return theme.colors.muted;
  }
}

function formatDuration(startedAt: Date, completedAt?: Date): string {
  const end = completedAt || new Date();
  const duration = end.getTime() - startedAt.getTime();
  return duration > 1000 ? `${(duration / 1000).toFixed(1)}s` : `${duration}ms`;
}

function shouldShowLabel(item: TranscriptItem, prev: TranscriptItem | null): boolean {
  if (item.kind === "tool-call") return false;
  if (item.role === "assistant") {
    return !prev || prev.kind === "tool-call" || (prev.kind === "message" && prev.role === "user");
  }
  return !prev || prev.kind === "tool-call" || (prev.kind === "message" && prev.role !== item.role);
}

function MessageItem({ msg, showLabel, theme }: { msg: ChatMessage; showLabel: boolean; theme: Theme }) {
  return (
    <box flexDirection="column" marginBottom={1}>
      {msg.role === "assistant" && msg.reasoning && (
        <box flexDirection="column" marginBottom={1} paddingLeft={1} paddingRight={1}>
          <text fg={theme.colors.accent}>
            <b>Thinking...</b>
          </text>
          <text fg={theme.colors.muted}>
            {msg.reasoning}
          </text>
        </box>
      )}

      {msg.role === "user" ? (
        <box borderStyle="single" border={["left"]} borderColor={theme.colors.info} paddingLeft={1} flexDirection="column">
          {showLabel && <text fg={theme.colors.info}><b>{formatRole(msg.role)}</b></text>}
          <text>{msg.content}</text>
        </box>
      ) : (
        <box flexDirection="column">
          {showLabel && (
            <text fg={getRoleColor(msg.role, theme)}>
              <b>{formatRole(msg.role)}</b>
            </text>
          )}
          <box paddingLeft={1}>
            {msg.role === "assistant" || msg.role === "tool" ? (
              <markdown syntaxStyle={getSyntaxStyle(theme.mode)} content={msg.content} />
            ) : (
              <text>{msg.content}</text>
            )}
          </box>
        </box>
      )}
    </box>
  );
}

function formatToolArgsSummary(toolName: string, args?: Record<string, unknown>): string | null {
  if (!args) return null;
  
  if (toolName === "bash" || toolName === "shell") {
    const command = args.command ?? args.cmd;
    if (typeof command === "string") return command;
  }

  if (toolName === "read_file" || toolName === "view") {
    const path = args.filePath ?? args.path ?? args.file;
    if (typeof path === "string") return path;
  }

  if (toolName === "edit_file" || toolName === "write") {
    const path = args.filePath ?? args.path ?? args.file;
    if (typeof path === "string") return path;
  }

  if (toolName === "grep" || toolName === "search") {
    const pattern = args.pattern ?? args.query ?? args.regex;
    if (typeof pattern === "string") return pattern;
  }

  const keys = Object.keys(args);
  if (keys.length === 0) return null;
  
  const firstKey = keys[0];
  const firstVal = args[firstKey];
  if (typeof firstVal === "string" && firstVal.length <= 120) return firstVal;
  
  return null;
}

const MAX_OUTPUT_LINES = 20;

function isEditTool(toolName: string): boolean {
  return toolName === "edit" || toolName === "edit_file" || toolName === "str_replace";
}

function getEditToolArgs(args?: Record<string, unknown>): { path?: string; oldStr?: string; newStr?: string } | null {
  if (!args) return null;
  
  const path = args.path ?? args.filePath ?? args.file;
  const oldStr = args.old_str ?? args.oldStr ?? args.search;
  const newStr = args.new_str ?? args.newStr ?? args.replace;
  
  if (typeof oldStr === "string" && typeof newStr === "string") {
    return {
      path: typeof path === "string" ? path : undefined,
      oldStr,
      newStr,
    };
  }
  return null;
}

function truncateOutput(output: string): { text: string; truncated: boolean } {
  const lines = output.split("\n");
  if (lines.length <= MAX_OUTPUT_LINES) {
    return { text: output, truncated: false };
  }
  return {
    text: lines.slice(0, MAX_OUTPUT_LINES).join("\n"),
    truncated: true,
  };
}

function ToolCallInline({ tool, theme }: { tool: ToolCallItem; theme: Theme }) {
  const isRunning = tool.status === "running";
  const isFailed = tool.status === "failed";
  const statusIcon = isRunning ? "▮" : isFailed ? "✗" : "✓";
  const statusColor = isRunning ? theme.colors.warning : isFailed ? theme.colors.error : theme.colors.success;
  const borderColor = isRunning ? theme.colors.warning : isFailed ? theme.colors.error : theme.colors.muted;

  const argsSummary = formatToolArgsSummary(tool.toolName, tool.arguments);
  const hasOutput = tool.output && tool.output.trim().length > 0;
  
  // Check if this is an edit tool with diff-able arguments
  const isEdit = isEditTool(tool.toolName);
  const editArgs = isEdit ? getEditToolArgs(tool.arguments) : null;
  const showDiff = isEdit && editArgs && !isRunning;

  return (
    <box
      flexDirection="column"
      marginBottom={1}
      borderStyle="single"
      border={["left"]}
      borderColor={borderColor}
      paddingLeft={1}
    >
      <text>
        <span fg={statusColor}>{statusIcon} </span>
        <span fg={theme.colors.info}><b>{tool.toolName}</b></span>
        <span fg={theme.colors.muted}> ({formatDuration(tool.startedAt, tool.completedAt)})</span>
      </text>
      {argsSummary && (
        <box paddingLeft={2} marginTop={0}>
          <text fg={theme.colors.muted}>{argsSummary}</text>
        </box>
      )}
      {tool.progress.length > 0 && (
        <box flexDirection="column" paddingLeft={1}>
          {tool.progress.map((msg, idx) => (
            <text key={idx} fg={theme.colors.muted}>
              {msg}
            </text>
          ))}
        </box>
      )}
      {showDiff && (
        <box marginTop={1}>
          <diff
            diff={createPatch(
              editArgs.path ?? "file",
              editArgs.oldStr!,
              editArgs.newStr!,
            )}
            view="split"
            filetype={getFiletypeFromPath(editArgs.path)}
            syntaxStyle={getSyntaxStyle(theme.mode)}
            treeSitterClient={treeSitterClient}
            showLineNumbers={true}
            addedBg={theme.colors.diffAddedBg}
            removedBg={theme.colors.diffRemovedBg}
            contextBg={theme.colors.diffContextBg}
            lineNumberBg={theme.colors.diffLineNumberBg}
          />
        </box>
      )}
      {hasOutput && !showDiff && (() => {
        const { text, truncated } = truncateOutput(tool.output!);
        return (
          <box
            flexDirection="column"
            marginTop={1}
            paddingLeft={1}
            paddingRight={1}
            borderStyle="single"
            border={["left"]}
            borderColor={theme.colors.borderDim}
          >
            <markdown syntaxStyle={getSyntaxStyle(theme.mode)} content={text} />
            {truncated && (
              <text fg={theme.colors.muted}><i>… output truncated</i></text>
            )}
          </box>
        );
      })()}
      {isFailed && tool.error && (
        <text fg={theme.colors.error}>  Error: {tool.error}</text>
      )}
    </box>
  );
}

export function ChatPane({ transcript, streamingContent, streamingReasoning, isStreaming, height, theme }: ChatPaneProps) {
  // Only auto-scroll when actively receiving streaming content, not when user is typing
  const shouldStickyScroll = isStreaming || Boolean(streamingContent) || Boolean(streamingReasoning);
  
  return (
    <scrollbox
      height={height}
      stickyScroll={shouldStickyScroll}
      stickyStart="bottom"
      viewportCulling
      contentOptions={{
        flexDirection: "column",
        paddingLeft: 2,
        paddingRight: 2,
        paddingTop: 1,
      }}
    >
      {transcript.length === 0 && !streamingContent && !streamingReasoning && (
        <text fg={theme.colors.muted}>No messages yet</text>
      )}

      {transcript.map((item, index) => {
        const prev = index > 0 ? transcript[index - 1] : null;

        if (item.kind === "tool-call") {
          // Skip report_intent - it's shown in the Plan & Progress pane
          if (item.toolName === "report_intent") {
            return null;
          }
          return <ToolCallInline key={item.id} tool={item} theme={theme} />;
        }

        return (
          <MessageItem
            key={item.id}
            msg={item}
            showLabel={shouldShowLabel(item, prev)}
            theme={theme}
          />
        );
      })}

      {streamingReasoning && (
        <box flexDirection="column" marginBottom={1} paddingLeft={1} paddingRight={1}>
          <text fg={theme.colors.accent}>
            <b>Thinking</b> <span fg={theme.colors.warning}>▮</span>
          </text>
          <text fg={theme.colors.muted}>
            {streamingReasoning}
          </text>
        </box>
      )}

      {streamingContent && (() => {
        const lastItem = transcript.length > 0 ? transcript[transcript.length - 1] : null;
        const showStreamingLabel = !lastItem || lastItem.kind === "tool-call" || (lastItem.kind === "message" && lastItem.role === "user");
        return (
          <box flexDirection="column" marginBottom={1}>
            {showStreamingLabel && (
              <text fg={theme.colors.secondary}>
                <b>Assistant</b> <span fg={theme.colors.success}>▮</span>
              </text>
            )}
            <box paddingLeft={1}>
              <markdown syntaxStyle={getSyntaxStyle(theme.mode)} content={streamingContent} streaming />
            </box>
          </box>
        );
      })()}
    </scrollbox>
  );
}
