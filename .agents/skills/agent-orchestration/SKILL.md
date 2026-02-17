# SKILL: Implement the `vscode-agents` orchestration model using `@github/copilot-sdk` (Node.js)

## Purpose
You are implementing a **multi-agent development system** (Intake → Tech Lead → Strategist → Specialists → Reviewer) modeled after `simkeyur/vscode-agents`, but **running in your own Node.js process** using `@github/copilot-sdk`.

This skill exists because the agent keeps “kind of” implementing it and getting the control-flow wrong. Follow this skill **exactly**.

Reference model: the repo’s workflow explicitly starts with Intake, then Tech Lead delegates to specialized agents, and a Reviewer is the final quality gate.  
Copilot SDK primitives you must use: `CopilotClient`, `createSession`, session events, `sendAndWait`, tools via `defineTool`, and (optionally) `onUserInputRequest`/`ask_user`.

---

## Non-negotiable rules (you must comply)
1. **ALWAYS start with Intake.** No exceptions. If unclear, Intake asks targeted questions before any work proceeds.
2. **Tech Lead NEVER implements.** It only decomposes, delegates, coordinates, and escalates.
3. **Strategist produces a plan, not code.**
4. **Specialists produce work outputs.** (Code, diffs, instructions, etc.)
5. **Reviewer is mandatory** before final output to the user.
6. **Adaptive escalation:** start with the lightest competent dev agent and escalate only when needed (explicitly defined in Tech Lead).

If you violate any rule above, the implementation is wrong.

---

## What you are building (mental model)
You are building a **controller** (your Node app) that:
- Spawns and manages **one Copilot session per role** (Intake, Tech Lead, Strategist, etc.)
- Provides a **tool** the Tech Lead can use to “call” specialist agents (since outside VS Code you must implement delegation yourself)
- Enforces the exact workflow ordering and quality gate

Copilot SDK gives you:
- A long-lived `CopilotClient`
- Multiple independent sessions (`client.createSession`)
- A robust tool callback mechanism (`defineTool`) so the model can trigger deterministic host behavior

---

## Required architecture

### A. Sessions (one per agent role)
Create a session per role:
- `intakeSession`
- `techLeadSession`
- `strategistSession`
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

Critical: the Tech Lead prompt must include “NEVER implement anything yourself” and the escalation strategy wording (that’s the core behavioral constraint).

### C. The Tech Lead must delegate via a tool you provide
In VS Code, “agent calling” is a built-in capability. In Node, **you must implement it**.

Provide a tool (via `defineTool`) named, e.g., `delegate_to_agent` that:
- Accepts `{ agent: <enum>, prompt: string, context?: object }`
- Runs the chosen agent session with `sendAndWait`
- Returns the agent’s response text + metadata (agent name, timestamps)

This is not optional. Without this tool, the Tech Lead will hallucinate delegation or try to implement work itself.

---

## Exact runtime workflow (state machine)
Implement this as a strict controller loop:

### Step 0 — Clarify (always)
1. Send the user request to `intakeSession`.
2. Intake must output one of:
    - **A. “NEEDS_CLARIFICATION”** + a list of questions; OR
    - **B. “CLEAR”** + a rewritten “clarified request” the rest of the pipeline will use.

If needs clarification:
- Return questions to the user.
- STOP. Do not proceed.

### Step 1 — Orchestrate (delegate only)
Send the clarified request to `techLeadSession`.

Tech Lead must produce:
- A structured task list
- Which agents to delegate to
- Whether escalation is required
- Any parallelizable groups
- A “review package” instruction for the Reviewer

**Hard constraint:** the Tech Lead must not write code, diffs, or implementation steps beyond delegation and coordination.

### Step 2 — Plan (Strategist session)
Send the clarified request + Tech Lead task list to `strategistSession`.
Strategist returns:
- Ordered phases
- Dependencies
- Acceptance criteria / done conditions

### Step 3 — Execute tasks (Specialists)
For each task, the Tech Lead must call your `delegate_to_agent` tool.
Your Node controller will:
- Route to the correct session
- Pass required context (clarified request, plan, relevant prior outputs)
- Collect results

Parallel execution:
- Only run tasks in parallel if you can prove they don’t conflict.
- If you can’t prove that, run sequentially.

Escalation:
- If a lower-level agent reports being stuck / security concerns / architectural decision, escalate to the next agent per the Tech Lead rules.

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
- route fixes back through Tech Lead → delegate tool → specialists
- re-review
  Repeat until PASS or user stops.

### Step 5 — Final response
Only after Reviewer PASS:
- Tech Lead composes the final user-facing summary (still not implementing; just presenting integrated results).
- Return final output.

---

## Output contracts (force the model to behave)
To prevent the model from “winging it,” enforce structured outputs:

### Intake output format
Require the Intake to respond in **JSON only**:

{ "status": "NEEDS_CLARIFICATION" | "CLEAR", "questions": ["..."], "clarified_request": "..." }

### Tech Lead output format
Require Tech Lead to respond in **JSON only**:

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

### Failure: Tech Lead starts coding
Fix:
- Strengthen Tech Lead system message: “NEVER implement.”
- Add controller-side validation: if Tech Lead output contains code fences/diffs, reject and re-prompt: “You violated role boundaries—output tasks only.”

### Failure: Skipping Intake
Fix:
- Controller must hard-enforce Step 0.
- Never allow direct user request → Tech Lead.

### Failure: “Delegation” is just text
Fix:
- The Tech Lead must call `delegate_to_agent` tool.
- Controller rejects any plan that doesn’t include tool calls during execution.

### Failure: No review gate
Fix:
- Controller refuses to respond to user with final output unless Reviewer PASS exists.

---

## Definition of Done (DoD)
This system is implemented correctly when:
- Every request runs Intake first
- Tech Lead only outputs structured delegation/tasks (no implementation)
- Strategist outputs a plan
- Specialists are invoked via a real tool callback
- Reviewer PASS is mandatory before final answer
- Escalation happens according to Tech Lead rules when agents struggle
- Structured JSON contracts are enforced
