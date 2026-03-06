import { useKeyboard } from "@opentui/react";
import { memo, useCallback, useEffect, useMemo, useState } from "react";
import type { Theme } from "../theme.js";
import type { SessionInfo } from "../../harness/events.js";

interface SessionHistoryPaneProps {
  sessions: SessionInfo[];
  currentSessionId: string | null;
  onSelect: (sessionId: string) => void;
  onNewSession: () => void;
  onClose: () => void;
  focused: boolean;
  height: number;
  width: number;
  theme: Theme;
}

type RowType =
  | { kind: "session"; session: SessionInfo }
  | { kind: "header"; label: string }
  | { kind: "spacer" };

function truncate(value: string, max: number): string {
  if (max <= 0) return "";
  if (value.length <= max) return value;
  if (max === 1) return "…";
  return `${value.slice(0, Math.max(0, max - 1))}…`;
}

function relativeTime(date: Date): string {
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const minute = 60 * 1000;
  const hour = 60 * minute;
  const day = 24 * hour;
  if (diffMs < hour) {
    const mins = Math.max(1, Math.floor(diffMs / minute));
    return `${mins}m ago`;
  }
  if (diffMs < day) {
    const hrs = Math.max(1, Math.floor(diffMs / hour));
    return `${hrs}h ago`;
  }
  if (diffMs < day * 2) {
    return "yesterday";
  }
  if (diffMs < day * 7) {
    return date.toLocaleDateString("en-US", { weekday: "short" });
  }
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export const SessionHistoryPane = memo(function SessionHistoryPane({
  sessions,
  currentSessionId,
  onSelect,
  onNewSession,
  onClose,
  focused,
  height,
  width,
  theme,
}: SessionHistoryPaneProps) {
  const c = theme.colors;
  const [selectedIndex, setSelectedIndex] = useState(0);
  const dividerWidth = Math.max(1, width - 2);
  const rowWidth = Math.max(8, width - 2);

  const { sortedSessions, rows } = useMemo(() => {
    const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000;
    const sorted = [...sessions]
      .sort((a, b) => {
        const dateA = (a.lastUsedAt || a.createdAt)?.getTime() || 0;
        const dateB = (b.lastUsedAt || b.createdAt)?.getTime() || 0;
        return dateB - dateA;
      })
      .filter((s) => {
        if (currentSessionId && s.id === currentSessionId) return true;
        const date = s.lastUsedAt || s.createdAt;
        if (!date) return true;
        return date.getTime() >= cutoff;
      });

    const projectSessions = sorted.filter((s) => s.isCurrentProject);
    const otherSessions = sorted.filter((s) => !s.isCurrentProject);
    const nextRows: RowType[] = [];

    if (projectSessions.length > 0) {
      nextRows.push({ kind: "header", label: "This Project" });
      projectSessions.forEach((session) => nextRows.push({ kind: "session", session }));
    }
    if (otherSessions.length > 0) {
      if (nextRows.length > 0) nextRows.push({ kind: "spacer" });
      nextRows.push({ kind: "header", label: "Other Projects" });
      otherSessions.forEach((session) => nextRows.push({ kind: "session", session }));
    }

    return {
      sortedSessions: sorted,
      rows: nextRows,
    };
  }, [sessions, currentSessionId]);

  const selectableIndices = useMemo(
    () => rows.map((row, index) => (row.kind === "session" ? index : -1)).filter((index) => index >= 0),
    [rows]
  );

  const nextSelectable = useCallback((from: number, direction: 1 | -1): number => {
    const currentPos = selectableIndices.indexOf(from);
    if (currentPos === -1) return selectableIndices[0] ?? 0;
    const nextPos = currentPos + direction;
    if (nextPos < 0 || nextPos >= selectableIndices.length) return from;
    return selectableIndices[nextPos];
  }, [selectableIndices]);

  useEffect(() => {
    if (!rows.length) {
      setSelectedIndex(0);
      return;
    }
    const currentIndex = rows.findIndex(
      (row) => row.kind === "session" && row.session.id === currentSessionId
    );
    if (focused) {
      setSelectedIndex(currentIndex >= 0 ? currentIndex : (selectableIndices[0] ?? 0));
      return;
    }
    setSelectedIndex(selectableIndices[0] ?? 0);
  }, [currentSessionId, focused, rows, selectableIndices]);

  useKeyboard((key) => {
    if (!focused) return;
    if (key.name === "escape") {
      onClose();
      return;
    }
    if (key.name === "up" || key.name === "k") {
      setSelectedIndex((index) => nextSelectable(index, -1));
      return;
    }
    if (key.name === "down" || key.name === "j") {
      setSelectedIndex((index) => nextSelectable(index, 1));
      return;
    }
    if (key.name === "return") {
      const row = rows[selectedIndex];
      if (row?.kind === "session") {
        onSelect(row.session.id);
        onClose();
      }
      return;
    }
    if (key.name === "n" && !key.ctrl) {
      onNewSession();
    }
  });

  const listHeight = Math.max(1, height - 4);
  const maxScrollOffset = Math.max(0, rows.length - listHeight);
  const scrollOffset = Math.min(
    maxScrollOffset,
    Math.max(0, selectedIndex - Math.floor(listHeight / 2))
  );
  const visibleRows = rows.slice(scrollOffset, scrollOffset + listHeight);

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
          <span fg={c.subtext1}><b>Sessions</b></span>
          <span fg={c.overlay0}> ({sortedSessions.length})</span>
        </text>
        <box onMouseDown={onNewSession}>
          <text fg={c.success}><b>+ New</b></text>
        </box>
      </box>

      <box height={1}>
        <text fg={c.overlay0}>
          {focused ? "↑↓ navigate  ⏎ select  esc close" : "ctrl+s focus"}
        </text>
      </box>

      <box height={1}>
        <text fg={c.surface2}>{"─".repeat(dividerWidth)}</text>
      </box>

      <box flexDirection="column" height={listHeight}>
        {rows.length === 0 ? (
          <box flexGrow={1} justifyContent="center" alignItems="center">
            <text fg={c.subtle}>No sessions yet. Press n to create one.</text>
          </box>
        ) : (
          visibleRows.map((row, visibleIndex) => {
            const actualIndex = scrollOffset + visibleIndex;

            if (row.kind === "spacer") {
              return <box key={`spacer-${actualIndex}`} height={1} />;
            }

            if (row.kind === "header") {
              return (
                <box key={`header-${actualIndex}`} height={1} width="100%">
                  <text fg={c.overlay1}>{" ".repeat(2)}{row.label}</text>
                </box>
              );
            }

            const isCurrent = row.session.id === currentSessionId;
            const isHighlighted = focused && actualIndex === selectedIndex;
            const timestampSource = row.session.lastUsedAt || row.session.createdAt;
            const timestamp = timestampSource ? relativeTime(timestampSource) : "";
            const indicator = isHighlighted || isCurrent ? "▌ " : "  ";
            const showTimestamp = rowWidth >= 20;
            const timestampStr = showTimestamp ? timestamp : "";
            const nameWidth = Math.max(1, rowWidth - 2 - timestampStr.length - (timestampStr ? 2 : 0));
            const sessionName = truncate(row.session.name || "Untitled", nameWidth);
            const gap = timestampStr
              ? " ".repeat(Math.max(1, rowWidth - 2 - sessionName.length - timestampStr.length))
              : "";

            const rowBackground = isHighlighted
              ? c.surface1
              : isCurrent
                ? c.surface0
                : undefined;
            const indicatorColor = isHighlighted
              ? c.info
              : isCurrent
                ? c.primary
                : c.subtext0;
            const nameColor = isHighlighted || isCurrent ? c.text : c.subtext0;

            return (
                <box
                  key={row.session.id}
                  onMouseDown={() => { onSelect(row.session.id); onClose(); }}
                  backgroundColor={rowBackground}
                  width="100%"
                  height={1}
                >
                  <text>
                    <span fg={indicatorColor}>{indicator}</span>
                    <span fg={nameColor}>{isHighlighted || isCurrent ? <b>{sessionName}</b> : sessionName}</span>
                    <span fg={c.overlay0}>{gap}{timestampStr}</span>
                  </text>
                </box>
            );
          })
        )}
      </box>
    </box>
  );
});
