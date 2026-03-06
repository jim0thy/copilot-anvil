# Performance Optimization Plan v2 — Deep Causes

> **Context:** The v1 plan (debug I/O, event batching, state caps, memoization, spinner gating) has been implemented. CPU usage and UI lag persist. This plan addresses the deeper root causes found through full pipeline tracing.

---

## Executive Summary

The v1 fixes removed overhead at the event-emission layer, but the real CPU cost sits in the **render pipeline**. During streaming, the app re-renders the full component tree ~31×/sec. Each render re-parses markdown through `marked` and re-runs `web-tree-sitter` syntax highlighting — the two most expensive operations in the stack. Combined with O(n²) string growth in the reducer and unnecessary React reconciliation, these account for ~90% of CPU time during streaming.

---

## Issue 1 — Markdown Re-parsing on Every Frame (**CRITICAL**)

### Problem

The `<markdown>` component in ChatPane parses its `content` prop through `marked` (v17) on every render. During streaming, `streamingContent` grows by a few characters every 32ms, but the **entire string** is re-parsed from scratch each time.

**Location:** `src/ui/panes/ChatPane.tsx` — `<markdown content={streamingContent} streaming />`

**Cost model:** `marked` parses the full string → tree-sitter highlights all code blocks → OpenTUI converts to terminal nodes. For a 5KB streaming response with 3 code blocks, this is ~5–15ms per frame. At 31 FPS that's 150–465ms/sec of pure parsing — over half a CPU core.

### Fix

**A. Cache parsed markdown for completed messages.**
Completed messages never change. Parse once, cache the result, and render the cached output on subsequent frames. Only the actively-streaming message needs live parsing.

```tsx
// MessageItem should cache its parsed output
const MessageItem = memo(({ message }: Props) => {
  // message.content is stable for completed messages
  // memo() prevents re-render entirely if props unchanged
  return <markdown content={message.content} syntaxStyle={style} />;
});
```

The key enabler: ensure `message` objects have **stable references** (see Issue 3).

**B. Throttle the streaming markdown render to a lower rate.**
32ms (31 FPS) is unnecessarily fast for text streaming. The human eye can't distinguish text updates faster than ~100–150ms. Throttle the streaming content render to 100ms while keeping other state updates at 32ms.

```tsx
// Separate streaming content from main state updates
const [streamingText, setStreamingText] = useState("");

// In event subscriber:
if (isStreamingEvent) {
  // Use a SLOWER timer for streaming text display
  if (!streamingTimerRef.current) {
    streamingTimerRef.current = setTimeout(() => {
      setStreamingText(harness.getState().streamingContent);
      streamingTimerRef.current = null;
    }, 100); // 10 FPS for streaming text — more than enough
  }
}
```

**C. Incremental markdown for streaming content.**
Instead of re-parsing the full string, only parse the new delta and append the rendered output. This requires changes to how the `<markdown>` component works — may need to coordinate with OpenTUI.

**Effort:** A = Small, B = Small, C = Medium (depends on OpenTUI API)
**Impact:** Eliminates ~60–70% of CPU usage during streaming.

---

## Issue 2 — O(n²) String Concatenation in Reducer (**HIGH**)

### Problem

Every streaming delta concatenates onto the existing string:

```typescript
// reducer.ts
streamingContent: state.streamingContent + event.text   // line ~167
streamingReasoning: state.streamingReasoning + event.text // line ~193
content: (existing?.content ?? "") + event.text           // line ~157
```

JavaScript string concatenation creates a **new string** every time. For a 10KB response built from 200 deltas, total allocation is ~200 × average(5KB) = ~1MB of garbage strings, with O(n²) total copying.

### Fix

**Use an array-based buffer, join only when reading.**

```typescript
// In state, replace:
//   streamingContent: string
// With:
//   streamingContentChunks: string[]

// Reducer — append only:
case "assistant.delta":
  return {
    ...state,
    streamingContentChunks: [...state.streamingContentChunks, event.text],
  };

// In the UI — join when needed (memoized):
const streamingContent = useMemo(
  () => state.streamingContentChunks.join(""),
  [state.streamingContentChunks]
);
```

The `join("")` is O(n) but runs only once per render frame (memoized), not once per delta. The reducer becomes O(1) per delta instead of O(n).

**Alternative:** Use a pre-allocated `Uint8Array` buffer with a write cursor. More complex but zero-copy.

**Effort:** Medium (touches reducer + ChatPane + any consumer of streamingContent)
**Impact:** Eliminates O(n²) allocation pattern. Major GC pressure reduction.

---

## Issue 3 — Unnecessary React Reconciliation Cascade (**HIGH**)

### Problem

The full event→render cascade:

```
assistant.delta → emit() → processEvent() → new state object → setState()
→ App re-renders → ALL children re-render → markdown re-parses → terminal output
```

Three specific issues:

**A. `setState` called without reference check.**
`App.tsx` subscriber calls `setState(harness.getState())` on every event. Even if nothing the UI cares about changed, React sees a new state object and re-renders the full tree.

**B. Reducer always returns a new root object.**
Even when only `streamingContent` changed, `{ ...state, streamingContent }` creates a new root reference, which makes every `state.X` prop look "new" to child components.

**C. ChatPane re-renders even when only streaming content changed.**
ChatPane receives `transcript` as a prop. The transcript array reference doesn't change during streaming, but ChatPane re-renders anyway because its parent (App) re-rendered.

### Fix

**A. Split state into independent slices.**
Instead of one monolithic `state` object, maintain separate state atoms for independent concerns:

```tsx
const [transcript, setTranscript] = useState<TranscriptItem[]>([]);
const [streaming, setStreaming] = useState({ content: "", reasoning: "" });
const [status, setStatus] = useState<RunStatus>("idle");
const [sidebar, setSidebar] = useState({ logs: [], tasks: [], subagents: [] });
```

In the event subscriber, only update the slice that actually changed:

```tsx
subscriberFn = (event) => {
  if (event.type === "assistant.delta" || event.type === "reasoning.delta") {
    // Only update streaming state — transcript/sidebar untouched
    throttledSetStreaming(harness.getState());
  } else if (event.type === "log.created") {
    setSidebar(prev => ({ ...prev, logs: harness.getState().logs }));
  }
  // etc.
};
```

This way, a streaming delta only re-renders the streaming content area, not the entire sidebar/input/transcript.

**B. Use `React.memo` with custom comparators on expensive children.**

```tsx
const ChatPane = memo(({ transcript, streamingContent, theme }: Props) => {
  // ...
}, (prev, next) => {
  // Only re-render if these specific fields changed
  return prev.transcript === next.transcript
    && prev.streamingContent === next.streamingContent
    && prev.theme === next.theme;
});
```

**C. Ensure stable references from the reducer.**
If a field didn't change, return the same reference:

```typescript
// Instead of always spreading:
return { ...state, streamingContent: state.streamingContent + event.text };

// Check first:
const newContent = state.streamingContent + event.text;
if (newContent === state.streamingContent) return state; // no change
return { ...state, streamingContent: newContent };
```

**Effort:** Large (architectural change to state management)
**Impact:** Reduces re-renders from "entire tree 31×/sec" to "only changed subtree 10×/sec".

---

## Issue 4 — Diff/Syntax Highlighting Without Caching (**MEDIUM**)

### Problem

Tool call results with file edits render diffs via:

```tsx
<diff diff={createPatch(...)} filetype={getFiletypeFromPath(...)}
      syntaxStyle={getSyntaxStyle(theme.mode)}
      treeSitterClient={treeSitterClient} />
```

`createPatch()` and tree-sitter highlighting run on every render. Diff content is immutable once a tool call completes — it never changes.

**Location:** `src/ui/panes/ChatPane.tsx` — ToolCallInline component

### Fix

**Memoize diff output per tool call.**

```tsx
const ToolCallInline = memo(({ toolCall, theme }: Props) => {
  const patch = useMemo(() => createPatch(...), [toolCall.id]);
  const filetype = useMemo(() => getFiletypeFromPath(toolCall.path), [toolCall.path]);
  // patch + filetype are stable → <diff> receives same props → memo skips re-render
  return <diff diff={patch} filetype={filetype} syntaxStyle={style} treeSitterClient={client} />;
});
```

Since tool call results are immutable after completion, the `useMemo` dependency on `toolCall.id` ensures this computes exactly once.

**Effort:** Small
**Impact:** Eliminates all diff re-computation for completed tool calls.

---

## Issue 5 — Double-Copy Array Patterns in Reducer (**MEDIUM**)

### Problem

Several reducer branches create two intermediate arrays:

```typescript
logs: [...state.logs.slice(-MAX_LOGS + 1), event]    // .slice() = copy1, spread = copy2
tasks: [...state.tasks.slice(-MAX_TASKS + 1), newTask] // same pattern
```

For `logs` (MAX=100), every new log creates 2 arrays of ~100 items.

### Fix

**Single-pass approach:**

```typescript
// Instead of double-copy:
const logs = state.logs.length >= MAX_LOGS
  ? [...state.logs.slice(1), event]  // only copy when at cap
  : [...state.logs, event];           // fast append when under cap
```

Or use a ring buffer for truly O(1) append:

```typescript
class RingBuffer<T> {
  private items: T[];
  private head = 0;
  private count = 0;

  constructor(private capacity: number) {
    this.items = new Array(capacity);
  }

  push(item: T): void {
    this.items[(this.head + this.count) % this.capacity] = item;
    if (this.count < this.capacity) this.count++;
    else this.head = (this.head + 1) % this.capacity;
  }

  toArray(): T[] {
    // Only allocate when needed for rendering
    return Array.from({ length: this.count }, (_, i) =>
      this.items[(this.head + i) % this.capacity]
    );
  }
}
```

**Effort:** Small (single-pass) or Medium (ring buffer)
**Impact:** Halves allocation for every log/task/subagent state update.

---

## Issue 6 — `subagentStreaming` Orphaned Entries (**LOW**)

### Problem

From v1 plan — still not implemented. `subagentStreaming` record entries for failed/abandoned subagents persist indefinitely.

### Fix

Add periodic cleanup in the reducer or a sweep on `run.finished`:

```typescript
case "run.finished": {
  return {
    ...state,
    subagentStreaming: {}, // Clear all streaming entries on run completion
    // ... other cleanup
  };
}
```

**Effort:** Trivial
**Impact:** Prevents slow memory growth in long sessions with many subagent calls.

---

## Implementation Priority

| # | Issue | CPU Impact | Effort | Priority |
|---|-------|-----------|--------|----------|
| 1 | Markdown re-parsing every frame | ~60-70% of CPU | Small–Medium | **P0** |
| 2 | O(n²) string concatenation | ~10-15% of CPU | Medium | **P0** |
| 3 | React reconciliation cascade | ~10-15% of CPU | Large | **P1** |
| 4 | Diff/syntax caching | ~5-10% of CPU | Small | **P1** |
| 5 | Double-copy arrays | ~2-5% of CPU | Small | **P2** |
| 6 | subagentStreaming cleanup | Memory only | Trivial | **P2** |

### Recommended Implementation Order

**Wave 1 (highest impact, lowest risk):**
- Issue 1B: Throttle streaming render to 100ms — one-line change, immediate impact
- Issue 4: Memoize diff/patch per tool call — small, self-contained
- Issue 6: Clear subagentStreaming on run end — trivial

**Wave 2 (high impact, moderate effort):**
- Issue 1A: Cache parsed markdown for completed messages — requires stable message references
- Issue 2: String buffer pattern for streaming content — touches reducer + UI

**Wave 3 (architectural improvement):**
- Issue 3: Split state into independent slices — largest change, highest long-term benefit
- Issue 5: Ring buffer or single-pass arrays — can do alongside Issue 3

---

## Validation

### Quick Check
```bash
# Monitor CPU during streaming
top -pid $(pgrep -f "bun.*index.tsx") -l 2
```

### Before/After Benchmarks
1. Start a conversation, ask for a long code-heavy response (~500 lines)
2. Measure: CPU% during streaming, time-to-first-keystroke during streaming
3. After fix: same test, compare numbers

### Targets
| Metric | Current (est.) | Target |
|--------|---------------|--------|
| CPU during streaming | 80-100%+ | <30% |
| Keystroke latency during streaming | 200-500ms | <50ms |
| CPU at idle (conversation open) | 10-20% | <5% |
| Memory after 1hr session | Growing | Stable |
