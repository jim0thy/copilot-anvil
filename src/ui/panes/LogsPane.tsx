import { memo, useMemo } from "react";
import type { LogEvent } from "../../harness/events.js";
import type { Theme } from "../theme.js";

interface LogsPaneProps {
  logs: LogEvent[];
  height: number;
  theme: Theme;
}

function getLevelColor(level: LogEvent["level"], theme: Theme): string {
  switch (level) {
    case "error":
      return theme.colors.error;
    case "warn":
      return theme.colors.warning;
    case "info":
      return theme.colors.info;
    case "debug":
      return theme.colors.muted;
  }
}

function getLevelLabel(level: LogEvent["level"]): string {
  switch (level) {
    case "error":
      return "ERR";
    case "warn":
      return "WRN";
    case "info":
      return "INF";
    case "debug":
      return "DBG";
  }
}

function formatTime(date: Date): string {
  return date.toLocaleTimeString("en-US", {
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

export const LogsPane = memo(function LogsPane({ logs, height, theme }: LogsPaneProps) {
  const visibleLogs = useMemo(() => {
    const availableLines = height - 4;
    return logs.slice(-Math.max(1, availableLines));
  }, [logs, height]);

  return (
    <box
      flexDirection="column"
      width="100%"
      height={height}
      borderStyle="rounded"
      borderColor={theme.colors.border}
      paddingLeft={1}
      paddingRight={1}
      overflow="hidden"
    >
      <text fg={theme.colors.primary}>
        <b>Logs</b>
      </text>

      {visibleLogs.length === 0 && (
        <text fg={theme.colors.muted}>No logs yet</text>
      )}

      {visibleLogs.map((log, index) => (
        <box key={`${log.createdAt.getTime()}-${index}`} flexDirection="row">
          <text>
            <span fg={theme.colors.muted}>{formatTime(log.createdAt)} </span>
            <b><span fg={getLevelColor(log.level, theme)}>[{getLevelLabel(log.level)}] </span></b>
            <span>{log.message}</span>
          </text>
        </box>
      ))}
    </box>
  );
});
