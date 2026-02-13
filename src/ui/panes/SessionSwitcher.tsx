import { useKeyboard } from "@opentui/react";
import { memo, useState } from "react";
import type { Theme } from "../theme.js";
import type { SessionInfo } from "../../harness/events.js";

interface SessionSwitcherProps {
  sessions: SessionInfo[];
  currentSessionId: string | null;
  onSelect: (sessionId: string) => void;
  onNewSession: () => void;
  onClose: () => void;
  theme: Theme;
  width: number;
  height: number;
}

// Helper: Get relative time string
function getRelativeTime(date: Date): string {
  const now = new Date();
  const diff = now.getTime() - date.getTime();
  const seconds = Math.floor(diff / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (seconds < 60) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  if (hours < 24) return `${hours}h ago`;
  if (days === 1) return "yesterday";
  return `${days}d ago`;
}

// Helper: Format time as HH:MM AM/PM
function formatTime(date: Date): string {
  const hours = date.getHours();
  const minutes = date.getMinutes();
  const ampm = hours >= 12 ? "PM" : "AM";
  const displayHours = hours % 12 || 12;
  const displayMinutes = minutes.toString().padStart(2, "0");
  return `${displayHours}:${displayMinutes} ${ampm}`;
}

// Helper: Get date group label
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

export const SessionSwitcher = memo(function SessionSwitcher({
  sessions,
  currentSessionId,
  onSelect,
  onNewSession,
  onClose,
  theme,
  width,
  height,
}: SessionSwitcherProps) {
  const c = theme.colors;
  // Sort by most recent and limit to last 10 sessions
  const recentSessions = sessions
    .sort((a, b) => {
      const dateA = (a.lastUsedAt || a.createdAt)?.getTime() || 0;
      const dateB = (b.lastUsedAt || b.createdAt)?.getTime() || 0;
      return dateB - dateA; // Most recent first
    })
    .slice(0, 10);

  // Group sessions by date
  const groupedSessions: Array<{ date: string; sessions: SessionInfo[] }> = [];
  recentSessions.forEach((session) => {
    const date = session.lastUsedAt || session.createdAt;
    if (!date) return;
    
    const dateGroup = getDateGroup(date);
    let group = groupedSessions.find((g) => g.date === dateGroup);
    if (!group) {
      group = { date: dateGroup, sessions: [] };
      groupedSessions.push(group);
    }
    group.sessions.push(session);
  });

  // Separate by project
  const projectGroups = groupedSessions.map((group) => ({
    ...group,
    sessions: group.sessions.filter((s) => s.isCurrentProject),
  })).filter((g) => g.sessions.length > 0);

  const otherGroups = groupedSessions.map((group) => ({
    ...group,
    sessions: group.sessions.filter((s) => !s.isCurrentProject),
  })).filter((g) => g.sessions.length > 0);
  
  // Build flat list of items for navigation
  const items: Array<{ type: "new" | "divider" | "session"; id: string; name: string; session?: SessionInfo; time?: string }> = [
    { type: "new", id: "__new__", name: "New Session" },
  ];

  // Add current project sessions grouped by date
  projectGroups.forEach((group, groupIdx) => {
    items.push({ type: "divider", id: `__divider_proj_${groupIdx}__`, name: group.date });
    group.sessions.forEach((s) => {
      const date = s.lastUsedAt || s.createdAt;
      const time = date ? formatTime(date) : "";
      items.push({ type: "session", id: s.id, name: s.name, session: s, time });
    });
  });

  // Add divider and other project sessions
  if (otherGroups.length > 0) {
    items.push({ type: "divider", id: "__divider_other__", name: "Other Projects" });
    otherGroups.forEach((group, groupIdx) => {
      items.push({ type: "divider", id: `__divider_other_${groupIdx}__`, name: group.date });
      group.sessions.forEach((s) => {
        const date = s.lastUsedAt || s.createdAt;
        const time = date ? formatTime(date) : "";
        items.push({ type: "session", id: s.id, name: s.name, session: s, time });
      });
    });
  }

  const currentIndex = items.findIndex(
    (item) => item.type === "session" && item.id === currentSessionId
  );
  const [selectedIndex, setSelectedIndex] = useState(
    currentIndex >= 0 ? currentIndex : 0
  );

  useKeyboard((key) => {
    if (key.name === "escape") {
      onClose();
      return;
    }
    if (key.name === "up") {
      setSelectedIndex((i) => {
        let newIndex = Math.max(0, i - 1);
        // Skip dividers
        while (newIndex > 0 && items[newIndex]?.type === "divider") {
          newIndex--;
        }
        return newIndex;
      });
      return;
    }
    if (key.name === "down") {
      setSelectedIndex((i) => {
        let newIndex = Math.min(items.length - 1, i + 1);
        // Skip dividers
        while (newIndex < items.length - 1 && items[newIndex]?.type === "divider") {
          newIndex++;
        }
        return newIndex;
      });
      return;
    }
    if (key.name === "return") {
      const item = items[selectedIndex];
      if (item?.type === "new") {
        onNewSession();
        onClose();
      } else if (item?.type === "session") {
        onSelect(item.id);
        onClose();
      }
      return;
    }
  });

  const modalWidth = Math.min(80, width - 4);
  const maxItems = height - 10;
  const displayItems = items.slice(0, maxItems);
  const modalHeight = Math.min(displayItems.length + 6, height - 4);
  const modalX = Math.floor((width - modalWidth) / 2);
  const modalY = Math.floor((height - modalHeight) / 2);

  const formatSessionName = (item: typeof items[number]) => {
    if (item.type === "new") {
      return "+ New Session";
    }
    if (item.type === "divider") {
      return `── ${item.name} ──`;
    }
    // Show session name + time
    const name = item.name || "Untitled";
    const time = item.time ? ` • ${item.time}` : "";
    const displayName = name.length > 30 ? name.slice(0, 27) + "..." : name;
    return displayName + time;
  };

  return (
    <box
      position="absolute"
      left={modalX}
      top={modalY}
      width={modalWidth}
      height={modalHeight}
      borderStyle="double"
      borderColor={c.primary}
      backgroundColor={c.mantle}
      flexDirection="column"
      padding={1}
    >
      {/* Header */}
      <box marginBottom={1}>
        <text>
          <span fg={c.primary}><b>📁 Sessions</b></span>
          {recentSessions.length > 0 && (
            <span fg={c.subtext0}> ({recentSessions.length} recent)</span>
          )}
        </text>
      </box>

      {/* Session list */}
      <box flexDirection="column">
        {displayItems.map((item, index) => {
          const isSelected = selectedIndex === index;
          const isCurrent = item.type === "session" && item.id === currentSessionId;
          const isDivider = item.type === "divider";

          if (isDivider) {
            return (
              <box key={item.id}>
                <text>
                  <span fg={c.subtext0}>
                    {formatSessionName(item)}
                  </span>
                </text>
              </box>
            );
          }

          return (
            <box key={item.id}>
              <text>
                <span fg={isSelected ? c.primary : c.subtle}>
                  {isSelected ? "› " : "  "}
                </span>
                <span fg={isSelected ? (item.type === "new" ? c.success : c.info) : c.subtext0}>
                  {formatSessionName(item)}
                </span>
                {isCurrent && (
                  <span fg={c.success}> ✓ current</span>
                )}
              </text>
            </box>
          );
        })}
        {items.length > maxItems && (
          <box>
            <text>
              <span fg={c.subtle}>
                ... and {items.length - maxItems} more
              </span>
            </text>
          </box>
        )}
      </box>

      {/* Footer with hints */}
      <box marginTop={1}>
        <text>
          <span fg={c.subtle}>
            ↑↓ navigate • Enter select • Esc cancel
          </span>
        </text>
      </box>
    </box>
  );
});
