---
name: copilot-tui-harness
description: Expert in the Copilot SDK TUI Harness project. Use for development tasks including architecture, event system, plugins, OpenTUI components, and Copilot SDK integration. Triggers on TUI development, harness events, streaming UI, plugin system, event-driven architecture.
---

# Copilot SDK TUI Harness Development Skill

Expert skill for developing the Copilot SDK TUI Harness—a terminal user interface that wraps the GitHub Copilot SDK with an event-driven, plugin-based architecture.

## Project Identity

**Name**: Copilot SDK TUI Harness (copilot-anvil)  
**Stack**: TypeScript + OpenTUI/React + @github/copilot-sdk  
**Runtime**: Bun 1.0+  
**Architecture**: Event-driven with strict UI ↔ SDK decoupling

## Core Principles

### 1. Strict Layer Separation

```
UI Layer (OpenTUI/React)
    ↕ HarnessEvent / UIAction
Harness (Orchestrator)
    ↕ Internal callbacks
CopilotSessionAdapter
    ↕
@github/copilot-sdk
```

**CRITICAL**: The UI layer never imports `@github/copilot-sdk` directly. All SDK interaction flows through the adapter and harness layers.

### 2. Event-Driven Communication

- **Harness → UI**: `HarnessEvent` types (run.started, assistant.delta, log, etc.)
- **UI → Harness**: `UIAction` types (submit.prompt, cancel)
- No direct function calls between layers—everything flows through events

### 3. Plugin-Ready Architecture

The system is designed for extensibility via plugins that can register:
- Tools (callable by the assistant)
- Commands (user-invokable actions)
- Panes (UI components)
- State slices (additional state management)

## Architecture Deep Dive

### Directory Structure

```
src/
├── index.tsx                    # Entry point, bootstraps app
├── copilot/
│   └── CopilotSessionAdapter.ts # ONLY place that imports SDK
├── harness/
│   ├── Harness.ts              # Orchestrator, state manager
│   ├── events.ts               # Event type definitions
│   └── plugins.ts              # Plugin system interfaces
├── ui/
│   ├── App.tsx                 # Main OpenTUI app component
│   └── panes/
│       ├── ChatPane.tsx        # Displays conversation transcript
│       ├── LogsPane.tsx        # Shows system logs
│       └── InputBar.tsx        # Prompt input interface
├── commands/                   # User commands (future)
└── utils/                      # Shared utilities
```

### Key Files and Responsibilities

#### `src/copilot/CopilotSessionAdapter.ts`

**Purpose**: Wraps Copilot SDK, translates SDK events to HarnessEvents

**Responsibilities**:
- Initialize CopilotClient
- Create/manage CopilotSession (with `streaming: true`)
- Subscribe to SDK events and emit corresponding HarnessEvents
- Handle prompt submission via session.sendAndWait()
- Must NOT contain UI code or import UI components

**Key Pattern**:
```typescript
// SDK event → Harness event translation
session.on('assistant.message_delta', (event) => {
  this.emit({
    type: 'assistant.delta',
    runId: this.currentRunId,
    text: event.content
  });
});
```

#### `src/harness/Harness.ts`

**Purpose**: Central orchestrator and state manager

**Responsibilities**:
- Maintain UI transcript (for display only—SDK has true memory)
- Own event bus and lifecycle state
- Handle UIAction dispatch from UI
- Support plugin registration and management
- Coordinate between adapter and UI

**Key Patterns**:
- State is immutable; updates create new state objects
- Events are emitted synchronously to all listeners
- Plugins hook into lifecycle via `onEvent()`

#### `src/harness/events.ts`

**Purpose**: Define all event and action types

**Core HarnessEvent Types**:

| Event | Payload | When Emitted |
|-------|---------|--------------|
| `run.started` | `{ runId, createdAt }` | Prompt submitted, SDK begins processing |
| `assistant.delta` | `{ runId, text }` | Streaming token received from SDK |
| `assistant.message` | `{ runId, message }` | Complete assistant response ready |
| `run.finished` | `{ runId, createdAt }` | Run completed successfully |
| `run.cancelled` | `{ runId, createdAt }` | User cancelled with Ctrl+C |
| `log` | `{ runId?, level, message, data? }` | System or plugin log message |

**UIAction Types**:

| Action | Payload | Effect |
|--------|---------|--------|
| `submit.prompt` | `{ text }` | Send prompt to Copilot SDK |
| `cancel` | `{}` | Abort current run |

#### `src/harness/plugins.ts`

**Purpose**: Define plugin system interfaces

**Plugin Interface**:
```typescript
interface HarnessPlugin {
  name: string;
  register(ctx: PluginContext): void;
  onEvent?(event: HarnessEvent): void;
}

interface PluginContext {
  tools: ToolRegistry;
  commands: CommandRegistry;
  panes: PaneRegistry;
  state: StateRegistry;
  emit(event: HarnessEvent): void;
}
```

**Key Concept**: Plugins receive a context object during registration and can subscribe to all harness events.

#### `src/ui/App.tsx`

**Purpose**: Main OpenTUI application component

**Responsibilities**:
- Layout definition (chat + logs + input)
- Subscribe to harness events and update local state
- Dispatch UIActions in response to user input
- Render keybind hints and status bar

**Key Patterns**:
- Use React hooks (useState, useEffect) for local UI state
- Never directly manipulate harness state
- All harness communication via events/actions

#### `src/ui/panes/ChatPane.tsx`

**Purpose**: Display conversation transcript with streaming support

**Responsibilities**:
- Render user and assistant messages
- Show streaming draft during active run
- Handle scrolling and layout

**Key Pattern**: Separate committed messages from streaming buffer:
```typescript
{messages.map(msg => <Message {...msg} />)}
{streamingBuffer && <StreamingMessage text={streamingBuffer} />}
```

#### `src/ui/panes/LogsPane.tsx`

**Purpose**: Display system logs

**Responsibilities**:
- Subscribe to `log` events
- Show recent logs (capped for performance)
- Format log levels (info/warn/error)

#### `src/ui/panes/InputBar.tsx`

**Purpose**: Handle prompt input

**Responsibilities**:
- Provide text input field
- Dispatch `submit.prompt` action on Enter
- Disable input during active run
- Show input hints

## Event Flow Patterns

### Typical Prompt Submission Flow

```
1. User types in InputBar, presses Enter
2. InputBar dispatches UIAction({ type: "submit.prompt", text })
3. Harness.dispatch() receives action
4. Harness emits HarnessEvent({ type: "run.started", runId, createdAt })
5. Harness calls CopilotSessionAdapter.sendPrompt(text)
6. Adapter calls session.sendAndWait({ prompt: text })
7. SDK streams response tokens
8. For each token:
   a. Adapter receives SDK event
   b. Adapter emits HarnessEvent({ type: "assistant.delta", runId, text })
   c. Harness updates streaming buffer
   d. UI re-renders with updated buffer
9. SDK completes
10. Adapter emits HarnessEvent({ type: "assistant.message", runId, message })
11. Harness commits buffer to transcript
12. Harness emits HarnessEvent({ type: "run.finished", runId, createdAt })
13. UI shows completed message, re-enables input
```

### Cancellation Flow

```
1. User presses Ctrl+C during run
2. UI dispatches UIAction({ type: "cancel" })
3. Harness.dispatch() receives action
4. Harness tells adapter to cancel
5. Adapter stops processing deltas (best-effort)
6. Adapter emits HarnessEvent({ type: "run.cancelled", runId, createdAt })
7. Harness clears streaming buffer, resets to idle
8. UI re-enables input
```

## Development Guidelines

### When Adding a New Feature

**1. Define Events First**
- Add new event types to `src/harness/events.ts`
- Define clear contracts (what data, when emitted)

**2. Implement in Layers**
- If SDK-related: extend `CopilotSessionAdapter`
- If state/logic: extend `Harness`
- If UI: add/modify components in `src/ui/`

**3. Maintain Separation**
- Never import SDK in UI
- Keep adapter simple—just translation
- Put logic in harness, not adapter or UI

### When Adding a Plugin

**1. Define the plugin object**:
```typescript
const myPlugin: HarnessPlugin = {
  name: "my-feature",
  register(ctx) {
    // Register tools, commands, etc.
    ctx.tools.register("myTool", async (args) => {
      return { result: "..." };
    });
  },
  onEvent(event) {
    // React to lifecycle events
    if (event.type === "run.started") {
      console.log("Run started!");
    }
  }
};
```

**2. Register with harness**:
```typescript
harness.use(myPlugin);
```

**3. Test integration**:
- Verify tools are callable by assistant
- Ensure events are received
- Check for conflicts with existing plugins

### When Adding a New Pane

**1. Create component**: `src/ui/panes/NewPane.tsx`

**2. Design state needs**:
- What events does it subscribe to?
- What actions does it dispatch?

**3. Add to layout**: Update `src/ui/App.tsx`

**4. (Future) Register via plugin**: Use `ctx.panes.register()`

### When Modifying SDK Integration

**ONLY edit `src/copilot/CopilotSessionAdapter.ts`**

Common tasks:
- Change session options (model, streaming, etc.)
- Add new SDK event subscriptions
- Adjust prompt formatting
- Handle new SDK capabilities

Never:
- Import SDK elsewhere
- Put business logic in adapter
- Directly manipulate UI from adapter

## Common Patterns

### Pattern: Buffered Streaming

```typescript
// In Harness
private streamingBuffer = "";

onDelta(event: AssistantDeltaEvent) {
  this.streamingBuffer += event.text;
  this.notifyUI();
}

onComplete(event: AssistantMessageEvent) {
  this.transcript.push({
    role: "assistant",
    content: this.streamingBuffer,
    createdAt: new Date()
  });
  this.streamingBuffer = "";
  this.notifyUI();
}
```

### Pattern: Idempotent Event Handling

```typescript
// In Plugin
onEvent(event: HarnessEvent) {
  if (event.type === "run.started") {
    // Always safe to call, even if called multiple times
    this.resetState();
  }
}
```

### Pattern: Async Tool Registration

```typescript
// In Plugin
register(ctx: PluginContext) {
  ctx.tools.register("fetchData", async (args) => {
    const data = await fetch(args.url);
    return await data.json();
  });
}
```

## Testing Strategies

### Manual Testing

```bash
bun run dev
```

**Test cases**:
1. Send a prompt, verify streaming display
2. Send multiple prompts, verify session continuity
3. Press Ctrl+C during streaming, verify cancellation
4. Trigger error (bad auth), verify error handling
5. Check logs pane shows lifecycle events

### Integration Testing

- Mock CopilotSessionAdapter
- Emit events manually
- Verify harness state updates
- Verify UI renders correctly

### Unit Testing

- Test event type definitions
- Test plugin registration logic
- Test utility functions

## Debugging

### Enable verbose logging

```typescript
// In Harness or Adapter
this.emit({
  type: "log",
  level: "info",
  message: "Debug: streaming delta",
  data: { text, runId }
});
```

### Check event flow

Add logging to:
1. `Harness.dispatch()` — see incoming actions
2. `Adapter` event handlers — see SDK events
3. UI `useEffect` hooks — see state updates

### Inspect state

Use OpenTUI devtools or add temporary UI to display:
- Current harness state
- Active run ID
- Streaming buffer content
- Plugin registry contents

## Performance Considerations

### Streaming Updates

- Debounce UI updates if delta rate is very high
- Use React memoization for message list
- Limit log pane to last N entries

### Event Listeners

- Remove listeners on component unmount
- Use weak references if holding onto event listeners long-term

### Plugin Load Time

- Keep `register()` fast—defer heavy init to first use
- Don't block on network calls during registration

## Common Pitfalls

### ❌ Importing SDK in UI

```typescript
// WRONG - never do this
import { CopilotClient } from "@github/copilot-sdk";
```

**Fix**: Use harness events and actions instead

### ❌ Putting Logic in Adapter

```typescript
// WRONG - adapter should not have business logic
adapter.sendPrompt = (text) => {
  if (text.includes("secret")) {
    // Don't do this here!
    throw new Error("Forbidden");
  }
  session.sendAndWait({ prompt: text });
}
```

**Fix**: Put validation in harness or plugin

### ❌ Mutating Harness State from UI

```typescript
// WRONG - never mutate harness state directly
harness.state.transcript.push(newMessage);
```

**Fix**: Dispatch an action, let harness update its own state

### ❌ Blocking Event Handlers

```typescript
// WRONG - don't block the event loop
onEvent(event) {
  if (event.type === "run.started") {
    // This blocks!
    const result = syncExpensiveOperation();
  }
}
```

**Fix**: Use async/await or defer work to next tick

## Scripts and Commands

| Command | Purpose |
|---------|---------|
| `bun run dev` | Start TUI in development mode |
| `bun run start` | Same as dev (alias) |
| `bun install` | Install dependencies |

## Dependencies

### Production

- `@github/copilot-sdk` — Core SDK for agent runtime
- `@opentui/core` — Terminal UI framework (core)
- `@opentui/react` — React reconciler for OpenTUI
- `react` — React library
- `diff` — Diff utility (future use)

### Development

- `typescript` — TypeScript compiler
- `@types/node` — Node.js type definitions
- `@types/react` — React type definitions
- `@types/diff` — Diff type definitions

## Configuration Files

- `package.json` — Project manifest, scripts, dependencies
- `tsconfig.json` — TypeScript compiler options
- `bun.lock` — Bun lockfile

## Resources

- Full requirements: `docs/REQUIREMENTS.md`
- Agent docs: `AGENTS.md`
- Main README: `README.md`

## Quick Reference: File → Responsibility

| File | What to Change |
|------|----------------|
| `CopilotSessionAdapter.ts` | SDK integration, event translation |
| `Harness.ts` | State management, orchestration |
| `events.ts` | Add new event/action types |
| `plugins.ts` | Extend plugin system |
| `App.tsx` | Layout, top-level UI structure |
| `ChatPane.tsx` | Conversation display logic |
| `LogsPane.tsx` | Log display logic |
| `InputBar.tsx` | Prompt input handling |

## Troubleshooting

### "Copilot not authenticated"

```bash
npm install -g @github/copilot-cli
copilot auth login
```

### Streaming not working

- Check `streaming: true` in session options
- Verify adapter subscribes to `assistant.message_delta`
- Check harness emits `assistant.delta` events

### Cancellation not working

- SDK may not support true abort
- Current approach: ignore subsequent deltas, reset state
- Session remains valid for next prompt

### Plugin not receiving events

- Verify plugin registered: `harness.use(plugin)`
- Check `onEvent` method exists and has correct signature
- Add logging to verify events are being emitted

### UI not updating

- Check component subscribes to harness events
- Verify state changes trigger re-render
- Use React DevTools to inspect component state

## Future Enhancements (Planned)

Architecture supports these additions:

1. **Tasks**: Task state slice, tools, dedicated pane
2. **Memory**: Memory provider interface, context injection
3. **Git & Diffs**: Git tools, diff resources, approval gating
4. **GitHub PR**: PR tools, PR resources, PR pane
5. **File Browser**: File selection pane, context injection

## Summary

This skill provides comprehensive knowledge for working on the Copilot SDK TUI Harness project. Key takeaways:

1. **Strict separation**: UI never imports SDK
2. **Event-driven**: All communication via events/actions
3. **Plugin-ready**: Extensibility built into core
4. **Three layers**: UI → Harness → Adapter → SDK
5. **TypeScript + OpenTUI**: Strongly typed, terminal-first

When developing, always consider: Which layer does this belong in? What events does it produce/consume? How does it fit into the plugin system?
