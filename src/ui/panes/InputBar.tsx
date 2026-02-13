import { useKeyboard, useTerminalDimensions } from "@opentui/react";
import { memo, useState, useEffect } from "react";
import type { Theme } from "../theme.js";

interface InputBarProps {
  onSubmit: (text: string) => void;
  disabled?: boolean;
  suppressKeys?: boolean;
  queuedCount?: number;
  theme: Theme;
  onHeightChange?: (height: number) => void;
}

// Custom keyboard-driven input (OpenTUI's <input> doesn't work in child components)
export const InputBar = memo(function InputBar({ onSubmit, disabled = false, suppressKeys = false, queuedCount = 0, theme, onHeightChange }: InputBarProps) {
  const [value, setValue] = useState("");
  // Key changes when input is cleared to force height recalculation
  const [resetKey, setResetKey] = useState(0);
  const { width } = useTerminalDimensions();

  const handleSubmit = () => {
    if (value.trim()) {
      onSubmit(value.trim());
      setValue("");
      setResetKey((k) => k + 1);
      // Reset height to minimum when message is sent
      if (onHeightChange) {
        onHeightChange(3);
      }
    }
  };

  useKeyboard((key) => {
    if (suppressKeys) return;
    if (key.name === "return") {
      handleSubmit();
      return;
    }
    if (key.name === "backspace") {
      setValue((v) => v.slice(0, -1));
      return;
    }
    if (key.name === "escape" || key.name === "tab" || key.name === "up" || key.name === "down") return;
    if ((key.ctrl || key.meta) && ["s", "c"].includes(key.name || "")) return;
    if (key.shift && key.name === "tab") return;
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

  // Calculate height based on wrapped text
  // Account for: border (2 lines) + padding + wrapped content
  const contentWidth = Math.max(1, Math.floor(width * 0.65) - 4); // 65% width minus padding and border
  const prompt = "› ";
  const displayText = showPlaceholder ? placeholder : value;
  const fullText = prompt + displayText;
  const lines = Math.ceil(fullText.length / contentWidth) || 1;
  const calculatedHeight = Math.max(3, lines + 2); // Minimum 3, add 2 for borders

  // Notify parent of height change
  useEffect(() => {
    if (onHeightChange) {
      onHeightChange(calculatedHeight);
    }
  }, [calculatedHeight, onHeightChange]);

  return (
    <box key={resetKey} width="100%" height={calculatedHeight} flexShrink={0} borderStyle="single" borderColor={theme.colors.border}>
      <box paddingLeft={1} paddingRight={1}>
        <text wrapMode="word">
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
