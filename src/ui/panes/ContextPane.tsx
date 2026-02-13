import { memo } from "react";
import type { Theme } from "../theme.js";

export interface ContextInfo {
  currentTokens: number;
  tokenLimit: number;
  conversationLength: number;
  remainingPremiumRequests: number | null;
  consumedRequests: number;
}

interface ContextPaneProps {
  contextInfo: ContextInfo;
  width: number | `${number}%` | "auto";
  theme: Theme;
}

export const ContextPane = memo(function ContextPane({ 
  contextInfo, 
  width, 
  theme 
}: ContextPaneProps) {
  const { currentTokens, tokenLimit, consumedRequests, remainingPremiumRequests } = contextInfo;
  
  const contextPercent = tokenLimit > 0 
    ? Math.round((currentTokens / tokenLimit) * 100) 
    : 0;
  
  const percentColor = contextPercent > 80 
    ? theme.colors.error 
    : contextPercent > 60 
    ? theme.colors.warning 
    : theme.colors.success;

  const barWidth = 30;
  const filledWidth = Math.round((contextPercent / 100) * barWidth);
  const progressBar = "█".repeat(filledWidth) + "░".repeat(barWidth - filledWidth);

  return (
    <box
      flexDirection="column"
      width={width}
      borderStyle="rounded"
      borderColor={theme.colors.border}
      paddingLeft={1}
      paddingRight={1}
    >
      {/* Header row with title and counters */}
      <box flexDirection="row" justifyContent="space-between" alignItems="center">
        <text fg={theme.colors.primary}>
          <b>Context</b>
        </text>
        <box flexDirection="row" gap={2}>
          <text>
            <span fg={theme.colors.muted}>Session: </span>
            <span fg={theme.colors.info}><b>{consumedRequests}</b></span>
            <span fg={theme.colors.muted}> premium</span>
          </text>
          <text fg={theme.colors.muted}>│</text>
          <text>
            <span fg={theme.colors.muted}>Remaining: </span>
            <span fg={theme.colors.accent}>
              <b>{remainingPremiumRequests !== null ? remainingPremiumRequests : '∞'}</b>
            </span>
            <span fg={theme.colors.muted}> premium</span>
          </text>
        </box>
      </box>

      {/* Token usage display with progress bar on same line as percentage */}
      <box flexDirection="column" marginTop={1}>
        <box flexDirection="row" justifyContent="space-between" alignItems="center">
          <text>
            <span fg={theme.colors.info}><b>{currentTokens.toLocaleString()}</b></span>
            <span fg={theme.colors.muted}> / </span>
            <span fg={theme.colors.muted}>{tokenLimit.toLocaleString()}</span>
            <span fg={theme.colors.muted}> tokens</span>
          </text>
          <text>
            <span fg={percentColor}>{progressBar}</span>
            <span fg={percentColor}> <b>{contextPercent}%</b></span>
          </text>
        </box>
      </box>
    </box>
  );
});
