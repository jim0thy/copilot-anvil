import { SyntaxStyle, RGBA, type StyleDefinition } from "@opentui/core";
import type { ThemeMode, CatppuccinPalette } from "./theme.js";
import { catppuccin } from "./theme.js";

// Helper to create RGBA from hex string
const hex = (color: string) => {
  const r = Number.parseInt(color.slice(1, 3), 16);
  const g = Number.parseInt(color.slice(3, 5), 16);
  const b = Number.parseInt(color.slice(5, 7), 16);
  return RGBA.fromInts(r, g, b, 255);
};

/**
 * Generate tree-sitter highlight group styles from a Catppuccin palette.
 * The mapping follows the Catppuccin style guide:
 * https://catppuccin.com/palette
 */
function createSyntaxStyles(p: CatppuccinPalette): Record<string, StyleDefinition> {
  return {
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
}

let cachedDarkStyle: SyntaxStyle | null = null;
let cachedLightStyle: SyntaxStyle | null = null;

export function getSyntaxStyle(mode: ThemeMode): SyntaxStyle {
  if (mode === "dark") {
    if (!cachedDarkStyle) {
      cachedDarkStyle = SyntaxStyle.fromStyles(createSyntaxStyles(catppuccin.frappe));
    }
    return cachedDarkStyle;
  } else {
    if (!cachedLightStyle) {
      cachedLightStyle = SyntaxStyle.fromStyles(createSyntaxStyles(catppuccin.latte));
    }
    return cachedLightStyle;
  }
}
