import { memo, useMemo } from "react";
import type { Theme } from "../theme.js";

interface PlanPaneProps {
  currentIntent: string | null;
  currentTodo: string | null;
  currentPlan: string | null;
  height: number;
  theme: Theme;
}

function parseMarkdownChecklist(markdown: string): Array<{ checked: boolean; text: string }> {
  const lines = markdown.split("\n");
  const items: Array<{ checked: boolean; text: string }> = [];

  for (const line of lines) {
    // Match checkbox patterns: - [ ] or - [x] or - [X]
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
}

export const PlanPane = memo(function PlanPane({
  currentIntent,
  currentTodo,
  currentPlan,
  height,
  theme,
}: PlanPaneProps) {
  const todoItems = useMemo(() => {
    if (!currentTodo) return [];
    return parseMarkdownChecklist(currentTodo);
  }, [currentTodo]);

  const hasPlan = currentPlan && currentPlan.trim().length > 0;
  const hasTodo = todoItems.length > 0;
  const hasIntent = currentIntent && currentIntent.trim().length > 0;

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
      <text fg={theme.colors.primary}>
        <b>Plan & Progress</b>
      </text>

      {!hasIntent && !hasTodo && !hasPlan && (
        <text fg={theme.colors.muted}>No active plan or todos</text>
      )}

      {/* Current Intent */}
      {hasIntent && (
        <box marginTop={1} flexDirection="column">
          <text fg={theme.colors.info}>
            <b>Current Intent:</b>
          </text>
          <box marginLeft={1}>
            <text fg={theme.colors.accent}>→ {currentIntent}</text>
          </box>
        </box>
      )}

      {/* TODO Checklist */}
      {hasTodo && (
        <box marginTop={1} flexDirection="column">
          <text fg={theme.colors.secondary}>
            <b>Tasks:</b>
          </text>
          {todoItems.map((item, idx) => (
            <box key={idx} flexDirection="row" marginLeft={1}>
              <text fg={item.checked ? theme.colors.success : theme.colors.muted}>
                {item.checked ? "✓" : "☐"}{" "}
              </text>
              <text fg={item.checked ? theme.colors.muted : theme.colors.primary}>
                {item.text}
              </text>
            </box>
          ))}
        </box>
      )}

      {/* Plan Content */}
      {hasPlan && (
        <box marginTop={1} flexDirection="column">
          <text fg={theme.colors.muted}>
            <b>Plan:</b>
          </text>
          <box marginLeft={1} flexDirection="column">
            {currentPlan.split("\n").slice(0, 10).map((line, idx) => (
              <text key={idx} fg={theme.colors.muted}>
                {line}
              </text>
            ))}
            {currentPlan.split("\n").length > 10 && (
              <text fg={theme.colors.muted}>...</text>
            )}
          </box>
        </box>
      )}
    </box>
  );
});
