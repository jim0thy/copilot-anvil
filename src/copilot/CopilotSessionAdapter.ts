import { CopilotClient, CopilotSession, approveAll } from "@github/copilot-sdk";
import type { ModelInfo, SessionEvent, SessionMetadata, SystemMessageConfig, Tool } from "@github/copilot-sdk";
import type { HarnessEvent, SessionInfo, TranscriptItem, ToolCallItem } from "../harness/events.js";
import { createAssistantMessage, createLogEvent } from "../harness/events.js";
import * as path from "path";
import { existsSync, readFileSync, watch, type FSWatcher } from "node:fs";
import { getOrchestrationAgents } from "../cli/agents.js";
import { getAnvilTools } from "../cli/tools.js";
import { createSessionHooks } from "../cli/hooks.js";
import { loadModelConfig, resolveAgentModel} from "../agents/modelConfig.js";
import { nf } from "../ui/icons.js";
import { debugLog } from "../utils/debugLog.js";

export type AdapterEventHandler = (event: HarnessEvent) => void;

export type UserInputHandler = (
  request: { question: string; choices?: string[]; allowFreeform?: boolean },
  invocation?: { sessionId: string }
) => Promise<{ answer: string; wasFreeform: boolean }>;

export interface ModelDescription {
  id: string;
  name: string;
  multiplier?: number;
  provider?: string;
  supportsReasoningEffort: boolean;
  supportedReasoningEfforts?: ("low" | "medium" | "high" | "xhigh")[];
  defaultReasoningEffort?: "low" | "medium" | "high" | "xhigh";
}

// ── Static helpers ───────────────────────────────────────────────

/** Try to JSON-parse a string argument; return the original value on failure. */
function parseToolArgs(args: unknown): unknown {
  if (typeof args === "string") {
    try {
      return JSON.parse(args);
    } catch {
      return args;
    }
  }
  return args;
}

/** Extract a human-readable output string from a tool execution result. */
function extractToolOutput(result: unknown): string | undefined {
  if (!result) return undefined;
  if (typeof result === "string") return result;
  if (typeof result === "object" && result !== null) {
    const obj = result as Record<string, unknown>;
    if (typeof obj.textResultForLlm === "string") return obj.textResultForLlm;
    if (typeof obj.sessionLog === "string") return obj.sessionLog;
  }
  return undefined;
}

export interface CustomAgentDef {
  name: string;
  displayName?: string;
  description?: string;
  tools?: string[] | null;
  prompt: string;
  infer?: boolean;
}

export class CopilotSessionAdapter {
  private client: CopilotClient | null = null;
  private session: CopilotSession | null = null;
  private eventHandler: AdapterEventHandler | null = null;
  private currentRunId: string | null = null;
  private streamingBuffers = new Map<
    string,
    { text: string; parentToolCallId?: string; agentName?: string; agentDisplayName?: string }
  >();
  private reasoningBuffer = "";
  private isCancelled = false;
  private isProcessing = false;
  private expectedRunGeneration = 0;
  private currentRunGeneration = 0;
  private _currentModel: string | null = null;
  private _availableModels: ModelDescription[] = [];
  private planWatcher: FSWatcher | null = null;
  private workspacePath: string | null = null;
  private userInputHandler: UserInputHandler | null = null;
  private _currentSessionId: string | null = null;
  private _customAgents: CustomAgentDef[] = [];
  private _activeAgent: CustomAgentDef | null = null;
  private _reasoningEffort: "low" | "medium" | "high" | "xhigh" = "medium";
  /** True while the onUserInputRequest callback is awaiting a user response */
  private hasPendingUserInput = false;
  /** Accumulates assistant.delta text per stream key; flushed every ~16 ms. */
  private deltaBuffer: Map<string, { text: string; runId: string; parentToolCallId?: string; agentName?: string; agentDisplayName?: string }> = new Map();
  private deltaFlushTimer: ReturnType<typeof setTimeout> | null = null;
  /** Guards against concurrent renewSessionWithAgents calls */
  private _renewalPromise: Promise<void> | null = null;
  /** True if a renewal was requested before the session existed and needs to run after init */
  private _pendingRenewalAfterInit = false;
  /** Map of tool call IDs to subagent information (insertion-order = start order) */
  private activeSubagents = new Map<string, { agentName: string; agentDisplayName: string; model?: string }>();
  /** Subagents whose last streamed message is complete but completion event has not arrived yet. */
  private closedSubagentStreams = new Set<string>();
  private executingSubagentToolCalls = new Set<string>();
  /** Recently completed subagents retained for fallback attribution until the next run boundary. */
  private recentlyCompletedSubagents = new Map<string, { agentName: string; agentDisplayName: string; model?: string }>();

  /**
   * When exactly one subagent tool execution is active and the SDK omits
   * parentToolCallId, infer that subagent.
   * Returns [resolvedToolCallId, subagentInfo] or [undefined, undefined].
   */
  private inferActiveSubagent(): [string | undefined, { agentName: string; agentDisplayName: string; model?: string } | undefined] {
    if (this.executingSubagentToolCalls.size !== 1) return [undefined, undefined];
    const activeToolCallId = this.executingSubagentToolCalls.values().next().value as string | undefined;
    if (!activeToolCallId || this.closedSubagentStreams.has(activeToolCallId)) return [undefined, undefined];
    const subagent = this.activeSubagents.get(activeToolCallId);
    if (subagent) {
      this.emit(createLogEvent("debug", `inferActiveSubagent: inferred toolCallId=${activeToolCallId} (${subagent.agentDisplayName})`));
    }
    return [activeToolCallId, subagent];
  }

  /** Fallback attribution when active subagent execution has completed but trailing messages still arrive. */
  private inferRecentlyCompletedSubagent(): [string | undefined, { agentName: string; agentDisplayName: string; model?: string } | undefined] {
    if (this.executingSubagentToolCalls.size > 0) return [undefined, undefined];
    if (this.recentlyCompletedSubagents.size !== 1) return [undefined, undefined];
    let lastCompletedKey: string | undefined;
    let lastCompletedVal: { agentName: string; agentDisplayName: string; model?: string } | undefined;
    for (const [k, v] of this.recentlyCompletedSubagents) {
      lastCompletedKey = k;
      lastCompletedVal = v;
    }
    if (lastCompletedKey) {
      this.emit(createLogEvent("debug", `inferRecentlyCompletedSubagent: inferred toolCallId=${lastCompletedKey} (${lastCompletedVal?.agentDisplayName})`));
    }
    return [lastCompletedKey, lastCompletedVal];
  }

  private getTrackedSubagent(toolCallId: string | undefined): { agentName: string; agentDisplayName: string; model?: string } | undefined {
    if (!toolCallId) return undefined;
    return this.activeSubagents.get(toolCallId) ?? this.recentlyCompletedSubagents.get(toolCallId);
  }

  private ensureSubagentStreamingBuffer(
    toolCallId: string,
    subagent: { agentName: string; agentDisplayName: string; model?: string },
  ): void {
    const key = this.getStreamingBufferKey(undefined, toolCallId);
    const existing = this.streamingBuffers.get(key);
    this.streamingBuffers.set(key, {
      text: existing?.text ?? "",
      parentToolCallId: toolCallId,
      agentName: existing?.agentName ?? subagent.agentName,
      agentDisplayName: existing?.agentDisplayName ?? subagent.agentDisplayName,
    });
  }
  /** Map of tool call IDs to specialist metadata extracted from task tool prompts.
   *  Populated in tool.execution_start, consumed in subagent.started to override
   *  the generic "general-purpose" display name with the actual specialist name. */
  private pendingAgentRoles = new Map<string, { role?: string; model?: string; taskTitle?: string }>();
  /** Checklist items tracked for todo/checklist tools */
  private checklistItems: { id: string; title: string; checked: boolean }[] = [];
  /** SQL query text by sql tool call ID (used for parsing execution_complete results) */
  private sqlQueriesByToolCallId = new Map<string, string>();
  /** Tool call IDs that have already emitted todo.updated (deduplication) */
  private todoUpdatedToolCallIds = new Set<string>();

  /** Pre-built Anvil tools for the SDK integration */
  private _anvilTools: Tool<any>[] = getAnvilTools();
  /** Session hooks for guardrails and context enrichment */
  private _sessionHooks = createSessionHooks();
  /** Skill directories discovered from the project */
  private _skillDirectories: string[] = [];

  constructor() {
    // Auto-discover skill directories
    const cwd = process.cwd();
    const projectSkillDir = path.join(cwd, ".agents", "skills");
    if (existsSync(projectSkillDir)) {
      this._skillDirectories.push(projectSkillDir);
    }
    const dotAnvilSkills = path.join(cwd, ".anvil", "skills");
    if (existsSync(dotAnvilSkills)) {
      this._skillDirectories.push(dotAnvilSkills);
    }
  }

  // ── Public accessors ─────────────────────────────────────────

  onEvent(handler: AdapterEventHandler): void {
    this.eventHandler = handler;
  }

  onUserInputRequest(handler: UserInputHandler): void {
    this.userInputHandler = handler;
  }

  /**
   * Set custom agents to be registered with the SDK.
   * These agents will be available for delegation by the engineering manager.
   * If a session is already active, it will be recreated with the new agents.
   */
  async setCustomAgents(agents: CustomAgentDef[]): Promise<void> {
    // Merge orchestration agents with existing builtin agents.
    // Orchestration agents supersede existing agents that serve the same role:
    //   engineering-manager and strategist are the new coordination agents.
    // All other existing agents (developers, specialists) are kept as-is
    // since the engineering-manager references them by name in its delegation table.
    const orchestrationAgents = getOrchestrationAgents();
    const orchestrationNames = new Set(orchestrationAgents.map(a => a.name));

    // Agents whose role is superseded by an orchestration agent
    const superseded = new Set(["orchestrator", "planner"]);

    const userAgents = agents.filter(
      (a) => !orchestrationNames.has(a.name) && !superseded.has(a.name)
    );
    this._customAgents = [...orchestrationAgents, ...userAgents];
    this.emit(createLogEvent("info", `${nf.cog} Setting ${this._customAgents.length} agents (${orchestrationAgents.length} orchestration + ${userAgents.length} custom): ${this._customAgents.map(a => a.displayName || a.name).join(", ")}`));

    // Schedule a session renewal (coalesced with any pending renewal)
    await this.scheduleRenewal("setCustomAgents");
  }

  /**
   * Set the active agent whose system prompt will be used for the session.
   * When an agent is selected, the session uses that agent's system prompt
   * directly, making the LLM behave AS that agent (not just delegate to it).
   *
   * @param agentId - The agent ID to activate, or null for default Copilot behavior
   * @param skipSessionRenew - If true, just sets the agent without recreating the session.
   *                           Use when you'll be switching models immediately after.
   */
  async setActiveAgent(agentId: string | null, skipSessionRenew = false): Promise<void> {
    // Find the agent from registered custom agents
    const agent = agentId
      ? this._customAgents.find(a => a.name === agentId)
      : null;

    this._activeAgent = agent ?? null;

    // Log for debugging
    if (agentId && !agent) {
      this.emit(createLogEvent("warn", `${nf.warning} Agent '${agentId}' not found in registered agents. Available: ${this._customAgents.map(a => a.name).join(", ")}`));
    } else if (agent) {
      this.emit(createLogEvent("debug", `${nf.check} Active agent set: ${agent.displayName || agent.name}`));
    }

    // Schedule a session renewal (coalesced with any pending renewal)
    if (!skipSessionRenew) {
      const agentName = agent?.displayName ?? agent?.name ?? "Copilot";
      this.emit(createLogEvent("info", `Activating agent: ${agentName}`));
      await this.scheduleRenewal("setActiveAgent");
    }
  }

  /**
   * Set the reasoning effort level for new sessions.
   * Does not affect the current session - only future sessions.
   */
  setReasoningEffort(effort: "low" | "medium" | "high" | "xhigh"): void {
    this._reasoningEffort = effort;
  }

  private getEffectiveReasoningEffort(targetModel?: string): "low" | "medium" | "high" | "xhigh" | undefined {
    const modelId = targetModel ?? this._currentModel;
    const model = this._availableModels.find((m) => m.id === modelId);
    if (!model?.supportsReasoningEffort) return undefined;

    if (model.supportedReasoningEfforts && !model.supportedReasoningEfforts.includes(this._reasoningEffort)) {
      return model.defaultReasoningEffort ?? undefined;
    }

    return this._reasoningEffort;
  }

  /**
   * Coalesces concurrent renewal requests so that only ONE
   * destroy-then-resume cycle runs at a time. If a renewal is already
   * in flight, callers share the same promise. The final renewal always
   * uses the latest _customAgents / _activeAgent state.
   */
  private async scheduleRenewal(source: string): Promise<void> {
    if (!this.session || !this.client || this.isProcessing) {
      this.emit(createLogEvent("info", `[scheduleRenewal] SKIPPED from ${source}: session=${!!this.session} client=${!!this.client} isProcessing=${this.isProcessing} activeAgent=${this._activeAgent?.name ?? 'none'}`));
      // If skipped because session doesn't exist yet, mark that a renewal is needed
      // after initialize() creates the session.
      if (!this.session) {
        this._pendingRenewalAfterInit = true;
      }
      return;
    }

    if (this._renewalPromise) {
      // Another renewal is already in flight — just wait for it.
      // It will pick up the latest state when it builds the session opts.
      this.emit(createLogEvent("debug", `Renewal coalesced (from ${source}) — joining existing renewal`));
      return this._renewalPromise;
    }

    // Defer one microtick so that synchronous setCustomAgents +
    // setActiveAgent calls both land before the renewal starts.
    this._renewalPromise = new Promise<void>(resolve => {
      queueMicrotask(async () => {
        try {
          this.emit(createLogEvent("info", `Renewing session (trigger: ${source})...`));
          await this.renewSessionWithAgents();
        } catch (err) {
          this.emit(createLogEvent("error", `Session renewal failed: ${err instanceof Error ? err.message : String(err)}`));
        } finally {
          this._renewalPromise = null;
          resolve();
        }
      });
    });

    return this._renewalPromise;
  }

  private async renewSessionWithAgents(): Promise<void> {
    if (!this.client) throw new Error("Client not initialized");

    const currentSessionId = this._currentSessionId;
    if (!currentSessionId) return;

    await this.teardownSession();

    // Resume the same session with updated agents, tools, hooks, and system message.
    const opts = {
      streaming: true as const,
      model: this._currentModel ?? undefined,
      onPermissionRequest: approveAll,
      onUserInputRequest: this.getUserInputCallback(),
      tools: this._anvilTools,
      hooks: this._sessionHooks,
      skillDirectories: this._skillDirectories.length > 0 ? this._skillDirectories : undefined,
      systemMessage: this.buildSystemMessage(),
      reasoningEffort: this.getEffectiveReasoningEffort(),
    };

    try {
      this.session = await this.client.resumeSession(currentSessionId, opts);
    } catch {
      // If resume fails, create new session with same ID
      this.session = await this.client.createSession({ sessionId: currentSessionId, ...opts });
    }

    this.workspacePath = this.session.workspacePath ?? null;
    this.setupSessionEventHandlers();
    if (this.workspacePath) this.setupPlanWatcher();
  }

  get currentModel(): string | null {
    return this._currentModel;
  }

  get availableModels(): ModelDescription[] {
    return this._availableModels;
  }

  get currentSessionId(): string | null {
    return this._currentSessionId;
  }

  // ── Internal helpers ─────────────────────────────────────────

  private emit(event: HarnessEvent): void {
    const parentToolCallId =
      ("parentToolCallId" in event ? event.parentToolCallId : undefined)
      ?? (event.type === "assistant.message" ? event.message.parentToolCallId : undefined);
    const agentName =
      ("agentName" in event ? event.agentName : undefined)
      ?? (event.type === "assistant.message" ? event.message.agentName : undefined);
    debugLog(`[EMIT] type=${event.type} ptcId=${parentToolCallId ?? "none"} agentName=${agentName ?? "none"}`);
    this.eventHandler?.(event);
  }

  /** Returns true when an event should be discarded (cancelled, not processing, or stale generation). */
  private isEventStale(gen: number): boolean {
    return this.isCancelled || !this.isProcessing || gen !== this.expectedRunGeneration;
  }

  /** Reset per-turn streaming/reasoning buffers. */
  private resetTurnStreamingBuffers(): void {
    this.streamingBuffers.clear();
    this.reasoningBuffer = "";
  }

  /** Flush all buffered delta text as assistant.delta events, then clear the buffer. */
  private flushDeltaBuffer(): void {
    if (this.deltaFlushTimer !== null) {
      clearTimeout(this.deltaFlushTimer);
      this.deltaFlushTimer = null;
    }
    if (this.deltaBuffer.size === 0) return;
    for (const [, entry] of this.deltaBuffer) {
      this.emit({
        type: "assistant.delta",
        runId: entry.runId,
        text: entry.text,
        parentToolCallId: entry.parentToolCallId,
        agentName: entry.agentName,
        agentDisplayName: entry.agentDisplayName,
      });
    }
    this.deltaBuffer.clear();
  }

  /** Reset all per-run transient tracking state. */
  private resetRunTrackingState(): void {
    this.resetTurnStreamingBuffers();
    this.activeSubagents.clear();
    this.closedSubagentStreams.clear();
    this.executingSubagentToolCalls.clear();
    this.recentlyCompletedSubagents.clear();
    this.pendingAgentRoles.clear();
    this.checklistItems = [];
    this.sqlQueriesByToolCallId.clear();
    this.todoUpdatedToolCallIds.clear();
  }

  private getStreamingBufferKey(messageId: string | undefined | null, parentToolCallId: string | undefined | null): string {
    if (messageId) return messageId;
    if (parentToolCallId) return `tool:${parentToolCallId}`;
    return "__default__";
  }

  private findBufferedMessage(
    messageId: string | undefined | null,
    parentToolCallId: string | undefined | null,
    inferredToolCallId?: string,
  ): [string, { text: string; parentToolCallId?: string; agentName?: string; agentDisplayName?: string }] | undefined {
    const candidateKeys = [
      this.getStreamingBufferKey(messageId, parentToolCallId),
      parentToolCallId ? this.getStreamingBufferKey(undefined, parentToolCallId) : undefined,
      inferredToolCallId ? this.getStreamingBufferKey(undefined, inferredToolCallId) : undefined,
      this.getStreamingBufferKey(messageId, undefined),
      this.getStreamingBufferKey(undefined, undefined),
    ].filter((key): key is string => Boolean(key));

    for (const key of candidateKeys) {
      const buffered = this.streamingBuffers.get(key);
      if (!buffered) continue;
      const explicitMatch =
        (Boolean(parentToolCallId) && (key === this.getStreamingBufferKey(undefined, parentToolCallId)))
        || (Boolean(messageId) && key === this.getStreamingBufferKey(messageId, parentToolCallId));
      if (explicitMatch || buffered.text) return [key, buffered];
    }

    if (parentToolCallId) {
      for (const [key, buffered] of this.streamingBuffers) {
        if (buffered.parentToolCallId === parentToolCallId && buffered.text) {
          return [key, buffered];
        }
      }
    }

    let latestToolBuffer:
      | [string, { text: string; parentToolCallId?: string; agentName?: string; agentDisplayName?: string }]
      | undefined;
    let latestAnyBuffer:
      | [string, { text: string; parentToolCallId?: string; agentName?: string; agentDisplayName?: string }]
      | undefined;

    for (const entry of this.streamingBuffers) {
      const [key, buffered] = entry;
      if (!buffered.text) continue;
      latestAnyBuffer = entry;
      if (key.startsWith("tool:")) latestToolBuffer = entry;
    }

    return latestToolBuffer ?? latestAnyBuffer;
  }

  /** Flush all pending streaming message buffers into transcript messages. */
  private flushStreamingBuffers(runId: string): void {
    for (const [, bufferedMessage] of this.streamingBuffers) {
      if (!bufferedMessage.text) continue;

      const message = createAssistantMessage(bufferedMessage.text);
      if (bufferedMessage.parentToolCallId) {
        message.parentToolCallId = bufferedMessage.parentToolCallId;
        const subagent = this.getTrackedSubagent(bufferedMessage.parentToolCallId);
        if (subagent) {
          message.agentName = subagent.agentName;
          message.agentDisplayName = subagent.agentDisplayName;
        } else {
          message.agentName = bufferedMessage.agentName;
          message.agentDisplayName = bufferedMessage.agentDisplayName;
        }
      } else {
        message.agentName = bufferedMessage.agentName;
        message.agentDisplayName = bufferedMessage.agentDisplayName;
        if (this.reasoningBuffer.trim()) {
          message.reasoning = this.reasoningBuffer;
          this.reasoningBuffer = "";
        }
      }

      this.emit({
        type: "assistant.message",
        runId,
        message,
      });
    }
    this.streamingBuffers.clear();
  }

  /** Resolve intent attribution to a subagent tool call when possible. */
  private resolveIntentToolCallId(parentToolCallId?: string): string | undefined {
    if (parentToolCallId && this.getTrackedSubagent(parentToolCallId)) {
      return parentToolCallId;
    }
    return undefined;
  }

  /** Render checklist state as markdown for todo.updated events. */
  private getChecklistMarkdown(): string | null {
    if (this.checklistItems.length === 0) return null;
    return this.checklistItems
      .map(item => `- [${item.checked ? "x" : " "}] ${item.title}`)
      .join("\n");
  }

  private isDoneTodoStatus(status: string | undefined): boolean {
    return (status ?? "").trim().toLowerCase() === "done";
  }

  /** Emit a todo.updated event with the current checklist state as markdown. */
  private emitChecklistUpdate(): void {
    if (!this.currentRunId) return;
    const markdown = this.getChecklistMarkdown();
    if (!markdown) return;
    this.emit({ type: "todo.updated", runId: this.currentRunId, todos: markdown });
  }

  /** Parse SQL INSERT/UPDATE on the todos table and merge with existing checklist state. */
  private parseSqlTodoItems(query: string): string | null {
    const upperQuery = query.toUpperCase();
    const isTodoMutation =
      (upperQuery.includes("INSERT") || upperQuery.includes("UPDATE")) &&
      upperQuery.includes("TODOS");
    if (!isTodoMutation) return null;

    try {
      // --- Helpers (intentionally small, SQL-ish not fully general) ---
      const unquote = (token: string | undefined): string | null => {
        if (!token) return null;
        const t = token.trim();
        if (!t) return null;
        if (/^null$/i.test(t)) return null;
        if (t.startsWith("'") && t.endsWith("'")) {
          // SQL escapes single-quote as doubled single-quote
          return t.slice(1, -1).replace(/''/g, "'");
        }
        return t;
      };

      const splitTupleValues = (tuple: string): string[] => {
        const vals: string[] = [];
        let cur = "";
        let inQuote = false;
        let depth = 0; // nested parens (e.g. datetime('now'))
        for (let i = 0; i < tuple.length; i++) {
          const ch = tuple[i];
          const next = tuple[i + 1];

          if (ch === "'") {
            if (inQuote && next === "'") {
              // escaped quote inside string
              cur += "''";
              i++;
              continue;
            }
            inQuote = !inQuote;
            cur += ch;
            continue;
          }

          if (!inQuote) {
            if (ch === "(") depth++;
            else if (ch === ")" && depth > 0) depth--;

            if (ch === "," && depth === 0) {
              vals.push(cur.trim());
              cur = "";
              continue;
            }
          }

          cur += ch;
        }
        if (cur.trim().length > 0) vals.push(cur.trim());
        return vals;
      };

      const extractValuesTuples = (valuesBlock: string): string[] => {
        const tuples: string[] = [];
        let inQuote = false;
        let depth = 0;
        let start = -1;

        for (let i = 0; i < valuesBlock.length; i++) {
          const ch = valuesBlock[i];
          const next = valuesBlock[i + 1];

          if (ch === "'") {
            if (inQuote && next === "'") {
              // escaped quote
              i++;
              continue;
            }
            inQuote = !inQuote;
            continue;
          }

          if (inQuote) continue;

          if (ch === "(") {
            if (depth === 0) start = i + 1;
            depth++;
          } else if (ch === ")") {
            depth = Math.max(0, depth - 1);
            if (depth === 0 && start >= 0) {
              tuples.push(valuesBlock.slice(start, i));
              start = -1;
            }
          }
        }

        return tuples;
      };

      // --- INSERT ---
      // Supports both: INSERT INTO todos (a,b,...) VALUES (...),(...)
      // and (best-effort): INSERT INTO todos VALUES (...)
      const insertMatch = query.match(
        /INSERT\s+INTO\s+todos\s*(?:\(([^)]+)\))?\s*VALUES\s+([\s\S]+?)(?:;|$)/i
      );
      if (insertMatch) {
        const columnsRaw = insertMatch[1];
        const columns = columnsRaw
          ? columnsRaw.split(",").map(c => c.trim().toLowerCase())
          : null;

        const valuesBlock = insertMatch[2];
        const tuples = extractValuesTuples(valuesBlock);
        if (tuples.length === 0) return null;

        const colIdx = (colName: string, fallbackIndex: number): number => {
          if (!columns) return fallbackIndex;
          const idx = columns.indexOf(colName);
          return idx >= 0 ? idx : -1;
        };

        const idIdx = colIdx("id", 0);
        const titleIdx = colIdx("title", 1);
        const statusIdx = colIdx("status", 3);

        let changed = false;

        for (const tuple of tuples) {
          const rawVals = splitTupleValues(tuple);
          const id = idIdx >= 0 ? unquote(rawVals[idIdx]) : unquote(rawVals[0]);
          const title = titleIdx >= 0 ? unquote(rawVals[titleIdx]) : unquote(rawVals[1]);
          const status = statusIdx >= 0 ? unquote(rawVals[statusIdx]) : unquote(rawVals[3]);

          const checklistId = (id || title)?.trim();
          if (!title || !checklistId) continue;

          const checked = this.isDoneTodoStatus(status ?? undefined);
          const existing = this.checklistItems.find(item => item.id === checklistId);

          if (!existing) {
            this.checklistItems.push({ id: checklistId, title, checked });
            changed = true;
          } else if (existing.title !== title || existing.checked !== checked) {
            existing.title = title;
            existing.checked = checked;
            changed = true;
          }
        }

        return changed ? this.getChecklistMarkdown() : null;
      }

      // --- UPDATE ---
      // Be liberal: allow additional SET fields (e.g. updated_at=...) and different spacing.
      if (upperQuery.includes("UPDATE") && upperQuery.includes("TODOS")) {
        const idMatch = query.match(/WHERE\s+id\s*=\s*'([^']+)'/i);
        const statusMatch = query.match(/\bstatus\s*=\s*'(done|in_progress|pending|blocked)'/i);
        if (idMatch && statusMatch) {
          const todoId = idMatch[1];
          const newStatus = statusMatch[1];
          const item = this.checklistItems.find(it => it.id === todoId);
          if (!item) return null;
          const checked = this.isDoneTodoStatus(newStatus);
          if (item.checked === checked) return null;
          item.checked = checked;
          return this.getChecklistMarkdown();
        }
      }

      return null;
    } catch (error) {
      this.emit(createLogEvent("warn", `Failed to parse SQL todo mutation: ${String(error)}`));
      return null;
    }
  }

  /** Parse SQL SELECT todos results and replace checklist state from returned rows. */
  private parseSqlTodoItemsFromResult(query: string, result: unknown): string | null {
    const upperQuery = query.toUpperCase();
    const isTodoSelect =
      upperQuery.includes("SELECT") &&
      upperQuery.includes("FROM") &&
      upperQuery.includes("TODOS");
    if (!isTodoSelect) return null;

    // Prefer structured SQL results if available (newer sql tool implementations).
    const structuredRows = this.extractSqlRows(result);
    if (structuredRows && structuredRows.length > 0) {
      const nextItems: { id: string; title: string; checked: boolean }[] = [];
      for (const row of structuredRows) {
        const title = typeof row.title === "string" ? row.title.trim() : String(row.title ?? "").trim();
        if (!title) continue;
        const idRaw = row.id ?? title;
        const id = typeof idRaw === "string" ? idRaw.trim() : String(idRaw).trim();
        const statusRaw = row.status ?? "pending";
        const status = typeof statusRaw === "string" ? statusRaw.trim() : String(statusRaw).trim();
        nextItems.push({ id, title, checked: this.isDoneTodoStatus(status) });
      }
      if (nextItems.length > 0) {
        this.checklistItems = nextItems;
        return this.getChecklistMarkdown();
      }
    }

    const resultText = this.extractSqlResultText(result);
    if (!resultText) return null;

    const lines = resultText
      .split(/\r?\n/)
      .map(line => line.trim())
      .filter(line => line.startsWith("|"));
    if (lines.length < 3) return null;

    const headerCells = this.parseMarkdownTableRow(lines[0]).map(cell => cell.toLowerCase());
    const idIdx = headerCells.indexOf("id");
    const titleIdx = headerCells.indexOf("title");
    const statusIdx = headerCells.indexOf("status");
    if (titleIdx === -1) return null;

    const nextItems: { id: string; title: string; checked: boolean }[] = [];
    for (const line of lines.slice(1)) {
      const cells = this.parseMarkdownTableRow(line);
      if (cells.length === 0) continue;
      if (cells.every(cell => /^:?-{3,}:?$/.test(cell))) continue;
      const title = cells[titleIdx]?.trim();
      if (!title) continue;
      const id = idIdx >= 0 ? (cells[idIdx]?.trim() || title) : title;
      const status = statusIdx >= 0 ? cells[statusIdx]?.trim() : "pending";
      nextItems.push({ id, title, checked: this.isDoneTodoStatus(status) });
    }

    if (nextItems.length === 0) return null;
    this.checklistItems = nextItems;
    return this.getChecklistMarkdown();
  }

  private parseMarkdownTableRow(row: string): string[] {
    const trimmed = row.trim();
    if (!trimmed.startsWith("|")) return [];
    const withoutEdges = trimmed.replace(/^\|/, "").replace(/\|$/, "");
    return withoutEdges.split("|").map(cell => cell.trim());
  }

  private extractSqlResultText(result: unknown): string | null {
    if (!result) return null;
    if (typeof result === "string") return result;
    if (typeof result === "object") {
      const obj = result as Record<string, unknown>;
      if (typeof obj.content === "string" && obj.content.trim()) return obj.content;
      if (typeof obj.detailedContent === "string" && obj.detailedContent.trim()) return obj.detailedContent;
      const contents = obj.contents;
      if (Array.isArray(contents)) {
        const textChunks: string[] = [];
        for (const content of contents) {
          if (!content || typeof content !== "object") continue;
          const item = content as Record<string, unknown>;
          if ((item.type === "text" || item.type === "terminal") && typeof item.text === "string") {
            textChunks.push(item.text);
          } else if (item.type === "resource" && typeof item.resource === "object" && item.resource !== null) {
            const resource = item.resource as Record<string, unknown>;
            if (typeof resource.text === "string") {
              textChunks.push(resource.text);
            }
          }
        }
        if (textChunks.length > 0) return textChunks.join("\n");
      }
    }
    const fallback = extractToolOutput(result);
    return typeof fallback === "string" && fallback.trim() ? fallback : null;
  }

  /** Best-effort extraction for structured SQL results (rows/columns), if provided by a sql tool implementation. */
  private extractSqlRows(result: unknown): Array<Record<string, unknown>> | null {
    if (!result) return null;

    // Some tools return the rows directly as an array.
    if (Array.isArray(result)) {
      const first = result[0];
      if (first && typeof first === "object" && !Array.isArray(first)) {
        return result as Array<Record<string, unknown>>;
      }
      return null;
    }

    if (typeof result !== "object") return null;
    const obj = result as Record<string, unknown>;

    const rows = obj.rows;
    if (!Array.isArray(rows) || rows.length === 0) return null;

    const firstRow = rows[0];

    // rows: Array<object>
    if (firstRow && typeof firstRow === "object" && !Array.isArray(firstRow)) {
      return rows as Array<Record<string, unknown>>;
    }

    // rows: Array<Array<any>> with columns: Array<string>
    const columns = obj.columns;
    if (Array.isArray(columns) && Array.isArray(firstRow)) {
      const colNames = columns.map(c => String(c));
      return (rows as unknown[]).map((r) => {
        const rec: Record<string, unknown> = {};
        const arr = r as unknown[];
        for (let i = 0; i < colNames.length; i++) {
          rec[colNames[i]] = arr[i];
        }
        return rec;
      });
    }

    return null;
  }

  /** Tear down the current session and its plan watcher. Does not throw. */
  private async teardownSession(): Promise<void> {
    if (this.planWatcher) {
      try { this.planWatcher.close(); } catch { /* ignore */ }
      this.planWatcher = null;
    }
    if (this.session) {
      try { await this.session.destroy(); } catch { /* ignore */ }
    }
  }

  /** Wire up a newly created/resumed session: extract workspace, register handlers, start plan watcher. */
  private activateSession(session: CopilotSession): void {
    this.session = session;
    this.workspacePath = session.workspacePath ?? null;
    this.setupSessionEventHandlers();
    if (this.workspacePath) {
      this.setupPlanWatcher();
    }
  }

  /** Build the `onUserInputRequest` callback suitable for SDK session options.
   *  Tracks pending state so `session.idle` doesn't prematurely end the run. */
  private getUserInputCallback(): ((request: any, invocation: { sessionId: string }) => Promise<{ answer: string; wasFreeform: boolean }>) | undefined {
    return this.userInputHandler
      ? async (request: any, invocation: { sessionId: string }) => {
          this.hasPendingUserInput = true;
          this.emit(createLogEvent("debug", "User input requested — pausing idle handling"));
          try {
            return await this.userInputHandler!(request, invocation);
          } finally {
            this.hasPendingUserInput = false;
            this.emit(createLogEvent("debug", "User input received — resuming idle handling"));
          }
        }
      : undefined;
  }

  /**
   * Build system message config for the session.
   *
   * When an active agent is selected, REPLACES the entire system prompt with
   * that agent's prompt + delegation guide (mode: "replace"). This is critical:
   * "append" buries the agent instructions under the Copilot CLI's own lengthy
   * system prompt, causing the model to ignore the agent's role.
   *
   * The delegation guide instructs the LLM to use agent_type "general-purpose"
   * for ALL delegations, with the specialist's role and prompt embedded in the
   * task prompt field. This avoids the customAgents overwrite issue (see
   * buildDelegationGuide for details).
   */
  private buildSystemMessage(): SystemMessageConfig | undefined {
    // When an active agent is selected, REPLACE the entire system prompt with the
    // agent's own instructions. Using "append" buries the agent prompt under the
    // Copilot CLI's lengthy default system prompt, causing the model to follow
    // general-assistant behaviour instead of the agent's role instructions.
    if (this._activeAgent) {
      this.emit(createLogEvent("info", `[SystemMessage] Building REPLACE prompt for agent: ${this._activeAgent.displayName ?? this._activeAgent.name} (customAgents: ${this._customAgents.length})`));

      const otherAgents = this._customAgents.filter(a => a.name !== this._activeAgent?.name);
      const delegationGuide = otherAgents.length > 0
        ? this.buildDelegationGuide(otherAgents)
        : '';

      return {
        mode: "replace" as const,
        content: `${this._activeAgent.prompt}\n\n${delegationGuide}`,
      };
    }

    // No active agent — append the delegation guide to inform the base assistant
    // about available agents without overriding its core behaviour.
    this.emit(createLogEvent("info", `[SystemMessage] No active agent — using ${this._customAgents.length > 0 ? 'append delegation guide' : 'default Copilot prompt'}`));
    if (this._customAgents.length === 0) return undefined;

    return {
      mode: "append" as const,
      content: `\n\n${this.buildDelegationGuide(this._customAgents)}`,
    };
  }

  /**
   * Resolve the model ID for an agent, returning undefined if not available.
   */
  private resolveModelForAgent(agentName: string): string | undefined {
    const modelConfig = loadModelConfig();
    const override = resolveAgentModel(agentName, modelConfig);
    if (!override.model) return undefined;
    return this._availableModels.some(m => m.id === override.model)
      ? override.model
      : undefined;
  }

  /**
   * Build a compact specialist directory listing all agents with their models.
   * Used both in the top-level delegation guide and embedded in orchestrator prompts.
   */
  private buildSpecialistDirectory(agents: CustomAgentDef[], exclude?: Set<string>): string {
    return agents
      .filter(a => !exclude?.has(a.name))
      .map(a => {
        const displayName = a.displayName || a.name;
        const model = this.resolveModelForAgent(a.name);
        const modelStr = model ? ` | model: "${model}"` : '';
        const preamble = a.prompt.split('\n').find(l => l.trim())?.trim() ?? '';
        return `- **${displayName}**${modelStr}: ${a.description || 'No description'}\n  Preamble: "${preamble}"`;
      })
      .join('\n');
  }

  /**
   * Build a delegation guide that instructs the LLM how to delegate to specialists.
   *
   * Build a delegation guide that instructs the LLM how to delegate to specialists.
   *
   * Uses agent_type "general-purpose" for ALL delegations, with the specialist's
   * role preamble embedded in the prompt. This avoids the customAgents overwrite
   * issue: the CLI's setAuthInfo flow calls updateOptions({authInfo}) without
   * customAgents, which triggers loadCustomAgents() and overwrites any customAgents
   * we register with an empty array loaded from disk. Since "general-purpose" is a
   * built-in type that doesn't require customAgents, it always works.
   *
    * CRITICAL DESIGN: Orchestrator agents (e.g., Engineering Manager) need to sub-delegate
   * to other specialists. Since subagents get a fresh context (no access to the
   * top-level system message), the delegation instructions must be embedded
   * directly in the orchestrator's prompt. This method:
   *
   * 1. Builds a compact specialist directory with models
   * 2. For orchestrators, augments their prompt with inline delegation instructions
   * 3. Instructs the top-level LLM to include the full orchestrator prompt
   *
   * The guide also includes a role marker format (## Role: Name) that we parse
   * in the event handler to extract display names for subagent UI attribution.
   */
  private buildDelegationGuide(agents: CustomAgentDef[]): string {
    // Identify orchestrator agents (agents that delegate but don't implement)
    const orchestratorNames = new Set(['engineering-manager']);

    // Build the sub-delegation block that gets embedded in orchestrator prompts.
    // This replaces the <delegation_guide> reference in the Engineering Manager's prompt.
    const nonOrchestrators = agents.filter(a => !orchestratorNames.has(a.name));
    const specialistDir = this.buildSpecialistDirectory(nonOrchestrators);

    const subDelegationBlock = `## Delegation Instructions

To delegate to a specialist, use the task tool with these EXACT parameters:
- **agent_type**: "general-purpose" (ALWAYS — never use specialist names as agent_type)
- **model**: Use the specialist's model listed below
- **prompt**: Start with "## Role: [Name]" then the task. Include enough context for the specialist to work independently.

### Specialist Directory
${specialistDir}

### Delegation Format
\`\`\`json
{
  "agent_type": "general-purpose",
  "model": "[model from directory]",
  "description": "[3-5 word summary]",
  "prompt": "## Role: [Specialist Name]\\n\\nTask: [detailed task description with all necessary context]"
}
\`\`\``;

    // Build agent entries for the top-level guide
    const agentEntries = agents.map(a => {
      const displayName = a.displayName || a.name;
      const model = this.resolveModelForAgent(a.name);

      if (orchestratorNames.has(a.name)) {
        // For orchestrators: augment their prompt with inline sub-delegation instructions,
        // replacing the <delegation_guide> reference with the actual content.
        const augmentedPrompt = a.prompt.replace(
          /Delegate to specialists using the task tool following the instructions in the <delegation_guide> section\./,
          ''
        ).trimEnd() + '\n\n' + subDelegationBlock;

        let entry = `### ${displayName} (ORCHESTRATOR)
- **Description**: ${a.description || 'No description'}`;
        if (model) entry += `\n- **Model**: "${model}"`;
        entry += `\n- **IMPORTANT**: When delegating to this agent, include its FULL prompt below verbatim.`;
        entry += `\n  The orchestrator needs the embedded delegation instructions to sub-delegate.`;
        entry += `\n<${a.name}_prompt>\n${augmentedPrompt}\n</${a.name}_prompt>`;
        return entry;
      }

      // Non-orchestrator: compact entry with preamble
      const preamble = a.prompt.split('\n').find(l => l.trim())?.trim() ?? '';
      let entry = `### ${displayName}
- **Description**: ${a.description || 'No description'}`;
      if (model) entry += `\n- **Model**: "${model}"`;
      entry += `\n- **Preamble**: "${preamble}"`;
      return entry;
    }).join('\n\n');

    // Pick a representative non-orchestrator for the simple delegation example
    const exampleAgent = nonOrchestrators.find(a => a.name === 'staff-engineer') ?? nonOrchestrators[0];
    const exampleName = exampleAgent?.displayName || exampleAgent?.name || 'Specialist';
    const exampleModel = this.resolveModelForAgent(exampleAgent?.name ?? '');
    const exampleModelStr = exampleModel ? `\n  "model": "${exampleModel}",` : '';

    // Find the orchestrator for the orchestrator example
    const orchestrator = agents.find(a => orchestratorNames.has(a.name));
    const orchName = orchestrator?.displayName || orchestrator?.name || 'Engineering Manager';
    const orchModel = this.resolveModelForAgent(orchestrator?.name ?? '');
    const orchModelStr = orchModel ? `\n  "model": "${orchModel}",` : '';

    return `<delegation_guide>
## How to Delegate

Use the task tool with agent_type "general-purpose" for ALL delegations.
Each specialist runs on its own model — include the model parameter from the directory.
Start every prompt with a role marker: ## Role: [Specialist Display Name]

## CRITICAL RULES
1. ALWAYS use agent_type "general-purpose" — never use specialist names as agent_type
2. ALWAYS include the specialist's model parameter if one is listed
3. ALWAYS start the prompt with: ## Role: [Specialist Display Name]
4. For ORCHESTRATOR agents: include their FULL prompt (shown in the <*_prompt> block)
5. For other specialists: include the role marker, then describe the task with full context

## Available Specialists

${agentEntries}

## Delegation Examples

### Delegating to a specialist (simple):
\`\`\`json
{
  "agent_type": "general-purpose",${exampleModelStr}
  "description": "Implement auth feature",
  "prompt": "## Role: ${exampleName}\\n\\nTask: [detailed task with context]"
}
\`\`\`

### Delegating to an orchestrator (include full prompt):
\`\`\`json
{
  "agent_type": "general-purpose",${orchModelStr}
  "description": "Coordinate feature implementation",
    "prompt": "## Role: ${orchName}\\n[INCLUDE THE FULL PROMPT FROM <${orchestrator?.name ?? 'engineering-manager'}_prompt> ABOVE]\\n\\nTask: [describe what needs to be done]"
}
\`\`\`
</delegation_guide>`;
  }

  // ── Lifecycle ────────────────────────────────────────────────

  async initialize(model?: string, reasoningEffort: "low" | "medium" | "high" | "xhigh" = "medium"): Promise<void> {
    this._reasoningEffort = reasoningEffort;

    try {
      this.client = new CopilotClient({
        autoStart: true,
        logLevel: "error",
      });

      await this.client.start();

      const models = await this.client.listModels();
      this._availableModels = models.map((m: ModelInfo) => {
        // Extract provider from model ID (e.g., "claude-sonnet-4.6" -> "Claude")
        let provider = "Other";
        if (m.id.startsWith("claude")) provider = "Claude";
        else if (m.id.startsWith("gpt")) provider = "OpenAI";
        else if (m.id.startsWith("gemini")) provider = "Google";
        else if (m.id.startsWith("o1") || m.id.startsWith("o3")) provider = "OpenAI";

        return {
          id: m.id,
          name: m.name,
          multiplier: m.billing?.multiplier,
          provider,
          supportsReasoningEffort: m.capabilities?.supports?.reasoningEffort ?? false,
          supportedReasoningEfforts: m.supportedReasoningEfforts,
          defaultReasoningEffort: m.defaultReasoningEffort,
        };
      });

      // Pre-load orchestration agents as defaults ONLY if the plugin hasn't already
      // set agents (loader.load() may have completed before this point)
      if (this._customAgents.length === 0) {
        this._customAgents = getOrchestrationAgents();
      }

      const selectedModel = model ?? this._availableModels[0]?.id;

      // Log what system message we're building at session creation time
      this.emit(createLogEvent("info", `[initialize] createSession: activeAgent=${this._activeAgent?.name ?? 'NONE'} customAgents=${this._customAgents.length}`));

      const session = await this.client.createSession({
        streaming: true,
        model: selectedModel,
        onPermissionRequest: approveAll,
        onUserInputRequest: this.getUserInputCallback(),
        // NOTE: customAgents intentionally omitted. The CLI's setAuthInfo flow
        // calls updateOptions({authInfo}) without customAgents, which triggers
        // loadCustomAgents() and overwrites any customAgents we pass here with an
        // empty array loaded from disk. We work around this by using
        // agent_type: "general-purpose" for delegations, embedding role prompts
        // in the task prompt field rather than relying on registered agent names.
        tools: this._anvilTools,
        hooks: this._sessionHooks,
        skillDirectories: this._skillDirectories.length > 0 ? this._skillDirectories : undefined,
        systemMessage: this.buildSystemMessage(),
        reasoningEffort: this.getEffectiveReasoningEffort(selectedModel),
      });

      this._currentSessionId = session.sessionId;
      this._currentModel = selectedModel ?? null;
      this.activateSession(session);

      // If the plugin fired setCustomAgents/setActiveAgent before the session existed,
      // those calls set _pendingRenewalAfterInit. Apply them now that we have a session.
      if (this._pendingRenewalAfterInit) {
        this._pendingRenewalAfterInit = false;
        this.emit(createLogEvent("info", `[initialize] Applying deferred renewal: activeAgent=${this._activeAgent?.name ?? 'none'}`));
        // Use scheduleRenewal so it picks up latest _activeAgent/_customAgents state
        await this.scheduleRenewal("initialize-deferred");
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const lowerMessage = message.toLowerCase();

      if (lowerMessage.includes("enoent") || lowerMessage.includes("spawn")) {
        throw new Error(
          "Copilot CLI not found. Please install GitHub Copilot CLI:\n" +
            "  npm install -g @githubnext/github-copilot-cli\n" +
            "Then authenticate:\n" +
            "  github-copilot-cli auth"
        );
      }

      if (lowerMessage.includes("auth") || lowerMessage.includes("unauthorized") ||
          lowerMessage.includes("401") || lowerMessage.includes("not logged in") ||
          lowerMessage.includes("token")) {
        throw new Error(
          "Copilot authentication required. Please authenticate:\n" +
            "  github-copilot-cli auth"
        );
      }

      throw error;
    }
  }

  // ── Session event translation ────────────────────────────────

  private setupSessionEventHandlers(): void {
    debugLog(`[SESSION] === NEW SESSION HANDLERS === ${new Date().toISOString()}`);
    if (!this.session) return;

    this.session.on((event) => {
      const rawData = (() => {
        try {
          return JSON.stringify(event.data) ?? "undefined";
        } catch {
          return "\"[unserializable]\"";
        }
      })();
      const rawDataTruncated = rawData.length > 200 ? `${rawData.slice(0, 200)}...` : rawData;
      const executingSubagentIds = Array.from(this.executingSubagentToolCalls);
      const activeSubagentIds = Array.from(this.activeSubagents.keys());
      debugLog(
        `[SDK-RAW] type=${event.type} execSubs=[${executingSubagentIds.join(",")}] activeSubs=[${activeSubagentIds.join(",")}] data=${rawDataTruncated}`,
      );
      const gen = this.currentRunGeneration;

      switch (event.type) {
        case "assistant.turn_start": {
          if (this.isEventStale(gen)) return;
          this.reasoningBuffer = "";

          if (this.currentRunId) {
            this.emit({
              type: "turn.started",
              runId: this.currentRunId,
              turnId: event.data?.turnId ?? "",
            });
          }
          break;
        }

        case "assistant.message_delta": {
          if (this.isEventStale(gen)) return;

          debugLog(`[ADAPTER] delta: content="${(event.data?.deltaContent ?? "").substring(0,30)}" msgId=${event.data?.messageId} ptcId=${event.data?.parentToolCallId || "none"} runId=${this.currentRunId || "null"} execSubagents=${this.executingSubagentToolCalls.size}`);

          const deltaContent = event.data?.deltaContent ?? "";
          if (!deltaContent) return;

          const messageId = event.data?.messageId;
          const explicitParentToolCallId = event.data?.parentToolCallId;
          let bufferKey = this.getStreamingBufferKey(messageId, explicitParentToolCallId);
          let existingBuffer = this.streamingBuffers.get(bufferKey);

          // Prefer explicit attribution from the SDK, but fall back to any existing attribution
          // already established for this messageId.
          let parentToolCallId: string | undefined = explicitParentToolCallId ?? existingBuffer?.parentToolCallId;
          let subagent = this.getTrackedSubagent(parentToolCallId);

          // SDK sometimes omits parentToolCallId for subagent deltas — infer only when exactly
          // one subagent tool execution is active. If the SDK emits deltas before both
          // tool.execution_start(task) and subagent.started, no attribution is possible here.
          if (!parentToolCallId && !subagent && this.executingSubagentToolCalls.size === 1) {
            const [inferredId, inferredAgent] = this.inferActiveSubagent();
            if (inferredId && inferredAgent) {
              parentToolCallId = inferredId;
              subagent = inferredAgent;
            }
          }

          const resolvedBufferKey = this.getStreamingBufferKey(messageId, parentToolCallId);
          if (resolvedBufferKey !== bufferKey) {
            bufferKey = resolvedBufferKey;
            existingBuffer = this.streamingBuffers.get(bufferKey) ?? existingBuffer;
          }
          if (parentToolCallId) this.closedSubagentStreams.delete(parentToolCallId);

          const bufferedAgentInfo = existingBuffer?.agentName || existingBuffer?.agentDisplayName
            ? { agentName: existingBuffer?.agentName, agentDisplayName: existingBuffer?.agentDisplayName }
            : undefined;

          const agentInfo = subagent
            || bufferedAgentInfo
            || (this._activeAgent ? {
              agentName: this._activeAgent.name,
              agentDisplayName: this._activeAgent.displayName || this._activeAgent.name,
            } : undefined);

          this.streamingBuffers.set(bufferKey, {
            text: (existingBuffer?.text ?? "") + deltaContent,
            parentToolCallId: parentToolCallId ?? existingBuffer?.parentToolCallId,
            agentName: agentInfo?.agentName ?? existingBuffer?.agentName,
            agentDisplayName: agentInfo?.agentDisplayName ?? existingBuffer?.agentDisplayName,
          });

          if (this.currentRunId) {
            // Debug logging for first delta of each message
            if ((!existingBuffer || existingBuffer.text.length === 0) && agentInfo) {
              this.emit(createLogEvent("debug", `${nf.send} Assistant delta starting - agent: ${agentInfo.agentDisplayName} (subagent: ${Boolean(subagent)}, parentToolCallId: ${parentToolCallId || "none"})`));
            }

            const deltaKey = parentToolCallId ?? "__main__";
            const existing = this.deltaBuffer.get(deltaKey);
            this.deltaBuffer.set(deltaKey, {
              text: (existing?.text ?? "") + deltaContent,
              runId: this.currentRunId,
              parentToolCallId,
              agentName: agentInfo?.agentName ?? existing?.agentName,
              agentDisplayName: agentInfo?.agentDisplayName ?? existing?.agentDisplayName,
            });
            if (this.deltaFlushTimer === null) {
              this.deltaFlushTimer = setTimeout(() => {
                this.deltaFlushTimer = null;
                this.flushDeltaBuffer();
              }, 16);
            }
          } else {
            debugLog(`[ADAPTER] delta DROPPED - no currentRunId`);
          }
          break;
        }

        case "assistant.message": {
          if (this.isEventStale(gen)) return;

          debugLog(`[ADAPTER] message: content="${(event.data?.content ?? "").substring(0,30)}" msgId=${event.data?.messageId} ptcId=${event.data?.parentToolCallId || "none"} runId=${this.currentRunId || "null"}`);

          const content = event.data?.content ?? "";
          const parentToolCallIdFromEvent = event.data?.parentToolCallId;
          const [inferredToolCallId] = (!parentToolCallIdFromEvent && this.executingSubagentToolCalls.size === 1)
            ? this.inferActiveSubagent()
            : [undefined, undefined];
          const bufferedMatch = this.findBufferedMessage(
            event.data?.messageId,
            parentToolCallIdFromEvent,
            inferredToolCallId,
          );
          const bufferKey = bufferedMatch?.[0];
          const bufferedMessage = bufferedMatch?.[1];
          const resolvedContent = content || bufferedMessage?.text || "";
          let parentToolCallId = parentToolCallIdFromEvent ?? bufferedMessage?.parentToolCallId ?? inferredToolCallId;

          // CRITICAL FALLBACK: if parentToolCallId is still unresolved and no buffer matched,
          // use recently completed subagent tracking once active execution has ended.
          if (!parentToolCallId && !bufferedMatch && resolvedContent) {
            const [fallbackId] = this.inferRecentlyCompletedSubagent();
            if (fallbackId) {
              parentToolCallId = fallbackId;
              this.emit(createLogEvent("debug", `${nf.pencil} Attributed unbuffered message to subagent via fallback inference: toolCallId=${fallbackId}`));
            }
          }

          const hadBufferedDelta = Boolean(bufferedMessage?.text);
          if (bufferKey) this.streamingBuffers.delete(bufferKey);
          if (parentToolCallId) this.closedSubagentStreams.add(parentToolCallId);

          // Use a fallback runId so content is never silently dropped
          // when this.currentRunId is temporarily null.
          const effectiveRunId = this.currentRunId || "unknown";

          this.emit(createLogEvent("debug", `${nf.pencil} Assistant message: parentToolCallId=${parentToolCallId}, content length=${resolvedContent.length}, runId=${effectiveRunId}`));

          if (!resolvedContent) {
            this.emit(createLogEvent("debug", `${nf.pencil} Assistant message: skipping empty content`));
          } else {
            const message = createAssistantMessage(resolvedContent);

            // Best-effort reasoning support: some SDK builds attach reasoning directly
            // to the completed assistant message instead of emitting reasoning_delta events.
            // Check all known field names the SDK uses across versions.
            const directReasoning = (event.data as any)?.reasoning
              ?? (event.data as any)?.reasoningContent
              ?? (event.data as any)?.reasoningText;
            if (typeof directReasoning === "string" && directReasoning.trim()) {
              (message as any).reasoning = directReasoning;
              this.reasoningBuffer = "";
            } else if (this.reasoningBuffer.trim()) {
              // Fall back to the buffer accumulated from assistant.reasoning_delta events.
              // This handles the case where reasoning_delta events fired but the message
              // didn't carry reasoning inline.
              (message as any).reasoning = this.reasoningBuffer;
              this.reasoningBuffer = "";
            }

            // Add agent information - from subagent if available, otherwise from active agent
            if (parentToolCallId) {
              message.parentToolCallId = parentToolCallId;
              this.emit(createLogEvent("debug", `Looking up subagent for toolCallId: ${parentToolCallId}`));
              const subagent = this.getTrackedSubagent(parentToolCallId);
              if (subagent) {
                this.emit(createLogEvent("info", `${nf.magic} Message from subagent: ${subagent.agentDisplayName}`));
                message.agentName = subagent.agentName;
                message.agentDisplayName = subagent.agentDisplayName;
              } else if (bufferedMessage?.agentName || bufferedMessage?.agentDisplayName) {
                message.agentName = bufferedMessage.agentName;
                message.agentDisplayName = bufferedMessage.agentDisplayName;
              } else {
                this.emit(createLogEvent("warn", `${nf.warning} No subagent found for toolCallId: ${parentToolCallId}. Active subagents: ${Array.from(this.activeSubagents.keys()).join(", ")}. Recently completed: ${Array.from(this.recentlyCompletedSubagents.keys()).join(", ")}`));
              }
            } else if (this._activeAgent) {
              // Message from top-level active agent (e.g., Engineering Manager)
              message.agentName = this._activeAgent.name;
              message.agentDisplayName = this._activeAgent.displayName || this._activeAgent.name;
            }

            if (parentToolCallId && !hadBufferedDelta) {
              this.emit({
                type: "assistant.delta",
                runId: effectiveRunId,
                text: resolvedContent,
                parentToolCallId,
                agentName: message.agentName,
                agentDisplayName: message.agentDisplayName,
              });
            }

            this.flushDeltaBuffer();

            this.emit({
              type: "assistant.message",
              runId: effectiveRunId,
              message,
            });

          }
          break;
        }

        case "assistant.turn_end": {
          if (this.isEventStale(gen)) return;

          if (this.currentRunId) {
            this.flushDeltaBuffer();
            this.flushStreamingBuffers(this.currentRunId);
          }

          if (this.currentRunId) {
            this.emit({
              type: "turn.ended",
              runId: this.currentRunId,
              turnId: event.data?.turnId ?? "",
            });
          }

          this.resetTurnStreamingBuffers();
          break;
        }

        case "tool.execution_start": {
          if (this.isEventStale(gen)) return;

          const toolName = event.data?.toolName;
          const args = parseToolArgs(event.data?.arguments);

          // Handle special tool calls
          if (toolName === "report_intent") {
            const intentArg =
              args && typeof args === "object"
                ? (args as any).intent
                : typeof args === "string"
                ? args
                : undefined;
            if (intentArg) {
              if (this.currentRunId) {
                const subagentToolCallId = this.resolveIntentToolCallId(event.data?.parentToolCallId);
                this.emit({ type: "intent.updated", runId: this.currentRunId, intent: intentArg, toolCallId: subagentToolCallId });
              }
            }
          } else if (toolName === "update_todo") {
            const toolCallId = event.data?.toolCallId;
            const todosArg =
              args && typeof args === "object"
                ? (args as any).todos
                : typeof args === "string"
                ? args
                : undefined;
            if (todosArg && this.currentRunId) {
              // Deduplicate by toolCallId when available
              if (!toolCallId || !this.todoUpdatedToolCallIds.has(toolCallId)) {
                if (toolCallId) this.todoUpdatedToolCallIds.add(toolCallId);
                this.emit({ type: "todo.updated", runId: this.currentRunId, todos: todosArg });
              }
            }
          } else if (toolName === "enforce_checklist" && args && typeof args === "object") {
            const action = (args as any).action;
            const items = (args as any).items as string[] | undefined;
            const itemIndex = (args as any).item_index as number | undefined;

            if (action === "register" && items && items.length > 0) {
              this.checklistItems = items.map((title, index) => ({
                id: `checklist-${index}`,
                title,
                checked: false,
              }));
              this.emitChecklistUpdate();
            } else if (
              action === "complete" &&
              itemIndex !== undefined &&
              itemIndex >= 0 &&
              itemIndex < this.checklistItems.length
            ) {
              this.checklistItems[itemIndex].checked = true;
              this.emitChecklistUpdate();
            }
          } else if (toolName === "sql" && args && typeof args === "object") {
            const toolCallId = event.data?.toolCallId;
            const query = (args as any).query as string | undefined;
            if (toolCallId && query) {
              this.sqlQueriesByToolCallId.set(toolCallId, query);
            }
            if (query && this.currentRunId) {
              const todoMarkdown = this.parseSqlTodoItems(query);
              if (todoMarkdown) {
                this.emit({ type: "todo.updated", runId: this.currentRunId, todos: todoMarkdown });
              }
            }
          }

          // Capture role/model metadata for subagent-style tool invocations.
          // Detect by task tool name or role marker in arguments.
          const serializedArgs = (() => {
            if (typeof args === "string") return args;
            if (args && typeof args === "object") {
              try {
                return JSON.stringify(args);
              } catch {
                return "";
              }
            }
            return "";
          })();
          const isSubagentToolCall =
            toolName === "task"
            || (typeof args === "string" && args.includes("## Role:"))
            || (typeof args === "object" && args !== null && serializedArgs.includes("## Role:"));

          if (isSubagentToolCall) {
            const toolCallId = event.data?.toolCallId;
            if (toolCallId) {
              let role: string | undefined;
              let model: string | undefined;
              let taskTitle: string | undefined;
              if (args && typeof args === "object") {
                const prompt = (args as any).prompt;
                const roleMatch = typeof prompt === "string" ? prompt.match(/^## Role:\s*(.+)/m) : null;
                role = roleMatch?.[1]?.trim();
                model = typeof (args as any).model === "string" ? (args as any).model : undefined;
                taskTitle = typeof (args as any).description === "string" ? (args as any).description : undefined;
              } else if (typeof args === "string") {
                const roleMatch = args.match(/^## Role:\s*(.+)/m);
                role = roleMatch?.[1]?.trim();
              }
              this.pendingAgentRoles.set(toolCallId, { role, model, taskTitle });

              // Keep a strict execution window for subagent attribution.
              this.executingSubagentToolCalls.add(toolCallId);
              this.recentlyCompletedSubagents.delete(toolCallId);

              // Pre-register the subagent so early deltas can be attributed even if the SDK
              // emits assistant.message_delta before subagent.started.
              if (!this.activeSubagents.has(toolCallId)) {
                const agentDisplayName = role ?? "Subagent";
                const agentName = role ? role.toLowerCase().replace(/\s+/g, "-") : "subagent";
                this.activeSubagents.set(toolCallId, { agentName, agentDisplayName, model });
                this.closedSubagentStreams.delete(toolCallId);
                this.ensureSubagentStreamingBuffer(toolCallId, { agentName, agentDisplayName, model });
                this.emit(createLogEvent("debug", `Pre-registered subagent from ${toolName ?? "unknown"} tool: ${agentDisplayName} (toolCallId=${toolCallId}), buffer seeded`));
              }
            }
          }

          if (this.currentRunId) {
            const parentToolCallIdRaw = (event.data as any)?.parentToolCallId;
            const sdkParentToolCallId =
              typeof parentToolCallIdRaw === "string" && parentToolCallIdRaw ? parentToolCallIdRaw : undefined;
            this.emit({
              type: "tool.started",
              runId: this.currentRunId,
              toolCallId: event.data?.toolCallId ?? "",
              toolName: event.data?.toolName ?? "unknown",
              arguments: typeof args === "object" && args !== null ? args as Record<string, unknown> : undefined,
              parentToolCallId: sdkParentToolCallId,
            });
          }
          break;
        }

        case "assistant.intent": {
          if (this.isEventStale(gen)) return;

          const intent = event.data?.intent;
          if (intent) {
            if (this.currentRunId) {
              const subagentToolCallId = this.resolveIntentToolCallId();
              this.emit({ type: "intent.updated", runId: this.currentRunId, intent, toolCallId: subagentToolCallId });
            }
          }
          break;
        }

        case "tool.execution_progress": {
          if (this.isEventStale(gen)) return;

          if (this.currentRunId) {
            const parentToolCallIdRaw = (event.data as any)?.parentToolCallId;
            const sdkParentToolCallId =
              typeof parentToolCallIdRaw === "string" && parentToolCallIdRaw ? parentToolCallIdRaw : undefined;
            this.emit({
              type: "tool.progress",
              runId: this.currentRunId,
              toolCallId: event.data?.toolCallId ?? "",
              message: event.data?.progressMessage ?? "",
              parentToolCallId: sdkParentToolCallId,
            });
          }
          break;
        }

        case "tool.execution_complete": {
          if (this.isEventStale(gen)) return;

          if (this.currentRunId) {
            const completeToolCallId = event.data?.toolCallId ?? "";
            const parentToolCallIdRaw = (event.data as any)?.parentToolCallId;
            const sdkParentToolCallId =
              typeof parentToolCallIdRaw === "string" && parentToolCallIdRaw ? parentToolCallIdRaw : undefined;
            if (!this.activeSubagents.has(completeToolCallId)) {
              this.executingSubagentToolCalls.delete(completeToolCallId);
            }
            const toolSuccess = event.data?.success ?? false;
            const sqlQuery = this.sqlQueriesByToolCallId.get(completeToolCallId);
            if (sqlQuery) this.sqlQueriesByToolCallId.delete(completeToolCallId);

            this.emit({
              type: "tool.completed",
              runId: this.currentRunId,
              toolCallId: completeToolCallId,
              success: toolSuccess,
              output: extractToolOutput(event.data?.result),
              error: event.data?.error?.message,
              parentToolCallId: sdkParentToolCallId,
            });

            if (sqlQuery) {
              const todoMarkdown = this.parseSqlTodoItemsFromResult(sqlQuery, event.data?.result);
              if (todoMarkdown) {
                this.emit({ type: "todo.updated", runId: this.currentRunId, todos: todoMarkdown });
              }
            }

            const pendingSubagent = this.activeSubagents.get(completeToolCallId);
            if (pendingSubagent) {
              this.recentlyCompletedSubagents.set(completeToolCallId, pendingSubagent);
              this.emit(createLogEvent("debug", `Subagent ${pendingSubagent.agentDisplayName} still tracked at tool completion — retained for fallback attribution (tool success=${toolSuccess})`));
            }
          }
          break;
        }

        case "assistant.reasoning_delta": {
          if (this.isEventStale(gen)) return;

          const reasoningDelta = event.data?.deltaContent ?? (event.data as any)?.delta ?? "";
          if (!reasoningDelta) return;
          const parentToolCallIdRaw = (event.data as any)?.parentToolCallId;
          let parentToolCallId = typeof parentToolCallIdRaw === "string" && parentToolCallIdRaw ? parentToolCallIdRaw : undefined;
          let subagent = this.getTrackedSubagent(parentToolCallId);

          if (!parentToolCallId && !subagent && this.executingSubagentToolCalls.size === 1) {
            const [inferredId, inferredAgent] = this.inferActiveSubagent();
            if (inferredId && inferredAgent) {
              parentToolCallId = inferredId;
              subagent = inferredAgent;
            }
          }

          if (!parentToolCallId) {
            this.reasoningBuffer += reasoningDelta;
          }

          const agentInfo = subagent || (this._activeAgent ? {
            agentName: this._activeAgent.name,
            agentDisplayName: this._activeAgent.displayName || this._activeAgent.name,
          } : undefined);

          if (this.currentRunId) {
            this.emit({
              type: "reasoning.delta",
              runId: this.currentRunId,
              reasoningId: event.data?.reasoningId ?? "",
              text: reasoningDelta,
              parentToolCallId,
              agentName: agentInfo?.agentName,
              agentDisplayName: agentInfo?.agentDisplayName,
            });
          }
          break;
        }

        case "assistant.reasoning": {
          if (this.isEventStale(gen)) return;

          const reasoningContent = event.data?.content ?? "";
          const parentToolCallIdRaw2 = (event.data as any)?.parentToolCallId;
          let parentToolCallId = typeof parentToolCallIdRaw2 === "string" && parentToolCallIdRaw2 ? parentToolCallIdRaw2 : undefined;
          let subagent = this.getTrackedSubagent(parentToolCallId);

          if (!parentToolCallId && !subagent && this.executingSubagentToolCalls.size === 1) {
            const [inferredId, inferredAgent] = this.inferActiveSubagent();
            if (inferredId && inferredAgent) {
              parentToolCallId = inferredId;
              subagent = inferredAgent;
            }
          }

          if (this.currentRunId && reasoningContent) {
            this.emit({
              type: "reasoning.message",
              runId: this.currentRunId,
              reasoningId: event.data?.reasoningId ?? "",
              content: reasoningContent,
              parentToolCallId,
              agentName: subagent?.agentName,
              agentDisplayName: subagent?.agentDisplayName,
            });
          }
          break;
        }

        case "session.idle": {
          if (!this.isProcessing) return;

          // The SDK may fire session.idle while waiting for the
          // onUserInputRequest callback to resolve.  Ignore it —
          // the real idle will arrive after the user answers and
          // the agent finishes its remaining turns.
          if (this.hasPendingUserInput) {
            this.emit(createLogEvent("debug", "Ignoring session.idle — user input pending"));
            return;
          }

          if (this.currentRunId) {
            const runId = this.currentRunId;

            this.flushDeltaBuffer();
            this.flushStreamingBuffers(runId);

            this.emit({ type: "run.finished", runId, createdAt: new Date() });
            this.emit(createLogEvent("info", "Response complete", runId));

            this.resetRunTrackingState();
            this.currentRunId = null;
            this.isProcessing = false;
          }
          break;
        }

        case "session.error": {
          this.emit(
            createLogEvent("error", `Session error: ${event.data?.message || "Unknown session error"}`, this.currentRunId)
          );
          break;
        }

        case "session.model_change": {
          this._currentModel = event.data?.newModel ?? null;
          this.emit({ type: "model.changed", model: this._currentModel });
          break;
        }

        case "session.usage_info": {
          this.emit({
            type: "usage.info",
            tokenLimit: event.data?.tokenLimit ?? 0,
            currentTokens: event.data?.currentTokens ?? 0,
            messagesLength: event.data?.messagesLength ?? 0,
          });
          break;
        }

        case "session.title_changed": {
          if ((event.data as any)?.title) {
            this.listSessions().then((sessions) => {
              this.emit({ type: "session.list.updated", sessions });
            }).catch(() => {});
          }
          break;
        }

        case "assistant.usage": {
          const quotaSnapshots = event.data?.quotaSnapshots;
          let remainingPremiumRequests: number | null = null;

          if (quotaSnapshots && Object.keys(quotaSnapshots).length > 0) {
            for (const [, quota] of Object.entries(quotaSnapshots)) {
              remainingPremiumRequests = Math.max(0, quota.entitlementRequests - quota.usedRequests);
              break;
            }
          }

          this.emit({
            type: "quota.info",
            remainingPremiumRequests,
            consumedRequests: 0, // Not used - harness tracks this via run.finished
          });
          break;
        }

        case "subagent.selected": {
          if (this.isEventStale(gen)) return;
          this.emit(createLogEvent("info", `${nf.search} Subagent selected: ${event.data?.agentName} (${event.data?.agentDisplayName})`));
          break;
        }

        case "subagent.started": {
          if (this.isEventStale(gen)) return;
          if (this.currentRunId) {
            const toolCallId = event.data?.toolCallId ?? "";
            const existingSubagent = this.activeSubagents.get(toolCallId);
            let agentName = event.data?.agentName ?? existingSubagent?.agentName ?? "";
            let agentDisplayName = event.data?.agentDisplayName ?? existingSubagent?.agentDisplayName ?? "";

            // Extract agent name/display name from the "## Role:" marker in the task prompt
            // (since we use general-purpose, the SDK's agentName will be "general-purpose").
            // Fall back to whatever the SDK provides if no role marker was found.
            const pendingData = this.pendingAgentRoles.get(toolCallId);
            let model: string | undefined = existingSubagent?.model;
            let taskTitle: string | undefined;
            if (pendingData) {
              // Always use the role marker to override the generic "General Purpose Agent"
              // name the SDK assigns when agent_type is "general-purpose".
              if (pendingData.role) {
                agentDisplayName = pendingData.role;
                agentName = pendingData.role.toLowerCase().replace(/\s+/g, "-");
              }
              model = pendingData.model;
              taskTitle = pendingData.taskTitle;
              this.pendingAgentRoles.delete(toolCallId);
            }
            if (!agentDisplayName) agentDisplayName = agentName || "Subagent";
            if (!agentName) {
              const normalized = agentDisplayName.toLowerCase().trim().replace(/\s+/g, "-");
              agentName = normalized || "subagent";
            }

            this.emit(createLogEvent("info", `${nf.rocket} Subagent STARTED: ${agentDisplayName} (${agentName}) - toolCallId: ${toolCallId}`));

            // Track this subagent so we can attribute its messages.
            // subagent.started is authoritative, so always (re)register it here.
            this.activeSubagents.set(toolCallId, { agentName, agentDisplayName, model });
            if (!this.executingSubagentToolCalls.has(toolCallId)) {
              this.executingSubagentToolCalls.add(toolCallId);
            }
            this.recentlyCompletedSubagents.delete(toolCallId);
            this.closedSubagentStreams.delete(toolCallId);
            this.ensureSubagentStreamingBuffer(toolCallId, { agentName, agentDisplayName, model });
            this.emit(createLogEvent("debug", `Subagent registered + buffer seeded: ${agentDisplayName} (toolCallId=${toolCallId})`));

            this.emit({
              type: "subagent.started",
              runId: this.currentRunId,
              toolCallId,
              agentName,
              agentDisplayName,
              agentDescription: event.data?.agentDescription ?? "",
              model,
              taskTitle,
            });
          }
          break;
        }

        case "subagent.completed": {
          if (this.isEventStale(gen)) return;
          if (this.currentRunId) {
            const toolCallId = event.data?.toolCallId ?? "";
            const completedSubagent = this.activeSubagents.get(toolCallId);

            if (completedSubagent) {
              this.recentlyCompletedSubagents.set(toolCallId, completedSubagent);
            }
            this.activeSubagents.delete(toolCallId);
            this.closedSubagentStreams.delete(toolCallId);
            this.executingSubagentToolCalls.delete(toolCallId);

            this.emit({
              type: "subagent.completed",
              runId: this.currentRunId,
              toolCallId,
              agentName: completedSubagent?.agentName ?? event.data?.agentName ?? "",
            });
          }
          break;
        }

        case "subagent.failed": {
          if (this.isEventStale(gen)) return;
          if (this.currentRunId) {
            const toolCallId = event.data?.toolCallId ?? "";
            const failedAgentName = event.data?.agentName ?? "";
            const failError = event.data?.error ?? "Unknown error";
            const failedSubagent = this.activeSubagents.get(toolCallId);

            if (failedSubagent) {
              this.recentlyCompletedSubagents.set(toolCallId, failedSubagent);
            }
            this.activeSubagents.delete(toolCallId);
            this.closedSubagentStreams.delete(toolCallId);
            this.executingSubagentToolCalls.delete(toolCallId);

            this.emit(createLogEvent("info", `Subagent ${failedAgentName} reported as "failed" by SDK (${failError}) — converting to completed for UI`));

            this.emit({
              type: "subagent.completed",
              runId: this.currentRunId,
              toolCallId,
              agentName: failedAgentName,
            });
          }
          break;
        }

        case "skill.invoked": {
          if (this.isEventStale(gen)) return;
          if (this.currentRunId) {
            this.emit({
              type: "skill.invoked",
              runId: this.currentRunId,
              name: event.data?.name ?? "",
              path: event.data?.path ?? "",
            });
          }
          break;
        }
      }
    });
  }

  // ── Prompt execution ─────────────────────────────────────────

  async sendPrompt(prompt: string, runId: string, images?: string[]): Promise<void> {
    if (!this.session) {
      throw new Error("Session not initialized");
    }

    this.expectedRunGeneration++;
    this.currentRunGeneration = this.expectedRunGeneration;
    this.currentRunId = runId;
    this.isCancelled = false;
    this.isProcessing = true;
    this.resetRunTrackingState();

    const attachments = images?.map((imagePath) => ({
      type: "file" as const,
      path: imagePath,
    }));
    const sendPayload = {
      prompt,
      attachments: attachments && attachments.length > 0 ? attachments : undefined,
    };

    try {
      await this.session.send(sendPayload);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const lowerMessage = message.toLowerCase();

      if (lowerMessage.includes("session") ||
          lowerMessage.includes("expired") ||
          lowerMessage.includes("invalid") ||
          lowerMessage.includes("closed") ||
          lowerMessage.includes("terminated")) {
        this.emit(createLogEvent("warn", "Session expired, renewing...", runId));
        await this.renewSession();

        // Bump generation to invalidate stale events from the old session
        this.expectedRunGeneration++;
        this.currentRunGeneration = this.expectedRunGeneration;
        this.resetRunTrackingState();

        this.emit(createLogEvent("info", "Session renewed, retrying prompt...", runId));
        await this.session!.send(sendPayload);
      } else {
        throw error;
      }
    }
  }

  async abort(): Promise<void> {
    const runId = this.currentRunId;

    this.isCancelled = true;
    this.isProcessing = false;
    this.hasPendingUserInput = false;
    this.expectedRunGeneration++;

    if (this.session) {
      try { await this.session.abort(); } catch { /* best-effort */ }
    }

    this.flushDeltaBuffer();
    this.resetRunTrackingState();
    this.currentRunId = null;

    if (runId) {
      this.emit({ type: "run.cancelled", runId, createdAt: new Date() });
    }
  }

  // ── Session management ───────────────────────────────────────

  private async renewSession(): Promise<void> {
    if (!this.client) throw new Error("Client not initialized");

    await this.teardownSession();

    const session = await this.client.createSession({
      streaming: true,
      model: this._currentModel ?? undefined,
      onPermissionRequest: approveAll,
      onUserInputRequest: this.getUserInputCallback(),
      tools: this._anvilTools,
      hooks: this._sessionHooks,
      skillDirectories: this._skillDirectories.length > 0 ? this._skillDirectories : undefined,
      systemMessage: this.buildSystemMessage(),
      reasoningEffort: this.getEffectiveReasoningEffort(),
    });

    this.activateSession(session);
  }

  async switchModel(modelId: string): Promise<void> {
    if (!this.client) throw new Error("Client not initialized");
    if (this.isProcessing) throw new Error("Cannot switch model while processing");
    if (!this.session) throw new Error("No active session to switch model");

    await this.session.setModel(modelId);

    // Update local tracking. The SDK also fires a `session.model_change` event
    // which our handler processes, but we update here too for immediate consistency.
    this._currentModel = modelId;
    this.emit({ type: "model.changed", model: modelId });
  }

  async createNewSession(): Promise<string> {
    if (!this.client) throw new Error("Client not initialized");
    if (this.isProcessing) throw new Error("Cannot create new session while processing");

    await this.teardownSession();

    const session = await this.client.createSession({
      streaming: true,
      model: this._currentModel ?? undefined,
      onPermissionRequest: approveAll,
      onUserInputRequest: this.getUserInputCallback(),
      tools: this._anvilTools,
      hooks: this._sessionHooks,
      skillDirectories: this._skillDirectories.length > 0 ? this._skillDirectories : undefined,
      systemMessage: this.buildSystemMessage(),
      reasoningEffort: this.getEffectiveReasoningEffort(),
    });

    const sessionId = session.sessionId;
    this._currentSessionId = sessionId;
    this.activateSession(session);

    this.emit({
      type: "session.created",
      sessionId,
      sessionName: "New session",
    });

    this.listSessions().then((sessions) => {
      this.emit({ type: "session.list.updated", sessions });
    }).catch(() => {});

    return sessionId;
  }

  async switchToSession(sessionId: string): Promise<void> {
    if (!this.client) throw new Error("Client not initialized");
    if (this.isProcessing) throw new Error("Cannot switch session while processing");

    await this.teardownSession();

    const session = await this.client.resumeSession(sessionId, {
      streaming: true,
      model: this._currentModel ?? undefined,
      onPermissionRequest: approveAll,
      onUserInputRequest: this.getUserInputCallback(),
      tools: this._anvilTools,
      hooks: this._sessionHooks,
      skillDirectories: this._skillDirectories.length > 0 ? this._skillDirectories : undefined,
      systemMessage: this.buildSystemMessage(),
      reasoningEffort: this.getEffectiveReasoningEffort(),
    });

    this._currentSessionId = sessionId;
    this.activateSession(session);
    const switchedSessionName = (await this.listSessions()).find((s) => s.id === sessionId)?.name ?? "";

    this.emit({
      type: "session.switched",
      sessionId,
      sessionName: switchedSessionName,
      transcript: await this.getSessionHistory(),
    });

    this.listSessions().then((sessions) => {
      this.emit({ type: "session.list.updated", sessions });
    }).catch(() => {});
  }

  // ── Plan watcher ─────────────────────────────────────────────

  private setupPlanWatcher(): void {
    if (!this.workspacePath) return;

    const planPath = path.join(this.workspacePath, "plan.md");

    const readAndEmitPlan = () => {
      try {
        if (existsSync(planPath)) {
          this.emit({ type: "plan.updated", content: readFileSync(planPath, "utf-8") });
        }
      } catch {
        // Ignore errors
      }
    };

    readAndEmitPlan();

    try {
      this.planWatcher = watch(this.workspacePath, (_eventType: string, filename: string | null) => {
        if (filename === "plan.md") readAndEmitPlan();
      });
    } catch {
      // Directory doesn't exist or can't be watched
    }
  }

  // ── Session history ──────────────────────────────────────────

  async listSessions(): Promise<SessionInfo[]> {
    if (!this.client) return [];

    try {
      const sessions = (await this.client.listSessions()) as SessionMetadata[];
      const cwd = path.resolve(process.cwd());
      return sessions.map((s) => ({
        id: s.sessionId,
        name: s.summary || "New session",
        createdAt: s.startTime ?? undefined,
        lastUsedAt: s.modifiedTime ?? undefined,
        isCurrentProject: s.context?.cwd ? path.resolve(s.context.cwd) === cwd : true,
      }));
    } catch (error) {
      this.emit(createLogEvent("error", `Failed to list sessions: ${error}`));
      return [];
    }
  }

  private async getSessionHistory(): Promise<TranscriptItem[]> {
    if (!this.session) return [];

    let events: SessionEvent[];
    try {
      events = await this.session.getMessages();
    } catch {
      return [];
    }

    const transcript: TranscriptItem[] = [];
    const toolCallIndex = new Map<string, number>();

    for (const event of events) {
      if ((event as any).ephemeral) continue;

      switch (event.type) {
        case "user.message": {
          transcript.push({
            id: event.id,
            kind: "message",
            role: "user",
            content: event.data.content,
            createdAt: new Date(event.timestamp),
          });
          break;
        }

        case "assistant.message": {
          if (!event.data.content) break;
          transcript.push({
            id: event.id,
            kind: "message",
            role: "assistant",
            content: event.data.content,
            createdAt: new Date(event.timestamp),
          });
          break;
        }

        case "tool.execution_start": {
          toolCallIndex.set(event.data.toolCallId, transcript.length);
          transcript.push({
            id: event.id,
            kind: "tool-call",
            toolCallId: event.data.toolCallId,
            toolName: event.data.toolName,
            arguments: event.data.arguments as Record<string, unknown> | undefined,
            progress: [],
            status: "running",
            startedAt: new Date(event.timestamp),
          });
          break;
        }

        case "tool.execution_complete": {
          const idx = toolCallIndex.get(event.data.toolCallId);
          if (idx !== undefined) {
            const existing = transcript[idx] as ToolCallItem;
            transcript[idx] = {
              ...existing,
              status: event.data.success ? "completed" : "failed",
              completedAt: new Date(event.timestamp),
              output: event.data.result?.content,
              error: event.data.error?.message,
            };
          }
          break;
        }

        default:
          break;
      }
    }

    return transcript;
  }

  // ── Ephemeral runs ───────────────────────────────────────────

  async runEphemeralPrompt(
    prompt: string,
    runId: string,
    options?: {
      model?: string;
      onEvent?: (event: HarnessEvent) => void;
    }
  ): Promise<void> {
    if (!this.client) throw new Error("Client not initialized");

    const model = options?.model ?? "gemini-3-flash";
    const onEvent = options?.onEvent;

    const ephemeralSessionId = `_ephemeral_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
    let ephemeralSession: CopilotSession | null = null;

    try {
      ephemeralSession = await this.client.createSession({
        sessionId: ephemeralSessionId,
        streaming: true,
        model,
        infiniteSessions: { enabled: false },
        onPermissionRequest: approveAll,
        onUserInputRequest: this.getUserInputCallback(),
        reasoningEffort: this.getEffectiveReasoningEffort(model),
      });

      let ephemeralStreamingBuffer = "";

      ephemeralSession.on((event) => {
        switch (event.type) {
          case "assistant.message_delta": {
            const deltaContent = event.data?.deltaContent ?? "";
            if (deltaContent) {
              ephemeralStreamingBuffer += deltaContent;
              onEvent?.({ type: "assistant.delta", runId, text: deltaContent });
            }
            break;
          }

          case "assistant.message": {
            const content = event.data?.content ?? "";
            const resolvedContent = content || ephemeralStreamingBuffer;
            if (resolvedContent && onEvent) {
              onEvent({
                type: "assistant.message",
                runId,
                message: createAssistantMessage(resolvedContent),
              });
            }
            ephemeralStreamingBuffer = "";
            break;
          }

          case "tool.execution_start": {
            if (onEvent) {
              const args = parseToolArgs(event.data?.arguments);
              const parentToolCallIdRaw = (event.data as any)?.parentToolCallId;
              const sdkParentToolCallId =
                typeof parentToolCallIdRaw === "string" && parentToolCallIdRaw ? parentToolCallIdRaw : undefined;
              onEvent({
                type: "tool.started",
                runId,
                toolCallId: event.data?.toolCallId ?? "",
                toolName: event.data?.toolName ?? "unknown",
                arguments: typeof args === "object" && args !== null ? args as Record<string, unknown> : undefined,
                parentToolCallId: sdkParentToolCallId,
              });
            }
            break;
          }

          case "tool.execution_complete": {
            const parentToolCallIdRaw = (event.data as any)?.parentToolCallId;
            const sdkParentToolCallId =
              typeof parentToolCallIdRaw === "string" && parentToolCallIdRaw ? parentToolCallIdRaw : undefined;
            onEvent?.({
              type: "tool.completed",
              runId,
              toolCallId: event.data?.toolCallId ?? "",
              success: event.data?.success ?? false,
              output: extractToolOutput(event.data?.result),
              error: event.data?.error?.message,
              parentToolCallId: sdkParentToolCallId,
            });
            break;
          }

          case "session.idle": {
            onEvent?.({ type: "run.finished", runId, createdAt: new Date() });
            break;
          }

          case "assistant.intent": {
            const intent = event.data?.intent;
            if (intent) onEvent?.({ type: "intent.updated", runId, intent });
            break;
          }
        }
      });

      await ephemeralSession.send({ prompt });

      await new Promise<void>((resolve) => {
        ephemeralSession!.on((event) => {
          if (event.type === "session.idle") resolve();
        });
      });
    } finally {
      if (ephemeralSession) {
        try { await ephemeralSession.destroy(); } catch { /* ignore */ }
      }
    }
  }

  // ── Shutdown ─────────────────────────────────────────────────

  async shutdown(): Promise<void> {
    await this.teardownSession();
    this.session = null;

    if (this.client) {
      try {
        await this.client.stop();
      } catch {
        await this.client.forceStop();
      }
      this.client = null;
    }
  }
}
