import { memo, useMemo } from "react";
import type { Theme } from "../theme.js";
import type { ContextInfo } from "./ContextPane.js";
import type { FileChange } from "../../utils/gitDiff.js";
import type { Subagent, Skill } from "./SubagentsPane.js";

interface SidebarProps {
  contextInfo: ContextInfo;
  files: FileChange[];
  currentIntent: string | null;
  currentTodo: string | null;
  currentPlan: string | null;
  subagents: Subagent[];
  skills: Skill[];
  height: number;
  width: number;
  theme: Theme;
}

// --- Context Section (always visible) ---
function ContextSection({ contextInfo, theme, innerWidth }: { contextInfo: ContextInfo; theme: Theme; innerWidth: number }) {
  const { currentTokens, tokenLimit, consumedRequests, remainingPremiumRequests } = contextInfo;
  
  const contextPercent = tokenLimit > 0 
    ? Math.round((currentTokens / tokenLimit) * 100) 
    : 0;
  
  const percentColor = contextPercent > 80 
    ? theme.colors.error 
    : contextPercent > 60 
    ? theme.colors.warning 
    : theme.colors.success;

  // Dynamic bar width: use available inner width, capped reasonably
  const barWidth = Math.max(10, Math.min(innerWidth, 60));
  const filledWidth = Math.round((contextPercent / 100) * barWidth);
  const progressBar = "█".repeat(filledWidth) + "░".repeat(barWidth - filledWidth);

  return (
    <box flexDirection="column">
      <box flexDirection="row" justifyContent="space-between" alignItems="center">
        <text fg={theme.colors.primary}>
          <b>Context</b>
        </text>
        <box flexDirection="row" gap={2}>
          <text>
            <span fg={theme.colors.muted}>Req: </span>
            <span fg={theme.colors.info}><b>{consumedRequests}</b></span>
          </text>
          <text fg={theme.colors.muted}>│</text>
          <text>
            <span fg={theme.colors.muted}>Rem: </span>
            <span fg={theme.colors.accent}>
              <b>{remainingPremiumRequests !== null ? remainingPremiumRequests : '∞'}</b>
            </span>
          </text>
        </box>
      </box>

      <box flexDirection="column" marginTop={1}>
        <box flexDirection="row" justifyContent="space-between" alignItems="center">
          <text>
            <span fg={theme.colors.info}><b>{currentTokens.toLocaleString()}</b></span>
            <span fg={theme.colors.muted}> / </span>
            <span fg={theme.colors.muted}>{tokenLimit.toLocaleString()}</span>
            <span fg={theme.colors.muted}> tokens</span>
          </text>
          <text fg={percentColor}><b>{contextPercent}%</b></text>
        </box>
        <box>
          <text fg={percentColor}>{progressBar}</text>
        </box>
      </box>
    </box>
  );
}

// --- Section Divider ---
function SectionDivider({ theme, innerWidth }: { theme: Theme; innerWidth: number }) {
  // Dynamic divider width based on available space
  const dividerWidth = Math.max(1, innerWidth);
  return (
    <box marginTop={1} marginBottom={1} width="100%">
      <text fg={theme.colors.border}>{"─".repeat(dividerWidth)}</text>
    </box>
  );
}

// --- Files Modified Section ---
function FilesSection({ files, theme }: { files: FileChange[]; theme: Theme }) {
  const totalAdditions = files.reduce((sum, f) => sum + f.additions, 0);
  const totalDeletions = files.reduce((sum, f) => sum + f.deletions, 0);

  const getStatusIcon = (status: FileChange["status"]): string => {
    switch (status) {
      case "modified": return "✎";
      case "added": return "+";
      case "deleted": return "✗";
      case "renamed": return "→";
    }
  };

  const getStatusColor = (status: FileChange["status"]): string => {
    switch (status) {
      case "modified": return theme.colors.warning;
      case "added": return theme.colors.success;
      case "deleted": return theme.colors.error;
      case "renamed": return theme.colors.info;
    }
  };

  return (
    <box flexDirection="column">
      <text fg={theme.colors.primary}>
        <b>Files Modified</b>
        <span fg={theme.colors.muted}> ({files.length})</span>
      </text>

      {files.map((file, idx) => (
        <box key={idx} flexDirection="row" justifyContent="space-between">
          <box flexDirection="row" flexShrink={1} width="100%">
            <text fg={getStatusColor(file.status)}>
              {getStatusIcon(file.status)}{" "}
            </text>
            <text>{file.path}</text>
          </box>
          <text fg={theme.colors.muted}>
            {file.additions > 0 && (
              <span fg={theme.colors.success}>+{file.additions}</span>
            )}
            {file.additions > 0 && file.deletions > 0 && <span> </span>}
            {file.deletions > 0 && (
              <span fg={theme.colors.error}>-{file.deletions}</span>
            )}
          </text>
        </box>
      ))}

      <text>
        <span fg={theme.colors.muted}>Total: </span>
        {totalAdditions > 0 && (
          <span fg={theme.colors.success}>+{totalAdditions}</span>
        )}
        {totalAdditions > 0 && totalDeletions > 0 && <span> </span>}
        {totalDeletions > 0 && (
          <span fg={theme.colors.error}>-{totalDeletions}</span>
        )}
      </text>
    </box>
  );
}

// --- Plan & Progress Section ---
function PlanSection({ 
  currentIntent, 
  currentTodo, 
  theme 
}: { 
  currentIntent: string | null; 
  currentTodo: string | null; 
  theme: Theme;
}) {
  const todoItems = useMemo(() => {
    if (!currentTodo) return [];
    const lines = currentTodo.split("\n");
    const items: Array<{ checked: boolean; text: string }> = [];
    for (const line of lines) {
      const match = line.match(/^[\s-]*\[([xX ])\]\s*(.*)$/);
      if (match) {
        const checked = match[1].toLowerCase() === "x";
        const text = match[2].trim();
        if (text) {
          items.push({ checked, text });
        }
      }
    }
    return items;
  }, [currentTodo]);

  return (
    <box flexDirection="column">
      <text fg={theme.colors.primary}>
        <b>Plan & Progress</b>
      </text>

      {currentIntent && (
        <box marginTop={1} flexDirection="column">
          <text fg={theme.colors.accent}>→ {currentIntent}</text>
        </box>
      )}

      {todoItems.length > 0 && (
        <box marginTop={1} flexDirection="column">
          {todoItems.map((item, idx) => (
            <box key={idx} flexDirection="row" width="100%">
              <box width={2} flexShrink={0}>
                <text fg={item.checked ? theme.colors.success : theme.colors.muted}>
                  {item.checked ? "✓ " : "☐ "}
                </text>
              </box>
              <box flexShrink={1} width="100%">
                <text fg={item.checked ? theme.colors.muted : theme.colors.primary}>
                  {item.text}
                </text>
              </box>
            </box>
          ))}
        </box>
      )}
    </box>
  );
}

// --- Subagents & Skills Section ---
function SubagentsSection({ 
  subagents, 
  skills, 
  theme 
}: { 
  subagents: Subagent[]; 
  skills: Skill[]; 
  theme: Theme;
}) {
  const { activeSubagents, completedSubagents, recentSkills } = useMemo(() => {
    const active = subagents.filter(s => s.status === "running");
    const completed = subagents
      .filter(s => s.status !== "running")
      .sort((a, b) => {
        const aTime = a.completedAt?.getTime() ?? a.startedAt.getTime();
        const bTime = b.completedAt?.getTime() ?? b.startedAt.getTime();
        return bTime - aTime;
      })
      .slice(0, 3);
    
    const recent = skills
      .sort((a, b) => b.invokedAt.getTime() - a.invokedAt.getTime())
      .slice(0, 3);
    
    return { activeSubagents: active, completedSubagents: completed, recentSkills: recent };
  }, [subagents, skills]);

  const getStatusIcon = (status: Subagent["status"]): string => {
    switch (status) {
      case "running": return "⟳";
      case "completed": return "✓";
      case "failed": return "✗";
    }
  };

  const getStatusColor = (status: Subagent["status"]): string => {
    switch (status) {
      case "running": return theme.colors.warning;
      case "completed": return theme.colors.success;
      case "failed": return theme.colors.error;
    }
  };

  return (
    <box flexDirection="column">
      <text fg={theme.colors.primary}>
        <b>Subagents & Skills</b>
      </text>

      {activeSubagents.length > 0 && (
        <box marginTop={1} flexDirection="column">
          {activeSubagents.map((agent) => (
            <box key={agent.toolCallId} flexDirection="row">
              <text fg={getStatusColor(agent.status)}>
                {getStatusIcon(agent.status)}{" "}
              </text>
              <text><b>{agent.agentDisplayName}</b></text>
            </box>
          ))}
        </box>
      )}

      {completedSubagents.length > 0 && (
        <box marginTop={activeSubagents.length > 0 ? 0 : 1} flexDirection="column">
          {completedSubagents.map((agent) => (
            <box key={agent.toolCallId} flexDirection="row">
              <text fg={getStatusColor(agent.status)}>
                {getStatusIcon(agent.status)}{" "}
              </text>
              <text fg={theme.colors.muted}>{agent.agentDisplayName}</text>
            </box>
          ))}
        </box>
      )}

      {recentSkills.length > 0 && (
        <box marginTop={1} flexDirection="column">
          {recentSkills.map((skill) => (
            <box key={skill.name} flexDirection="row">
              <text fg={theme.colors.accent}>◆ </text>
              <text>{skill.name}</text>
              {skill.invokeCount > 1 && (
                <text fg={theme.colors.muted}>
                  {" "}(×{skill.invokeCount})
                </text>
              )}
            </box>
          ))}
        </box>
      )}
    </box>
  );
}

// --- Main Sidebar Component ---
export const Sidebar = memo(function Sidebar({
  contextInfo,
  files,
  currentIntent,
  currentTodo,
  currentPlan,
  subagents,
  skills,
  height,
  width,
  theme,
}: SidebarProps) {
  // Calculate inner width: total width minus border (2) and padding (2)
  const innerWidth = Math.max(1, width - 4);
  
  // Determine which sections have content
  const hasFiles = files.length > 0;
  
  const hasPlanContent = useMemo(() => {
    if (currentIntent && currentIntent.trim().length > 0) return true;
    if (currentTodo) {
      const lines = currentTodo.split("\n");
      for (const line of lines) {
        if (line.match(/^[\s-]*\[([xX ])\]\s*(.+)$/)) return true;
      }
    }
    return false;
  }, [currentIntent, currentTodo]);

  const hasSubagentsOrSkills = subagents.length > 0 || skills.length > 0;

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
      {/* Context Section - Always visible */}
      <ContextSection contextInfo={contextInfo} theme={theme} innerWidth={innerWidth} />

      {/* Files Modified Section - Only when files exist */}
      {hasFiles && (
        <>
          <SectionDivider theme={theme} innerWidth={innerWidth} />
          <FilesSection files={files} theme={theme} />
        </>
      )}

      {/* Plan & Progress Section - Only when there's content */}
      {hasPlanContent && (
        <>
          <SectionDivider theme={theme} innerWidth={innerWidth} />
          <PlanSection 
            currentIntent={currentIntent} 
            currentTodo={currentTodo} 
            theme={theme} 
          />
        </>
      )}

      {/* Subagents & Skills Section - Only when there's content */}
      {hasSubagentsOrSkills && (
        <>
          <SectionDivider theme={theme} innerWidth={innerWidth} />
          <SubagentsSection subagents={subagents} skills={skills} theme={theme} />
        </>
      )}
    </box>
  );
});
