import React, { useMemo } from "react";
import { Box, Text } from "ink";
import type { LogEvent } from "../../harness/events.js";
import type { Theme } from "../theme.js";

interface LogsPaneProps {
  logs: LogEvent[];
  height: number;
  theme: Theme;
}

function getLevelColor(level: LogEvent["level"]): string {
  switch (level) {
    case "error":
      return "red";
    case "warn":
      return "yellow";
    case "info":
      return "blue";
    case "debug":
      return "gray";
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

export const LogsPane = React.memo(function LogsPane({ logs, height, theme }: LogsPaneProps) {
  const visibleLogs = useMemo(() => {
    const availableLines = height - 4;
    return logs.slice(-Math.max(1, availableLines));
  }, [logs, height]);

  return (
    <Box
      flexDirection="column"
      width="100%"
      height={height}
      borderStyle="single"
      borderColor={theme.colors.border}
      paddingX={1}
      overflow="hidden"
    >
      <Text bold color={theme.colors.muted}>
        Logs
      </Text>

      {visibleLogs.length === 0 && <Text color={theme.colors.muted}>No logs yet</Text>}

      {visibleLogs.map((log, index) => (
        <Box key={`${log.createdAt.getTime()}-${index}`} flexDirection="row">
          <Text color={theme.colors.muted}>{formatTime(log.createdAt)} </Text>
          <Text color={getLevelColor(log.level)}>[{getLevelLabel(log.level)}] </Text>
          <Text wrap="truncate-end">{log.message}</Text>
        </Box>
      ))}
    </Box>
  );
});
