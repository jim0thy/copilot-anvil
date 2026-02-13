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
  const c = theme.colors;
  const { currentTokens, tokenLimit, consumedRequests, remainingPremiumRequests } = contextInfo;
  
  const contextPercent = tokenLimit > 0 
    ? Math.round((currentTokens / tokenLimit) * 100) 
    : 0;
  
  const percentColor = contextPercent > 80 
    ? c.error 
    : contextPercent > 60 
    ? c.warning 
    : c.success;

  const barWidth = 30;
  const filledWidth = Math.round((contextPercent / 100) * barWidth);
  const progressBar = "█".repeat(filledWidth) + "░".repeat(barWidth - filledWidth);

  return (
    <box
      flexDirection="column"
      width={width}
      borderStyle="rounded"
      borderColor={c.border}
      paddingLeft={1}
      paddingRight={1}
    >
      {/* Header row with title and counters */}
      <box flexDirection="row" justifyContent="space-between" alignItems="center">
        <text fg={c.primary}>
          <b>Context</b>
        </text>
        <box flexDirection="row" gap={2}>
          <text>
            <span fg={c.subtext0}>Session: </span>
            <span fg={c.info}><b>{consumedRequests}</b></span>
            <span fg={c.subtext0}> premium</span>
          </text>
          <text fg={c.subtle}>│</text>
          <text>
            <span fg={c.subtext0}>Remaining: </span>
            <span fg={c.accent}>
              <b>{remainingPremiumRequests !== null ? remainingPremiumRequests : '∞'}</b>
            </span>
            <span fg={c.subtext0}> premium</span>
          </text>
        </box>
      </box>

      {/* Token usage display with progress bar on same line as percentage */}
      <box flexDirection="column" marginTop={1}>
        <box flexDirection="row" justifyContent="space-between" alignItems="center">
          <text>
            <span fg={c.info}><b>{currentTokens.toLocaleString()}</b></span>
            <span fg={c.subtle}> / </span>
            <span fg={c.subtext0}>{tokenLimit.toLocaleString()}</span>
            <span fg={c.subtext0}> tokens</span>
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
