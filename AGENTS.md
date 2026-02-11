# Copilot SDK TUI Harness

## Project Overview

A terminal UI (TUI) for interacting with GitHub Copilot, built with TypeScript, OpenTUI, and the `@github/copilot-sdk`. See [`docs/REQUIREMENTS.md`](./docs/REQUIREMENTS.md) for full specifications.

---

## Quick Start

```bash
# Prerequisites: Bun 1.0+, GitHub Copilot CLI authenticated
bun install
bun run dev
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
| `src/ui/` | OpenTUI/React components |
| `src/ui/panes/` | Chat, Logs, Input panes |
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
| `run.finished` | Run completed successfully |
| `run.cancelled` | User cancelled with Ctrl+C |
| `log` | Internal logging (info/warn/error) |

**Actions** (UI → Harness):

| Action | Effect |
|--------|--------|
| `submit.prompt` | Send prompt to Copilot |
| `cancel` | Abort current run |

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
3. (Future) Register via `ctx.panes.register()` for plugin support

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

### Testing

```bash
npm test
```

### Linting

```bash
npm run lint
```

---

## Scripts

| Script | Purpose |
|--------|---------|
| `npm run dev` | Start TUI in development mode |
| `npm run build` | Compile TypeScript |
| `npm test` | Run tests |
| `npm run lint` | Check code style |

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

