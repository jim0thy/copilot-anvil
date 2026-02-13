import { memo, useMemo } from "react";
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
  const c = theme.colors;
  switch (status) {
    case "running":
      return c.warning;
    case "completed":
      return c.success;
    case "failed":
      return c.error;
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

export const TasksPane = memo(function TasksPane({ tasks, height, theme }: TasksPaneProps) {
  const c = theme.colors;
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
        <b>Tasks</b>
      </text>

      {activeTasks.length === 0 && recentTasks.length === 0 && (
        <text fg={c.subtle}>No tasks yet</text>
      )}

      {activeTasks.length > 0 && (
        <>
          <box>
             <text fg={c.subtext1}><b>Active:</b></text>
          </box>
          {activeTasks.map((task) => (
            <box key={task.id} flexDirection="column" marginLeft={1}>
              <box flexDirection="row">
                <text fg={getStatusColor(task.status, theme)}>
                  {getStatusIcon(task.status)}{" "}
                </text>
                <text fg={c.text}><b>{task.name}</b></text>
              </box>
              <box marginLeft={2}>
                 <text fg={c.subtext0}>
                   Started {formatTime(task.startedAt)}
                 </text>
              </box>
            </box>
          ))}
        </>
      )}

      {recentTasks.length > 0 && (
        <>
          <box>
            <text fg={c.subtext0}><b>Recent:</b></text>
          </box>
          {recentTasks.map((task) => (
            <box key={task.id} flexDirection="row" marginLeft={1}>
              <text fg={getStatusColor(task.status, theme)}>
                {getStatusIcon(task.status)}{" "}
              </text>
              <text fg={c.text}>{task.name}</text>
              {task.completedAt && (
                <text fg={c.subtle}>
                  {" "}({formatDuration(task.startedAt, task.completedAt)})
                </text>
              )}
            </box>
          ))}
        </>
      )}
    </box>
  );
});
