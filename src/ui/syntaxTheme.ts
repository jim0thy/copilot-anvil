import { SyntaxStyle, RGBA, type StyleDefinition } from "@opentui/core";
import type { ThemeMode } from "./theme.js";
import { catppuccin } from "./theme.js";

// Helper to create RGBA from hex string
const hex = (color: string) => {
  const r = Number.parseInt(color.slice(1, 3), 16);
  const g = Number.parseInt(color.slice(3, 5), 16);
  const b = Number.parseInt(color.slice(5, 7), 16);
  return RGBA.fromInts(r, g, b, 255);
};

// Tree-sitter highlight group styles for syntax highlighting
// Using Catppuccin Frappé palette for dark mode
// https://catppuccin.com/palette

const p = catppuccin.frappe;
const darkStyles: Record<string, StyleDefinition> = {
  // Base - use text color
  default: { fg: hex(p.text) },

  // Comments - overlay colors with italic
  comment: { fg: hex(p.overlay1), italic: true },

  // Keywords - mauve (purple)
  keyword: { fg: hex(p.mauve) },
  "keyword.function": { fg: hex(p.mauve) },
  "keyword.return": { fg: hex(p.mauve) },
  "keyword.operator": { fg: hex(p.mauve) },
  "keyword.import": { fg: hex(p.mauve) },
  "keyword.export": { fg: hex(p.mauve) },

  // Types - yellow
  type: { fg: hex(p.yellow) },
  "type.builtin": { fg: hex(p.yellow) },

  // Functions - blue
  function: { fg: hex(p.blue) },
  "function.call": { fg: hex(p.blue) },
  "function.method": { fg: hex(p.blue) },
  "function.builtin": { fg: hex(p.blue) },
  method: { fg: hex(p.blue) },

  // Variables - text, parameters in maroon
  variable: { fg: hex(p.text) },
  "variable.parameter": { fg: hex(p.maroon) },
  "variable.builtin": { fg: hex(p.red) },
  parameter: { fg: hex(p.maroon) },
  property: { fg: hex(p.lavender) },

  // Strings - green
  string: { fg: hex(p.green) },
  "string.special": { fg: hex(p.green) },
  "string.escape": { fg: hex(p.pink) },

  // Numbers - peach
  number: { fg: hex(p.peach) },
  float: { fg: hex(p.peach) },

  // Constants - peach
  constant: { fg: hex(p.peach) },
  "constant.builtin": { fg: hex(p.peach) },
  boolean: { fg: hex(p.peach) },

  // Operators - sky
  operator: { fg: hex(p.sky) },
  punctuation: { fg: hex(p.overlay2) },
  "punctuation.bracket": { fg: hex(p.overlay2) },
  "punctuation.delimiter": { fg: hex(p.overlay2) },

  // Tags (HTML/JSX) - blue
  tag: { fg: hex(p.blue) },
  "tag.attribute": { fg: hex(p.yellow) },

  // Attributes - yellow
  attribute: { fg: hex(p.yellow) },

  // Labels - sapphire
  label: { fg: hex(p.sapphire) },

  // Namespaces - teal
  namespace: { fg: hex(p.teal) },
  module: { fg: hex(p.teal) },

  // Constructor - sapphire
  constructor: { fg: hex(p.sapphire) },

  // Markup (markdown)
  "markup.heading": { fg: hex(p.blue), bold: true },
  "markup.bold": { bold: true },
  "markup.italic": { italic: true },
  "markup.link": { fg: hex(p.blue), underline: true },
  "markup.raw": { fg: hex(p.green) },
};

// Using Catppuccin Latte palette for light mode
const pl = catppuccin.latte;
const lightStyles: Record<string, StyleDefinition> = {
  // Base - use text color
  default: { fg: hex(pl.text) },

  // Comments - overlay colors with italic
  comment: { fg: hex(pl.overlay1), italic: true },

  // Keywords - mauve (purple)
  keyword: { fg: hex(pl.mauve) },
  "keyword.function": { fg: hex(pl.mauve) },
  "keyword.return": { fg: hex(pl.mauve) },
  "keyword.operator": { fg: hex(pl.mauve) },
  "keyword.import": { fg: hex(pl.mauve) },
  "keyword.export": { fg: hex(pl.mauve) },

  // Types - yellow
  type: { fg: hex(pl.yellow) },
  "type.builtin": { fg: hex(pl.yellow) },

  // Functions - blue
  function: { fg: hex(pl.blue) },
  "function.call": { fg: hex(pl.blue) },
  "function.method": { fg: hex(pl.blue) },
  "function.builtin": { fg: hex(pl.blue) },
  method: { fg: hex(pl.blue) },

  // Variables - text, parameters in maroon
  variable: { fg: hex(pl.text) },
  "variable.parameter": { fg: hex(pl.maroon) },
  "variable.builtin": { fg: hex(pl.red) },
  parameter: { fg: hex(pl.maroon) },
  property: { fg: hex(pl.lavender) },

  // Strings - green
  string: { fg: hex(pl.green) },
  "string.special": { fg: hex(pl.green) },
  "string.escape": { fg: hex(pl.pink) },

  // Numbers - peach
  number: { fg: hex(pl.peach) },
  float: { fg: hex(pl.peach) },

  // Constants - peach
  constant: { fg: hex(pl.peach) },
  "constant.builtin": { fg: hex(pl.peach) },
  boolean: { fg: hex(pl.peach) },

  // Operators - sky
  operator: { fg: hex(pl.sky) },
  punctuation: { fg: hex(pl.overlay2) },
  "punctuation.bracket": { fg: hex(pl.overlay2) },
  "punctuation.delimiter": { fg: hex(pl.overlay2) },

  // Tags (HTML/JSX) - blue
  tag: { fg: hex(pl.blue) },
  "tag.attribute": { fg: hex(pl.yellow) },

  // Attributes - yellow
  attribute: { fg: hex(pl.yellow) },

  // Labels - sapphire
  label: { fg: hex(pl.sapphire) },

  // Namespaces - teal
  namespace: { fg: hex(pl.teal) },
  module: { fg: hex(pl.teal) },

  // Constructor - sapphire
  constructor: { fg: hex(pl.sapphire) },

  // Markup (markdown)
  "markup.heading": { fg: hex(pl.blue), bold: true },
  "markup.bold": { bold: true },
  "markup.italic": { italic: true },
  "markup.link": { fg: hex(pl.blue), underline: true },
  "markup.raw": { fg: hex(pl.green) },
};

let cachedDarkStyle: SyntaxStyle | null = null;
let cachedLightStyle: SyntaxStyle | null = null;

export function getSyntaxStyle(mode: ThemeMode): SyntaxStyle {
  if (mode === "dark") {
    if (!cachedDarkStyle) {
      cachedDarkStyle = SyntaxStyle.fromStyles(darkStyles);
    }
    return cachedDarkStyle;
  } else {
    if (!cachedLightStyle) {
      cachedLightStyle = SyntaxStyle.fromStyles(lightStyles);
    }
    return cachedLightStyle;
  }
}
