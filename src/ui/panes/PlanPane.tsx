import { memo, useMemo } from "react";
import type { Theme } from "../theme.js";
import { parseMarkdownChecklist } from "../formatters.js";

interface PlanPaneProps {
  currentTodo: string | null;
  currentPlan: string | null;
  height: number;
  theme: Theme;
}

export const PlanPane = memo(function PlanPane({
  currentTodo,
  currentPlan,
  height,
  theme,
}: PlanPaneProps) {
  const c = theme.colors;
  const todoItems = useMemo(() => {
    if (!currentTodo) return [];
    return parseMarkdownChecklist(currentTodo);
  }, [currentTodo]);

  const hasPlan = currentPlan && currentPlan.trim().length > 0;
  const hasTodo = todoItems.length > 0;

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
        <b>Plan & Progress</b>
      </text>

      {!hasTodo && !hasPlan && (
        <text fg={c.subtle}>No active plan or todos</text>
      )}

      {/* TODO Checklist */}
      {hasTodo && (
        <box marginTop={1} flexDirection="column">
          <text fg={c.secondary}>
            <b>Tasks:</b>
          </text>
          {todoItems.map((item, idx) => (
            <box key={idx} flexDirection="row" marginLeft={1}>
              <box width={2} flexShrink={0}>
                <text fg={item.checked ? c.success : c.subtle}>
                  {item.checked ? "✓ " : "☐ "}
                </text>
              </box>
              <box flexShrink={1}>
                <text fg={item.checked ? c.subtle : c.text}>
                  {item.text}
                </text>
              </box>
            </box>
          ))}
        </box>
      )}

      {/* Plan Content */}
      {hasPlan && (
        <box marginTop={1} flexDirection="column">
          <text fg={c.subtext0}>
            <b>Plan:</b>
          </text>
          <box marginLeft={1} flexDirection="column">
            {currentPlan.split("\n").slice(0, 10).map((line, idx) => (
              <text key={idx} fg={c.subtle}>
                {line}
              </text>
            ))}
            {currentPlan.split("\n").length > 10 && (
              <text fg={c.subtle}>...</text>
            )}
          </box>
        </box>
      )}
    </box>
  );
});
