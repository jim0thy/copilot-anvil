import React from "react";
import { Box, Text } from "ink";
import type { Theme } from "../theme.js";
import { InputBar } from "./InputBar.js";

interface StartScreenProps {
  onSubmit: (text: string) => void;
  disabled?: boolean;
  theme: Theme;
  height: number;
}

const LOGO_LINES = [
  " █████████                           ███  █████      ",
  "███░░░░░███                         ░░░  ░░███       ",
  "░███    ░███  ████████   █████ █████ ████  ░███       ",
  "░███████████ ░░███░░███ ░░███ ░░███ ░░███  ░███       ",
  "░███░░░░░███  ░███ ░███  ░███  ░███  ░███  ░███       ",
  "░███    ░███  ░███ ░███  ░░███ ███   ░███  ░███      █",
  " █████   █████ ████ █████  ░░█████    █████ ███████████",
  "░░░░░   ░░░░░ ░░░░ ░░░░░    ░░░░░    ░░░░░ ░░░░░░░░░░░",
];

const RAINBOW_COLORS = [
  "#ff0000",
  "#ff7f00",
  "#ffff00",
  "#00ff00",
  "#0099ff",
  "#6633ff",
  "#8b00ff",
  "#ff00ff",
];

export function StartScreen({ onSubmit, disabled = false, theme, height }: StartScreenProps) {
  return (
    <Box flexDirection="column" width="100%" height={height}>
      <Box flexGrow={1} flexDirection="column" alignItems="center" justifyContent="center">
        {LOGO_LINES.map((line, index) => (
          <Text key={index} color={RAINBOW_COLORS[index % RAINBOW_COLORS.length]}>
            {line}
          </Text>
        ))}
        <Box marginTop={1}>
          <Text color={theme.colors.muted}>Ask anything to get started.</Text>
        </Box>
      </Box>
      <Box
        borderStyle="single"
        borderColor={theme.colors.borderActive}
        borderTop={true}
        borderBottom={false}
        borderLeft={false}
        borderRight={false}
      >
        <InputBar onSubmit={onSubmit} disabled={disabled} theme={theme} />
      </Box>
    </Box>
  );
}
