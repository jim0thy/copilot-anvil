# Copilot SDK TUI Harness

## Project Overview

A terminal UI (TUI) for interacting with GitHub Copilot, built with TypeScript, OpenTUI, and the `@github/copilot-sdk`. See [`docs/REQUIREMENTS.md`](./docs/REQUIREMENTS.md) for full specifications.

---

## Quick Start

```bash
# Prerequisites: Bun 1.0+, GitHub Copilot CLI authenticated
bun install
bun run dev  # or: bun run start
```

---

## For AI Agents / Copilots

This section helps AI coding assistants understand and work with this codebase effectively.

### Architecture Summary

```
┌─────────────────────────────────────────────────────────────┐
│                        UI Layer (OpenTUI/React)             │
│  src/ui/App.tsx, panes/ChatPane.tsx, LogsPane.tsx, etc.     │
└──────────────────────────┬──────────────────────────────────┘
                           │ HarnessEvent / UIAction
┌──────────────────────────▼──────────────────────────────────┐
│                     Harness (Orchestrator)                  │
│  src/harness/Harness.ts - state, events, plugins            │
└──────────────────────────┬──────────────────────────────────┘
                           │ Internal callbacks
┌──────────────────────────▼──────────────────────────────────┐
│                  Copilot Session Adapter                    │
│  src/copilot/CopilotSessionAdapter.ts - SDK wrapper         │
└──────────────────────────┬──────────────────────────────────┘
                           │
                    @github/copilot-sdk
```

### Key Principle: UI ↔ SDK Decoupling

**The UI never imports `@github/copilot-sdk` directly.** All SDK interaction flows through:

1. `CopilotSessionAdapter` — translates SDK events to `HarnessEvent`s
2. `Harness` — manages state, emits events, handles `UIAction`s
3. UI — subscribes to events, dispatches actions

### Directory Map

| Path | Purpose |
|------|---------|
| `src/index.tsx` | Entry point |
| `src/copilot/` | SDK adapter (only place that imports `@github/copilot-sdk`) |
| `src/harness/` | Event bus, state management, plugin system |
| `src/harness/events.ts` | `HarnessEvent` and `UIAction` type definitions |
| `src/harness/plugins.ts` | Plugin interface and registries |
| `src/cli/` | CLI entry point, orchestration agents, tools, hooks |
| `src/agents/` | Agent orchestration system |
| `src/agents/types.ts` | AgentDefinition types |
| `src/agents/loader.ts` | Agent discovery and loading |
| `src/agents/builtin.ts` | Built-in agent definitions (13 agents) |
| `src/agents/OrchestrationPlugin.ts` | Orchestration mode plugin |
| `src/ui/` | OpenTUI/React components |
| `src/ui/panes/` | All UI panes (Chat, Sidebar, Input, etc.) |
| `src/commands/` | Slash command system |
| `src/utils/` | Utilities (git, diff, etc.) |
| `docs/REQUIREMENTS.md` | Full requirements document |

### Event Flow

```
User types prompt → InputBar dispatches UIAction("submit.prompt")
                              ↓
                    Harness.dispatch()
                              ↓
                    CopilotSessionAdapter.sendPrompt()
                              ↓
                    SDK streams response
                              ↓
                    Adapter emits HarnessEvent("assistant.delta")
                              ↓
                    Harness updates state, notifies UI
                              ↓
                    ChatPane re-renders with streaming text
```

### Event Types

**Core events** (see `src/harness/events.ts`):

| Event | When |
|-------|------|
| `run.started` | Prompt submitted, SDK processing begins |
| `assistant.delta` | Streaming token received |
| `assistant.message` | Full response complete |
| `reasoning.delta` | Reasoning token received (for o1 models) |
| `reasoning.message` | Complete reasoning content |
| `run.finished` | Run completed successfully |
| `run.cancelled` | User cancelled with Ctrl+C |
| `tool.started` | Tool execution begins |
| `tool.progress` | Tool progress update |
| `tool.completed` | Tool execution completes |
| `subagent.started` | Subagent invoked |
| `subagent.completed` | Subagent finished |
| `subagent.failed` | Subagent failed |
| `skill.invoked` | Skill invoked |
| `intent.updated` | Agent intent updated |
| `todo.updated` | Task list updated |
| `plan.updated` | Plan content updated |
| `turn.started` | New turn begins |
| `turn.ended` | Turn completes |
| `question.requested` | Agent asks user a question |
| `question.answered` | User answers question |
| `session.switched` | Session changed |
| `session.created` | New session created |
| `session.list.updated` | Session list refreshed |
| `orchestration.mode.changed` | Orchestration mode toggled |
| `model.changed` | AI model changed |
| `usage.info` | Token usage information |
| `quota.info` | Quota information |
| `log` | Internal logging (info/warn/error/debug) |

**Actions** (UI → Harness):

| Action | Effect |
|--------|--------|
| `submit.prompt` | Send prompt to Copilot (with optional images) |
| `cancel` | Abort current run |
| `change.model` | Switch AI model |
| `answer.question` | Respond to agent question |
| `session.new` | Create new session |
| `session.switch` | Switch to different session |
| `session.refresh` | Refresh session list |
| `ephemeral.close` | Close ephemeral run modal |
| `orchestration.toggle` | Toggle or set orchestration mode |

### Agent Orchestration System

The TUI includes a multi-agent orchestration system based on the [vscode-agents](https://github.com/simkeyur/vscode-agents) model.

#### Modes

- **Direct Mode** (default): Prompts go directly to Copilot
- **Team Mode**: Prompts route through Engineering Manager → Specialist agents

#### Keyboard Shortcuts

| Key | Action |
|-----|--------|
| `Tab` | Cycle through top-level agents (shown in status bar) |
| `Shift+Tab` | Open model selector |
| `/team` | Enable orchestrated mode |
| `/direct` | Enable direct mode |
| `/agents` | List available agents |

#### Built-in Agents

**Builtin agents** (loaded from `src/agents/builtin.ts`):

| Agent | Tier | Domain | Description |
|-------|------|--------|-------------|
| Engineering Manager | specialist | orchestration | Orchestrates the team — delegates to specialists, ensures quality |
| Junior Developer | junior | general | Quick fixes, simple tasks |
| Frontend Developer | mid | frontend | UI components, client-side logic |
| Backend Developer | mid | backend | APIs, databases, server logic |
| Fullstack Developer | mid | fullstack | End-to-end features |
| Senior Frontend Developer | senior | frontend | Complex UI architecture |
| Senior Backend Developer | senior | backend | Distributed systems |
| Senior Fullstack Developer | senior | fullstack | Complex integrations |
| Data Engineer | specialist | data | SQL, ETL, analytics |
| Designer | specialist | design | UI/UX, styling |
| Prompt Writer | specialist | prompt | LLM prompt optimization |
| DevOps | specialist | devops | Git, dependencies, deployment |
| Reviewer | specialist | review | Code review, security checks |

**Orchestration agents** (loaded from `src/cli/agents.ts`, registered as SDK `customAgents`):

| Agent | Role | Description |
|-------|------|-------------|
| Engineering Manager | Coordinator | Decomposes tasks, delegates to specialists, ensures quality |
| Staff Engineer | Deep worker | Thorough autonomous execution across many files |
| Architect | Analyst | Root-cause analysis, architecture review, debugging |
| Navigator | Knowledge | Codebase exploration, pattern identification |
| Scout | Fast search | Quick read-only codebase searches |
| Strategist | Planner | Creates phased implementation plans |
| Advisor | Critic | Validates plans before execution |

#### Agent Loading Priority

1. **Project agents** (`.agents/*.agent.md`) - highest priority
2. **Global agents** (`~/.config/anvil/agents/`) - override built-ins
3. **Built-in agents** - default definitions

#### Custom Agent Format

```markdown
---
name: My Custom Agent
description: What this agent does
model: claude-sonnet-4.6
tools: ['edit', 'search']
tier: mid
domain: fullstack
escalatesTo: Senior Fullstack Developer
---

System prompt content here...
```

### Plugin System

Plugins can extend functionality without modifying core code:

```typescript
import { HarnessPlugin } from "./harness/plugins.js";

const myPlugin: HarnessPlugin = {
  name: "my-plugin",
  register(ctx) {
    // Register tools the assistant can call
    ctx.tools.register("myTool", async (args) => {
      return "tool result";
    });
    
    // Register commands
    ctx.commands.register("myCommand", (args) => {
      console.log("command executed");
    });
  },
  onEvent(event) {
    // React to events
    if (event.type === "run.started") {
      console.log("Run started:", event.runId);
    }
  },
};

harness.use(myPlugin);
```

### Common Tasks

#### Adding a new pane

1. Create component in `src/ui/panes/NewPane.tsx`
2. Add to layout in `src/ui/App.tsx`
3. Subscribe to relevant harness events
4. Dispatch actions as needed
5. (Future) Register via `ctx.panes.register()` for plugin support

**Existing panes**:
- `ChatPane.tsx` — Conversation transcript
- `InputBar.tsx` — Prompt input with image attachment
- `Sidebar.tsx` — Container for sidebar panes
- `TasksPane.tsx` — Active tasks display
- `ContextPane.tsx` — Current context info
- `SubagentsPane.tsx` — Subagent execution tracking
- `FilesModifiedPane.tsx` — Git modified files
- `PlanPane.tsx` — Plan viewer
- `LogsPane.tsx` — System logs (unused in default layout)
- `StartScreen.tsx` — Welcome screen
- `ModelSelector.tsx` — Model selection modal
- `SessionSwitcher.tsx` — Session management modal
- `SkillsPane.tsx` — Skills browser
- `QuestionModal.tsx` — Interactive questions
- `ConfirmModal.tsx` — Confirmation dialogs
- `CommandModal.tsx` — Ephemeral command display
- `DebugOverlay.tsx` — Debug information

#### Adding a new tool

1. Create a plugin (or extend existing)
2. Use `ctx.tools.register("toolName", handler)`
3. Tool becomes available to the assistant

#### Adding a new event type

1. Extend `HarnessEvent` union in `src/harness/events.ts`
2. Emit from adapter or harness
3. Handle in UI or plugins

#### Modifying SDK behavior

Only touch `src/copilot/CopilotSessionAdapter.ts`. Never import SDK elsewhere.

---

## Development Conventions

### TypeScript

- Strict mode enabled
- ESM imports (`import/export`)
- No `any` types without explicit justification
- Prefer interfaces over type shapes for object types

### React/OpenTUI

- Functional components with hooks
- Keep components small and focused
- State lives in Harness, UI is a projection
- Use OpenTUI primitives (Box, Text, etc.) for layout

---

## Scripts

| Script | Purpose |
|--------|---------|
| `bun run dev` | Start TUI in development mode |
| `bun run start` | Same as dev (alias) |
| `bun install` | Install dependencies |

---

# Nerd Fonts & Icon Usage (TUI Projects)

## Policy

This project supports **Nerd Fonts** for enhanced iconography in terminal UIs.

Icons must:
- Be optional
- Gracefully degrade when Nerd Fonts are unavailable
- Never break layout, alignment, or usability

Icons are an enhancement — not a dependency.

---

## User Requirements

Users must install and configure a Nerd Font in their terminal.

Recommended fonts:
- JetBrainsMono Nerd Font
- FiraCode Nerd Font
- Hack Nerd Font

If icons render as empty squares (□), the user likely needs to:

1. Install a Nerd Font
2. Set their terminal font to that Nerd Font

The application must not attempt to install or enforce fonts.

---

## Configuration

All TUIs must support:

```
icons: auto | on | off
```

Default: `auto`

Behavior:

- `off` → never render icons
- `on` → always render icons
- `auto` →
    - Disable if output is not a TTY
    - Disable if `TERM=dumb`
    - Otherwise enable

---

## Implementation Rules

### 1. Centralized Icon Registry

Icons must be defined in one place.
Never inline Nerd Font glyphs throughout the codebase.

Example (TypeScript):

```ts
export const Icons = {
  git: "",
  folder: "",
  branch: "",
} as const
```

Provide a fallback set:

```ts
export const AsciiIcons = {
  git: "git",
  folder: "[dir]",
  branch: "branch",
} as const
```

Provide a selector helper:

```ts
export type IconMode = "auto" | "on" | "off"

export function getIcons(mode: IconMode, isTTY: boolean): typeof Icons {
  if (mode === "off") return AsciiIcons
  if (mode === "on") return Icons
  if (!isTTY || process.env.TERM === "dumb") return AsciiIcons
  return Icons
}
```

---

### 2. Width Safety

- Never assume glyph width.
- Use a wcwidth-aware library when measuring layout.
- Icons must not be embedded in structural table borders.
- Layout must remain correct when icons are disabled.

---

### 3. Graceful Degradation

If icons are disabled:

- Use ASCII or common Unicode fallbacks
- Maintain column alignment
- Preserve spacing

The UI must remain fully usable without icons.

---

## Help / Diagnostics

Include in `--help` or documentation:

> If icons render as empty squares, install a Nerd Font and configure your terminal to use it.

Optional:

Provide a `--diagnose` or `check-font` command that prints sample glyphs.

---

## Non-Goals

- Do not auto-detect specific installed fonts.
- Do not block startup if glyphs fail.
- Do not require Nerd Fonts for core functionality.

---

## Troubleshooting

### "Copilot not authenticated"

```bash
npm install -g @github/copilot-cli
copilot auth login
```

### Streaming feels slow

Check network latency. The SDK streams tokens as they arrive from the API.

### Ctrl+C doesn't cancel cleanly

The SDK may not support true abort. Current behavior: stops processing deltas, resets state to idle. Session remains valid for next prompt.

---

## Contributing

1. Read [`docs/REQUIREMENTS.md`](./docs/REQUIREMENTS.md) for context
2. Follow existing patterns (event-driven, decoupled)
3. Add tests for new functionality
4. Keep UI ↔ SDK separation strict

