import type { Theme } from "../theme.js";
import { InputBar } from "./InputBar.js";

interface StartScreenProps {
  onSubmit: (text: string) => void;
  disabled?: boolean;
  suppressKeys?: boolean;
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

export function StartScreen({ onSubmit, disabled = false, suppressKeys = false, theme, height }: StartScreenProps) {
  return (
    <box flexDirection="column" width="100%" height={height}>
      <box flexGrow={1} flexDirection="column" alignItems="center" justifyContent="center">
        {LOGO_LINES.map((line, index) => (
          <text key={index} fg={RAINBOW_COLORS[index % RAINBOW_COLORS.length]}>
            {line}
          </text>
        ))}
        <box marginTop={1}>
          <text fg={theme.colors.muted}>Ask anything to get started.</text>
        </box>
      </box>
      <InputBar onSubmit={onSubmit} disabled={disabled} suppressKeys={suppressKeys} theme={theme} />
    </box>
  );
}
