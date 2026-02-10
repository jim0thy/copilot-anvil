export type ThemeMode = "light" | "dark";

export interface ThemeColors {
  border: string;
  muted: string;
}

export interface Theme {
  mode: ThemeMode;
  colors: ThemeColors;
}

const DARK_COLORS: ThemeColors = {
  border: "gray",
  muted: "gray",
};

const LIGHT_COLORS: ThemeColors = {
  border: "black",
  muted: "blackBright",
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
