import React, { useMemo } from "react";
import { Box, Text } from "ink";
import type { Theme } from "../theme.js";

export interface Task {
  id: string;
  name: string;
  status: "running" | "completed" | "failed";
  startedAt: Date;
  completedAt?: Date;
  error?: string;
}

interface TasksPaneProps {
  tasks: Task[];
  height: number;
  theme: Theme;
}

function getStatusIcon(status: Task["status"]): string {
  switch (status) {
    case "running":
      return "⟳";
    case "completed":
      return "✓";
    case "failed":
      return "✗";
  }
}

function getStatusColor(status: Task["status"], theme: Theme): string {
  switch (status) {
    case "running":
      return theme.colors.warning;
    case "completed":
      return theme.colors.success;
    case "failed":
      return theme.colors.error;
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

function formatDuration(start: Date, end: Date): string {
  const ms = end.getTime() - start.getTime();
  if (ms < 1000) return `${ms}ms`;
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  return `${minutes}m ${seconds % 60}s`;
}

export const TasksPane = React.memo(function TasksPane({ tasks, height, theme }: TasksPaneProps) {
  const { activeTasks, recentTasks } = useMemo(() => {
    const active = tasks.filter(t => t.status === "running");
    const completed = tasks
      .filter(t => t.status !== "running")
      .sort((a, b) => {
        const aTime = a.completedAt?.getTime() ?? a.startedAt.getTime();
        const bTime = b.completedAt?.getTime() ?? b.startedAt.getTime();
        return bTime - aTime;
      });
    
    return {
      activeTasks: active,
      recentTasks: completed.slice(0, Math.max(1, height - active.length - 6)),
    };
  }, [tasks, height]);

  return (
    <Box
      flexDirection="column"
      width="100%"
      height={height}
      borderStyle="round"
      borderColor={theme.colors.border}
      paddingX={1}
      overflow="hidden"
    >
      <Text bold color={theme.colors.primary}>
        Tasks
      </Text>

      {activeTasks.length === 0 && recentTasks.length === 0 && (
        <Text color={theme.colors.muted}>No tasks yet</Text>
      )}

      {activeTasks.length > 0 && (
        <>
          <Box marginTop={0} marginBottom={0}>
             <Text bold color={theme.colors.info}>Active:</Text>
          </Box>
          {activeTasks.map((task) => (
            <Box key={task.id} flexDirection="column" marginLeft={1}>
              <Box flexDirection="row">
                <Text color={getStatusColor(task.status, theme)}>
                  {getStatusIcon(task.status)}{" "}
                </Text>
                <Text bold wrap="truncate-end">{task.name}</Text>
              </Box>
              <Box marginLeft={2}>
                 <Text color={theme.colors.muted}>
                   Started {formatTime(task.startedAt)}
                 </Text>
              </Box>
            </Box>
          ))}
        </>
      )}

      {recentTasks.length > 0 && (
        <>
          <Box marginTop={0} marginBottom={0}>
            <Text bold color={theme.colors.muted}>Recent:</Text>
          </Box>
          {recentTasks.map((task) => (
            <Box key={task.id} flexDirection="row" marginLeft={1}>
              <Text color={getStatusColor(task.status, theme)}>
                {getStatusIcon(task.status)}{" "}
              </Text>
              <Text wrap="truncate-end">{task.name}</Text>
              {task.completedAt && (
                <Text color={theme.colors.muted}>
                  {" "}({formatDuration(task.startedAt, task.completedAt)})
                </Text>
              )}
            </Box>
          ))}
        </>
      )}
    </Box>
  );
});
