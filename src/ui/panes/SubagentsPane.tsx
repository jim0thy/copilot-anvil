import { memo, useMemo } from "react";
import type { Theme } from "../theme.js";

export interface Subagent {
  toolCallId: string;
  agentName: string;
  agentDisplayName: string;
  agentDescription: string;
  status: "running" | "completed" | "failed";
  startedAt: Date;
  completedAt?: Date;
  error?: string;
}

export interface Skill {
  name: string;
  path: string;
  invokedAt: Date;
  invokeCount: number;
}

interface SubagentsPaneProps {
  subagents: Subagent[];
  skills: Skill[];
  height: number;
  theme: Theme;
}

function getStatusIcon(status: Subagent["status"]): string {
  switch (status) {
    case "running":
      return "⟳";
    case "completed":
      return "✓";
    case "failed":
      return "✗";
  }
}

function getStatusColor(status: Subagent["status"], theme: Theme): string {
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

function formatDuration(start: Date, end: Date): string {
  const ms = end.getTime() - start.getTime();
  if (ms < 1000) return `${ms}ms`;
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  return `${minutes}m ${seconds % 60}s`;
}

export const SubagentsPane = memo(function SubagentsPane({ 
  subagents, 
  skills, 
  height, 
  theme 
}: SubagentsPaneProps) {
  const c = theme.colors;
  const { activeSubagents, completedSubagents, recentSkills } = useMemo(() => {
    const active = subagents.filter(s => s.status === "running");
    const completed = subagents
      .filter(s => s.status !== "running")
      .sort((a, b) => {
        const aTime = a.completedAt?.getTime() ?? a.startedAt.getTime();
        const bTime = b.completedAt?.getTime() ?? b.startedAt.getTime();
        return bTime - aTime;
      })
      .slice(0, 5);
    
    const recent = skills
      .sort((a, b) => b.invokedAt.getTime() - a.invokedAt.getTime())
      .slice(0, 5);
    
    return {
      activeSubagents: active,
      completedSubagents: completed,
      recentSkills: recent,
    };
  }, [subagents, skills]);

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
        <b>Subagents & Skills</b>
      </text>

      {activeSubagents.length === 0 && completedSubagents.length === 0 && recentSkills.length === 0 && (
        <text fg={c.subtle}>No agents or skills used yet</text>
      )}

      {/* Active Subagents */}
      {activeSubagents.length > 0 && (
        <>
          <box marginTop={1}>
            <text fg={c.subtext1}><b>Active Subagents:</b></text>
          </box>
          {activeSubagents.map((agent) => (
            <box key={agent.toolCallId} flexDirection="column" marginLeft={1}>
              <box flexDirection="row">
                <text fg={getStatusColor(agent.status, theme)}>
                  {getStatusIcon(agent.status)}{" "}
                </text>
                <text fg={c.text}><b>{agent.agentDisplayName}</b></text>
              </box>
              <box marginLeft={2}>
                <text fg={c.subtext0}>
                  {agent.agentDescription}
                </text>
              </box>
            </box>
          ))}
        </>
      )}

      {/* Recent Subagents */}
      {completedSubagents.length > 0 && (
        <>
          <box marginTop={1}>
            <text fg={c.subtext0}><b>Recent Subagents:</b></text>
          </box>
          {completedSubagents.map((agent) => (
            <box key={agent.toolCallId} flexDirection="row" marginLeft={1}>
              <text fg={getStatusColor(agent.status, theme)}>
                {getStatusIcon(agent.status)}{" "}
              </text>
              <text fg={c.text}>{agent.agentDisplayName}</text>
              {agent.completedAt && (
                <text fg={c.subtle}>
                  {" "}({formatDuration(agent.startedAt, agent.completedAt)})
                </text>
              )}
            </box>
          ))}
        </>
      )}

      {/* Skills */}
      {recentSkills.length > 0 && (
        <>
          <box marginTop={1}>
            <text fg={c.secondary}><b>Skills:</b></text>
          </box>
          {recentSkills.map((skill) => (
            <box key={skill.name} flexDirection="row" marginLeft={1}>
              <text fg={c.accent}>◆ </text>
              <text fg={c.text}>{skill.name}</text>
              {skill.invokeCount > 1 && (
                <text fg={c.subtext0}>
                  {" "}(×{skill.invokeCount})
                </text>
              )}
            </box>
          ))}
        </>
      )}
    </box>
  );
});
