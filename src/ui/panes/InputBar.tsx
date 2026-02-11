import { useKeyboard } from "@opentui/react";
import { memo, useState, useCallback } from "react";
import type { Theme } from "../theme.js";

interface InputBarProps {
  onSubmit: (text: string) => void;
  disabled?: boolean;
  queuedCount?: number;
  theme: Theme;
}

// Custom keyboard-driven input (OpenTUI's <input> doesn't work in child components)
export const InputBar = memo(function InputBar({ onSubmit, disabled = false, queuedCount = 0, theme }: InputBarProps) {
  const [value, setValue] = useState("");

  useKeyboard((key) => {
    if (key.name === "return") {
      if (value.trim()) {
        onSubmit(value.trim());
        setValue("");
      }
      return;
    }
    if (key.name === "backspace") {
      setValue((v) => v.slice(0, -1));
      return;
    }
    // Let App-level handler handle these
    if (key.name === "escape" || key.name === "tab" || key.name === "up" || key.name === "down") return;
    if (key.ctrl || key.meta) return;
    // Printable character
    if (key.sequence && key.sequence.length === 1) {
      setValue((v) => v + key.sequence);
    }
  });

  const placeholder = queuedCount > 0
    ? `Ask anything... (${queuedCount} queued)`
    : "Ask anything...";
  const promptColor = disabled ? theme.colors.muted : theme.colors.success;
  const showPlaceholder = !value;

  return (
    <box width="100%" flexShrink={0} height={3} borderStyle="single" borderColor={theme.colors.border}>
      <box paddingLeft={1} paddingRight={1}>
        <text>
          <span fg={promptColor}><b>{"› "}</b></span>
          {showPlaceholder ? (
            <span fg={theme.colors.muted}>{placeholder}</span>
          ) : (
            <>
              <span>{value}</span>
              <span fg="#000" bg={theme.colors.primary}>{" "}</span>
            </>
          )}
        </text>
      </box>
    </box>
  );
});
