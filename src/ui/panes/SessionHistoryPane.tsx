import { memo, useMemo } from "react";
import type { Theme } from "../theme.js";
import type { SessionInfo } from "../../harness/events.js";
import { nf } from "../icons.js";

interface SessionHistoryPaneProps {
  sessions: SessionInfo[];
  currentSessionId: string | null;
  onSelect: (sessionId: string) => void;
  onNewSession: () => void;
  height: number;
  width: number;
  theme: Theme;
}

function getDateGroup(date: Date): string {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const sessionDate = new Date(date.getFullYear(), date.getMonth(), date.getDate());

  const diffDays = Math.floor((today.getTime() - sessionDate.getTime()) / (1000 * 60 * 60 * 24));

  if (diffDays === 0) return "Today";
  if (diffDays === 1) return "Yesterday";
  if (diffDays <= 7) return `${diffDays} days ago`;
  return sessionDate.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function truncate(value: string, max: number): string {
  if (max <= 0) return "";
  if (value.length <= max) return value;
  if (max === 1) return "…";
  return `${value.slice(0, Math.max(0, max - 1))}…`;
}

export const SessionHistoryPane = memo(function SessionHistoryPane({
  sessions,
  currentSessionId,
  onSelect,
  onNewSession,
  height,
  width,
  theme,
}: SessionHistoryPaneProps) {
  const c = theme.colors;
  const maxNameLength = Math.max(8, width - 2);
  const dividerWidth = Math.max(1, width - 2);

  const { recentSessions, projectGroups, otherGroups } = useMemo(() => {
    const recent = [...sessions]
      .sort((a, b) => {
        const dateA = (a.lastUsedAt || a.createdAt)?.getTime() || 0;
        const dateB = (b.lastUsedAt || b.createdAt)?.getTime() || 0;
        return dateB - dateA;
      })
      .slice(0, 10);

    const grouped: Array<{ date: string; sessions: SessionInfo[] }> = [];
    recent.forEach((session) => {
      const date = session.lastUsedAt || session.createdAt;
      if (!date) return;
      const dateGroup = getDateGroup(date);
      let group = grouped.find((g) => g.date === dateGroup);
      if (!group) {
        group = { date: dateGroup, sessions: [] };
        grouped.push(group);
      }
      group.sessions.push(session);
    });

    const currentProject = grouped
      .map((group) => ({
        ...group,
        sessions: group.sessions.filter((s) => s.isCurrentProject),
      }))
      .filter((group) => group.sessions.length > 0);

    const others = grouped
      .map((group) => ({
        ...group,
        sessions: group.sessions.filter((s) => !s.isCurrentProject),
      }))
      .filter((group) => group.sessions.length > 0);

    return {
      recentSessions: recent,
      projectGroups: currentProject,
      otherGroups: others,
    };
  }, [sessions]);

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
      <box flexDirection="row" justifyContent="space-between">
        <text>
          <span fg={c.primary}><b>{nf.folder} Sessions</b></span>
          <span fg={c.subtext0}> ({recentSessions.length})</span>
        </text>
        <box onMouseDown={onNewSession}>
          <text fg={c.success}><b>{nf.plus} New</b></text>
        </box>
      </box>

      <box marginBottom={1}>
        <text fg={c.border}>{"─".repeat(dividerWidth)}</text>
      </box>

      <scrollbox
        height={Math.max(1, height - 4)}
        contentOptions={{
          flexDirection: "column",
        }}
      >
        {projectGroups.length === 0 && otherGroups.length === 0 && (
          <text fg={c.subtle}>No sessions yet</text>
        )}

        {projectGroups.map((group) => (
          <box key={`project-${group.date}`} flexDirection="column">
            <text fg={c.subtext0}>
              <b>{group.date}</b>
            </text>
            {group.sessions.map((session) => {
              const isCurrent = session.id === currentSessionId;
              const indicator = isCurrent ? "▌" : " ";
              const reservedWidth = isCurrent ? 4 : 2;
              const name = truncate(session.name || "Untitled", Math.max(1, maxNameLength - reservedWidth));

              return (
                <box
                  key={session.id}
                  onMouseDown={() => onSelect(session.id)}
                  backgroundColor={isCurrent ? c.surface0 : undefined}
                  width="100%"
                  height={1}
                  marginBottom={1}
                >
                  <text>
                    <span fg={isCurrent ? c.info : c.subtle}>{indicator} </span>
                    <span fg={c.text}>{isCurrent ? <b>{name}</b> : name}</span>
                    {isCurrent && (
                      <span fg={c.success}> {nf.check}</span>
                    )}
                  </text>
                </box>
              );
            })}
          </box>
        ))}

        {otherGroups.length > 0 && (
          <box flexDirection="column">
            <box marginTop={projectGroups.length > 0 ? 1 : 0}>
              <text fg={c.secondary}>
                <b>Other Projects</b>
              </text>
            </box>
            {otherGroups.map((group) => (
              <box key={`other-${group.date}`} flexDirection="column">
                <text fg={c.subtext0}>
                  <b>{group.date}</b>
                </text>
                {group.sessions.map((session) => {
                  const isCurrent = session.id === currentSessionId;
                  const indicator = isCurrent ? "▌" : " ";
                  const reservedWidth = isCurrent ? 4 : 2;
                  const name = truncate(session.name || "Untitled", Math.max(1, maxNameLength - reservedWidth));

                  return (
                    <box
                      key={session.id}
                      onMouseDown={() => onSelect(session.id)}
                      backgroundColor={isCurrent ? c.surface0 : undefined}
                      width="100%"
                      height={1}
                      marginBottom={1}
                    >
                      <text>
                        <span fg={isCurrent ? c.info : c.subtle}>{indicator} </span>
                        <span fg={c.text}>{isCurrent ? <b>{name}</b> : name}</span>
                        {isCurrent && (
                          <span fg={c.success}> {nf.check}</span>
                        )}
                      </text>
                    </box>
                  );
                })}
              </box>
            ))}
          </box>
        )}
      </scrollbox>
    </box>
  );
});
