# Copilot Anvil

A terminal UI (TUI) for interacting with GitHub Copilot via the `@github/copilot-sdk`.

## Prerequisites

- Node.js 18+
- GitHub Copilot CLI installed and authenticated:
  ```bash
  npm install -g @github/copilot-cli
  copilot auth login
  ```

## Install

```bash
npm install
```

## Run

```bash
npm run dev
```

## Keybinds

| Key | Action |
|-----|--------|
| `Tab` | Cycle through available models |
| `Esc` | Quit the application |
| `Ctrl+C` | Cancel active run (or quit if idle) |
| `Enter` | Submit prompt |

## Layout

```
┌──────────────────────────────────────────────────┐
│ Anvil │ STATUS │ model  Tab: model │ Esc...│
├──────────────────────────────────┬───────────────┤
│                                  │ Logs          │
│ Chat transcript                  │ [INF] ...     │
│                                  │ [ERR] ...     │
│ [You]                            │               │
│ Your message                     │               │
│                                  │               │
│ [Assistant]                      │               │
│ Response (streaming...)          │               │
│                                  │               │
├──────────────────────────────────┴───────────────┤
│ > Type your prompt...                            │
└──────────────────────────────────────────────────┘
```

## Architecture

- **CopilotSessionAdapter**: Wraps `@github/copilot-sdk`, translates SDK events to internal `HarnessEvent`s
- **Harness**: Orchestrator that manages state, event bus, transcript, and dispatches UI actions
- **UI (Ink/React)**: Renders Chat, Logs, and Input panes based on harness state

The UI never imports the Copilot SDK directly—all interaction goes through the adapter and harness.

## Known Limitations

- **Cancellation**: Uses SDK's `session.abort()`. If the SDK doesn't support clean abort, the cancellation is best-effort (ignores subsequent deltas and resets state).
- **Scrollback**: Limited to what fits in the terminal. No scroll history in v0.
- **Markdown**: Responses are displayed as plain text (no markdown rendering).
- **Theme detection**: Adapts neutral colors based on `COLORFGBG` with a dark fallback.

## Plugin System (Scaffolding)

The harness includes a plugin registry for future extensibility:

```typescript
import { HarnessPlugin } from "./harness/plugins.js";

const myPlugin: HarnessPlugin = {
  name: "my-plugin",
  register(ctx) {
    ctx.tools.register("myTool", async () => "result");
    ctx.commands.register("myCommand", () => console.log("executed"));
  },
  onEvent(event) {
    if (event.type === "run.started") {
      console.log("Run started:", event.runId);
    }
  },
};

harness.use(myPlugin);
```

## Future Enhancements

Architecture supports (not implemented in v0):
- Task management with state slices
- Memory/context injection
- Git integration (diffs, commits)
- GitHub PR workflows
- File browser pane
