import React, { useState, useCallback } from "react";
import { Box, Text } from "ink";
import TextInput from "ink-text-input";

interface InputBarProps {
  onSubmit: (text: string) => void;
  disabled?: boolean;
}

export const InputBar = React.memo(function InputBar({ onSubmit, disabled = false }: InputBarProps) {
  const [value, setValue] = useState("");

  const handleSubmit = useCallback((text: string) => {
    if (text.trim() && !disabled) {
      onSubmit(text.trim());
      setValue("");
    }
  }, [onSubmit, disabled]);

  return (
    <Box
      width="100%"
      borderStyle="round"
      borderColor={disabled ? "gray" : "cyan"}
      paddingX={1}
    >
      <Text bold color={disabled ? "gray" : "green"}>{">"} </Text>
      <Box flexGrow={1}>
        <TextInput
          value={value}
          onChange={setValue}
          onSubmit={handleSubmit}
          placeholder={disabled ? "Processing..." : "Type your prompt and press Enter..."}
        />
      </Box>
    </Box>
  );
});
