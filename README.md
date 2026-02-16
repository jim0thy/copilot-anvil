# Copilot Anvil

A terminal UI and CLI for GitHub Copilot, built on `@github/copilot-sdk`. Anvil extends Copilot with a **multi-agent orchestration system** modeled after a well-run engineering team, where a Tech Lead coordinates specialist agents to deliver complex tasks — all within a single premium request.

## Key Concepts

### Multi-Agent Orchestration

Anvil ships with a team of specialist agents that collaborate to handle complex tasks:

```
User prompt --> Intake --> Tech Lead --> Specialists --> Reviewer --> Final output
```

- **Intake** analyses requests, asks clarifying questions, and ensures requirements are clear before work begins
- **Tech Lead** decomposes tasks, assigns them to the right specialists, and coordinates execution
- **Specialists** (Staff Engineer, Architect, Navigator, Strategist, etc.) do the actual work
- **Reviewer** validates quality before the final output is returned

All orchestration happens within a single `session.send()` call, so **1 user message = 1 premium request** regardless of how many agents are involved.

### Two Interfaces

| Interface | Command | Best for |
|-----------|---------|----------|
| **TUI** | `bun run dev` | Interactive sessions with rich UI |
| **CLI** | `bun run cli "prompt"` | Scripting, CI/CD, one-shot tasks |

Both interfaces share the same agents, tools, and skills.

### SDK Integration

Anvil uses `@github/copilot-sdk` under the hood. Agents are registered as SDK `customAgents`, and the built-in `task` tool enables agent-to-agent delegation without additional API calls. The UI never imports the SDK directly — all interaction flows through the `CopilotSessionAdapter` and `Harness` layers.

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
# TUI (interactive terminal UI)
bun run dev

# CLI (one-shot mode)
bun run cli "Refactor the auth module to use JWT"
bun run cli --model claude-sonnet-4.5 "Add dark mode support"
```

## Programmatic Usage

```typescript
import { createAnvilSession } from "./src/cli/index.js";

const session = await createAnvilSession({
  model: "claude-sonnet-4.5",
  onDelta: (text) => process.stdout.write(text),
});

const response = await session.send("Add error handling to the API routes");
await session.destroy();
```

## Keybinds (TUI)

| Key | Action |
|-----|--------|
| `Enter` | Submit prompt |
| `Tab` | Cycle through agents |
| `Shift+Tab` | Cycle through models |
| `Ctrl+S` | Open skills selector |
| `Ctrl+N` | Switch/create sessions |
| `Ctrl+G` | Smart commit & push |
| `Ctrl+I` | Attach image to prompt |
| `Ctrl+C` | Cancel active run (or quit if idle) |
| `Esc` | Quit |

## TUI Layout

```
+----------------------------------------------------------+
| Anvil | STATUS | model  Shift+Tab | Ctrl+S | Ctrl+N...   |
+---------------------------------+------------------------+
| [Chat Transcript]               | [Sidebar]              |
|                                 | - Tasks                |
| [You]                           | - Context              |
| Your message                    | - Subagents            |
|                                 | - Files Modified       |
| [Assistant]                     | - Plan                 |
| Response (streaming...)         |                        |
|                                 |                        |
+---------------------------------+------------------------+
| > Type your prompt...                                    |
+----------------------------------------------------------+
```

## Agent Team

Anvil includes 20 agents organized into functional layers:

| Layer | Agents | Purpose |
|-------|--------|---------|
| **Entry** | Intake | Clarify requirements before work begins |
| **Coordination** | Tech Lead, Strategist, Advisor | Plan and coordinate work |
| **Investigation** | Architect, Navigator, Scout | Analyse, explore, search |
| **Implementation** | Staff Engineer, Junior/Mid/Senior Devs | Write code |
| **Specialist** | Designer, Data Engineer, DevOps, Prompt Writer | Domain expertise |
| **Quality** | Reviewer | Final quality gate |

See [docs/AGENT-ORCHESTRATION.md](docs/AGENT-ORCHESTRATION.md) for the full orchestration architecture.

### Customizing Agents

Create `.agent.md` files to add or override agents:

```markdown
---
name: My Custom Agent
description: What this agent does
model: claude-sonnet-4.5
tier: mid
domain: fullstack
escalatesTo: Senior Fullstack Developer
---

Your system prompt here...
```

**Loading priority** (later overrides earlier):
1. Built-in agents (defaults)
2. Global agents (`~/.config/anvil/agents/*.agent.md`)
3. Project agents (`.agents/*.agent.md`)

## Architecture

```
+------------------------------------------------------+
|                 UI Layer (OpenTUI/React)              |
|  TUI: App.tsx, ChatPane, Sidebar, InputBar           |
|  CLI: index.ts, streaming output                     |
+------------------------+-----------------------------+
                         | HarnessEvent / UIAction
+------------------------v-----------------------------+
|               Harness (Orchestrator)                 |
|  State management, event bus, plugins, sessions      |
+------------------------+-----------------------------+
                         |
+------------------------v-----------------------------+
|           Copilot Session Adapter                    |
|  SDK wrapper -- the only place that imports the SDK  |
|  Registers agents, tools, hooks, skills              |
+------------------------+-----------------------------+
                         |
                  @github/copilot-sdk
```

## Features

- **Multi-agent orchestration**: Team of 20 agents with automatic delegation and escalation
- **Single-request guarantee**: Complex multi-agent flows consume only 1 premium request
- **Multi-session support**: Create and switch between conversation sessions
- **Skills integration**: Invoke project-specific skills
- **Image attachments**: Attach images for vision model support
- **Git integration**: View modified files, smart commit & push workflows
- **Task tracking**: Monitor agent task progress in real-time
- **Subagent monitoring**: Track subagent execution and status
- **Plan tracking**: View and monitor execution plans
- **Plugin system**: Extend functionality with custom plugins
- **Custom tools**: SDK-native tools (checklist enforcement, context summarization, convention checking)
- **Session hooks**: Pre/post tool-use guardrails, prompt enrichment, project context injection

## Further Documentation

- [Agent Orchestration](docs/AGENT-ORCHESTRATION.md) — How the multi-agent system works
- [Requirements](docs/REQUIREMENTS.md) — Full product requirements
- [AGENTS.md](AGENTS.md) — Guide for AI agents working on this codebase

## Known Limitations

- **Cancellation**: Uses SDK's `session.abort()`. Best-effort if SDK doesn't support clean abort.
- **Scrollback**: Limited to terminal height. Use arrow keys to scroll.
- **Theme detection**: Adapts colors based on `COLORFGBG` with a dark fallback.
