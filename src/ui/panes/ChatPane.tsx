import { memo, useState, useCallback, useMemo } from "react";
import { MouseButton } from "@opentui/core";
import { createPatch } from "diff";
import { getTreeSitterClient, extToFiletype } from "@opentui/core";
import type { ChatMessage, SubagentStreamEntry, ToolCallItem, TranscriptItem } from "../../harness/events.js";
import type { Theme } from "../theme.js";
import { getSyntaxStyle } from "../syntaxTheme.js";
import { formatRole, getRoleColor, formatDuration } from "../formatters.js";
import { nf } from "../icons.js";

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
  streamingContentChunks: string[];
  streamingReasoningChunks: string[];
  streamingAgentName: string | null;
  subagentStreaming?: Record<string, SubagentStreamEntry>;
  hasStarted?: boolean;
  isStreaming: boolean;
  height: number;
  theme: Theme;
}

const VISIBLE_WINDOW = 50;

function shouldShowLabel(item: TranscriptItem, prev: TranscriptItem | null): boolean {
  if (item.kind === "tool-call") return false;
  if (item.role === "assistant") {
    return !prev || prev.kind === "tool-call" || (prev.kind === "message" && prev.role === "user");
  }
  return !prev || prev.kind === "tool-call" || (prev.kind === "message" && prev.role !== item.role);
}

const MessageItem = memo(function MessageItem({ msg, showLabel, theme }: { msg: ChatMessage; showLabel: boolean; theme: Theme }) {
  const c = theme.colors;
  
  // Use agent display name if available, otherwise fall back to role formatting
  const labelText = msg.role === "assistant" && msg.agentDisplayName 
    ? msg.agentDisplayName 
    : formatRole(msg.role);
  
  return (
    <box flexDirection="column" marginBottom={1}>
      {msg.role === "assistant" && msg.reasoning && (
        <box flexDirection="column" marginBottom={1} paddingLeft={1} paddingRight={1}>
          <text fg={c.accent}>
            <b>{msg.agentDisplayName ? `${msg.agentDisplayName} is thinking` : "Thinking..."}</b>
          </text>
          <text fg={c.subtle}>
            {msg.reasoning}
          </text>
        </box>
      )}

      {msg.role === "user" ? (
        <box alignSelf="flex-end" borderStyle="single" border={["right"]} borderColor={c.info} backgroundColor={c.mantle} paddingLeft={1} paddingRight={1} maxWidth="66%" flexDirection="column">
          {showLabel && <text fg={c.info}><b>{labelText}</b></text>}
          <text fg={c.text} wrapMode="word">{msg.content}</text>
        </box>
      ) : (
        <box flexDirection="column">
          {showLabel && (
            <text fg={getRoleColor(msg.role, theme)}>
              <b>{labelText}</b>
            </text>
          )}
          <box paddingLeft={1}>
            {msg.role === "assistant" || msg.role === "tool" ? (
              <markdown syntaxStyle={getSyntaxStyle(theme.mode)} content={msg.content} />
            ) : (
              <text fg={c.text}>{msg.content}</text>
            )}
          </box>
        </box>
      )}
    </box>
  );
});

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

  if (toolName === "task") {
    const prompt = args.prompt;
    if (typeof prompt === "string") {
      const roleMatch = prompt.match(/^## Role:\s*(.+)/m);
      if (roleMatch) return roleMatch[1].trim();
    }
    const desc = args.description;
    if (typeof desc === "string") return desc;
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

const ToolCallInline = memo(function ToolCallInline({ tool, theme }: { tool: ToolCallItem; theme: Theme }) {
  const c = theme.colors;
  const isRunning = tool.status === "running";
  const isFailed = tool.status === "failed";
  const statusIcon = isRunning ? "▮" : isFailed ? nf.times : nf.check;
  const statusColor = isRunning ? c.warning : isFailed ? c.error : c.success;
  const borderColor = isRunning ? c.warning : isFailed ? c.error : c.border;

  const argsSummary = formatToolArgsSummary(tool.toolName, tool.arguments);
  const hasOutput = tool.output && tool.output.trim().length > 0;
  
  // Check if this is an edit tool with diff-able arguments
  const isEdit = isEditTool(tool.toolName);
  const editArgs = isEdit ? getEditToolArgs(tool.arguments) : null;
  const showDiff = isEdit && editArgs && !isRunning;

  const diffPatch = useMemo(() => {
    if (!showDiff || !editArgs) return null;
    return createPatch(
      editArgs.path ?? "file",
      editArgs.oldStr!,
      editArgs.newStr!,
    );
  }, [tool.toolCallId, tool.status]);

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
        <span fg={c.info}><b>{tool.toolName}</b></span>
        <span fg={c.subtle}> ({formatDuration(tool.startedAt, tool.completedAt)})</span>
      </text>
      {argsSummary && (
        <box paddingLeft={2} marginTop={0}>
          <text fg={c.subtext0}>{argsSummary}</text>
        </box>
      )}
      {tool.progress.length > 0 && (
        <box flexDirection="column" paddingLeft={1}>
          {tool.progress.map((msg, idx) => (
            <text key={idx} fg={c.subtle}>
              {msg}
            </text>
          ))}
        </box>
      )}
      {diffPatch && (
        <box marginTop={1} backgroundColor={c.surface0}>
          <diff
            diff={diffPatch}
            view="split"
            filetype={getFiletypeFromPath(editArgs!.path)}
            syntaxStyle={getSyntaxStyle(theme.mode)}
            treeSitterClient={treeSitterClient}
            showLineNumbers={true}
            addedBg={c.surface0}
            removedBg={c.surface0}
            contextBg={c.surface0}
            lineNumberBg={c.surface0}
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
            paddingTop={1}
            backgroundColor={c.surface0}
          >
            <markdown syntaxStyle={getSyntaxStyle(theme.mode)} content={text} />
            {truncated && (
              <text fg={c.subtle}><i>… output truncated</i></text>
            )}
          </box>
        );
      })()}
      {isFailed && tool.error && (
        <text fg={c.error}>  Error: {tool.error}</text>
      )}
    </box>
  );
});

const TranscriptList = memo(function TranscriptList({ transcript, theme }: { transcript: TranscriptItem[]; theme: Theme }) {
  return (
    <>
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
    </>
  );
});

export const ChatPane = memo(function ChatPane({ transcript, streamingContentChunks, streamingReasoningChunks, streamingAgentName, subagentStreaming: subagentStreamingProp = {}, hasStarted = false, isStreaming, height, theme }: ChatPaneProps) {
  const c = theme.colors;
  const [visibleCount, setVisibleCount] = useState(VISIBLE_WINDOW);
  const streamingContent = useMemo(() => streamingContentChunks.join(""), [streamingContentChunks]);
  const streamingReasoning = useMemo(() => streamingReasoningChunks.join(""), [streamingReasoningChunks]);

  const subagentStreamingEntries = Object.entries(subagentStreamingProp);
  const hasSubagentStreaming = subagentStreamingEntries.length > 0;
  const shouldStickyScroll = isStreaming || Boolean(streamingContent) || Boolean(streamingReasoning) || hasSubagentStreaming;

  const showLoadMore = transcript.length > visibleCount;
  const visibleTranscript = useMemo(() => transcript.slice(-visibleCount), [transcript, visibleCount]);
  const hiddenCount = transcript.length - visibleTranscript.length;

  const handleLoadMore = useCallback(() => {
    setVisibleCount((prev) => prev + VISIBLE_WINDOW);
  }, []);

  return (
    <scrollbox
      height={height}
      stickyScroll={shouldStickyScroll}
      stickyStart="bottom"
      contentOptions={{
        flexDirection: "column",
        paddingLeft: 2,
        paddingRight: 2,
        paddingTop: 1,
      }}
    >
      {showLoadMore && (
        <box
          height={3}
          justifyContent="center"
          alignItems="center"
          marginBottom={1}
          onMouseDown={(e) => {
            if (e.button === MouseButton.LEFT) handleLoadMore();
          }}
        >
          <text fg={c.accent}>
            <b>↑ Show {hiddenCount} earlier messages</b>
          </text>
        </box>
      )}

      {transcript.length === 0 && !streamingContent && !streamingReasoning && !hasSubagentStreaming && (
        <text fg={c.subtle}>No messages yet</text>
      )}

      <TranscriptList transcript={visibleTranscript} theme={theme} />

      {(streamingReasoning || streamingContent) && (
        <box flexDirection="column" marginBottom={1}>
          <text fg={c.secondary}>
            <b>{streamingAgentName || "Assistant"}</b> <span fg={c.success}>▮</span>
          </text>
          {streamingReasoning && (
            <box flexDirection="column" paddingLeft={1}>
              <text fg={c.accent}>
                <b>{streamingAgentName ? `${streamingAgentName} is thinking` : "Thinking"}</b>
              </text>
              <text fg={c.subtle}>{streamingReasoning}</text>
            </box>
          )}
          {streamingContent && (
            <box paddingLeft={1}>
              <markdown syntaxStyle={getSyntaxStyle(theme.mode)} content={streamingContent} streaming />
            </box>
          )}
        </box>
      )}

      {subagentStreamingEntries.map(([toolCallId, stream]) => {
          const streamContent = (stream.contentChunks ?? []).join("");
          if (stream.contentInTranscript && !streamContent && !stream.currentIntent && !stream.lastProgress) {
            return null;
          }
          return (
          <box key={toolCallId} flexDirection="column" marginBottom={1}>
            <text fg={c.secondary}>
              <b>{stream.agentDisplayName || "Subagent"}</b> <span fg={c.success}>▮</span>
            </text>
            {(() => {
              const statusParts = [stream.taskTitle, stream.currentIntent, stream.lastProgress].filter(
                (part): part is string => Boolean(part),
              );
              if (statusParts.length === 0) return null;
              return (
                <box paddingLeft={1}>
                  <text fg={c.subtle}><i>{statusParts.join(" • ")}</i></text>
                </box>
              );
            })()}
            {stream.reasoning && !stream.contentInTranscript && (
              <box flexDirection="column" paddingLeft={1} marginBottom={1}>
                <text fg={c.accent}>{stream.agentDisplayName ? `${stream.agentDisplayName} is thinking` : "Thinking"}</text>
                <text fg={c.subtle}>{stream.reasoning}</text>
              </box>
            )}
            <box paddingLeft={1}>
              {streamContent ? (
                <markdown syntaxStyle={getSyntaxStyle(theme.mode)} content={streamContent} streaming={!stream.contentInTranscript} />
              ) : !stream.contentInTranscript ? (
                stream.lastProgress ? (
                  <text fg={c.subtle}>{stream.lastProgress}</text>
                ) : (
                  <text fg={c.subtle}><i>...</i></text>
                )
              ) : null}
            </box>
          </box>
          );
        })}
    </scrollbox>
  );
});
