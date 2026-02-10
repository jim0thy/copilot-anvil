import React, { useMemo } from "react";
import { Box, Text } from "ink";
import type { LogEvent } from "../../harness/events.js";

interface LogsPaneProps {
  logs: LogEvent[];
  height: number;
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

export const LogsPane = React.memo(function LogsPane({ logs, height }: LogsPaneProps) {
  const visibleLogs = useMemo(() => {
    const availableLines = height - 4;
    return logs.slice(-Math.max(1, availableLines));
  }, [logs, height]);

  return (
    <Box
      flexDirection="column"
      width="40%"
      height={height}
      borderStyle="single"
      borderColor="gray"
      paddingX={1}
      overflow="hidden"
    >
      <Text bold color="gray">
        Logs
      </Text>

      {visibleLogs.length === 0 && <Text color="gray">No logs yet</Text>}

      {visibleLogs.map((log, index) => (
        <Box key={`${log.createdAt.getTime()}-${index}`} flexDirection="row">
          <Text color="gray">{formatTime(log.createdAt)} </Text>
          <Text color={getLevelColor(log.level)}>[{getLevelLabel(log.level)}] </Text>
          <Text wrap="truncate-end">{log.message}</Text>
        </Box>
      ))}
    </Box>
  );
});
