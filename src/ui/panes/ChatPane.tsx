import React, { useMemo } from "react";
import { Box, Text } from "ink";
import Markdown from "ink-markdown-es";
import type { ChatMessage } from "../../harness/events.js";
import type { ReactNode } from "react";

interface ChatPaneProps {
  messages: ChatMessage[];
  streamingContent: string;
  streamingReasoning: string;
  height: number;
}

function formatRole(role: ChatMessage["role"]): string {
  switch (role) {
    case "user":
      return "[You]";
    case "assistant":
      return "[Assistant]";
    case "tool":
      return "[Tool]";
    case "system":
      return "[System]";
  }
}

function getRoleColor(role: ChatMessage["role"]): string {
  switch (role) {
    case "user":
      return "cyan";
    case "assistant":
      return "green";
    case "tool":
      return "yellow";
    case "system":
      return "gray";
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

export function ChatPane({ messages, streamingContent, streamingReasoning, height }: ChatPaneProps) {
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
      paddingX={1}
    >
      {visibleMessages.length === 0 && !streamingContent && !streamingReasoning && (
        <Text color="gray">No messages yet. Type a prompt below.</Text>
      )}

      {visibleMessages.map((msg) => (
        <Box key={msg.id} flexDirection="column" marginBottom={1}>
          {msg.role === "assistant" && msg.reasoning && (
            <Box flexDirection="column" marginBottom={1}>
              <Text color="magenta" bold dimColor>
                [Thinking]
              </Text>
              <Text color="gray" dimColor wrap="wrap">
                {msg.reasoning}
              </Text>
            </Box>
          )}
          <Text color={getRoleColor(msg.role)} bold>
            {formatRole(msg.role)}
          </Text>
          {msg.role === "assistant" ? (
            <Markdown renderers={markdownRenderers} styles={markdownStyles}>
              {msg.content}
            </Markdown>
          ) : (
            <Text wrap="wrap">{msg.content}</Text>
          )}
        </Box>
      ))}

      {streamingReasoning && (
        <Box flexDirection="column" marginBottom={1}>
          <Text color="magenta" bold dimColor>
            [Thinking] <Text color="gray">▌</Text>
          </Text>
          <Text color="gray" dimColor wrap="wrap">
            {streamingReasoning}
          </Text>
        </Box>
      )}

      {streamingContent && (
        <Box flexDirection="column" marginBottom={1}>
          <Text color="green" bold>
            [Assistant] <Text color="gray">▌</Text>
          </Text>
          <Markdown renderers={markdownRenderers} styles={markdownStyles}>
            {streamingContent}
          </Markdown>
        </Box>
      )}
    </Box>
  );
}
