import React from "react";
import { Box, Text } from "ink";
import type { Theme } from "../theme.js";

export interface ContextInfo {
  currentTokens: number;
  tokenLimit: number;
  conversationLength: number;
  remainingPremiumRequests: number | null;
}

interface ContextPaneProps {
  contextInfo: ContextInfo;
  width: string | number;
  theme: Theme;
}

export const ContextPane = React.memo(function ContextPane({ 
  contextInfo, 
  width, 
  theme 
}: ContextPaneProps) {
  const { currentTokens, tokenLimit, conversationLength, remainingPremiumRequests } = contextInfo;
  
  const contextPercent = tokenLimit > 0 
    ? Math.round((currentTokens / tokenLimit) * 100) 
    : 0;
  
  const percentColor = contextPercent > 80 ? "red" : contextPercent > 60 ? "yellow" : "green";

  return (
    <Box
      flexDirection="column"
      width={width}
      borderStyle="single"
      borderColor={theme.colors.border}
      paddingX={1}
    >
      <Text bold color={theme.colors.muted}>
        Context
      </Text>

      <Box flexDirection="column" marginTop={1}>
        <Box>
          <Text color={theme.colors.muted}>Tokens: </Text>
          <Text color="cyan">
            {currentTokens.toLocaleString()}/{tokenLimit.toLocaleString()}
          </Text>
        </Box>

        <Box>
          <Text color={theme.colors.muted}>Usage: </Text>
          <Text color={percentColor}>{contextPercent}%</Text>
        </Box>

        <Box>
          <Text color={theme.colors.muted}>Conv msgs: </Text>
          <Text>{conversationLength}</Text>
        </Box>

        <Box marginTop={1}>
          <Text color={theme.colors.muted}>Remaining: </Text>
          <Text color="magenta">
            {remainingPremiumRequests !== null ? remainingPremiumRequests : '—'}
          </Text>
        </Box>
      </Box>
    </Box>
  );
});
