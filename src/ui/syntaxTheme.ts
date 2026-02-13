import { SyntaxStyle, RGBA, type StyleDefinition } from "@opentui/core";
import type { ThemeMode } from "./theme.js";

// Helper to create RGBA from ints
const rgb = (r: number, g: number, b: number) => RGBA.fromInts(r, g, b, 255);

// Tree-sitter highlight group styles for syntax highlighting
// These map to tree-sitter capture groups like @keyword, @string, @comment, etc.

const darkStyles: Record<string, StyleDefinition> = {
  // Base
  default: { fg: rgb(212, 212, 212) }, // Light gray

  // Comments
  comment: { fg: rgb(106, 153, 85), italic: true }, // Green italic

  // Keywords
  keyword: { fg: rgb(197, 134, 192) }, // Purple/magenta
  "keyword.function": { fg: rgb(197, 134, 192) },
  "keyword.return": { fg: rgb(197, 134, 192) },
  "keyword.operator": { fg: rgb(197, 134, 192) },
  "keyword.import": { fg: rgb(197, 134, 192) },
  "keyword.export": { fg: rgb(197, 134, 192) },

  // Types
  type: { fg: rgb(78, 201, 176) }, // Teal
  "type.builtin": { fg: rgb(78, 201, 176) },

  // Functions
  function: { fg: rgb(220, 220, 170) }, // Yellow
  "function.call": { fg: rgb(220, 220, 170) },
  "function.method": { fg: rgb(220, 220, 170) },
  "function.builtin": { fg: rgb(220, 220, 170) },
  method: { fg: rgb(220, 220, 170) },

  // Variables
  variable: { fg: rgb(156, 220, 254) }, // Light blue
  "variable.parameter": { fg: rgb(156, 220, 254) },
  "variable.builtin": { fg: rgb(86, 156, 214) },
  parameter: { fg: rgb(156, 220, 254) },
  property: { fg: rgb(156, 220, 254) },

  // Strings
  string: { fg: rgb(206, 145, 120) }, // Orange/brown
  "string.special": { fg: rgb(206, 145, 120) },
  "string.escape": { fg: rgb(215, 186, 125) }, // Golden

  // Numbers
  number: { fg: rgb(181, 206, 168) }, // Light green
  float: { fg: rgb(181, 206, 168) },

  // Constants
  constant: { fg: rgb(79, 193, 255) }, // Bright blue
  "constant.builtin": { fg: rgb(86, 156, 214) },
  boolean: { fg: rgb(86, 156, 214) },

  // Operators
  operator: { fg: rgb(212, 212, 212) },
  punctuation: { fg: rgb(212, 212, 212) },
  "punctuation.bracket": { fg: rgb(212, 212, 212) },
  "punctuation.delimiter": { fg: rgb(212, 212, 212) },

  // Tags (HTML/JSX)
  tag: { fg: rgb(86, 156, 214) }, // Blue
  "tag.attribute": { fg: rgb(156, 220, 254) },

  // Attributes
  attribute: { fg: rgb(156, 220, 254) },

  // Labels
  label: { fg: rgb(156, 220, 254) },

  // Namespaces
  namespace: { fg: rgb(78, 201, 176) },
  module: { fg: rgb(78, 201, 176) },

  // Constructor
  constructor: { fg: rgb(78, 201, 176) },

  // Markup (markdown)
  "markup.heading": { fg: rgb(86, 156, 214), bold: true },
  "markup.bold": { bold: true },
  "markup.italic": { italic: true },
  "markup.link": { fg: rgb(86, 156, 214), underline: true },
  "markup.raw": { fg: rgb(206, 145, 120) },
};

const lightStyles: Record<string, StyleDefinition> = {
  // Base
  default: { fg: rgb(0, 0, 0) }, // Black

  // Comments
  comment: { fg: rgb(0, 128, 0), italic: true }, // Green italic

  // Keywords
  keyword: { fg: rgb(0, 0, 255) }, // Blue
  "keyword.function": { fg: rgb(0, 0, 255) },
  "keyword.return": { fg: rgb(0, 0, 255) },
  "keyword.operator": { fg: rgb(0, 0, 255) },
  "keyword.import": { fg: rgb(0, 0, 255) },
  "keyword.export": { fg: rgb(0, 0, 255) },

  // Types
  type: { fg: rgb(38, 127, 153) }, // Teal
  "type.builtin": { fg: rgb(38, 127, 153) },

  // Functions
  function: { fg: rgb(121, 94, 38) }, // Brown
  "function.call": { fg: rgb(121, 94, 38) },
  "function.method": { fg: rgb(121, 94, 38) },
  "function.builtin": { fg: rgb(121, 94, 38) },
  method: { fg: rgb(121, 94, 38) },

  // Variables
  variable: { fg: rgb(0, 16, 128) }, // Dark blue
  "variable.parameter": { fg: rgb(0, 16, 128) },
  "variable.builtin": { fg: rgb(0, 0, 255) },
  parameter: { fg: rgb(0, 16, 128) },
  property: { fg: rgb(0, 16, 128) },

  // Strings
  string: { fg: rgb(163, 21, 21) }, // Red
  "string.special": { fg: rgb(163, 21, 21) },
  "string.escape": { fg: rgb(0, 0, 255) },

  // Numbers
  number: { fg: rgb(9, 136, 90) }, // Green
  float: { fg: rgb(9, 136, 90) },

  // Constants
  constant: { fg: rgb(0, 0, 255) },
  "constant.builtin": { fg: rgb(0, 0, 255) },
  boolean: { fg: rgb(0, 0, 255) },

  // Operators
  operator: { fg: rgb(0, 0, 0) },
  punctuation: { fg: rgb(0, 0, 0) },
  "punctuation.bracket": { fg: rgb(0, 0, 0) },
  "punctuation.delimiter": { fg: rgb(0, 0, 0) },

  // Tags (HTML/JSX)
  tag: { fg: rgb(128, 0, 0) }, // Maroon
  "tag.attribute": { fg: rgb(255, 0, 0) },

  // Attributes
  attribute: { fg: rgb(255, 0, 0) },

  // Labels
  label: { fg: rgb(0, 16, 128) },

  // Namespaces
  namespace: { fg: rgb(38, 127, 153) },
  module: { fg: rgb(38, 127, 153) },

  // Constructor
  constructor: { fg: rgb(38, 127, 153) },

  // Markup (markdown)
  "markup.heading": { fg: rgb(0, 0, 255), bold: true },
  "markup.bold": { bold: true },
  "markup.italic": { italic: true },
  "markup.link": { fg: rgb(0, 0, 255), underline: true },
  "markup.raw": { fg: rgb(163, 21, 21) },
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
