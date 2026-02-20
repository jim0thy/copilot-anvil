import { memo, useMemo } from "react";
import type { Theme } from "../theme.js";
import type { ContextInfo } from "./ContextPane.js";
import type { FileChange } from "../../utils/gitDiff.js";
import type { Subagent, Skill } from "../../harness/Harness.js";
import type { OrchestrationMode } from "../../agents/types.js";
import { getStatusIcon, getStatusColor, parseMarkdownChecklist } from "../formatters.js";
import { nf } from "../icons.js";
import { useSpinner } from "../hooks.js";

interface SidebarProps {
  contextInfo: ContextInfo;
  orchestrationMode: OrchestrationMode;
  files: FileChange[];
  currentSessionName?: string | null;
  currentIntent: string | null;
  currentTodo: string | null;
  currentPlan: string | null;
  subagents: Subagent[];
  skills: Skill[];
  agentName?: string;
  modelName?: string;
  height: number;
  width: number;
  theme: Theme;
}

// --- Context Section (always visible) ---
function ContextSection({ 
  contextInfo, 
  theme, 
  innerWidth 
}: { 
  contextInfo: ContextInfo; 
  theme: Theme; 
  innerWidth: number 
}) {
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

  // Dynamic bar width: use available inner width
  const barWidth = Math.max(10, innerWidth);
  const filledWidth = Math.round((contextPercent / 100) * barWidth);
  const progressBar = "\u2588".repeat(filledWidth) + "\u2591".repeat(barWidth - filledWidth);

  return (
    <box flexDirection="column">
      <box flexDirection="row" justifyContent="space-between" alignItems="center">
        <text fg={c.primary}>
          <b>Context</b>
        </text>
        <box flexDirection="row" gap={2}>
          <text>
            <span fg={c.subtext0}>Req: </span>
            <span fg={c.info}><b>{consumedRequests}</b></span>
          </text>
          <text fg={c.subtle}>{"\u2502"}</text>
          <text>
            <span fg={c.subtext0}>Rem: </span>
            <span fg={c.accent}>
              <b>{remainingPremiumRequests !== null ? remainingPremiumRequests : '\u221E'}</b>
            </span>
          </text>
        </box>
      </box>

      <box flexDirection="column" marginTop={1}>
        <box flexDirection="row" justifyContent="space-between" alignItems="center">
          <text>
            <span fg={c.info}><b>{currentTokens.toLocaleString()}</b></span>
            <span fg={c.subtle}> / </span>
            <span fg={c.subtext0}>{tokenLimit.toLocaleString()}</span>
            <span fg={c.subtext0}> tokens</span>
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
  const c = theme.colors;
  // Dynamic divider width based on available space
  const dividerWidth = Math.max(1, innerWidth);
  return (
    <box marginTop={1} marginBottom={1} width="100%">
      <text fg={c.border}>{"\u2500".repeat(dividerWidth)}</text>
    </box>
  );
}

// --- File status helpers (file-specific icons, distinct from task/subagent status) ---
function getFileStatusIcon(status: FileChange["status"]): string {
  switch (status) {
    case "modified": return nf.circle;
    case "added": return nf.plus;
    case "deleted": return nf.minus;
    case "renamed": return nf.arrowRight;
  }
}

function getFileStatusColor(status: FileChange["status"], theme: Theme): string {
  const c = theme.colors;
  switch (status) {
    case "modified": return c.warning;
    case "added": return c.success;
    case "deleted": return c.error;
    case "renamed": return c.info;
  }
}

// --- Files Modified Section ---
function FilesSection({ files, theme }: { files: FileChange[]; theme: Theme }) {
  const c = theme.colors;
  const totalAdditions = files.reduce((sum, f) => sum + f.additions, 0);
  const totalDeletions = files.reduce((sum, f) => sum + f.deletions, 0);

  // Calculate max widths for alignment
  const maxAddWidth = Math.max(
    ...files.map(f => f.additions > 0 ? `+${f.additions}`.length : 0),
    totalAdditions > 0 ? `+${totalAdditions}`.length : 0
  );
  const maxDelWidth = Math.max(
    ...files.map(f => f.deletions > 0 ? `-${f.deletions}`.length : 0),
    totalDeletions > 0 ? `-${totalDeletions}`.length : 0
  );

  const formatAdd = (n: number) => n > 0 ? `+${n}`.padStart(maxAddWidth) : " ".repeat(maxAddWidth);
  const formatDel = (n: number) => n > 0 ? `-${n}`.padStart(maxDelWidth) : " ".repeat(maxDelWidth);

  return (
    <box flexDirection="column" gap={0}>
      <box height={1}>
        <text fg={c.primary}>
          <b>Files Modified</b>
          <span fg={c.subtext0}> ({files.length})</span>
        </text>
      </box>

      {files.map((file, idx) => (
        <box key={idx} flexDirection="row" justifyContent="space-between" height={1}>
          <box flexDirection="row" flexShrink={1} overflow="hidden" height={1}>
            <text fg={getFileStatusColor(file.status, theme)}>
              {getFileStatusIcon(file.status)}{" "}
            </text>
            <text fg={c.text}>{file.path}</text>
          </box>
          <box flexShrink={0}>
            <text>
              <span fg={file.additions > 0 ? c.success : c.text}>{formatAdd(file.additions)}</span>
              <span> </span>
              <span fg={file.deletions > 0 ? c.error : c.text}>{formatDel(file.deletions)}</span>
            </text>
          </box>
        </box>
      ))}

      <box flexDirection="row" justifyContent="space-between" height={1} marginTop={1}>
        <text fg={c.subtext0}><b>Total</b></text>
        <box flexShrink={0}>
          <text>
            <b>
              <span fg={totalAdditions > 0 ? c.success : c.text}>{formatAdd(totalAdditions)}</span>
              <span> </span>
              <span fg={totalDeletions > 0 ? c.error : c.text}>{formatDel(totalDeletions)}</span>
            </b>
          </text>
        </box>
      </box>
    </box>
  );
}

// --- Plan & Progress Section ---
function PlanSection({
  currentTodo,
  theme
}: {
  currentTodo: string | null;
  theme: Theme;
}) {
  const c = theme.colors;
  const todoItems = useMemo(() => {
    if (!currentTodo) return [];
    return parseMarkdownChecklist(currentTodo);
  }, [currentTodo]);

  // Find the first unchecked item (current task)
  const currentTaskIndex = useMemo(() => {
    return todoItems.findIndex(item => !item.checked);
  }, [todoItems]);

  return (
    <box flexDirection="column">
      <text fg={c.primary}>
        <b>Plan & Progress</b>
      </text>

      {todoItems.length === 0 ? (
        <box marginTop={1}>
          <text fg={c.subtle}>No active tasks</text>
        </box>
      ) : (
        <box marginTop={1} flexDirection="column">
          {todoItems.map((item, idx) => {
            const isCurrent = idx === currentTaskIndex && !item.checked;
            return (
              <box key={idx} flexDirection="row" width="100%">
                <box width={5} flexShrink={0}>
                  <text fg={item.checked ? c.success : c.text}>
                    {item.checked ? `[${nf.check}]` : "[ ]"}
                  </text>
                </box>
                <box flexShrink={1} width="100%">
                  <text 
                    fg={item.checked ? c.subtle : c.text}
                    bg={isCurrent ? c.surface0 : undefined}
                  >
                    {isCurrent ? <b>{item.text}</b> : item.text}
                  </text>
                </box>
              </box>
            );
          })}
        </box>
      )}
    </box>
  );
}

// --- Subagents Section ---
function SubagentsSection({
  subagents,
  orchestrationMode,
  currentIntent,
  agentName,
  modelName,
  theme
}: {
  subagents: Subagent[];
  orchestrationMode: OrchestrationMode;
  currentIntent: string | null;
  agentName?: string;
  modelName?: string;
  theme: Theme;
}) {
  const c = theme.colors;
  const spinner = useSpinner();

  const { activeSubagents, completedSubagents } = useMemo(() => {
    const active = subagents.filter(s => s.status === "running");
    const completed = subagents
      .filter(s => s.status !== "running")
      .sort((a, b) => {
        const aTime = a.completedAt?.getTime() ?? a.startedAt.getTime();
        const bTime = b.completedAt?.getTime() ?? b.startedAt.getTime();
        return bTime - aTime;
      })
      .slice(0, 5);

    return { activeSubagents: active, completedSubagents: completed };
  }, [subagents]);

  const hasAnySubagents = activeSubagents.length > 0 || completedSubagents.length > 0;

  return (
    <box flexDirection="column">
      <text fg={c.primary}>
        <b>Dev Team</b>
      </text>

      {/* Main Agent Entry */}
      <box marginTop={1} flexDirection="column">
        <box flexDirection="row">
          <text fg={c.success}>
            {spinner}{" "}
          </text>
          <text fg={c.text}><b>{agentName || "Engineering Manager"}</b></text>
          {modelName && (
            <text fg={c.subtle}> {" "}({modelName})</text>
          )}
        </box>
        {currentIntent && currentIntent.trim().length > 0 && (
          <box marginLeft={2}>
            <text>
              <span fg={c.accent}>{nf.arrowRight} {currentIntent}</span>
            </text>
          </box>
        )}
      </box>

      {!hasAnySubagents && orchestrationMode === "orchestrated" && (
        <box marginTop={1}>
          <text fg={c.subtle}>Ready to delegate tasks</text>
        </box>
      )}

      {activeSubagents.length > 0 && (
        <box marginTop={1} flexDirection="column">
          {activeSubagents.map((agent) => (
            <box key={agent.toolCallId} flexDirection="column">
              <box flexDirection="row">
                <text fg={getStatusColor(agent.status, theme)}>
                  {spinner}{" "}
                </text>
                <text fg={c.text}><b>{agent.agentDisplayName}</b></text>
                {agent.model && (
                  <text fg={c.subtle}> {" "}({agent.model})</text>
                )}
              </box>
              {agent.taskTitle && (
                <box marginLeft={2}>
                  <text fg={c.subtext0}>{agent.taskTitle}</text>
                </box>
              )}
              {agent.currentIntent && (
                <box marginLeft={2}>
                  <text>
                    <span fg={c.accent}>{nf.arrowRight} {agent.currentIntent}</span>
                  </text>
                </box>
              )}
            </box>
          ))}
        </box>
      )}

      {completedSubagents.length > 0 && (
        <box marginTop={activeSubagents.length > 0 ? 0 : 1} flexDirection="column">
          {completedSubagents.map((agent) => (
            <box key={agent.toolCallId} flexDirection="column">
              <box flexDirection="row">
                <text fg={getStatusColor(agent.status, theme)}>
                  {getStatusIcon(agent.status)}{" "}
                </text>
                <text fg={c.subtle}>{agent.agentDisplayName}</text>
                {agent.model && (
                  <text fg={c.subtle}> {" "}({agent.model})</text>
                )}
              </box>
              {agent.taskTitle && (
                <box marginLeft={2}>
                  <text fg={c.subtext0}>{agent.taskTitle}</text>
                </box>
              )}
            </box>
          ))}
        </box>
      )}
    </box>
  );
}

// --- Skills Section ---
function SkillsSection({
  skills,
  theme
}: {
  skills: Skill[];
  theme: Theme;
}) {
  const c = theme.colors;
  const recentSkills = useMemo(() => {
    return skills
      .sort((a, b) => b.invokedAt.getTime() - a.invokedAt.getTime())
      .slice(0, 5);
  }, [skills]);

  return (
    <box flexDirection="column">
      <text fg={c.secondary}>
        <b>Skills</b>
      </text>

      {recentSkills.length > 0 && (
        <box marginTop={1} flexDirection="column">
          {recentSkills.map((skill) => (
            <box key={skill.name} flexDirection="row">
              <text fg={c.accent}>{nf.diamond} </text>
              <text fg={c.text}>{skill.name}</text>
              {skill.invokeCount > 1 && (
                <text fg={c.subtext0}>
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
  orchestrationMode,
  files,
  currentSessionName,
  currentIntent,
  currentTodo,
  currentPlan,
  subagents,
  skills,
  agentName,
  modelName,
  height,
  width,
  theme,
}: SidebarProps) {
  const c = theme.colors;
  // Calculate inner width: total width minus paddingLeft (1) and paddingRight (1)
  const innerWidth = Math.max(1, width - 2);

  // Determine which sections have content
  const hasFiles = files.length > 0;
  const hasSubagents = subagents.length > 0;
  const hasSkills = skills.length > 0;
  const hasSessionName = !!(currentSessionName && currentSessionName.trim().length > 0 && currentSessionName.trim() !== "New session");
  const headerTitle = hasSessionName ? currentSessionName : null;

  return (
    <box
      flexDirection="column"
      width="100%"
      height={height}
      backgroundColor={c.mantle}
      paddingLeft={1}
      paddingRight={1}
      paddingTop={1}
      overflow="hidden"
    >
      {/* Conversation Title */}
      {headerTitle && (
        <box marginBottom={1}>
          <text fg={c.primary}><b>{headerTitle}</b></text>
        </box>
      )}

      {/* Context Section - Always visible */}
      <ContextSection contextInfo={contextInfo} theme={theme} innerWidth={innerWidth} />

      {/* Subagents Section - Always show main agent, subagents if any */}
      <SectionDivider theme={theme} innerWidth={innerWidth} />
      <SubagentsSection 
        subagents={subagents} 
        orchestrationMode={orchestrationMode} 
        currentIntent={currentIntent} 
        agentName={agentName}
        modelName={modelName}
        theme={theme} 
      />

      {/* Files Modified Section - Only when files exist */}
      {hasFiles && (
        <>
          <SectionDivider theme={theme} innerWidth={innerWidth} />
          <FilesSection files={files} theme={theme} />
        </>
      )}

      {/* Plan & Progress Section - Always visible */}
      <SectionDivider theme={theme} innerWidth={innerWidth} />
      <PlanSection
        currentTodo={currentTodo}
        theme={theme}
      />

      {/* Skills Section - Only when there are skills */}
      {hasSkills && (
        <>
          <SectionDivider theme={theme} innerWidth={innerWidth} />
          <SkillsSection skills={skills} theme={theme} />
        </>
      )}
    </box>
  );
});
