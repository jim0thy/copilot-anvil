import React, { useState, useCallback } from "react";
import { Box, Text, useInput } from "ink";
import type { Theme } from "../theme.js";

interface InputBarProps {
  onSubmit: (text: string) => void;
  disabled?: boolean;
  theme: Theme;
}

export const InputBar = React.memo(function InputBar({ onSubmit, disabled = false, theme }: InputBarProps) {
  const [value, setValue] = useState("");

  const handleSubmit = useCallback((text: string) => {
    if (text.trim() && !disabled) {
      onSubmit(text.trim());
      setValue("");
    }
  }, [onSubmit, disabled]);

  useInput((input, key) => {
    if (key.upArrow || key.downArrow || key.tab || (key.shift && key.tab) || key.escape) {
      return;
    }
    if (key.ctrl && input === "c") {
      return;
    }
    if (key.return) {
      handleSubmit(value);
      return;
    }
    if (key.backspace || key.delete) {
      setValue((prev) => prev.slice(0, -1));
      return;
    }
    if (input) {
      setValue((prev) => prev + input);
    }
  }, { isActive: !disabled });

  const placeholder = disabled ? "Processing..." : "Type your prompt and press Enter...";

  return (
    <Box width="100%" paddingX={1} flexShrink={0} height={1}>
      <Text bold color={disabled ? theme.colors.muted : "green"}>{">"} </Text>
      {value.length > 0 ? (
        <Text>{value}<Text inverse>{" "}</Text></Text>
      ) : (
        <Text dimColor><Text inverse>{placeholder[0]}</Text>{placeholder.slice(1)}</Text>
      )}
    </Box>
  );
});
