---
description: Multi-agent orchestration system inspired by oh-my-opencode. Provides specialist agents (Sisyphus, Hephaestus, Oracle, Librarian, Prometheus, Metis) that coordinate complex coding tasks within a single premium request.
allowed-tools:
  - task
  - read
  - write
  - edit
  - glob
  - grep
  - shell
  - ask_user
---

# OpenCode Orchestration

This skill provides a multi-agent orchestration system for complex coding tasks. It coordinates specialist agents to break down, plan, implement, and review work efficiently.

## Agents

| Agent | Role | Best For |
|-------|------|----------|
| **Sisyphus** | Main orchestrator | Coordinating complex multi-step tasks |
| **Hephaestus** | Deep worker | Large implementations spanning 5+ files |
| **Oracle** | Analyst | Debugging, architecture review, root-cause analysis |
| **Librarian** | Navigator | Finding code, explaining patterns, documentation |
| **Explore** | Fast search | Quick read-only codebase searches |
| **Prometheus** | Planner | Creating implementation plans with phases |
| **Metis** | Critic | Validating plans before execution |

## How It Works

1. All agents are registered as `customAgents` in the Copilot SDK session.
2. The SDK's built-in `task` tool enables agent-to-agent delegation.
3. All orchestration happens within a **single premium request** — subagent invocations are free.
4. The orchestrator (Sisyphus) coordinates specialists based on task complexity.

## Usage

### Via CLI (one-shot mode)
```bash
bun src/cli/index.ts "Refactor the authentication module to use JWT"
```

### Programmatic
```typescript
import { createAnvilSession } from "./src/cli/index.js";

const session = await createAnvilSession({
  model: "claude-sonnet-4.5",
});

const response = await session.send("Add dark mode support");
await session.destroy();
```

### Via TUI
The agents are automatically loaded when Anvil starts in TUI mode. Use:
- `Ctrl+A` or `/agents` to see available agents
- `/team` to enable orchestrated mode (Clarifier → Orchestrator → Specialists)
- `/direct` to go back to single-agent mode

## Single-Request Guarantee

The critical design constraint: **1 user message = 1 premium request**. This is achieved because:

- Agents are SDK `customAgents`, not separate API calls
- The `task` tool delegates to subagents within the same request context
- All tool calls, agent delegations, and follow-ups happen within a single `session.send()` call
- The request only completes when `session.idle` fires

This means even a complex flow like:
```
User → Sisyphus → Prometheus (plan) → Metis (validate) → Hephaestus (implement) → Reviewer (check) → User
```
...consumes exactly **1 premium request**.
