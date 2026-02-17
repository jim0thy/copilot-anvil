/**
 * Nerd Font icon constants.
 *
 * All codepoints live in the Font Awesome BMP range (U+F000-U+F2E0)
 * and render correctly in any Nerd Font patched terminal font.
 */
export const nf = {
  // ── Status indicators ──────────────────────────────
  check:        "\uF00C", //  nf-fa-check
  times:        "\uF00D", //  nf-fa-times
  warning:      "\uF071", //  nf-fa-exclamation_triangle
  question:     "\uF128", //  nf-fa-question
  refresh:      "\uF021", //  nf-fa-refresh

  // ── Concept icons ──────────────────────────────────
  target:       "\uF05B", //  nf-fa-crosshairs
  bolt:         "\uF0E7", //  nf-fa-bolt
  clipboard:    "\uF0EA", //  nf-fa-clipboard
  wrench:       "\uF0AD", //  nf-fa-wrench
  trophy:       "\uF091", //  nf-fa-trophy
  code:         "\uF121", //  nf-fa-code
  magic:        "\uF0D0", //  nf-fa-magic
  folder:       "\uF07B", //  nf-fa-folder
  image:        "\uF03E", //  nf-fa-image
  cog:          "\uF013", //  nf-fa-cog
  search:       "\uF002", //  nf-fa-search
  rocket:       "\uF135", //  nf-fa-rocket
  pencil:       "\uF040", //  nf-fa-pencil
  send:         "\uF1D8", //  nf-fa-paper_plane

  // ── Git file status ────────────────────────────────
  circle:       "\uF111", //  nf-fa-circle
  plus:         "\uF067", //  nf-fa-plus
  minus:        "\uF068", //  nf-fa-minus
  arrowRight:   "\uF061", //  nf-fa-arrow_right

  // ── Navigation ─────────────────────────────────────
  chevronRight: "\uF054", //  nf-fa-chevron_right
  angleRight:   "\uF105", //  nf-fa-angle_right
  caretRight:   "\uF0DA", //  nf-fa-caret_right

  // ── Decorative ─────────────────────────────────────
  diamond:      "\uF219", //  nf-fa-diamond
  ellipsis:     "\uF141", //  nf-fa-ellipsis_h
} as const;
