import type { Theme } from "../theme.js";
import { InputBar, type SubmitData } from "./InputBar.js";
import { nf } from "../icons.js";

interface StartScreenProps {
  onSubmit: (data: SubmitData) => void;
  disabled?: boolean;
  suppressKeys?: boolean;
  theme: Theme;
  width: number;
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

export function StartScreen({ onSubmit, disabled = false, suppressKeys = false, theme, width, height, agentName, modelName, reasoningEffort }: StartScreenProps) {
  const c = theme.colors;
  const inputBarWidth = Math.max(60, Math.floor(width * 0.4));
  
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
        <box width={inputBarWidth} marginBottom={3}>
          <InputBar 
            onSubmit={onSubmit} 
            disabled={disabled} 
            suppressKeys={suppressKeys} 
            theme={theme} 
            agentName={agentName} 
            modelName={modelName} 
            reasoningEffort={reasoningEffort} 
            containerWidth={inputBarWidth}
          />
        </box>

        {/* Agent info */}
        <box flexDirection="column" marginBottom={2}>
          <text>
            <span fg={c.palette.mauve}>{nf.circle} </span>
            <span fg={c.palette.mauve}><b>Engineering Manager</b></span>
            <span fg={c.subtext0}> coordinates and delegates work to specialist agents</span>
          </text>
          <text>
            <span fg={c.palette.sapphire}>{nf.circle} </span>
            <span fg={c.palette.sapphire}><b>Strategist</b></span>
            <span fg={c.subtext0}> implementation planner — creates decision-complete plans grounded in codebase reality</span>
          </text>
          <text>
            <span fg={c.palette.green}>{nf.circle} </span>
            <span fg={c.palette.green}><b>Reviewer</b></span>
            <span fg={c.subtext0}> code review, bug detection, and security checks</span>
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
