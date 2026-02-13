---
description: Load the Copilot TUI Harness skill for development tasks on this project
---

Load the Copilot TUI Harness development skill and help with the requested task.

## Workflow

### Step 1: Load the copilot-tui-harness skill

```
skill({ name: 'copilot-tui-harness' })
```

### Step 2: Identify task type from user request

Analyze $ARGUMENTS to determine the development task:
- **Architecture changes** (event system, plugin system, layer modifications)
- **SDK integration** (CopilotSessionAdapter changes, new SDK features)
- **UI development** (new panes, component updates, OpenTUI work)
- **Plugin development** (new plugins, tool registration, command registration)
- **Event system** (new events, action types, event flow changes)
- **Debugging/troubleshooting** (event flow issues, state problems)

### Step 3: Execute task

Apply the patterns and architecture guidelines from the skill to complete the user's request, maintaining:
- Strict UI ↔ SDK separation
- Event-driven communication
- Plugin-ready architecture

### Step 4: Summarize

```
=== Harness Development Task Complete ===

Area: <SDK | Harness | UI | Plugin | Events>
Files modified: <files changed>

<brief summary of what was done>
```

<user-request>
$ARGUMENTS
</user-request>
