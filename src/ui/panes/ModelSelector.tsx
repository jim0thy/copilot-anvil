import { useKeyboard } from "@opentui/react";
import { memo, useState, useCallback } from "react";
import type { Theme } from "../theme.js";
import type { ModelDescription } from "../../copilot/CopilotSessionAdapter.js";

interface ModelSelectorProps {
  models: ModelDescription[];
  currentModelId: string | null;
  onSelect: (modelId: string) => void;
  onClose: () => void;
  theme: Theme;
  width: number;
  height: number;
}

export const ModelSelector = memo(function ModelSelector({
  models,
  currentModelId,
  onSelect,
  onClose,
  theme,
  width,
  height,
}: ModelSelectorProps) {
  const c = theme.colors;
  
  // Group models by provider
  const groupedModels = models.reduce((acc, model) => {
    const provider = model.provider || "Other";
    if (!acc[provider]) acc[provider] = [];
    acc[provider].push(model);
    return acc;
  }, {} as Record<string, typeof models>);

  // Sort providers: Claude, OpenAI, Google, then others
  const providerOrder = ["Claude", "OpenAI", "Google"];
  const sortedProviders = Object.keys(groupedModels).sort((a, b) => {
    const aIdx = providerOrder.indexOf(a);
    const bIdx = providerOrder.indexOf(b);
    if (aIdx !== -1 && bIdx !== -1) return aIdx - bIdx;
    if (aIdx !== -1) return -1;
    if (bIdx !== -1) return 1;
    return a.localeCompare(b);
  });

  // Flatten into rows with provider headers
  interface Row {
    type: "header" | "model" | "spacer";
    provider?: string;
    model?: typeof models[0];
  }
  const rows: Row[] = [];
  sortedProviders.forEach((provider, providerIndex) => {
    if (providerIndex > 0) {
      rows.push({ type: "spacer" });
    }
    rows.push({ type: "header", provider });
    groupedModels[provider].forEach(model => {
      rows.push({ type: "model", model });
    });
  });

  const currentRowIndex = rows.findIndex(
    (r) => r.type === "model" && r.model?.id === currentModelId
  );
  const firstModelIndex = rows.findIndex(r => r.type === "model");
  const [selectedIndex, setSelectedIndex] = useState(
    currentRowIndex >= 0 ? currentRowIndex : Math.max(0, firstModelIndex)
  );

  const handleKeyboard = useCallback((key: any) => {
    if (key.name === "escape") {
      onClose();
      return;
    }
    if (key.name === "up") {
      setSelectedIndex((i) => {
        let newIdx = Math.max(0, i - 1);
        // Skip non-selectable rows
        while (newIdx > 0 && rows[newIdx].type !== "model") {
          newIdx--;
        }
        return newIdx;
      });
      return;
    }
    if (key.name === "down") {
      setSelectedIndex((i) => {
        let newIdx = Math.min(rows.length - 1, i + 1);
        // Skip non-selectable rows
        while (newIdx < rows.length - 1 && rows[newIdx].type !== "model") {
          newIdx++;
        }
        return newIdx;
      });
      return;
    }
    if (key.name === "return") {
      const selectedRow = rows[selectedIndex];
      if (selectedRow?.type === "model" && selectedRow.model) {
        onSelect(selectedRow.model.id);
      }
      return;
    }
  }, [onClose, onSelect, rows, selectedIndex]);

  useKeyboard(handleKeyboard);

  const modalWidth = Math.min(60, width - 4);
  const modalHeight = Math.min(rows.length + 6, height - 4);
  const listHeight = Math.min(rows.length, Math.max(4, modalHeight - 6)); // Header/footer + padding
  const modalX = Math.floor((width - modalWidth) / 2);
  const modalY = Math.floor((height - modalHeight) / 2);

  // Calculate scroll offset to keep selected item visible
  const maxScrollOffset = Math.max(0, rows.length - listHeight);
  const scrollOffset = Math.min(
    maxScrollOffset,
    Math.max(0, selectedIndex - Math.floor(listHeight / 2))
  );
  const visibleRows = rows.slice(scrollOffset, scrollOffset + listHeight);

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
            <span fg={c.primary}><b>🤖 Select Model</b></span>
          </text>
        </box>

        {/* Model list - scrollable */}
        <box flexDirection="column" height={listHeight} overflow="hidden">
          {visibleRows.map((row, visibleIndex) => {
            const index = scrollOffset + visibleIndex;
            
            if (row.type === "spacer") {
              return (
                <box key={`spacer-${index}`}>
                  <text> </text>
                </box>
              );
            }

            if (row.type === "header") {
              return (
                <box key={`header-${row.provider}`}>
                  <text>
                    <span fg={c.primary}>
                      <b>{row.provider}</b>
                    </span>
                  </text>
                </box>
              );
            }
            
            const model = row.model!;
            const isSelected = selectedIndex === index;
            const isCurrent = model.id === currentModelId;
            
            return (
              <box key={model.id}>
                <text>
                  <span fg={isSelected ? c.primary : c.subtle}>
                    {isSelected ? "› " : "  "}
                  </span>
                  <span fg={isSelected ? c.info : c.subtext0}>
                    {model.name || model.id.split("/").pop() || model.id}
                  </span>
                  {model.multiplier !== undefined && (
                    <span fg={c.subtle}>
                      {` (${model.multiplier}x)`}
                    </span>
                  )}
                  {isCurrent && (
                    <span fg={c.success}> ✓</span>
                  )}
                </text>
              </box>
            );
          })}
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
