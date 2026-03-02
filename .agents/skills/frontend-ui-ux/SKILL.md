# Frontend UI/UX Skill

Design and implementation principles for user interfaces. Use this skill when making layout decisions, styling components, improving accessibility, or evaluating UI/UX quality.

## Core Principles

### 1. User Goals First
Every UI decision starts with what the user is trying to accomplish. Ask:
- What is the user's primary goal on this screen?
- What's the most common path through this flow?
- What happens when something goes wrong?

### 2. Progressive Disclosure
Show only what's needed for the current step. Reveal complexity as users need it.
- Primary actions: always visible and prominent
- Secondary actions: visible but subdued
- Tertiary/advanced options: hidden behind "More" or settings

### 3. Feedback for Every Action
Users must always know what happened:
- **Immediate feedback** (< 100ms): button press, toggle state
- **Short process** (100ms–1s): spinner or skeleton
- **Long process** (> 1s): progress indicator with cancel option
- **Completion**: success state, then return to normal
- **Error**: clear message + recovery action

## Layout Patterns

### Spacing Scale (use consistently, don't invent values)
```
4px   → gap-1  (tight: icon gap, badge padding)
8px   → gap-2  (small: form field internal padding)
12px  → gap-3  (medium-small: between related items)
16px  → gap-4  (medium: standard component spacing)
24px  → gap-6  (large: section separation)
32px  → gap-8  (xlarge: page section breaks)
48px  → gap-12 (2xlarge: major page divisions)
```

### Responsive Breakpoints
```
sm:  640px   (large phones, landscape)
md:  768px   (tablets, portrait)
lg:  1024px  (tablets landscape, small laptops)
xl:  1280px  (desktop)
2xl: 1536px  (large desktop)
```

**Mobile-first**: Write base styles for mobile, then override for larger screens.

```css
/* ✅ Mobile-first */
.container {
  padding: 16px;          /* mobile */
}
@media (min-width: 768px) {
  .container {
    padding: 32px;        /* tablet+ */
  }
}

/* ❌ Desktop-first — harder to override for mobile */
.container {
  padding: 32px;
}
@media (max-width: 767px) {
  .container {
    padding: 16px;
  }
}
```

## Typography

### Hierarchy (5 levels max on any screen)
```
Display:  48-64px, weight 700-800 (hero headlines only)
H1:       32-40px, weight 700     (page title)
H2:       24-28px, weight 600     (section heading)
H3:       18-20px, weight 600     (subsection)
Body:     16px,    weight 400     (primary content)
Small:    14px,    weight 400     (captions, metadata)
Tiny:     12px,    weight 400     (labels, badges — sparingly)
```

**Line height**: 1.5 for body text, 1.2-1.3 for headings.
**Max line width**: 60-80 characters (640-720px at 16px). Wider lines reduce readability.

## Color and Contrast

### Minimum Contrast Ratios (WCAG AA)
- Normal text (< 18px): 4.5:1 minimum
- Large text (≥ 18px bold or ≥ 24px): 3:1 minimum
- UI components and focus indicators: 3:1 minimum

### Color Roles
```
Primary:     Main actions, links, selected states
Success:     Confirmations, valid states (green tones)
Warning:     Caution, pending, degraded (amber tones)
Error:       Failures, invalid states (red tones)
Neutral:     Text, borders, backgrounds (gray scale)
```

**Never use color alone** to convey information — also use shape, text, or pattern.

## Interactive States (every interactive element needs all of these)

```
Default  → Hover     → Active/Pressed → Focus → Disabled
```

```css
button {
  background: var(--primary);          /* default */
  cursor: pointer;
}
button:hover {
  background: var(--primary-hover);    /* hover: lighten or darken 10% */
}
button:active {
  background: var(--primary-active);   /* pressed: darken more */
  transform: scale(0.98);
}
button:focus-visible {
  outline: 2px solid var(--focus-ring);
  outline-offset: 2px;                 /* focus: keyboard navigation */
}
button:disabled {
  opacity: 0.4;
  cursor: not-allowed;                 /* disabled: clear visual + cursor */
}
```

## Accessibility Checklist

### Keyboard Navigation
- [ ] All interactive elements reachable via Tab
- [ ] Logical tab order (matches visual reading order)
- [ ] Focus visible on all focused elements (never `outline: none` without replacement)
- [ ] Modals trap focus within (focus not escapable to background)
- [ ] Escape key closes modals and dropdowns

### ARIA
- [ ] Buttons use `<button>`, links use `<a href>` — not `<div onClick>`
- [ ] Images have meaningful `alt` attributes (or `alt=""` for decorative)
- [ ] Form inputs have associated `<label>` (not just placeholder)
- [ ] Error messages linked to inputs via `aria-describedby`
- [ ] Loading states announced via `aria-live="polite"`
- [ ] Expanded/collapsed states via `aria-expanded`

### Screen Reader
- [ ] Page has one `<h1>` per page
- [ ] Headings form a logical hierarchy (no skipping h2 → h4)
- [ ] Icon-only buttons have accessible name (`aria-label`)
- [ ] Tables have `<th>` with scope attributes

## Form Design

### Input States
```
Empty:   Placeholder text, normal border
Focus:   Highlighted border (primary color), no placeholder
Filled:  Normal border, user content visible
Valid:   Subtle success indicator (icon, green border) — only after interaction
Error:   Red border, error message below input, icon inside input
Disabled: Reduced opacity, not-allowed cursor, clear visual difference
```

### Error Messages
- Place error messages immediately below the field they describe.
- Use specific language: "Email must include @" not "Invalid email".
- Announce errors to screen readers via `aria-live` or `aria-describedby`.
- Show errors after user leaves the field (blur), not while typing.

### Button Labels
- Describe the action, not the UI: "Save changes" not "Submit"
- Include object when needed: "Delete account" not "Delete"
- Avoid: "Click here", "OK", "Yes/No" without context

## Loading and Empty States

### Loading States
```
< 200ms:   No indicator needed (feels instant)
200ms-1s:  Subtle spinner or shimmer skeleton
> 1s:      Progress bar or percentage if measurable
> 4s:      Explain what's happening + cancel option
```

### Empty States (when a list/table has no data)
1. Illustration or icon (optional, keeps it friendly)
2. Clear headline: "No projects yet"
3. Explanation: "Create a project to get started"
4. Call-to-action: "Create project" button

**Never**: blank white space with no explanation.

## Anti-Patterns

- **Modal overuse**: Prefer inline editing or dedicated pages for complex flows.
- **Confirmation dialogs for everything**: Reserve for irreversible destructive actions only.
- **Infinite scroll without position restore**: Users lose their place on back-navigation.
- **Custom scroll bars**: Almost always worse than browser defaults.
- **Hover-only interactions**: Mobile users cannot hover.
- **Auto-playing media**: Always user-initiated.
- **Jargon in UI text**: Write for the user's vocabulary, not the developer's.
- **Disabled buttons with no explanation**: Show why it's disabled or what to do to enable it.
