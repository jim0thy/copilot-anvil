import { useKeyboard } from "@opentui/react";
import { memo, useState } from "react";
import type { Theme } from "../theme.js";

interface ConfirmModalProps {
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
  theme: Theme;
  width: number;
  height: number;
}

export const ConfirmModal = memo(function ConfirmModal({
  title,
  message,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  onConfirm,
  onCancel,
  theme,
  width,
  height,
}: ConfirmModalProps) {
  const c = theme.colors;
  const [selectedIndex, setSelectedIndex] = useState(0);
  const options = [confirmLabel, cancelLabel];

  useKeyboard((key) => {
    if (key.name === "escape") {
      onCancel();
      return;
    }
    if (key.name === "left" || key.name === "right" || key.name === "tab") {
      setSelectedIndex((i) => (i + 1) % 2);
      return;
    }
    if (key.name === "return") {
      if (selectedIndex === 0) {
        onConfirm();
      } else {
        onCancel();
      }
      return;
    }
    // Quick keys
    if (key.name === "y") {
      onConfirm();
      return;
    }
    if (key.name === "n") {
      onCancel();
      return;
    }
  });

  const modalWidth = Math.min(60, width - 4);
  const lines = message.split("\n");
  const modalHeight = Math.min(lines.length + 8, height - 4);
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
      borderColor={c.warning}
      backgroundColor={c.mantle}
      flexDirection="column"
      padding={1}
    >
      {/* Header */}
      <box marginBottom={1}>
        <text>
          <span fg={c.warning}><b>⚠️  {title}</b></span>
        </text>
      </box>

      {/* Message */}
      <box flexDirection="column" marginBottom={1}>
        {lines.map((line, index) => (
          <text key={index}>
            <span fg={c.text}>{line}</span>
          </text>
        ))}
      </box>

      {/* Buttons */}
      <box flexDirection="row" marginTop={1}>
        {options.map((option, index) => {
          const isSelected = selectedIndex === index;
          const isConfirm = index === 0;
          return (
            <box key={option} marginRight={2}>
              <text>
                <span
                  fg={isSelected ? (isConfirm ? c.warning : c.subtext0) : c.subtext0}
                  bg={isSelected ? c.surface1 : undefined}
                >
                  {isSelected ? ` ${option} ` : ` ${option} `}
                </span>
              </text>
            </box>
          );
        })}
      </box>

      {/* Footer with hints */}
      <box marginTop={1}>
        <text>
          <span fg={c.subtle}>
            ←→ navigate • Enter select • Y/N quick • Esc cancel
          </span>
        </text>
      </box>
    </box>
  );
});
