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
  
  const percentColor = contextPercent > 80 
    ? theme.colors.error 
    : contextPercent > 60 
    ? theme.colors.warning 
    : theme.colors.success;

  // Simple progress bar
  const barWidth = 20;
  const filledWidth = Math.round((contextPercent / 100) * barWidth);
  const progressBar = "█".repeat(filledWidth) + "░".repeat(barWidth - filledWidth);

  return (
    <Box
      flexDirection="column"
      width={width}
      borderStyle="round"
      borderColor={theme.colors.border}
      paddingX={1}
      paddingY={0}
    >
      <Box marginTop={0} marginBottom={1}>
        <Text bold color={theme.colors.primary}>
          Context
        </Text>
      </Box>

      <Box flexDirection="column">
        <Box marginBottom={0}>
          <Text color={theme.colors.muted}>Tokens: </Text>
          <Text color={theme.colors.info}>
            {currentTokens.toLocaleString()}<Text color={theme.colors.muted}>/</Text>{tokenLimit.toLocaleString()}
          </Text>
        </Box>

        <Box flexDirection="column" marginBottom={1}>
          <Box>
            <Text color={percentColor}>{progressBar}</Text>
            <Text color={theme.colors.muted}> {contextPercent}%</Text>
          </Box>
        </Box>

        <Box>
          <Text color={theme.colors.muted}>Messages: </Text>
          <Text color={theme.colors.info}>{conversationLength}</Text>
        </Box>

        <Box marginTop={0}>
          <Text color={theme.colors.muted}>Remaining: </Text>
          <Text color={theme.colors.accent}>
            {remainingPremiumRequests !== null ? remainingPremiumRequests : '∞'}
          </Text>
        </Box>
      </Box>
    </Box>
  );
});
