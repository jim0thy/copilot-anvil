import React, { useMemo } from "react";
import { Box, Text } from "ink";
import Markdown from "ink-markdown-es";
import type { ChatMessage } from "../../harness/events.js";
import type { ActiveTool } from "../../harness/Harness.js";
import type { ReactNode } from "react";
import type { Theme } from "../theme.js";

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

const markdownRenderers = {
  paragraph: (content: ReactNode) => (
    <Box>
      <Text wrap="wrap">{content}</Text>
    </Box>
  ),
};

const markdownStyles = {
  paragraph: {
    wrap: "wrap" as const,
  },
};

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
    <Box
      flexDirection="column"
      flexGrow={1}
      paddingX={2}
      paddingY={1}
    >
      {visibleMessages.length === 0 && !streamingContent && !streamingReasoning && (
        <Text color={theme.colors.muted}>No messages yet</Text>
      )}

      {visibleMessages.map((msg, index) => {
        const prevMsg = index > 0 ? visibleMessages[index - 1] : null;
        const showLabel = !prevMsg || prevMsg.role !== msg.role;
        
        return (
          <Box key={msg.id} flexDirection="column" marginBottom={1}>
            {msg.role === "assistant" && msg.reasoning && (
              <Box flexDirection="column" marginBottom={1} paddingX={1}>
                <Text color={theme.colors.accent} bold>
                  Thinking...
                </Text>
                <Text color={theme.colors.muted} wrap="wrap">
                  {msg.reasoning}
                </Text>
              </Box>
            )}
            
            {msg.role === "user" ? (
               <Box borderStyle="single" borderLeft={true} borderRight={false} borderTop={false} borderBottom={false} borderColor={theme.colors.info} paddingLeft={1} flexDirection="column">
                 {showLabel && <Text color={theme.colors.info} bold>{formatRole(msg.role)}</Text>}
                 <Text wrap="wrap">{msg.content}</Text>
               </Box>
            ) : (
              <Box flexDirection="column">
                {showLabel && (
                  <Text color={getRoleColor(msg.role, theme)} bold>
                    {formatRole(msg.role)}
                  </Text>
                )}
                <Box paddingLeft={1}>
                  {msg.role === "assistant" ? (
                    <Markdown renderers={markdownRenderers} styles={markdownStyles}>
                      {msg.content}
                    </Markdown>
                  ) : (
                    <Text wrap="wrap">{msg.content}</Text>
                  )}
                </Box>
              </Box>
            )}
          </Box>
        );
      })}

      {streamingReasoning && (
        <Box flexDirection="column" marginBottom={1} paddingX={1}>
          <Text color={theme.colors.accent} bold>
            Thinking <Text color={theme.colors.warning}>▮</Text>
          </Text>
          <Text color={theme.colors.muted} wrap="wrap">
            {streamingReasoning}
          </Text>
        </Box>
      )}

      {activeTools.length > 0 && (
        <Box flexDirection="column" marginBottom={1} paddingX={1}>
          {activeTools.map((tool) => (
            <Text key={tool.toolCallId} color={theme.colors.warning}>
              Running: {tool.toolName}
            </Text>
          ))}
        </Box>
      )}

      {streamingContent && (
        <Box flexDirection="column" marginBottom={1}>
          <Text color={theme.colors.secondary} bold>
            Assistant <Text color={theme.colors.success}>▮</Text>
          </Text>
          <Box paddingLeft={1}>
            <Markdown renderers={markdownRenderers} styles={markdownStyles}>
              {streamingContent}
            </Markdown>
          </Box>
        </Box>
      )}
    </Box>
  );
}
