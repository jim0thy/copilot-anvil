# Copilot Anvil

A terminal UI (TUI) for interacting with GitHub Copilot via the `@github/copilot-sdk`.

## Prerequisites

- Bun 1.0+
- GitHub Copilot CLI installed and authenticated:
  ```bash
  npm install -g @github/copilot-cli
  copilot auth login
  ```

## Install

```bash
bun install
```

## Run

```bash
bun run dev
```

## Keybinds

| Key | Action |
|-----|--------|
| `Shift+Tab` | Cycle through available models |
| `Ctrl+S` | Open skills selector |
| `Ctrl+N` | Switch/create sessions |
| `Ctrl+G` | Smart commit & push |
| `Esc` | Quit the application |
| `Ctrl+C` | Cancel active run (or quit if idle) |
| `Enter` | Submit prompt |
| `Ctrl+I` | Attach image to prompt |

## Layout

```
┌──────────────────────────────────────────────────────────┐
│ Anvil │ STATUS │ model  Shift+Tab │ Ctrl+S │ Ctrl+N... │
├─────────────────────────────────────┬────────────────────┤
│ [Chat Transcript]                   │ [Sidebar]          │
│                                     │ • Tasks            │
│ [You]                               │ • Context          │
│ Your message                        │ • Subagents        │
│                                     │ • Files Modified   │
│ [Assistant]                         │ • Plan             │
│ Response (streaming...)             │                    │
│                                     │                    │
├─────────────────────────────────────┴────────────────────┤
│ > Type your prompt...                                    │
└──────────────────────────────────────────────────────────┘
```

## Features

- **Multi-session support**: Create and switch between multiple conversation sessions
- **Skills integration**: Invoke project-specific skills (e.g., copilot-sdk, opentui, copilot-tui-harness)
- **Image attachments**: Attach images to prompts for vision model support
- **Git integration**: View modified files, smart commit & push workflows
- **Task tracking**: Monitor task progress in real-time
- **Subagent monitoring**: Track subagent execution and status
- **Context awareness**: Display current context (git info, active tools, etc.)
- **Plan tracking**: View and monitor execution plans
- **Ephemeral runs**: Run quick commands with separate UI (e.g., smart commits)

## Architecture

- **CopilotSessionAdapter**: Wraps `@github/copilot-sdk`, translates SDK events to internal `HarnessEvent`s
- **Harness**: Orchestrator that manages state, event bus, transcript, sessions, and dispatches UI actions
- **UI (OpenTUI/React)**: Renders multiple panes (Chat, Sidebar, Input) based on harness state

The UI never imports the Copilot SDK directly—all interaction goes through the adapter and harness.

### Key Components

- **ChatPane**: Displays conversation transcript with streaming support
- **Sidebar**: Contains multiple sub-panes (Tasks, Context, Subagents, Files, Plan)
- **InputBar**: Handles prompt input with image attachment support
- **SessionSwitcher**: Manage multiple conversation sessions
- **SkillsPane**: Browse and invoke available skills
- **ModelSelector**: Switch between available AI models
- **QuestionModal**: Interactive prompts for user input during execution

## Known Limitations

- **Cancellation**: Uses SDK's `session.abort()`. If the SDK doesn't support clean abort, the cancellation is best-effort (ignores subsequent deltas and resets state).
- **Scrollback**: Limited to what fits in the terminal. Use arrow keys to scroll through chat history.
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

## Implemented Features

- ✅ Task management with real-time tracking
- ✅ Context awareness and injection
- ✅ Git integration (diffs, modified files, smart commits)
- ✅ Multi-session support
- ✅ Skills integration
- ✅ Image attachment support
- ✅ Plan tracking
- ✅ Subagent monitoring
- ✅ Interactive questions/prompts

## Future Enhancements

- GitHub PR workflows
- File browser pane with selection
- Advanced diff visualization
- Session search and filtering
