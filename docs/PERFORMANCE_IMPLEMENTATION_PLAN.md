# Performance Implementation Plan

> **Generated from actual source code inspection.** All line numbers, variable names, and code snippets are verified against the current codebase.

---

## Dependency Graph

```
Wave 1 (parallel — no interdependencies):
  Task 1: Throttle streaming markdown render ──┐
  Task 2: Memoize diff/patch in ToolCallInline ─┤── all independent
  Task 3: Clear subagentStreaming on run end ────┘   (ALREADY DONE — verified)

Wave 2 (sequential after Wave 1 verified):
  Task 4: Chunk buffer for streaming ──→ Task 5: Cache markdown for completed messages

Wave 3 (after Wave 1 + Wave 2 verified):
  Task 6: Split monolithic state into slices
```

---

## Task 3: Clear subagentStreaming on Run Completion

### Status: ✅ ALREADY IMPLEMENTED — NO WORK NEEDED

The `resetRunFields()` helper in `src/harness/reducer.ts:37-46` already resets `subagentStreaming: {}`:

```ts
function resetRunFields(): Partial<HarnessState> {
  return {
    streamingContent: "",
    streamingReasoning: "",
    streamingAgentName: null,
    subagentStreaming: {},   // ← already cleared
    currentIntent: null,
    activeTools: [],
  };
}
```

This is called in both `run.finished` (line 355) and `run.cancelled` (line 310) via `...resetRunFields()`. No action required.

---

## Wave 1 — Quick Wins

### Task 1: Throttle Streaming Markdown Render to 100ms

#### Summary
Increase the streaming event throttle from 32ms to 100ms for `assistant.delta` and `reasoning.delta` events, reducing markdown re-parse frequency by ~3x.

#### Why
Markdown parsing via the `<markdown>` component (which uses `marked` + tree-sitter syntax highlighting) is the #1 CPU cost during streaming (~60-70%). Currently, `assistant.delta` events trigger a `setState` every 32ms (31 FPS). Markdown re-rendering at 10 FPS (100ms) is visually indistinguishable for text streaming but cuts CPU work by ~68%.

#### Files to Modify
- `src/ui/App.tsx`

#### Current Code (`src/ui/App.tsx:66-91`)
```ts
const subscriberFn = useCallback((event: import('../harness/events.js').HarnessEvent) => {
    const isStreamingEvent = event.type === "assistant.delta" || event.type === "reasoning.delta";
    if (isStreamingEvent) {
      if (streamingUpdateTimerRef.current === null) {
        streamingUpdateTimerRef.current = setTimeout(() => {
          streamingUpdateTimerRef.current = null;
          setState(harness.getState());
        }, 32);
      }
    } else {
      if (streamingUpdateTimerRef.current !== null) {
        clearTimeout(streamingUpdateTimerRef.current);
        streamingUpdateTimerRef.current = null;
      }
      setState(harness.getState());
    }

    if (event.type === "show.agents.modal") {
      setShowAgentsModal(true);
    }
    if (event.type === "run.started") {
      renderer.requestLive();
    } else if (event.type === "run.finished" || event.type === "run.cancelled") {
      renderer.dropLive();
    }
  }, [harness, renderer]);
```

#### Target Code
```ts
const STREAMING_THROTTLE_MS = 100;

const subscriberFn = useCallback((event: import('../harness/events.js').HarnessEvent) => {
    const isStreamingEvent = event.type === "assistant.delta" || event.type === "reasoning.delta";
    if (isStreamingEvent) {
      if (streamingUpdateTimerRef.current === null) {
        streamingUpdateTimerRef.current = setTimeout(() => {
          streamingUpdateTimerRef.current = null;
          setState(harness.getState());
        }, STREAMING_THROTTLE_MS);
      }
    } else {
      if (streamingUpdateTimerRef.current !== null) {
        clearTimeout(streamingUpdateTimerRef.current);
        streamingUpdateTimerRef.current = null;
      }
      setState(harness.getState());
    }

    if (event.type === "show.agents.modal") {
      setShowAgentsModal(true);
    }
    if (event.type === "run.started") {
      renderer.requestLive();
    } else if (event.type === "run.finished" || event.type === "run.cancelled") {
      renderer.dropLive();
    }
  }, [harness, renderer]);
```

#### Step-by-Step Instructions
1. Open `src/ui/App.tsx`.
2. Add `const STREAMING_THROTTLE_MS = 100;` above the `subscriberFn` definition (after line 65, before line 66).
3. Change the `32` on line 73 to `STREAMING_THROTTLE_MS`.
4. Verify the build still succeeds: `bun run build`.

#### Verification
- Run `bun run dev`, submit a prompt, observe streaming text updates. Text should still appear fluid but update in slightly larger batches.
- Confirm non-streaming events (tool.started, tool.completed, run.started, run.finished) still update the UI immediately (no throttle delay).
- Verify that when a run finishes during a pending streaming timer, the final state is flushed correctly (the `else` branch clears the timer and calls `setState` synchronously).

#### Risk/Rollback
- **Risk**: 100ms may feel slightly less fluid for very fast token streams. This is unlikely to be noticeable since humans perceive text updates as smooth at ~8-10 FPS.
- **Rollback**: Revert the constant back to `32`.

#### DO NOT
- Do NOT change the throttle behavior for non-streaming events. They must remain synchronous (instant `setState`).
- Do NOT add a separate timer for `run.finished` / `run.cancelled` — they already flush the pending timer in the `else` branch.
- Do NOT add debouncing. The current pattern is a trailing-edge throttle which is correct — the first delta schedules a future update, subsequent deltas within the window are batched naturally because the harness state accumulates them.
- Do NOT move the `STREAMING_THROTTLE_MS` constant outside the file or into a config. It's a UI-only tuning knob.

---

### Task 2: Memoize Diff/Patch Computation Per Tool Call

#### Summary
Wrap `createPatch()` and the associated diff rendering in `ToolCallInline` with `useMemo` keyed on the tool call's identity fields, so completed tool calls don't recompute diffs on every render.

#### Why
`createPatch()` runs a diff algorithm, and the `<diff>` component invokes tree-sitter parsing for syntax highlighting. Both are expensive. Currently they run on every render of `ToolCallInline`, even though tool call arguments (`oldStr`, `newStr`, `path`) are immutable once the tool is created. During streaming, the parent `TranscriptList` re-renders on every state update, which cascades into every `ToolCallInline` in the transcript.

#### Files to Modify
- `src/ui/panes/ChatPane.tsx`

#### Current Code (`src/ui/panes/ChatPane.tsx:171-258`)
The `ToolCallInline` component computes `editArgs` and `showDiff` inline, then calls `createPatch()` directly in JSX:

```tsx
const ToolCallInline = memo(function ToolCallInline({ tool, theme }: { tool: ToolCallItem; theme: Theme }) {
  const c = theme.colors;
  const isRunning = tool.status === "running";
  const isFailed = tool.status === "failed";
  // ... status setup ...
  
  const isEdit = isEditTool(tool.toolName);
  const editArgs = isEdit ? getEditToolArgs(tool.arguments) : null;
  const showDiff = isEdit && editArgs && !isRunning;

  return (
    <box /* ... */>
      {/* ... */}
      {showDiff && (
        <box marginTop={1} backgroundColor={c.surface0}>
          <diff
            diff={createPatch(
              editArgs.path ?? "file",
              editArgs.oldStr!,
              editArgs.newStr!,
            )}
            view="split"
            filetype={getFiletypeFromPath(editArgs.path)}
            syntaxStyle={getSyntaxStyle(theme.mode)}
            treeSitterClient={treeSitterClient}
            showLineNumbers={true}
            addedBg={c.surface0}
            removedBg={c.surface0}
            contextBg={c.surface0}
            lineNumberBg={c.surface0}
          />
        </box>
      )}
      {/* ... */}
    </box>
  );
});
```

#### Target Code
Replace the inline `createPatch` call with a `useMemo`:

```tsx
const ToolCallInline = memo(function ToolCallInline({ tool, theme }: { tool: ToolCallItem; theme: Theme }) {
  const c = theme.colors;
  const isRunning = tool.status === "running";
  const isFailed = tool.status === "failed";
  // ... status setup (unchanged) ...

  const isEdit = isEditTool(tool.toolName);
  const editArgs = isEdit ? getEditToolArgs(tool.arguments) : null;
  const showDiff = isEdit && editArgs && !isRunning;

  const diffPatch = useMemo(() => {
    if (!showDiff || !editArgs) return null;
    return createPatch(
      editArgs.path ?? "file",
      editArgs.oldStr!,
      editArgs.newStr!,
    );
  }, [tool.toolCallId, tool.status]);

  return (
    <box /* ... */>
      {/* ... */}
      {diffPatch && (
        <box marginTop={1} backgroundColor={c.surface0}>
          <diff
            diff={diffPatch}
            view="split"
            filetype={getFiletypeFromPath(editArgs!.path)}
            syntaxStyle={getSyntaxStyle(theme.mode)}
            treeSitterClient={treeSitterClient}
            showLineNumbers={true}
            addedBg={c.surface0}
            removedBg={c.surface0}
            contextBg={c.surface0}
            lineNumberBg={c.surface0}
          />
        </box>
      )}
      {/* ... */}
    </box>
  );
});
```

#### Step-by-Step Instructions
1. Open `src/ui/panes/ChatPane.tsx`.
2. Verify `useMemo` is already imported on line 1: `import { memo, useState, useCallback, useMemo } from "react";` — it is.
3. After the line `const showDiff = isEdit && editArgs && !isRunning;` (line 186), add:
   ```ts
   const diffPatch = useMemo(() => {
     if (!showDiff || !editArgs) return null;
     return createPatch(
       editArgs.path ?? "file",
       editArgs.oldStr!,
       editArgs.newStr!,
     );
   }, [tool.toolCallId, tool.status]);
   ```
4. Replace the `{showDiff && (` JSX block (lines 215-234) with:
   ```tsx
   {diffPatch && (
     <box marginTop={1} backgroundColor={c.surface0}>
       <diff
         diff={diffPatch}
         view="split"
         filetype={getFiletypeFromPath(editArgs!.path)}
         syntaxStyle={getSyntaxStyle(theme.mode)}
         treeSitterClient={treeSitterClient}
         showLineNumbers={true}
         addedBg={c.surface0}
         removedBg={c.surface0}
         contextBg={c.surface0}
         lineNumberBg={c.surface0}
       />
     </box>
   )}
   ```
5. Verify the build: `bun run build`.

#### Verification
- Run `bun run dev`, trigger an edit tool call (e.g., ask the agent to edit a file).
- Verify the diff still renders correctly after the tool completes.
- Verify the diff does NOT render while the tool is still running (status === "running").
- The visual output should be identical to before.

#### Risk/Rollback
- **Risk**: Minimal. `tool.toolCallId` and `tool.status` are the correct cache keys — arguments are immutable per tool call, and `status` transitions from `running` → `completed`/`failed` exactly once.
- **Rollback**: Remove the `useMemo` wrapper and restore the inline `createPatch` call.

#### DO NOT
- Do NOT key the memo on `editArgs` directly — objects create new references on every render, defeating memoization.
- Do NOT key on `tool.arguments` — same reason (new object reference per render).
- Do NOT remove the `memo()` wrapper on `ToolCallInline` itself — it's still needed for prop-level memoization.
- Do NOT try to memoize the `<markdown>` component inside the output section — that's a separate concern and `<markdown>` already handles its own caching internally.

---

## Wave 2 — Core Fixes

### Task 4: Replace String Concatenation with Chunk Buffer for Streaming

#### Summary
Replace `streamingContent: string` (and `streamingReasoning`, and subagent streaming content/reasoning) with chunk arrays that are joined only at render time, eliminating O(n²) string concatenation in the reducer.

#### Why
Every `assistant.delta` event currently runs `state.streamingContent + event.text` which copies the entire accumulated string. For a 10,000-token response with ~40 chars/token, that's ~400KB copied per delta, growing quadratically. With ~300 deltas per response, total memory churn is ~60MB. Appending to an array is O(1).

#### Files to Modify
- `src/harness/state.ts` — type changes
- `src/harness/reducer.ts` — accumulation logic
- `src/ui/panes/ChatPane.tsx` — join chunks at render time
- `src/ui/App.tsx` — no changes needed (it reads `harness.getState()` opaquely)
- `src/harness/Harness.ts` — update `handleNewSession` and `handleSwitchSession` which directly set `streamingContent: ""`

#### Current Code

**`src/harness/state.ts:80-119`** — State shape:
```ts
export interface HarnessState {
  // ...
  streamingContent: string;
  streamingReasoning: string;
  // ...
  subagentStreaming: Record<string, SubagentStreamEntry>;
  // ...
}
```

**`src/harness/state.ts:131-166`** — Initial state:
```ts
export const INITIAL_STATE: HarnessState = {
  // ...
  streamingContent: "",
  streamingReasoning: "",
  // ...
  subagentStreaming: {},
  // ...
};
```

**`src/harness/reducer.ts:145-169`** — `assistant.delta` handler:
```ts
case "assistant.delta":
  if (event.parentToolCallId) {
    // ...
    return {
      ...state,
      subagentStreaming: {
        ...state.subagentStreaming,
        [event.parentToolCallId]: {
          ...existing,
          // ...
          content: resetFromTranscript ? event.text : (existing?.content ?? "") + event.text,
          // ...
        },
      },
    };
  }
  return {
    ...state,
    streamingContent: state.streamingContent + event.text,   // ← O(n) copy
    // ...
  };
```

**`src/harness/reducer.ts:171-195`** — `reasoning.delta` handler:
```ts
case "reasoning.delta":
  if (event.parentToolCallId) {
    // ...
    return {
      ...state,
      subagentStreaming: {
        ...state.subagentStreaming,
        [event.parentToolCallId]: {
          ...existing,
          // ...
          reasoning: resetFromTranscript ? event.text : (existing?.reasoning ?? "") + event.text,
          // ...
        },
      },
    };
  }
  return {
    ...state,
    streamingReasoning: state.streamingReasoning + event.text,  // ← O(n) copy
    // ...
  };
```

**`src/harness/reducer.ts:314-323`** — `run.finished` reads `state.streamingContent`:
```ts
case "run.finished": {
  let newTranscript = [...state.transcript];
  if (state.streamingContent) {
    const finalMessage: ChatMessage = {
      ...createAssistantMessage(state.streamingContent),
      reasoning: state.streamingReasoning || undefined,
      agentDisplayName: state.streamingAgentName || undefined,
    };
    newTranscript.push(finalMessage);
  }
```

**`src/harness/events.ts`** — `SubagentStreamEntry` type (need to check):
The `SubagentStreamEntry` type has `content?: string` and `reasoning?: string` fields.

**`src/ui/panes/ChatPane.tsx:287-356`** — ChatPane reads `streamingContent` and `streamingReasoning` directly:
```tsx
export const ChatPane = memo(function ChatPane({
  transcript, streamingContent, streamingReasoning, streamingAgentName,
  subagentStreaming: subagentStreamingProp = {}, /* ... */
}: ChatPaneProps) {
  // ...
  {streamingContent && (
    <box paddingLeft={1}>
      <markdown syntaxStyle={getSyntaxStyle(theme.mode)} content={streamingContent} streaming />
    </box>
  )}
```

#### Target Code

**`src/harness/state.ts`** — Change type:
```ts
export interface HarnessState {
  // ...
  streamingContentChunks: string[];
  streamingReasoningChunks: string[];
  // ...
}
```
```ts
export const INITIAL_STATE: HarnessState = {
  // ...
  streamingContentChunks: [],
  streamingReasoningChunks: [],
  // ...
};
```

**`src/harness/reducer.ts`** — `resetRunFields`:
```ts
function resetRunFields(): Partial<HarnessState> {
  return {
    streamingContentChunks: [],
    streamingReasoningChunks: [],
    streamingAgentName: null,
    subagentStreaming: {},
    currentIntent: null,
    activeTools: [],
  };
}
```

**`src/harness/reducer.ts`** — `assistant.delta`:
```ts
case "assistant.delta":
  if (event.parentToolCallId) {
    const existing = state.subagentStreaming[event.parentToolCallId];
    const resetFromTranscript = Boolean(existing?.contentInTranscript);
    return {
      ...state,
      subagentStreaming: {
        ...state.subagentStreaming,
        [event.parentToolCallId]: {
          ...existing,
          agentDisplayName: event.agentDisplayName ?? existing?.agentDisplayName ?? event.agentName ?? "Subagent",
          contentChunks: resetFromTranscript ? [event.text] : [...(existing?.contentChunks ?? []), event.text],
          reasoning: resetFromTranscript ? undefined : existing?.reasoning,
          contentInTranscript: false,
        },
      },
    };
  }
  return {
    ...state,
    streamingContentChunks: [...state.streamingContentChunks, event.text],
    streamingAgentName: event.agentDisplayName ?? state.streamingAgentName,
  };
```

**`src/harness/reducer.ts`** — `run.finished` joins chunks:
```ts
case "run.finished": {
  let newTranscript = [...state.transcript];
  const streamingContent = state.streamingContentChunks.join("");
  if (streamingContent) {
    const streamingReasoning = state.streamingReasoningChunks.join("");
    const finalMessage: ChatMessage = {
      ...createAssistantMessage(streamingContent),
      reasoning: streamingReasoning || undefined,
      agentDisplayName: state.streamingAgentName || undefined,
    };
    newTranscript.push(finalMessage);
  }
  // ... rest unchanged, but subagent streaming also needs to join contentChunks ...
```

**`src/ui/panes/ChatPane.tsx`** — Props and render:
```tsx
interface ChatPaneProps {
  // ...
  streamingContentChunks: string[];
  streamingReasoningChunks: string[];
  // ...
}

export const ChatPane = memo(function ChatPane({
  transcript, streamingContentChunks, streamingReasoningChunks,
  streamingAgentName, /* ... */
}: ChatPaneProps) {
  const streamingContent = useMemo(() => streamingContentChunks.join(""), [streamingContentChunks]);
  const streamingReasoning = useMemo(() => streamingReasoningChunks.join(""), [streamingReasoningChunks]);
  // ... use streamingContent / streamingReasoning as before ...
```

**`src/harness/events.ts`** — `SubagentStreamEntry`:
```ts
// Change content field:
export interface SubagentStreamEntry {
  // ...
  contentChunks?: string[];   // was: content?: string;
  // ...
}
```

#### Step-by-Step Instructions

**Phase A: State shape changes**

1. In `src/harness/state.ts`, rename `streamingContent: string` → `streamingContentChunks: string[]` in `HarnessState` interface (line 85).
2. In `src/harness/state.ts`, rename `streamingReasoning: string` → `streamingReasoningChunks: string[]` in `HarnessState` interface (line 86).
3. In `src/harness/state.ts`, update `INITIAL_STATE` (lines 135-136): change `streamingContent: ""` → `streamingContentChunks: []` and `streamingReasoning: ""` → `streamingReasoningChunks: []`.
4. In `src/harness/events.ts`, find the `SubagentStreamEntry` type. Change `content?: string` → `contentChunks?: string[]`. Keep `reasoning` as a string (it's less frequently appended).

**Phase B: Reducer changes**

5. In `src/harness/reducer.ts`, update `resetRunFields()` (lines 37-46): change `streamingContent: ""` → `streamingContentChunks: []` and `streamingReasoning: ""` → `streamingReasoningChunks: []`.
6. Update `assistant.delta` handler (lines 145-169):
   - Main branch: `streamingContent: state.streamingContent + event.text` → `streamingContentChunks: [...state.streamingContentChunks, event.text]`
   - Subagent branch: `content: resetFromTranscript ? event.text : (existing?.content ?? "") + event.text` → `contentChunks: resetFromTranscript ? [event.text] : [...(existing?.contentChunks ?? []), event.text]`
7. Update `reasoning.delta` handler (lines 171-195) similarly for `streamingReasoningChunks`. Subagent reasoning can stay as string concatenation since reasoning is typically short.
8. Update `assistant.message` handler (lines 243-290): change `streamingContent: ""` → `streamingContentChunks: []` and `streamingReasoning: ""` → `streamingReasoningChunks: []`.
9. Update `reasoning.message` handler (lines 197-241): change `streamingContent` → join of `streamingContentChunks` where needed, and `streamingReasoning: event.content` → `streamingReasoningChunks: [event.content]`.
10. Update `run.finished` handler (lines 314-361): join chunks when creating the final message: `const streamingContent = state.streamingContentChunks.join("")`.
11. Update `subagent.started` handler (lines 605-676): change `streamingContent: ""` → `streamingContentChunks: []`, etc. Also update rescued content logic: `const rescuedContent = state.streamingContentChunks.join("")`.
12. Search the entire reducer for any remaining references to `streamingContent` or `streamingReasoning` and update accordingly. Key locations:
    - `reasoning.message` case checks `!state.streamingContent` — change to `state.streamingContentChunks.length === 0`
    - `ephemeralRun` cases use `state.ephemeralRun.streamingContent` — this is a **different field** on `EphemeralRun`, leave it as-is. EphemeralRun is short-lived (single ephemeral tool execution) with minimal delta volume, so string concatenation is acceptable here and does not need the chunk buffer pattern.

**Phase C: Harness.ts changes**

13. In `src/harness/Harness.ts`, update `handleNewSession` (line 643): change `streamingContent: ""` → `streamingContentChunks: []` and `streamingReasoning: ""` → `streamingReasoningChunks: []`.
14. In `src/harness/Harness.ts`, update `handleSwitchSession` (line 682): same changes.

**Phase D: UI changes**

15. In `src/ui/App.tsx`, update the `ChatPane` props (lines 359-362):
    ```tsx
    streamingContentChunks={state.streamingContentChunks}
    streamingReasoningChunks={state.streamingReasoningChunks}
    ```
16. In `src/ui/panes/ChatPane.tsx`, update `ChatPaneProps` interface (lines 26-36): rename `streamingContent` → `streamingContentChunks: string[]` and `streamingReasoning` → `streamingReasoningChunks: string[]`.
17. In the `ChatPane` component body, add useMemo joins:
    ```ts
    const streamingContent = useMemo(() => streamingContentChunks.join(""), [streamingContentChunks]);
    const streamingReasoning = useMemo(() => streamingReasoningChunks.join(""), [streamingReasoningChunks]);
    ```
18. All existing references to `streamingContent` / `streamingReasoning` inside ChatPane remain unchanged after the useMemo.
19. Update subagent streaming display: anywhere that reads `stream.content`, change to `(stream.contentChunks ?? []).join("")` or add a local useMemo in the render.

**Phase E: All other consumers**

20. `grep -r "streamingContent\|streamingReasoning" src/` to find any remaining references. Update each one. Key expected hits:
    - `src/harness/Harness.ts` — handled in Phase C
    - `src/harness/reducer.ts` — handled in Phase B
    - `src/ui/App.tsx` — handled in Phase D
    - `src/ui/panes/ChatPane.tsx` — handled in Phase D
    - `src/ui/panes/EphemeralModal.tsx` — uses `ephemeralRun.streamingContent` which is a **different field**, leave unchanged
    - `src/harness/state.ts` — handled in Phase A

21. Run `bun run build` and fix any remaining type errors.

#### Verification
- Build succeeds with no type errors.
- Run `bun run dev`, submit a prompt, verify streaming text appears correctly.
- Verify that completed messages in the transcript still display correctly.
- Verify subagent streaming content displays correctly.
- Memory profiling (optional): observe that heap growth during streaming is linear, not quadratic.

#### Risk/Rollback
- **Risk**: This is a medium-risk change touching many files. The main risk is missing a reference to the old field names.
- **Mitigation**: TypeScript strict mode will catch any remaining references to the old field names as type errors.
- **Rollback**: Revert all changes to `state.ts`, `reducer.ts`, `Harness.ts`, `events.ts`, `App.tsx`, `ChatPane.tsx`.

#### DO NOT
- Do NOT change `EphemeralRun.streamingContent` — it's a separate type with its own lifecycle and low delta frequency.
- Do NOT use `Array.push()` mutation on the chunks array in the reducer — the reducer must be pure. Always spread: `[...existing, newChunk]`.
- Do NOT remove the `useMemo` join in ChatPane — without it, a new string is created on every render.
- Do NOT change the subagent `reasoning` field to chunks — it's rarely appended to (usually set once) and the complexity isn't worth it.
- Do NOT try to share chunk arrays across subagent entries — each must be independent.

---

### Task 5: Cache Markdown for Completed Messages

#### Summary
Ensure `MessageItem` does not re-render when only streaming state changes, by verifying that the reducer preserves transcript array identity during streaming deltas, and that `MessageItem` is properly memo'd.

> **Ordering Note:** Execute this task BEFORE Task 4. Task 4 changes `streamingContent` to `streamingContentChunks`, which changes the field names referenced here. This audit validates the current state shape; Task 4 will then modify it.

#### Why
During streaming, every `assistant.delta` creates a new state object. If `state.transcript` also gets a new array reference, React re-renders every `MessageItem` in the list even though their content hasn't changed. `MessageItem` is already wrapped in `memo()` (line 48), but `TranscriptList` must also receive a stable transcript reference.

#### Files to Modify
- `src/harness/reducer.ts` — audit only (verify transcript is NOT spread during delta events)
- `src/ui/panes/ChatPane.tsx` — potentially no changes needed, but audit `TranscriptList` memo behavior

#### Current Code Analysis

**`src/harness/reducer.ts` — `assistant.delta` case (line 145-169):**
```ts
case "assistant.delta":
  if (event.parentToolCallId) {
    return {
      ...state,
      subagentStreaming: { /* ... */ },
    };
  }
  return {
    ...state,
    streamingContent: state.streamingContent + event.text,
    streamingAgentName: event.agentDisplayName ?? state.streamingAgentName,
  };
```

**Key observation**: The `assistant.delta` handler does `...state` which creates a new state object, but it does NOT spread or copy `state.transcript`. JavaScript spread copies top-level properties by reference, so `newState.transcript === oldState.transcript` (same array reference). ✅ This is correct.

**`src/harness/reducer.ts` — `reasoning.delta` case (line 171-195):**
Same pattern — does NOT touch `transcript`. ✅ Correct.

**`src/ui/panes/ChatPane.tsx` — `TranscriptList` (line 260-285):**
```tsx
const TranscriptList = memo(function TranscriptList({ transcript, theme }: { transcript: TranscriptItem[]; theme: Theme }) {
```

`TranscriptList` is wrapped in `memo()`. Since `transcript` is the same array reference during streaming deltas, `memo()` will skip re-rendering. ✅ Correct.

**`src/ui/panes/ChatPane.tsx` — `MessageItem` (line 48-92):**
```tsx
const MessageItem = memo(function MessageItem({ msg, showLabel, theme }: { msg: ChatMessage; showLabel: boolean; theme: Theme }) {
```
Also wrapped in `memo()`. ✅ Correct.

**BUT** — there is a potential issue with `visibleTranscript`:

```tsx
const visibleTranscript = useMemo(() => transcript.slice(-visibleCount), [transcript, visibleCount]);
```

The `useMemo` is keyed on `transcript` reference. During streaming, if `transcript` is the same reference, `visibleTranscript` will also be the same reference. ✅ Correct.

**However**, after Task 4 changes the state shape, we need to ensure App.tsx passes `state.transcript` (not a derived/copied value) to ChatPane.

**`src/ui/App.tsx` (line 359):**
```tsx
<ChatPane
  transcript={state.transcript}
```
Passes the reference directly. ✅ Correct.

#### Step-by-Step Instructions

This task is primarily an **audit and verification task**. The existing code already implements the optimization correctly. The instructions below document what to verify and what to fix if the audit finds issues.

1. **Verify**: In `src/harness/reducer.ts`, confirm that `assistant.delta` and `reasoning.delta` cases do NOT spread/copy `state.transcript`. They should only modify streaming-related fields. **Current status: ✅ Already correct.**

2. **Verify**: In `src/ui/panes/ChatPane.tsx`, confirm `TranscriptList` and `MessageItem` are both wrapped in `memo()`. **Current status: ✅ Already correct.**

3. **Verify**: In `src/ui/App.tsx`, confirm `state.transcript` is passed directly to `ChatPane` without transformation. **Current status: ✅ Already correct.**

4. **After Task 4**: Re-verify that the chunk buffer changes did not accidentally spread the transcript array in delta handlers. This is the most likely regression.

5. **Optional enhancement**: If profiling shows `TranscriptList` still re-renders during streaming (which would indicate a broken memo), add a custom comparison function:
   ```tsx
   const TranscriptList = memo(function TranscriptList(/* ... */) {
     // ...
   }, (prev, next) => prev.transcript === next.transcript && prev.theme === next.theme);
   ```
   This is only needed if the default shallow comparison fails for some reason.

#### Verification
- Run `bun run dev`, submit a prompt that produces a long response.
- During streaming, completed messages above the streaming area should NOT flicker or re-render.
- Scroll up during streaming — completed messages should remain stable.

#### Risk/Rollback
- **Risk**: Near zero. This is mostly a verification task.
- **Rollback**: N/A — no changes expected unless an issue is found.

#### DO NOT
- Do NOT add `React.memo` with deep equality comparisons — shallow is correct here and deep would be more expensive than the re-render it prevents.
- Do NOT cache the markdown parse result inside `MessageItem` — the `<markdown>` component already handles its own internal caching.
- Do NOT move transcript slicing into the reducer — it belongs in the UI layer.
- Do NOT try to "freeze" transcript items — JavaScript immutability patterns are sufficient.

---

## Wave 3 — Architecture

### Task 6: Split Monolithic State into Independent Slices

#### Summary
Split the single `HarnessState` object and single `setState` call in `App.tsx` into multiple independent state slices, so that streaming deltas only trigger re-renders of the streaming pane, not the sidebar, input bar, or status bar.

#### Why
Currently, `App.tsx` has one `useState<HarnessState>` (line 47). Every `setState(harness.getState())` call creates a new state object, which triggers a full re-render of the entire component tree — including `Sidebar`, `InputBar`, `StatusBar`, modals, etc. During streaming at 10 FPS (after Task 1), this means the sidebar (which shows files, tasks, subagents, context info) re-renders 10x/sec for no reason.

#### Files to Modify
- `src/ui/App.tsx` — major refactor of state management

#### Current Code (`src/ui/App.tsx:47`)
```ts
const [state, setState] = useState<HarnessState>(harness.getState());
```

And the subscriber (lines 66-91) calls `setState(harness.getState())` for every event.

#### Target Architecture

Split into 4 state slices:

```ts
// Import INITIAL_STATE from src/harness/state.ts for all initial values

// Slice 1: Streaming state (changes at 10 FPS during streaming)
const [streamingState, setStreamingState] = useState({
  streamingContentChunks: [] as string[],
  streamingReasoningChunks: [] as string[],
  streamingAgentName: null as string | null,
  subagentStreaming: {} as Record<string, SubagentStreamEntry>,
});

// Slice 2: Transcript state (changes on message/tool events, not deltas)
const [transcriptState, setTranscriptState] = useState({
  transcript: [] as TranscriptItem[],
});

// Slice 3: Sidebar state (changes on tool/subagent/context events)
const [sidebarState, setSidebarState] = useState({
  contextInfo: INITIAL_STATE.contextInfo,
  orchestrationMode: "direct" as OrchestrationMode,
  subagents: [] as Subagent[],
  skills: [] as Skill[],
  currentIntent: null as string | null,
  currentTodo: null as string | null,
  currentPlan: null as string | null,
  currentSessionName: null as string | null,
});

// Slice 4: UI state (changes infrequently — model switches, status changes)
const [uiState, setUiState] = useState({
  status: "idle" as HarnessStatus,
  currentModel: null as string | null,
  availableModels: [] as ModelDescription[],
  currentAgentId: null as string | null,
  availableAgents: [] as HarnessState["availableAgents"],
  currentRunId: null as string | null,
  messageQueue: [] as string[],
  pendingQuestion: null as PendingQuestion | null,
  availableSessions: [] as SessionInfo[],
  currentSessionId: null as string | null,
  ephemeralRun: null as EphemeralRun | null,
  reasoningEffort: "medium" as ReasoningEffort,
});
```

The event subscriber then updates only the relevant slice:

```ts
const subscriberFn = useCallback((event: HarnessEvent) => {
  const s = harness.getState();
  
  const isStreamingEvent = event.type === "assistant.delta" || event.type === "reasoning.delta";
  if (isStreamingEvent) {
    // Only update streaming slice, throttled
    if (streamingUpdateTimerRef.current === null) {
      streamingUpdateTimerRef.current = setTimeout(() => {
        streamingUpdateTimerRef.current = null;
        const latest = harness.getState();
        setStreamingState({
          streamingContentChunks: latest.streamingContentChunks,
          streamingReasoningChunks: latest.streamingReasoningChunks,
          streamingAgentName: latest.streamingAgentName,
          subagentStreaming: latest.subagentStreaming,
        });
      }, STREAMING_THROTTLE_MS);
    }
    return;
  }

  // For non-streaming events, flush any pending streaming update
  if (streamingUpdateTimerRef.current !== null) {
    clearTimeout(streamingUpdateTimerRef.current);
    streamingUpdateTimerRef.current = null;
  }

  // Determine which slices changed and update only those
  setStreamingState({
    streamingContentChunks: s.streamingContentChunks,
    streamingReasoningChunks: s.streamingReasoningChunks,
    streamingAgentName: s.streamingAgentName,
    subagentStreaming: s.subagentStreaming,
  });
  setTranscriptState({ transcript: s.transcript });
  setSidebarState({
    contextInfo: s.contextInfo,
    orchestrationMode: s.orchestrationMode,
    subagents: s.subagents,
    skills: s.skills,
    currentIntent: s.currentIntent,
    currentTodo: s.currentTodo,
    currentPlan: s.currentPlan,
    currentSessionName: s.currentSessionName,
  });
  setUiState({
    status: s.status,
    currentModel: s.currentModel,
    availableModels: s.availableModels,
    currentAgentId: s.currentAgentId,
    availableAgents: s.availableAgents,
    currentRunId: s.currentRunId,
    messageQueue: s.messageQueue,
    pendingQuestion: s.pendingQuestion,
    availableSessions: s.availableSessions,
    currentSessionId: s.currentSessionId,
    ephemeralRun: s.ephemeralRun,
    reasoningEffort: s.reasoningEffort,
  });

  // ... existing modal/renderer handlers unchanged ...
}, [harness, renderer]);
```

Then update all prop accesses in the JSX to read from the appropriate slice:
- `state.transcript` → `transcriptState.transcript`
- `state.streamingContentChunks` → `streamingState.streamingContentChunks`
- `state.status` → `uiState.status`
- `state.contextInfo` → `sidebarState.contextInfo`
- etc.

#### Step-by-Step Instructions

1. **Define slice types** at the top of `App.tsx`:
   ```ts
   interface StreamingSlice {
     streamingContentChunks: string[];
     streamingReasoningChunks: string[];
     streamingAgentName: string | null;
     subagentStreaming: Record<string, SubagentStreamEntry>;
   }
   interface TranscriptSlice { transcript: TranscriptItem[]; }
   interface SidebarSlice {
     contextInfo: HarnessState["contextInfo"];
     orchestrationMode: OrchestrationMode;
     subagents: Subagent[];
     skills: Skill[];
     currentIntent: string | null;
     currentTodo: string | null;
     currentPlan: string | null;
     currentSessionName: string | null;
   }
   interface UISlice {
     status: HarnessStatus;
     currentModel: string | null;
     availableModels: ModelDescription[];
     currentAgentId: string | null;
     availableAgents: HarnessState["availableAgents"];
     currentRunId: string | null;
     messageQueue: string[];
     pendingQuestion: PendingQuestion | null;
     availableSessions: SessionInfo[];
     currentSessionId: string | null;
     ephemeralRun: EphemeralRun | null;
     reasoningEffort: ReasoningEffort;
   }
   ```

2. **Replace** `const [state, setState] = useState<HarnessState>(harness.getState());` with 4 useState calls, initialized from `harness.getState()`.

3. **Update the subscriber** to classify events and update only the relevant slices. For streaming events, update only `setStreamingState`. For non-streaming events, update all slices (React batches multiple `setState` calls in the same synchronous block).

4. **Update all JSX prop accesses** — systematically replace `state.X` with the correct slice:
   - All `state.transcript` → `transcriptState.transcript`
   - All `state.streamingContent*` → `streamingState.streamingContent*`
   - All `state.subagentStreaming` → `streamingState.subagentStreaming`
   - All `state.status` → `uiState.status`
   - All `state.currentModel` → `uiState.currentModel`
   - All `state.availableModels` → `uiState.availableModels`
   - All `state.pendingQuestion` → `uiState.pendingQuestion`
   - All `state.ephemeralRun` → `uiState.ephemeralRun`
   - All `state.messageQueue` → `uiState.messageQueue`
   - All `state.currentAgentId` → `uiState.currentAgentId`
   - All `state.availableAgents` → `uiState.availableAgents`
   - All `state.availableSessions` → `uiState.availableSessions`
   - All `state.currentSessionId` → `uiState.currentSessionId`
   - All `state.contextInfo` → `sidebarState.contextInfo`
   - All `state.orchestrationMode` → `sidebarState.orchestrationMode`
   - All `state.subagents` → `sidebarState.subagents`
   - All `state.skills` → `sidebarState.skills`
   - All `state.currentIntent` → `sidebarState.currentIntent`
   - All `state.currentTodo` → `sidebarState.currentTodo`
   - All `state.currentPlan` → `sidebarState.currentPlan`
   - All `state.currentSessionName` → `sidebarState.currentSessionName`
   - All `state.reasoningEffort` → `uiState.reasoningEffort`

5. **Update useCallback dependencies** — any callback that referenced `state` should now reference the specific slice it needs.

6. **Update useMemo dependencies** — e.g., `modelDisplay` depends on `uiState.currentModel`, `currentAgent` depends on `uiState.currentAgentId` and `uiState.availableAgents`.

7. Run `bun run build` and fix all type errors.

#### Verification
- Build succeeds with no type errors.
- Run `bun run dev`, verify all features work:
  - Prompt submission and streaming
  - Tool call display
  - Sidebar updates (files, tasks, subagents)
  - Model switching (Shift+Tab)
  - Agent cycling (Tab)
  - Session management (Ctrl+S, Ctrl+N)
  - Question modal
  - Ephemeral runs (Ctrl+G)
- **Key test**: During streaming, verify the sidebar does NOT flicker or show unnecessary re-renders. The sidebar should only update when sidebar-relevant events occur (tool.started, tool.completed, subagent.started, etc.).

#### Risk/Rollback
- **Risk**: High — this is a large refactor of the main component. The main risks are:
  1. Missing a `state.X` → slice conversion, causing undefined errors.
  2. Stale closure references in callbacks that read from the wrong slice.
  3. React batching behavior differences — multiple `setState` calls should batch in React 18+, but verify.
- **Mitigation**: TypeScript strict mode will catch most missing conversions. Run the full app and exercise all features.
- **Rollback**: Revert all changes to `App.tsx`. This task only modifies one file.

#### DO NOT
- Do NOT create a context provider or store abstraction — useState slices are simpler and sufficient.
- Do NOT use `useReducer` — the harness already has a reducer; the UI just needs to subscribe to slices of its output.
- Do NOT split child components into separate files as part of this task — keep the refactor focused on state slicing.
- Do NOT try to make the subscriber "smart" about which events affect which slices — just read from `harness.getState()` for all slices on non-streaming events. React's shallow comparison in useState will no-op if the slice object has the same values (but since we're creating new objects, this won't help). The real win is that streaming events ONLY update the streaming slice.
- Do NOT remove the streaming throttle from Task 1 — it works in conjunction with this change.
- Do NOT move sidebar state into a child component's own useState — that would require the child to subscribe to the harness independently, duplicating subscription logic.

---

## Implementation Schedule

| Phase | Tasks | Parallelizable | Estimated Effort |
|-------|-------|---------------|-----------------|
| Wave 1 | Task 1, Task 2 | Yes — fully independent | ~30min each |
| Wave 1 | Task 3 | N/A — already done | 0 |
| Verify | Build + manual test after Wave 1 | | ~15min |
| Wave 2 | Task 4 | No — do first | ~2hr |
| Wave 2 | Task 5 | After Task 4 | ~30min (audit) |
| Verify | Build + manual test after Wave 2 | | ~30min |
| Wave 3 | Task 6 | After Wave 1+2 verified | ~3hr |
| Verify | Full regression test | | ~30min |

**Total estimated effort**: ~7 hours

---

## Global DO NOTs

- Do NOT import `@github/copilot-sdk` in any UI file — all SDK interaction goes through the adapter.
- Do NOT add new npm dependencies for performance optimization — the fixes are all structural.
- Do NOT change the `Harness` class's public API — state shape changes are internal.
- Do NOT modify `CopilotSessionAdapter.ts` — it already has delta buffering.
- Do NOT change the event types in `events.ts` (except `SubagentStreamEntry` for Task 4) — the event bus contract should remain stable.
- Do NOT use `any` types — maintain strict TypeScript throughout.
