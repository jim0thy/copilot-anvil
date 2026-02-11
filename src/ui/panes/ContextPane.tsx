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

  const barWidth = 20;
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
      <box marginBottom={1}>
        <text fg={theme.colors.primary}>
          <b>Context</b>
        </text>
      </box>

      <box flexDirection="column">
        <box>
          <text>
            <span fg={theme.colors.muted}>Tokens: </span>
            <span fg={theme.colors.info}>
              {currentTokens.toLocaleString()}<span fg={theme.colors.muted}>/</span>{tokenLimit.toLocaleString()}
            </span>
          </text>
        </box>

        <box flexDirection="column" marginBottom={1}>
          <box>
            <text>
              <span fg={percentColor}>{progressBar}</span>
              <span fg={theme.colors.muted}> {contextPercent}%</span>
            </text>
          </box>
        </box>

        <box>
          <text>
            <span fg={theme.colors.muted}>Requests: </span>
            <span fg={theme.colors.info}>{consumedRequests}</span>
          </text>
        </box>

        <box>
          <text>
            <span fg={theme.colors.muted}>Remaining: </span>
            <span fg={theme.colors.accent}>
              {remainingPremiumRequests !== null ? remainingPremiumRequests : '∞'}
            </span>
          </text>
        </box>
      </box>
    </box>
  );
});
