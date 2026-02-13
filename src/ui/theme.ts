export type ThemeMode = "light" | "dark";
export type CatppuccinFlavor = "frappe" | "latte" | "macchiato" | "mocha";

// Catppuccin palette colors for each flavor
// https://catppuccin.com/palette
export interface CatppuccinPalette {
  rosewater: string;
  flamingo: string;
  pink: string;
  mauve: string;
  red: string;
  maroon: string;
  peach: string;
  yellow: string;
  green: string;
  teal: string;
  sky: string;
  sapphire: string;
  blue: string;
  lavender: string;
  text: string;
  subtext1: string;
  subtext0: string;
  overlay2: string;
  overlay1: string;
  overlay0: string;
  surface2: string;
  surface1: string;
  surface0: string;
  base: string;
  mantle: string;
  crust: string;
}

// Catppuccin Frappé palette
const FRAPPE: CatppuccinPalette = {
  rosewater: "#f2d5cf",
  flamingo: "#eebebe",
  pink: "#f4b8e4",
  mauve: "#ca9ee6",
  red: "#e78284",
  maroon: "#ea999c",
  peach: "#ef9f76",
  yellow: "#e5c890",
  green: "#a6d189",
  teal: "#81c8be",
  sky: "#99d1db",
  sapphire: "#85c1dc",
  blue: "#8caaee",
  lavender: "#babbf1",
  text: "#c6d0f5",
  subtext1: "#b5bfe2",
  subtext0: "#a5adce",
  overlay2: "#949cbb",
  overlay1: "#838ba7",
  overlay0: "#737994",
  surface2: "#626880",
  surface1: "#51576d",
  surface0: "#414559",
  base: "#303446",
  mantle: "#292c3c",
  crust: "#232634",
};

// Catppuccin Latte palette (light theme)
const LATTE: CatppuccinPalette = {
  rosewater: "#dc8a78",
  flamingo: "#dd7878",
  pink: "#ea76cb",
  mauve: "#8839ef",
  red: "#d20f39",
  maroon: "#e64553",
  peach: "#fe640b",
  yellow: "#df8e1d",
  green: "#40a02b",
  teal: "#179299",
  sky: "#04a5e5",
  sapphire: "#209fb5",
  blue: "#1e66f5",
  lavender: "#7287fd",
  text: "#4c4f69",
  subtext1: "#5c5f77",
  subtext0: "#6c6f85",
  overlay2: "#7c7f93",
  overlay1: "#8c8fa1",
  overlay0: "#9ca0b0",
  surface2: "#acb0be",
  surface1: "#bcc0cc",
  surface0: "#ccd0da",
  base: "#eff1f5",
  mantle: "#e6e9ef",
  crust: "#dce0e8",
};

// Semantic colors following Catppuccin style guide
// https://github.com/catppuccin/catppuccin/blob/main/docs/style-guide.md
export interface ThemeColors {
  // Raw palette access
  palette: CatppuccinPalette;

  // === Background Colors (per style guide) ===
  // Background Pane: Base
  base: string;
  // Secondary Panes: Mantle, Crust
  mantle: string;
  crust: string;
  // Surface Elements: Surface 0, 1, 2
  surface0: string;
  surface1: string;
  surface2: string;
  // Overlays: Overlay 0, 1, 2
  overlay0: string;
  overlay1: string;
  overlay2: string;

  // === Typography (per style guide) ===
  // Body Copy / Main Headline: Text
  text: string;
  // Sub-Headlines, Labels: Subtext 0, 1
  subtext0: string;
  subtext1: string;
  // Subtle text: Overlay 1
  subtle: string;
  // Links, URLs, Tags, Pills: Blue
  link: string;

  // === Semantic Colors (per style guide) ===
  success: string;  // Green
  warning: string;  // Yellow
  error: string;    // Red

  // === Terminal/UI Elements (per style guide) ===
  // Cursor: Rosewater
  cursor: string;
  // Cursor Text: Crust (dark) / Base (light)
  cursorText: string;
  // Active Border: Lavender
  borderActive: string;
  // Inactive Border: Overlay 0
  border: string;

  // === Additional semantic mappings ===
  // Primary accent for interactive elements
  primary: string;    // Lavender (matches active border)
  // Secondary accent
  secondary: string;  // Teal
  // Accent color (for highlights, emphasis)
  accent: string;     // Mauve
  // Info color
  info: string;       // Blue

  // === Derived/Utility colors ===
  // Muted text (same as subtle)
  muted: string;
  // Dim border
  borderDim: string;
  // Status bar background
  statusBarBg: string;
  // Pane background
  paneBg: string;

  // === Diff colors ===
  diffAddedBg: string;
  diffRemovedBg: string;
  diffContextBg: string;
  diffLineNumberBg: string;
}

export interface Theme {
  mode: ThemeMode;
  flavor: CatppuccinFlavor;
  colors: ThemeColors;
}

function createColorsFromPalette(palette: CatppuccinPalette, isDark: boolean): ThemeColors {
  return {
    palette,

    // === Background Colors ===
    base: palette.base,
    mantle: palette.mantle,
    crust: palette.crust,
    surface0: palette.surface0,
    surface1: palette.surface1,
    surface2: palette.surface2,
    overlay0: palette.overlay0,
    overlay1: palette.overlay1,
    overlay2: palette.overlay2,

    // === Typography ===
    text: palette.text,
    subtext0: palette.subtext0,
    subtext1: palette.subtext1,
    subtle: palette.overlay1,  // Per style guide: "Subtle" uses Overlay 1
    link: palette.blue,        // Per style guide: Links/URLs use Blue

    // === Semantic Colors ===
    success: palette.green,
    warning: palette.yellow,
    error: palette.red,

    // === Terminal/UI Elements ===
    cursor: palette.rosewater,
    cursorText: isDark ? palette.crust : palette.base,
    borderActive: palette.lavender,
    border: palette.overlay0,  // Per style guide: Inactive border uses Overlay 0

    // === Additional semantic mappings ===
    primary: palette.lavender,
    secondary: palette.teal,
    accent: palette.mauve,
    info: palette.blue,

    // === Derived/Utility colors ===
    muted: palette.overlay1,
    borderDim: palette.surface0,
    statusBarBg: palette.mantle,
    paneBg: palette.base,

    // === Diff colors ===
    diffAddedBg: isDark ? "#2a3f35" : "#d4edda",
    diffRemovedBg: isDark ? "#3d2a2f" : "#f8d7da",
    diffContextBg: palette.base,
    diffLineNumberBg: palette.surface0,
  };
}

const DARK_COLORS: ThemeColors = createColorsFromPalette(FRAPPE, true);
const LIGHT_COLORS: ThemeColors = createColorsFromPalette(LATTE, false);

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
    const flavor: CatppuccinFlavor = mode === "light" ? "latte" : "frappe";
    cachedTheme = {
      mode,
      flavor,
      colors: mode === "light" ? LIGHT_COLORS : DARK_COLORS,
    };
  }
  return cachedTheme;
}

// Export palettes for direct access if needed
export const catppuccin = {
  frappe: FRAPPE,
  latte: LATTE,
};
