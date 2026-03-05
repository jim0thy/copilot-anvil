# Performance & Memory Optimization Plan

## Problem Statement

After extended use the TUI exhibits high memory/CPU usage, laggy keyboard input, and slow scrolling. The symptoms worsen over time and affect other applications on the machine.

## Root Cause Analysis

Six issues were identified through architecture review, ranked by likely impact.

---

### 1. Synchronous File I/O on Every Streaming Token — **CRITICAL**

**Location:** `src/copilot/CopilotSessionAdapter.ts` → `debugLog()` calls; `src/utils/debugLog.ts`

**Problem:** `debugLog()` calls `fs.appendFileSync()` — a **blocking, synchronous disk write** — on every single streaming token delta. During active streaming this fires 100–200 times per second, each call blocking the event loop for potentially 1–50ms depending on disk pressure.

**Impact:** Keyboard input is processed on the same event loop. Blocking it 100–200×/sec directly causes input lag and UI jank. Under sustained load the OS page cache fills, causing system-wide slowdown.

**Fix:**
- Buffer debug log writes and flush asynchronously on an interval (e.g. every 500ms) or on idle.
- Gate debug logging behind a `DEBUG` env var so it's completely off in normal use.
- Replace `appendFileSync` with `appendFile` (async) at minimum.

```typescript
// Example: buffered async logger
const buffer: string[] = [];
let flushTimer: Timer | null = null;

export function debugLog(message: string): void {
  if (!process.env.DEBUG) return; // gate behind env var
  buffer.push(message);
  if (!flushTimer) {
    flushTimer = setTimeout(flushBuffer, 500);
  }
}

async function flushBuffer() {
  flushTimer = null;
  if (buffer.length === 0) return;
  const batch = buffer.splice(0);
  await Bun.write(Bun.file(DEBUG_LOG_PATH), batch.join("\n") + "\n", { append: true });
}
```

---

### 2. No Transcript Virtualization — **HIGH**

**Location:** `src/ui/panes/ChatPane.tsx` → `TranscriptList`

**Problem:** Every message in the transcript is rendered to the terminal buffer, even those scrolled far out of view. With the transcript capped at 500 items, a long session renders 500+ complex nodes (with markdown parsing and syntax highlighting) on every state update.

**Impact:** Rendering cost grows linearly with conversation length. Past ~200 messages, layout computation and terminal output become expensive enough to cause visible scroll lag and delayed keystroke echoing.

**Fix (choose one):**
- **Viewport slicing (simplest):** Only render messages within ±N items of the scroll position. This is the lowest-effort fix for a terminal UI where the viewport is known.
- **Reduce MAX_TRANSCRIPT:** Lower from 500 to 200 or 100 and/or implement "load more" when scrolling up.
- **Lazy markdown rendering:** Defer syntax highlighting for off-screen messages; render plain text until they scroll into view.

---

### 3. Per-Token Event Emission with No Batching — **HIGH**

**Location:** `src/copilot/CopilotSessionAdapter.ts` (streaming handler); `src/harness/Harness.ts` (emit loop)

**Problem:** Every individual token chunk from the SDK emits a separate `assistant.delta` event, which synchronously calls all subscribers (2–3 handlers + plugins). At 100–200 tokens/sec this produces 200–600+ synchronous handler invocations per second.

**Impact:** Combined with issue #1 (debug logging in the handler path), this saturates the event loop. Even without debug logging, the synchronous fan-out adds overhead.

**Fix:**
- **Micro-batch deltas:** Accumulate delta text in the adapter for 16–32ms, then emit a single `assistant.delta` event with the combined text. The UI already throttles renders at 32ms, so this loses nothing.
- **Async event dispatch:** Move subscriber notification to `queueMicrotask()` or `setImmediate()` so keyboard/input events interleave with event processing.

```typescript
// Example: micro-batched delta emission
private deltaBuffer = "";
private deltaFlushTimer: Timer | null = null;

private bufferDelta(text: string, runId: string) {
  this.deltaBuffer += text;
  if (!this.deltaFlushTimer) {
    this.deltaFlushTimer = setTimeout(() => {
      this.emit({ type: "assistant.delta", runId, text: this.deltaBuffer });
      this.deltaBuffer = "";
      this.deltaFlushTimer = null;
    }, 16); // ~60fps max
  }
}
```

---

### 4. Unbounded State Accumulation — **MEDIUM**

**Location:** `src/harness/reducer.ts`, `src/harness/Harness.ts`

**Problem:** While most arrays are capped (`transcript: 500`, `logs: 100`, `tasks/subagents/skills: 50`), several structures grow without bounds:

| Structure | Location | Issue |
|-----------|----------|-------|
| `activeTools` | reducer.ts | Accumulates tool entries; only cleared on run end |
| `subagentStreaming` | reducer.ts | Record keyed by toolCallId; orphaned entries from failed subagents persist |
| `messageQueue` | Harness.ts | Grows if user submits while a run is active |
| `toolCallTranscriptIndex` | Harness.ts | Map persists across runs; orphaned entries from trimmed transcript items |
| `questionResolvers` | Harness.ts | Map grows if questions are never answered |

**Impact:** Individually small, but collectively these contribute to gradual memory growth over hours of use.

**Fix:**
- Cap `activeTools` (e.g. keep last 20; older tools are certainly complete).
- Add periodic cleanup sweep for `subagentStreaming` — remove entries older than 60s.
- Clear `messageQueue` on run completion (it should be empty by then; defensive).
- Rebuild `toolCallTranscriptIndex` when its size exceeds 2× transcript length.
- Add 60s timeout to `questionResolvers` entries.

---

### 5. Missing Memoization in App.tsx — **LOW**

**Location:** `src/ui/App.tsx` lines ~316–325

**Problem:** Model display name, agent name, and a few other derived strings are computed on every render without `useMemo`. Since App re-renders on every state change (~31×/sec during streaming), these computations run unnecessarily.

**Impact:** Minor per-render cost, but contributes to prop churn that defeats `memo()` on child components.

**Fix:**
- Wrap computed display values in `useMemo` keyed on the relevant state fields.

---

### 6. Spinner Intervals Running When Not Visible — **LOW**

**Location:** `src/ui/hooks.ts` → `useSpinner`

**Problem:** Spinner animation intervals (80ms / 12.5 FPS) run continuously while any spinner-using component is mounted, regardless of whether the spinner is visible or the component is in view.

**Impact:** Minor — adds a timer tick and potential re-render every 80ms. Compounds if multiple spinners are active.

**Fix:**
- Accept an `active` boolean parameter; clear the interval when not active.
- Or use a single shared spinner timer for all spinner instances.

---

## Implementation Priority

| # | Issue | Impact | Effort | Priority |
|---|-------|--------|--------|----------|
| 1 | Sync debug file I/O | Critical | Small | **P0 — Do first** |
| 2 | Transcript virtualization | High | Medium | **P1** |
| 3 | Event batching | High | Medium | **P1** |
| 4 | Unbounded state cleanup | Medium | Small | **P2** |
| 5 | App.tsx memoization | Low | Trivial | **P3** |
| 6 | Spinner optimization | Low | Trivial | **P3** |

**Recommended order:** Fix #1 first — it's the single biggest bang-for-buck and may resolve the keyboard lag on its own. Then tackle #2 and #3 together for scroll performance. Items #4–#6 are polish.

---

## Validation

After each fix, verify with:

1. **Sustained session test:** Run the TUI for 30+ minutes with active conversation. Monitor with `Activity Monitor` or `top -pid <PID>` for RSS (resident memory) and CPU%.
2. **Keyboard latency:** Type during active streaming — keystrokes should appear within ~50ms.
3. **Scroll performance:** Scroll through a 200+ message transcript — should be smooth with no visible lag.
4. **System impact:** Other applications should not be affected during TUI use.
