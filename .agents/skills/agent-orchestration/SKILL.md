# SKILL: Implement the `vscode-agents` orchestration model using `@github/copilot-sdk` (Node.js)

## Purpose
You are implementing a **multi-agent development system** (Clarifier → Orchestrator → Planner → Specialists → Reviewer) modeled after `simkeyur/vscode-agents`, but **running in your own Node.js process** using `@github/copilot-sdk`.

This skill exists because the agent keeps “kind of” implementing it and getting the control-flow wrong. Follow this skill **exactly**.

Reference model: the repo’s workflow explicitly starts with Clarifier, then Orchestrator delegates to specialized agents, and a Reviewer is the final quality gate.  
Copilot SDK primitives you must use: `CopilotClient`, `createSession`, session events, `sendAndWait`, tools via `defineTool`, and (optionally) `onUserInputRequest`/`ask_user`.

---

## Non-negotiable rules (you must comply)
1. **ALWAYS start with Clarifier.** No exceptions. If unclear, Clarifier asks targeted questions before any work proceeds.
2. **Orchestrator NEVER implements.** It only decomposes, delegates, coordinates, and escalates.
3. **Planner produces a plan, not code.**
4. **Specialists produce work outputs.** (Code, diffs, instructions, etc.)
5. **Reviewer is mandatory** before final output to the user.
6. **Adaptive escalation:** start with the lightest competent dev agent and escalate only when needed (explicitly defined in Orchestrator).

If you violate any rule above, the implementation is wrong.

---

## What you are building (mental model)
You are building a **controller** (your Node app) that:
- Spawns and manages **one Copilot session per role** (Clarifier, Orchestrator, Planner, etc.)
- Provides a **tool** the Orchestrator can use to “call” specialist agents (since outside VS Code you must implement delegation yourself)
- Enforces the exact workflow ordering and quality gate

Copilot SDK gives you:
- A long-lived `CopilotClient`
- Multiple independent sessions (`client.createSession`)
- A robust tool callback mechanism (`defineTool`) so the model can trigger deterministic host behavior

---

## Required architecture

### A. Sessions (one per agent role)
Create a session per role:
- `clarifierSession`
- `orchestratorSession`
- `plannerSession`
- specialist sessions: `juniorDev`, `frontendDev`, `backendDev`, `fullstackDev`, `srFrontend`, `srBackend`, `srFullstack`, `dataEngineer`, `designer`, `promptWriter`, `devOps`
- `reviewerSession`

**Do not** “roleplay all agents in one session.” That defeats isolation and breaks delegation.

**Model selection:** pass `model` in session config. The SDK requires `model` to be set when creating sessions (especially with custom providers), and it supports multiple sessions with different models.  
(Use `listModels()` if you need to confirm exact model IDs in your environment.)

### B. System prompts (role definitions)
Each agent session must have a role-specific system prompt derived from the `.agent.md` content.

Minimum viable approach:
- Put each role prompt into `systemMessage.content`.
- Prefer `mode: default/append` unless you have a very specific reason to replace the full prompt. The SDK notes your content is appended after SDK-managed guardrails by default; `mode:"replace"` removes guardrails.

Critical: the Orchestrator prompt must include “NEVER implement anything yourself” and the escalation strategy wording (that’s the core behavioral constraint).

### C. The Orchestrator must delegate via a tool you provide
In VS Code, “agent calling” is a built-in capability. In Node, **you must implement it**.

Provide a tool (via `defineTool`) named, e.g., `delegate_to_agent` that:
- Accepts `{ agent: <enum>, prompt: string, context?: object }`
- Runs the chosen agent session with `sendAndWait`
- Returns the agent’s response text + metadata (agent name, timestamps)

This is not optional. Without this tool, the Orchestrator will hallucinate delegation or try to implement work itself.

---

## Exact runtime workflow (state machine)
Implement this as a strict controller loop:

### Step 0 — Clarify (always)
1. Send the user request to `clarifierSession`.
2. Clarifier must output one of:
    - **A. “NEEDS_CLARIFICATION”** + a list of questions; OR
    - **B. “CLEAR”** + a rewritten “clarified request” the rest of the pipeline will use.

If needs clarification:
- Return questions to the user.
- STOP. Do not proceed.

### Step 1 — Orchestrate (delegate only)
Send the clarified request to `orchestratorSession`.

Orchestrator must produce:
- A structured task list
- Which agents to delegate to
- Whether escalation is required
- Any parallelizable groups
- A “review package” instruction for the Reviewer

**Hard constraint:** the Orchestrator must not write code, diffs, or implementation steps beyond delegation and coordination.

### Step 2 — Plan (Planner session)
Send the clarified request + Orchestrator task list to `plannerSession`.
Planner returns:
- Ordered phases
- Dependencies
- Acceptance criteria / done conditions

### Step 3 — Execute tasks (Specialists)
For each task, the Orchestrator must call your `delegate_to_agent` tool.
Your Node controller will:
- Route to the correct session
- Pass required context (clarified request, plan, relevant prior outputs)
- Collect results

Parallel execution:
- Only run tasks in parallel if you can prove they don’t conflict.
- If you can’t prove that, run sequentially.

Escalation:
- If a lower-level agent reports being stuck / security concerns / architectural decision, escalate to the next agent per the Orchestrator rules.

### Step 4 — Review gate (mandatory)
Send the full execution bundle to `reviewerSession`:
- clarified request
- plan
- all specialist outputs
- any diffs/files produced

Reviewer returns:
- PASS/FAIL
- issues found (security/bugs/perf)
- required fixes (who should fix them)

If FAIL:
- route fixes back through Orchestrator → delegate tool → specialists
- re-review
  Repeat until PASS or user stops.

### Step 5 — Final response
Only after Reviewer PASS:
- Orchestrator composes the final user-facing summary (still not implementing; just presenting integrated results).
- Return final output.

---

## Output contracts (force the model to behave)
To prevent the model from “winging it,” enforce structured outputs:

### Clarifier output format
Require the Clarifier to respond in **JSON only**:

{ "status": "NEEDS_CLARIFICATION" | "CLEAR", "questions": ["..."], "clarified_request": "..." }

### Orchestrator output format
Require Orchestrator to respond in **JSON only**:

{
"tasks": [
{
"id": "T1",
"agent": "JUNIOR_DEV" | "FRONTEND_DEV" | "BACKEND_DEV" | "FULLSTACK_DEV" | "SR_FRONTEND" | "SR_BACKEND" | "SR_FULLSTACK" | "DATA_ENGINEER" | "DESIGNER" | "PROMPT_WRITER" | "DEVOPS",
"goal": "...",
"inputs": { "files": [], "constraints": [] },
"can_parallelize_with": ["T2"]
}
],
"escalation_rules_reminder": "Start low, escalate on defined signals.",
"review_instructions": "What the reviewer must check."
}

### Reviewer output format
Require Reviewer to respond in **JSON only**:

{ "status": "PASS" | "FAIL", "findings": [{ "severity": "low|med|high", "issue": "...", "fix": "...", "suggested_agent": "..." }] }

Enforcement:
- If parsing fails, your controller must re-prompt the same agent with: “Output valid JSON only, matching schema; no prose.”

---

## Copilot SDK specifics you must implement correctly

### Session creation & message sending
- Use `CopilotClient`, `start()`, and `createSession()` per the SDK.
- Use `sendAndWait()` for deterministic “wait until idle” behavior.
- Use session event handlers if you need streaming or telemetry (`assistant.message`, `session.idle`, etc.).

### Tools (delegation)
- Implement delegation using `defineTool`, with Zod schemas for parameters.
- The handler performs the real work (routing prompts to other sessions) and returns JSON-serializable results.

### System message behavior
- Default behavior appends your system message after SDK-managed sections.
- Use `mode:"replace"` only if you truly want to remove guardrails (usually you do not).

### Infinite sessions
- Default “infinite sessions” persist workspace state; you may keep enabled for long multi-step tasks.
- If you need stateless behavior, disable it explicitly.

---

## Common failure modes (and what to do instead)

### Failure: Orchestrator starts coding
Fix:
- Strengthen Orchestrator system message: “NEVER implement.”
- Add controller-side validation: if Orchestrator output contains code fences/diffs, reject and re-prompt: “You violated role boundaries—output tasks only.”

### Failure: Skipping Clarifier
Fix:
- Controller must hard-enforce Step 0.
- Never allow direct user request → Orchestrator.

### Failure: “Delegation” is just text
Fix:
- The Orchestrator must call `delegate_to_agent` tool.
- Controller rejects any plan that doesn’t include tool calls during execution.

### Failure: No review gate
Fix:
- Controller refuses to respond to user with final output unless Reviewer PASS exists.

---

## Definition of Done (DoD)
This system is implemented correctly when:
- Every request runs Clarifier first
- Orchestrator only outputs structured delegation/tasks (no implementation)
- Planner outputs a plan
- Specialists are invoked via a real tool callback
- Reviewer PASS is mandatory before final answer
- Escalation happens according to Orchestrator rules when agents struggle
- Structured JSON contracts are enforced
