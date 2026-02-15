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
| `src/agents/` | Agent orchestration system |
| `src/agents/types.ts` | AgentDefinition types |
| `src/agents/loader.ts` | Agent discovery and loading |
| `src/agents/builtin.ts` | Built-in agent definitions (14 agents) |
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
- **Team Mode**: Prompts route through Clarifier → Orchestrator → Specialist agents

#### Keyboard Shortcuts

| Key | Action |
|-----|--------|
| `Tab` | Cycle through top-level agents (shown in status bar) |
| `Shift+Tab` | Open model selector |
| `/team` | Enable orchestrated mode |
| `/direct` | Enable direct mode |
| `/agents` | List available agents |

#### Built-in Agents (14 total)

| Agent | Tier | Domain | Description |
|-------|------|--------|-------------|
| Clarifier | specialist | clarification | Seeks clarification on ambiguous requests |
| Orchestrator | specialist | orchestration | Coordinates work, delegates to specialists |
| Planner | specialist | planning | Creates implementation plans |
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

#### Agent Loading Priority

1. **Project agents** (`.agents/*.agent.md`) - highest priority
2. **Global agents** (`~/.config/anvil/agents/`) - override built-ins
3. **Built-in agents** - default definitions

#### Custom Agent Format

```markdown
---
name: My Custom Agent
description: What this agent does
model: claude-sonnet-4.5
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

