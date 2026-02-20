# Anvil Agent Model

Anvil's multi-agent system is composed of two layers that were developed independently and then merged:

1. **Builtin agents** (`src/agents/builtin.ts`) — 13 role-based developer agents written as the original agent framework, with tiers, domains, and escalation paths.
2. **Orchestration agents** (`src/cli/agents.ts`) — 7 coordination agents introduced to implement the [simkeyur/vscode-agents](https://github.com/simkeyur/vscode-agents) orchestration pattern on top of the Copilot SDK.

The orchestration agents were originally named after Greek mythology figures (inspired by oh-my-opencode) and later renamed to professional dev team roles.

---

## Name Mapping: oh-my-opencode to Anvil

| oh-my-opencode Name | Anvil Name | Role |
|---------------------|------------|------|
| Sisyphus | **Tech Lead** | Central orchestrator — decomposes tasks, delegates, never implements |
| Hephaestus | **Staff Engineer** | Deep autonomous worker — 5+ file implementations |
| Oracle | **Architect** | Systems analyst — root-cause analysis, architecture review, debugging |
| Librarian | **Navigator** | Codebase knowledge — exploration, pattern identification, documentation |
| Explore | **Scout** | Fast read-only search — file patterns, keyword grep |
| Prometheus | **Strategist** | Implementation planner — phased plans with agent assignments |
| Metis | **Advisor** | Plan critic — validates plans before execution begins |

The **Clarifier** agent (originally part of the oh-my-opencode integration) was renamed to **Intake** and moved into the builtin agents layer since it serves as the entry point.

---

## Complete Agent Roster

### Entry Point

| Agent | Model | Source | Purpose |
|-------|-------|--------|---------|
| Intake | claude-sonnet-4.5 | builtin | Clarifies ambiguous requests, then delegates to Tech Lead. Never implements. |

### Orchestration Layer

| Agent | Model | Effort | Source | Purpose |
|-------|-------|--------|--------|---------|
| Tech Lead | claude-opus-4.6 | xhigh | cli | Decomposes tasks, delegates to specialists. Never writes code. |
| Strategist | claude-opus-4.6 | xhigh | cli | Creates phased implementation plans with agent assignments and risks. |
| Advisor | claude-opus-4.6 | xhigh | cli | Validates plans. Returns APPROVED or NEEDS REVISION. |

### Investigation Layer

| Agent | Model | Effort | Source | Purpose |
|-------|-------|--------|--------|---------|
| Architect | gpt-5.2 | high | cli | Root-cause analysis, architecture review, debugging. Read-only. |
| Navigator | claude-sonnet-4.5 | — | cli | Codebase exploration, pattern identification, documentation. Read-only. |
| Scout | gpt-5-mini | — | cli | Quick file/keyword searches. Under 500 words. Fastest agent. |

### Implementation Layer — Tiered Developers

| Agent | Model | Tier | Domain | Escalates To |
|-------|-------|------|--------|--------------|
| Junior Developer | claude-haiku-4.5 | junior | general | Fullstack Developer |
| Frontend Developer | gemini-3-pro-preview | mid | frontend | Senior Frontend Developer |
| Backend Developer | claude-sonnet-4.5 | mid | backend | Senior Backend Developer |
| Fullstack Developer | gemini-3-pro-preview | mid | fullstack | Senior Fullstack Developer |
| Senior Frontend Developer | gpt-5.3-codex | senior | frontend | — |
| Senior Backend Developer | claude-sonnet-4.5 | senior | backend | — |
| Senior Fullstack Developer | gpt-5.3-codex | senior | fullstack | — |
| Staff Engineer | gpt-5.3-codex | — | autonomous | — (handles 5+ file tasks end-to-end) |

### Domain Specialists

| Agent | Model | Domain | Purpose |
|-------|-------|--------|---------|
| Data Engineer | claude-sonnet-4.5 | data | SQL, ETL, data transformations, analytics |
| Designer | gemini-3-pro-preview | design | UI/UX decisions, styling, visual consistency |
| Prompt Writer | gemini-3-flash-preview | prompt | LLM prompt optimization and debugging |
| DevOps | gpt-5.3-codex | devops | Git, CI/CD, dependency management, deployment |

### Quality Gate

| Agent | Model | Effort | Purpose |
|-------|-------|--------|---------|
| Reviewer | gpt-5.2 | medium | Mandatory review before final output. Returns PASS/FAIL with findings. |

---

## Request Flow

```
User
 |
 v
Intake (clarify if needed, then delegate)
 |
 v
Tech Lead (decompose + delegate — NEVER implements)
 |
 +---> Strategist (plan) ---> Advisor (validate plan)
 |
 +---> Scout / Navigator / Architect (investigate)
 |
 +---> Junior / Mid / Senior developers (implement)
 |     (start cheapest, escalate if needed)
 |
 +---> Domain specialists (data, design, prompts, devops)
 |
 v
Reviewer (mandatory quality gate)
 |
 +---> PASS: Tech Lead summarises to user
 +---> FAIL: Tech Lead routes fixes back through specialists
```

---

## Key Design Decisions

**Single-session architecture.** All agents run within one SDK session using the `task` tool for delegation. This means 1 user message = 1 premium API request, regardless of how many agents are involved. The SKILL.md originally described a multi-session design (one per agent), but the SDK's `customAgents` + `task` tool mechanism made single-session delegation possible and far more cost-effective.

**`agent_type: "general-purpose"` workaround.** Custom agent names can't be used as `agent_type` in the task tool because the SDK's `setAuthInfo` flow calls `loadCustomAgents()` after every session create/resume, overwriting registered agents with an empty array from disk. Instead, all delegation uses `agent_type: "general-purpose"` with the specialist's role embedded in the prompt via a `## Role: [Name]` marker.

**Prompt augmentation for sub-delegation.** When Tech Lead runs as a subagent, it gets a fresh context with no access to the parent's system message. The delegation guide is therefore embedded directly in the Tech Lead's prompt at session creation time, so it knows which specialists exist and how to delegate to them.

**False-failure interception.** The SDK's task tool returns `resultType: "failure"` even when the subagent ran and produced useful output. The `onPostToolUse` hook intercepts these and converts false failures to success before the parent LLM sees them, preventing wasteful retry loops. Real failures (empty output, validation errors, unknown agent types) are left as-is.

**Start low, escalate up.** Tech Lead should prefer the cheapest capable agent (Junior > Mid > Senior > Staff Engineer). Escalation happens when an agent reports being stuck, the task involves security, or architectural decisions are needed.

---

## Model Configuration

Models are assigned in `src/agents/modelConfig.ts` and can be overridden per-user via `~/.config/anvil/agents.json`:

```json
{
  "agents": {
    "tech-lead": { "model": "claude-opus-4.6", "reasoningEffort": "xhigh" },
    "junior-developer": { "model": "claude-haiku-4.5" }
  }
}
```

Priority: user config > built-in defaults.

---

## File Map

| File | Contents |
|------|----------|
| `src/agents/builtin.ts` | 13 builtin agent definitions (Intake, developers, specialists, reviewer) |
| `src/cli/agents.ts` | 7 orchestration agents (Tech Lead, Staff Engineer, Architect, Navigator, Scout, Strategist, Advisor) |
| `src/agents/modelConfig.ts` | Default model assignments + user override system |
| `src/copilot/CopilotSessionAdapter.ts` | Delegation guide construction, event handling, SDK integration |
| `src/cli/hooks.ts` | Session hooks including false-failure interception |
| `src/cli/tools.ts` | Custom tools (enforce_checklist, summarize_context, check_conventions, project_overview) |
| `.agents/skills/agent-orchestration/SKILL.md` | Reference spec for the orchestration pattern |
