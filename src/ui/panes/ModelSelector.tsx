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
  const currentIndex = models.findIndex((m) => m.id === currentModelId);
  const [selectedIndex, setSelectedIndex] = useState(
    currentIndex >= 0 ? currentIndex : 0
  );

  useKeyboard((key) => {
    if (key.name === "escape") {
      onClose();
      return;
    }
    if (key.name === "up") {
      setSelectedIndex((i) => Math.max(0, i - 1));
      return;
    }
    if (key.name === "down") {
      setSelectedIndex((i) => Math.min(models.length - 1, i + 1));
      return;
    }
    if (key.name === "return") {
      if (models[selectedIndex]) {
        onSelect(models[selectedIndex].id);
      }
      return;
    }
  });

  const modalWidth = Math.min(50, width - 4);
  const modalHeight = Math.min(models.length + 6, height - 4);
  const modalX = Math.floor((width - modalWidth) / 2);
  const modalY = Math.floor((height - modalHeight) / 2);

  return (
    <box
      position="absolute"
      left={modalX}
      top={modalY}
      width={modalWidth}
      height={modalHeight}
      borderStyle="double"
      borderColor={theme.colors.primary}
      backgroundColor={theme.colors.statusBarBg}
      flexDirection="column"
      padding={1}
    >
        {/* Header */}
        <box marginBottom={1}>
          <text>
            <span fg={theme.colors.primary}><b>🤖 Select Model</b></span>
          </text>
        </box>

        {/* Model list */}
        <box flexDirection="column">
          {models.map((model, index) => {
            const isSelected = selectedIndex === index;
            const isCurrent = model.id === currentModelId;
            return (
              <box key={model.id}>
                <text>
                  <span fg={isSelected ? theme.colors.primary : theme.colors.muted}>
                    {isSelected ? "› " : "  "}
                  </span>
                  <span fg={isSelected ? theme.colors.info : theme.colors.muted}>
                    {model.name || model.id.split("/").pop() || model.id}
                  </span>
                  {isCurrent && (
                    <span fg={theme.colors.success}> ✓</span>
                  )}
                </text>
              </box>
            );
          })}
        </box>

        {/* Footer with hints */}
        <box marginTop={1}>
          <text>
            <span fg={theme.colors.muted}>
              ↑↓ navigate • Enter select • Esc cancel
            </span>
          </text>
        </box>
      </box>
  );
});
