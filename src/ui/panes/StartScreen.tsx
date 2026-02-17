import type { Theme } from "../theme.js";
import { InputBar, type SubmitData } from "./InputBar.js";
import { nf } from "../icons.js";

interface StartScreenProps {
  onSubmit: (data: SubmitData) => void;
  disabled?: boolean;
  suppressKeys?: boolean;
  theme: Theme;
  height: number;
  agentName?: string;
  modelName?: string;
  reasoningEffort?: "low" | "medium" | "high" | "xhigh";
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

export function StartScreen({ onSubmit, disabled = false, suppressKeys = false, theme, height, agentName, modelName, reasoningEffort }: StartScreenProps) {
  const c = theme.colors;
  return (
    <box flexDirection="column" width="100%" height={height}>
      <box flexGrow={1} flexDirection="column" alignItems="center" justifyContent="center">
        {/* Logo */}
        <box flexDirection="column" alignItems="center" marginBottom={2}>
          {LOGO_LINES.map((line, index) => (
            <text key={index} fg={RAINBOW_COLORS[index % RAINBOW_COLORS.length]}>
              {line}
            </text>
          ))}
        </box>
        
        {/* Input Bar - positioned directly under ASCII art */}
        <box width="60%" marginBottom={3}>
          <InputBar onSubmit={onSubmit} disabled={disabled} suppressKeys={suppressKeys} theme={theme} agentName={agentName} modelName={modelName} reasoningEffort={reasoningEffort} />
        </box>

        {/* Subtitle */}
        <box marginBottom={3}>
          <text fg={c.subtle}>Ask anything to get started</text>
        </box>

        {/* Agent info */}
        <box flexDirection="column" marginBottom={2}>
          <text>
            <span fg={c.info}>{nf.circle} </span>
            <span fg={c.info}><b>Intake</b></span>
            <span fg={c.subtext0}> analyzes your request and asks clarifying questions</span>
          </text>
          <text>
            <span fg={c.accent}>{nf.circle} </span>
            <span fg={c.accent}><b>Tech Lead</b></span>
            <span fg={c.subtext0}> delegates work to specialist agents</span>
          </text>
        </box>

        {/* Keyboard hints */}
        <text>
          <span fg={c.subtext0}>Press </span>
          <span fg={c.success}><b>Tab</b></span>
          <span fg={c.subtext0}> to select agent  •  </span>
          <span fg={c.success}><b>Shift+Tab</b></span>
          <span fg={c.subtext0}> for model</span>
        </text>
      </box>
    </box>
  );
}
