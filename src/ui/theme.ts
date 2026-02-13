export type ThemeMode = "light" | "dark";

export interface ThemeColors {
  border: string;
  borderActive: string;
  borderDim: string;
  muted: string;
  primary: string;
  secondary: string;
  success: string;
  warning: string;
  error: string;
  info: string;
  accent: string;
  statusBarBg: string;
  paneBg: string;
  diffAddedBg: string;
  diffRemovedBg: string;
  diffContextBg: string;
  diffLineNumberBg: string;
}

export interface Theme {
  mode: ThemeMode;
  colors: ThemeColors;
}

const DARK_COLORS: ThemeColors = {
  border: "#4a5568",
  borderActive: "#7c8cff",
  borderDim: "#2d3748",
  muted: "#718096",
  primary: "#818cf8",
  secondary: "#5eead4",
  success: "#6ee7b7",
  warning: "#fbbf24",
  error: "#fb7185",
  info: "#60a5fa",
  accent: "#c084fc",
  statusBarBg: "#2d3748",
  paneBg: "#1a1a1a",
  diffAddedBg: "#1e3a2f",
  diffRemovedBg: "#3d2a2a",
  diffContextBg: "#1e1e2e",
  diffLineNumberBg: "#252535",
};

const LIGHT_COLORS: ThemeColors = {
  border: "#cbd5e0",
  borderActive: "#5a67d8",
  borderDim: "#e2e8f0",
  muted: "#a0aec0",
  primary: "#5a67d8",
  secondary: "#38a169",
  success: "#38a169",
  warning: "#dd6b20",
  error: "#e53e3e",
  info: "#3182ce",
  accent: "#805ad5",
  statusBarBg: "#e2e8f0",
  paneBg: "#f0f0f0",
  diffAddedBg: "#d4edda",
  diffRemovedBg: "#f8d7da",
  diffContextBg: "#f8f9fa",
  diffLineNumberBg: "#e9ecef",
};

let cachedTheme: Theme | null = null;

function parseColorIndex(value: string): number | null {
  const parsed = Number.parseInt(value, 10);
  return Number.isNaN(parsed) ? null : parsed;
}

function detectThemeModeFromColorFgBg(value: string | undefined): ThemeMode | null {
  if (!value) return null;
  const parts = value.split(";").filter(Boolean);
  if (parts.length === 0) return null;
  const bg = parseColorIndex(parts[parts.length - 1]);
  if (bg === null) return null;
  return bg >= 7 ? "light" : "dark";
}

function detectThemeMode(): ThemeMode {
  return detectThemeModeFromColorFgBg(process.env.COLORFGBG) ?? "dark";
}

export function getTheme(): Theme {
  if (!cachedTheme) {
    const mode = detectThemeMode();
    cachedTheme = {
      mode,
      colors: mode === "light" ? LIGHT_COLORS : DARK_COLORS,
    };
  }
  return cachedTheme;
}
