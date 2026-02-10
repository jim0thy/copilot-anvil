# Copilot SDK TUI Harness — Requirements Document

> This document captures the full product requirements for the Copilot SDK TUI Harness project. It serves as the source of truth for what we're building, why, and how.

---

## Summary

Build a terminal UI (TUI) in **TypeScript** using **Ink** that wraps the **GitHub Copilot SDK** (`@github/copilot-sdk`). The app provides an interactive chat experience with **streaming assistant output**, structured logs, cancellable runs, and a foundation for future enhancements: **task management & memory**, **git support with diffs**, **GitHub PR workflows**, and a **file browser**.

The design follows **Option A**: the Copilot SDK **session** is the source of truth for conversational context, while the app maintains its own UI transcript and additional state (tasks/memory/resources).

---

## Goals

1. Provide a usable Ink-based TUI for interacting with a Copilot SDK session.
2. Support streaming output (token/delta streaming).
3. Support cancellation/interrupt of an in-flight run.
4. Emit and consume a stable internal event protocol (`HarnessEvent`) to decouple UI from Copilot SDK specifics.
5. Provide plugin-ready architecture (registries for panes/tools/state slices/commands), even if only minimally used in v0.
6. Keep codebase clean, typed, and extendable for planned enhancements.

---

## Non-Goals (v0)

* Implement full task management UI/logic beyond scaffolding.
* Implement persistent memory / embeddings / vector DB.
* Implement full git tooling, diff rendering, PR creation flows.
* Implement a file browser pane (beyond scaffolding).
* Perfect scrollback / advanced terminal UX (keep MVP simple).

---

## Target Stack

* Node.js 18+
* TypeScript + `tsx` runner
* `ink` + `react`
* `@github/copilot-sdk`

---

## High-Level Architecture

### Components

1. **Copilot Session Adapter** (`src/copilot/CopilotSessionAdapter.ts`)

    * Responsible for starting/stopping `CopilotClient`
    * Creating/resuming a `CopilotSession`
    * Subscribing to SDK events and relaying them to the harness
    * Must not contain UI code

2. **Harness (Orchestrator)** (`src/harness/`)

    * Owns internal event bus and run lifecycle
    * Stores UI transcript (user/assistant messages) for display only
    * Converts Copilot SDK events → internal `HarnessEvent`s
    * Provides `dispatch(UIAction)` interface for UI → harness commands
    * Supports plugin registry scaffolding (panes/tools/commands/state slices)

3. **Ink UI** (`src/ui/`)

    * Renders based on local state updated via harness events
    * Contains panes: Chat + Side pane (Logs) in v0
    * Uses input box to submit prompts
    * Provides keybinds: Escape quit, Ctrl+C cancel

---

## Data Contracts

### Internal Event Protocol (`HarnessEvent`)

Implemented in v0:

* `run.started { runId, createdAt }`
* `assistant.delta { runId, text }`
* `assistant.message { runId, message }`
* `log { runId, level, message, data? }`
* `run.cancelled { runId, createdAt }`
* `run.finished { runId, createdAt }`

Scaffolding types for future features:

* `resource.created { resource }`
* `permission.requested { requestId, prompt }`
* `state.updated { slice, patch }` (reserved for later)

### Transcript Model

* `ChatMessage { id, role: "user"|"assistant"|"tool"|"system", content, createdAt }`
* Transcript is for UI and persistence later; Copilot session remains the real conversational memory.

### UIAction Protocol

Implemented:

* `submit.prompt { text }`
* `cancel`

Reserved for later:

* `select.resource { uri }`
* `permission.respond { requestId, allow }`
* `approve.patch { patchId }`

---

## Functional Requirements (v0)

### FR1 — App Boot / Runtime

* `npm run dev` starts the Ink app using `tsx`.
* App loads without needing any existing code or config beyond what's in repo.

### FR2 — Copilot SDK Session Lifecycle

* On startup or first prompt, initialize Copilot SDK:
    * start `CopilotClient`
    * create a session with `streaming: true`
* Session should be reused across prompts in the same app run.

### FR3 — Prompt Submission

* User can type in an input box and submit prompt.
* Submitting triggers:
    * `run.started`
    * transcript append: user message
    * SDK `session.sendAndWait({ prompt })` (or equivalent "send then wait idle" strategy)
    * streaming deltas shown in UI as they arrive
    * final assistant message appended to transcript
    * `run.finished`

### FR4 — Streaming Output

* UI must display assistant output incrementally as it streams.
* Streaming must feel responsive (sub-100ms updates).
* When run completes, streaming buffer is committed as final assistant message.

### FR5 — Cancellation

* Ctrl+C while a run is active should cancel the run.
* Cancellation should:
    * stop streaming updates
    * emit `run.cancelled`
    * return UI to idle state
* If the SDK doesn't support aborting a single request cleanly, app should implement "best-effort cancel":
    * ignore subsequent deltas
    * optionally tear down and recreate the session if necessary (document behavior).

### FR6 — Logs Pane

* Side pane shows recent log lines (capped).
* Log important lifecycle events:
    * run started/finished/cancelled
    * SDK init failures
    * unexpected errors

### FR7 — Error Handling

* Errors should not crash the TUI.
* Errors should emit `log level=error` and end the run (`run.finished`).
* Provide actionable error messages (e.g., Copilot CLI not installed/authenticated).

---

## UX Requirements

### Layout

* Top bar: status (IDLE/RUNNING) + key hints (Esc quit, Ctrl+C cancel)
* Main area split:
    * Left: Chat transcript + streaming assistant draft
    * Right: Logs
* Bottom: input box

### Keybinds

| Key | Action |
|-----|--------|
| `Tab` | Cycle through available models |
| `Esc` | Quit the application |
| `Ctrl+C` | Cancel active run (or quit if idle) |
| `Enter` | Submit prompt |

### Message Rendering

* Minimal plain text rendering (no need for markdown parsing in v0).
* Prefix each message with role label.

---

## Extensibility Requirements (must be built into v0)

### ER1 — Plugin Registry Scaffolding

Implemented:

* A `HarnessPlugin` interface (`register(ctx)`, `onEvent?`)
* A way to `harness.use(plugin)`
* `PluginContext` exposing:
    * `emit(evt)` (required)
    * Registries for: tools, panes, state slices, commands

### ER2 — Resource Model

Defined `Resource` type (URI-based), used later by:

* git diffs: `git://diff?...`
* file browser: `file:///...`
* PRs: `github://pull/123`

No UI needed in v0, but the type exists and is plumbable via events.

### ER3 — No UI↔SDK Coupling

UI must not import `@github/copilot-sdk` directly.
All Copilot SDK interaction goes through adapter + harness.

---

## Project Structure

```
src/
  index.tsx                       # Entry point
  copilot/
    CopilotSessionAdapter.ts      # SDK wrapper
  harness/
    events.ts                     # HarnessEvent types
    Harness.ts                    # Orchestrator
    plugins.ts                    # Plugin system
  ui/
    App.tsx                       # Main Ink component
    panes/
      ChatPane.tsx
      LogsPane.tsx
      InputBar.tsx
```

---

## SDK Integration Notes

### Session Option A (Implemented)

* Only send **prompt text** to Copilot session.
* Do not attempt to "replay" full message history; the session holds it.

### Event Mapping

* Subscribe to session events and translate them into `assistant.delta`, `log`, etc.
* Use streaming event (`assistant.message_delta`) as delta source when `streaming: true`.

---

## Acceptance Criteria

* [x] `npm run dev` opens a TUI with Chat + Logs + Input.
* [x] Sending a prompt displays streaming output and then commits to transcript.
* [x] Multiple prompts in a row work in the same session.
* [x] Ctrl+C cancels an in-flight run and returns to idle without crashing.
* [x] Errors are shown in logs, and app remains usable.
* [x] Code is strongly typed, modular, and UI does not import Copilot SDK.

---

## Future Enhancements

Architecture is designed to support these future additions:

### 1. Tasks

* Tasks state slice + tools (`task.create/update/list/complete`)
* Tasks pane

### 2. Memory

* Memory provider interface (local JSON → later embeddings)
* Context injection before prompt

### 3. Git & Diffs

* Tools (`git.status`, `git.diff`, `git.commit`)
* Diff resources, approval gating

### 4. GitHub PR

* Tools (`github.createPR`, `github.updatePR`, `github.comment`)
* PR resource + pane

### 5. File Browser

* Pane to browse directories, preview files, set "selected files"
* Selection influences prompt context

---

## References

* [Copilot SDK Node.js Instructions](https://github.com/github/awesome-copilot/blob/main/instructions/copilot-sdk-nodejs.instructions.md)
* [Ink Documentation](https://github.com/vadimdemedes/ink)
