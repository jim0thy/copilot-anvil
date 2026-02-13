import { memo, useMemo } from "react";
import type { LogEvent } from "../../harness/events.js";
import type { Theme } from "../theme.js";

interface LogsPaneProps {
  logs: LogEvent[];
  height: number;
  theme: Theme;
}

function getLevelColor(level: LogEvent["level"], theme: Theme): string {
  const c = theme.colors;
  switch (level) {
    case "error":
      return c.error;
    case "warn":
      return c.warning;
    case "info":
      return c.info;
    case "debug":
      return c.subtle;
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
  const c = theme.colors;
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
      borderColor={c.border}
      paddingLeft={1}
      paddingRight={1}
      overflow="hidden"
    >
      <text fg={c.primary}>
        <b>Logs</b>
      </text>

      {visibleLogs.length === 0 && (
        <text fg={c.subtle}>No logs yet</text>
      )}

      {visibleLogs.map((log, index) => (
        <box key={`${log.createdAt.getTime()}-${index}`} flexDirection="row">
          <text>
            <span fg={c.subtext0}>{formatTime(log.createdAt)} </span>
            <b><span fg={getLevelColor(log.level, theme)}>[{getLevelLabel(log.level)}] </span></b>
            <span fg={c.text}>{log.message}</span>
          </text>
        </box>
      ))}
    </box>
  );
});
