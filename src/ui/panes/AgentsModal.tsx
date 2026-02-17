import { useKeyboard } from "@opentui/react";
import { memo, useState, useCallback, useRef, useEffect } from "react";
import type { Theme } from "../theme.js";
import { nf } from "../icons.js";

interface AgentInfo {
  id: string;
  name: string;
  description: string;
  model: string;
  tier: string;
  domain: string;
}

interface AgentsModalProps {
  agents: AgentInfo[];
  currentAgentId: string | null;
  onSelect: (agentId: string | null) => void;
  onClose: () => void;
  theme: Theme;
  width: number;
  height: number;
}

export const AgentsModal = memo(function AgentsModal({
  agents,
  currentAgentId,
  onSelect,
  onClose,
  theme,
  width,
  height,
}: AgentsModalProps) {
  const c = theme.colors;
  
  // Group agents by tier
  const groupedAgents = agents.reduce((acc, agent) => {
    const tier = agent.tier;
    if (!acc[tier]) acc[tier] = [];
    acc[tier].push(agent);
    return acc;
  }, {} as Record<string, typeof agents>);

  // Tier order
  const tierOrder = ["specialist", "senior", "mid", "junior"];
  const sortedTiers = tierOrder.filter(tier => groupedAgents[tier]);

  // Flatten into rows with tier headers
  interface Row {
    type: "header" | "agent" | "spacer" | "default";
    tier?: string;
    agent?: AgentInfo;
  }
  const rows: Row[] = [];
  
  // Add "Default (Copilot)" option at the top
  rows.push({ type: "default" });
  rows.push({ type: "spacer" });
  
  sortedTiers.forEach((tier, tierIndex) => {
    if (tierIndex > 0) {
      rows.push({ type: "spacer" });
    }
    rows.push({ type: "header", tier });
    groupedAgents[tier].forEach(agent => {
      rows.push({ type: "agent", agent });
    });
  });

  const currentRowIndex = rows.findIndex(
    (r) => {
      if (currentAgentId === null) return r.type === "default";
      return r.type === "agent" && r.agent?.id === currentAgentId;
    }
  );
  const [selectedIndex, setSelectedIndex] = useState(
    currentRowIndex >= 0 ? currentRowIndex : 0
  );
  const [manualScrollOffset, setManualScrollOffset] = useState<number | null>(null);
  const modalRef = useRef<any>(null);

  // Focus modal when mounted to capture keyboard events
  useEffect(() => {
    if (modalRef.current) {
      modalRef.current.focus();
    }
  }, []);

  const handleKeyboard = useCallback((key: any) => {
    if (key === "escape" || key === "ctrl+c") {
      onClose();
      return;
    }

    if (key === "up") {
      setSelectedIndex((prev) => {
        let newIndex = prev - 1;
        while (newIndex >= 0 && (rows[newIndex].type === "header" || rows[newIndex].type === "spacer")) {
          newIndex--;
        }
        return newIndex >= 0 ? newIndex : prev;
      });
      setManualScrollOffset(null);
      return;
    }

    if (key === "down") {
      setSelectedIndex((prev) => {
        let newIndex = prev + 1;
        while (newIndex < rows.length && (rows[newIndex].type === "header" || rows[newIndex].type === "spacer")) {
          newIndex++;
        }
        return newIndex < rows.length ? newIndex : prev;
      });
      setManualScrollOffset(null);
      return;
    }

    if (key === "return" || key === "enter") {
      const selected = rows[selectedIndex];
      if (selected.type === "agent" && selected.agent) {
        onSelect(selected.agent.id);
      } else if (selected.type === "default") {
        onSelect(null);
      }
      return;
    }
  }, [selectedIndex, rows, onSelect, onClose]);

  useKeyboard(handleKeyboard);

  // Calculate visible area
  const modalWidth = Math.min(90, width - 4);
  const modalHeight = Math.min(30, height - 4);
  const contentHeight = modalHeight - 4; // Borders + padding

  // Auto-scroll to keep selected item visible
  const effectiveScrollOffset = manualScrollOffset !== null 
    ? manualScrollOffset 
    : Math.max(0, Math.min(selectedIndex - Math.floor(contentHeight / 2), rows.length - contentHeight));

  const visibleRows = rows.slice(effectiveScrollOffset, effectiveScrollOffset + contentHeight);

  const tierIcon = {
    specialist: nf.wrench,
    senior: nf.trophy,
    mid: nf.code,
    junior: nf.bolt,
  };

  return (
    <box
      position="absolute"
      left={Math.floor((width - modalWidth) / 2)}
      top={Math.floor((height - modalHeight) / 2)}
      width={modalWidth}
      height={modalHeight}
      flexDirection="column"
      borderStyle="double"
      borderColor={c.primary}
      backgroundColor={c.mantle}
      ref={modalRef}
    >
      <box height={1} paddingLeft={1} paddingRight={1} marginBottom={1}>
        <text>
          <span fg={c.text}><b>Select Agent</b></span>
          <span fg={c.subtext0}> (↑↓ navigate, Enter select, Esc close)</span>
        </text>
      </box>

      <box flexDirection="column" flexGrow={1}>
        {visibleRows.map((row, idx) => {
          const actualIndex = effectiveScrollOffset + idx;
          const isSelected = actualIndex === selectedIndex;
          const backgroundColor = isSelected ? c.surface0 : undefined;
          const fg = isSelected ? c.text : c.subtext1;

          if (row.type === "spacer") {
            return <box key={`spacer-${actualIndex}`} height={1} />;
          }

          if (row.type === "header") {
            const icon = tierIcon[row.tier as keyof typeof tierIcon] || "•";
            return (
              <box key={`header-${actualIndex}`} height={1} paddingLeft={1}>
                <text>
                  <span fg={c.accent}><b>{icon} {row.tier!.charAt(0).toUpperCase() + row.tier!.slice(1)}</b></span>
                </text>
              </box>
            );
          }

          if (row.type === "default") {
            return (
              <box
                key={`default-${actualIndex}`}
                height={1}
                paddingLeft={2}
                backgroundColor={backgroundColor}
              >
                <text>
                  <span fg={fg}>{isSelected ? `${nf.caretRight} ` : "  "}<b>Copilot (Default)</b></span>
                </text>
              </box>
            );
          }

          if (row.type === "agent" && row.agent) {
            const agent = row.agent;
            const isCurrent = agent.id === currentAgentId;
            return (
              <box
                key={`agent-${actualIndex}`}
                height={2}
                paddingLeft={2}
                backgroundColor={backgroundColor}
                flexDirection="column"
              >
                <text>
                  <span fg={fg}>{isSelected ? `${nf.caretRight} ` : "  "}<b>{agent.name}</b></span>
                  {isCurrent && <span fg={isSelected ? fg : c.accent}> {nf.check}</span>}
                  <span fg={isSelected ? fg : c.subtext0}> ({agent.domain})</span>
                </text>
                <text>
                  <span fg={isSelected ? fg : c.subtext0}>    {agent.description} · {agent.model}</span>
                </text>
              </box>
            );
          }

          return null;
        })}
      </box>

      {rows.length > contentHeight && (
        <box height={1} justifyContent="center">
          <text>
            <span fg={c.subtext0}>Showing {effectiveScrollOffset + 1}-{Math.min(effectiveScrollOffset + contentHeight, rows.length)} of {rows.length}</span>
          </text>
        </box>
      )}
    </box>
  );
});
