import React, { useState, useCallback, useEffect } from "react";
import { Box, Text, useInput } from "ink";
import type { Theme } from "../theme.js";

interface InputBarProps {
  onSubmit: (text: string) => void;
  disabled?: boolean;
  theme: Theme;
}

export const InputBar = React.memo(function InputBar({ onSubmit, disabled = false, theme }: InputBarProps) {
  const [value, setValue] = useState("");
  const [cursorVisible, setCursorVisible] = useState(true);

  const handleSubmit = useCallback((text: string) => {
    if (text.trim() && !disabled) {
      onSubmit(text.trim());
      setValue("");
    }
  }, [onSubmit, disabled]);

  useEffect(() => {
    if (disabled) return;
    const interval = setInterval(() => {
      setCursorVisible((prev) => !prev);
    }, 500);
    return () => clearInterval(interval);
  }, [disabled]);

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

  const placeholder = disabled ? "Processing..." : "";
  const promptColor = disabled ? theme.colors.muted : theme.colors.success;
  const promptIcon = disabled ? "›" : "›";

  return (
    <Box width="100%" paddingX={2} flexShrink={0} height={1}>
      <Text bold color={promptColor}>{promptIcon} </Text>
      {value.length > 0 ? (
        <Text color={theme.colors.info}>
          {value}
          {!disabled && cursorVisible && <Text inverse color={theme.colors.primary}> </Text>}
        </Text>
      ) : (
        <>
          <Text color={theme.colors.muted}>{placeholder}</Text>
          {!disabled && cursorVisible && <Text inverse color={theme.colors.primary}> </Text>}
        </>
      )}
    </Box>
  );
});
