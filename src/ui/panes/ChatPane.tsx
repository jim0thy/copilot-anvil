import { useMemo } from "react";
import { SyntaxStyle } from "@opentui/core";
import type { ChatMessage } from "../../harness/events.js";
import type { ActiveTool } from "../../harness/Harness.js";
import type { Theme } from "../theme.js";

const defaultSyntaxStyle = SyntaxStyle.create();

interface ChatPaneProps {
  messages: ChatMessage[];
  streamingContent: string;
  streamingReasoning: string;
  activeTools: ActiveTool[];
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

export function ChatPane({ messages, streamingContent, streamingReasoning, activeTools, height, theme }: ChatPaneProps) {
  const visibleMessages = useMemo(() => {
    let estimatedLines = 0;
    const availableLines = height - 2;
    const result: ChatMessage[] = [];
    
    for (let i = messages.length - 1; i >= 0 && estimatedLines < availableLines; i--) {
      const msg = messages[i];
      const contentLines = Math.ceil(msg.content.length / 60) + 2;
      estimatedLines += contentLines;
      result.unshift(msg);
    }
    
    return result;
  }, [messages, height]);

  return (
    <box
      flexDirection="column"
      flexGrow={1}
      paddingLeft={2}
      paddingRight={2}
      paddingTop={1}
      paddingBottom={1}
    >
      {visibleMessages.length === 0 && !streamingContent && !streamingReasoning && (
        <text fg={theme.colors.muted}>No messages yet</text>
      )}

      {visibleMessages.map((msg, index) => {
        const prevMsg = index > 0 ? visibleMessages[index - 1] : null;
        const showLabel = !prevMsg || prevMsg.role !== msg.role;
        
        return (
          <box key={msg.id} flexDirection="column" marginBottom={1}>
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
                  {msg.role === "assistant" ? (
                    <markdown syntaxStyle={defaultSyntaxStyle} content={msg.content} />
                  ) : (
                    <text>{msg.content}</text>
                  )}
                </box>
              </box>
            )}
          </box>
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

      {activeTools.length > 0 && (
        <box flexDirection="column" marginBottom={1} paddingLeft={1} paddingRight={1}>
          {activeTools.map((tool) => (
            <text key={tool.toolCallId} fg={theme.colors.warning}>
              Running: {tool.toolName}
            </text>
          ))}
        </box>
      )}

      {streamingContent && (
        <box flexDirection="column" marginBottom={1}>
          <text fg={theme.colors.secondary}>
            <b>Assistant</b> <span fg={theme.colors.success}>▮</span>
          </text>
          <box paddingLeft={1}>
            <markdown syntaxStyle={defaultSyntaxStyle} content={streamingContent} streaming />
          </box>
        </box>
      )}
    </box>
  );
}
