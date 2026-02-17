import { CopilotClient, CopilotSession } from "@github/copilot-sdk";
import type { ModelInfo, SessionEvent, SystemMessageConfig, Tool } from "@github/copilot-sdk";
import type { HarnessEvent, SessionInfo, TranscriptItem, ToolCallItem } from "../harness/events.js";
import { createAssistantMessage, createLogEvent } from "../harness/events.js";
import * as path from "path";
import { existsSync, readFileSync, watch, type FSWatcher } from "node:fs";
import { getOrchestrationAgents } from "../cli/agents.js";
import { getAnvilTools } from "../cli/tools.js";
import { createSessionHooks } from "../cli/hooks.js";
import { loadModelConfig, resolveAgentModel, type AgentModelOverride } from "../agents/modelConfig.js";
import { nf } from "../ui/icons.js";

export type AdapterEventHandler = (event: HarnessEvent) => void;

export type UserInputHandler = (
  request: { question: string; choices?: string[]; allowFreeform?: boolean }
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
  private streamingBuffer = "";
  private reasoningBuffer = "";
  private isCancelled = false;
  private isProcessing = false;
  private expectedRunGeneration = 0;
  private currentRunGeneration = 0;
  private _currentModel: string | null = null;
  private _availableModels: ModelDescription[] = [];
  private hasEmittedContentForTurn = false;
  private planWatcher: FSWatcher | null = null;
  private workspacePath: string | null = null;
  private userInputHandler: UserInputHandler | null = null;
  private _currentSessionId: string | null = null;
  private _projectPrefix: string;
  private _customAgents: CustomAgentDef[] = [];
  private _activeAgent: CustomAgentDef | null = null;
  private _reasoningEffort: "low" | "medium" | "high" | "xhigh" = "medium";
  /** True while the onUserInputRequest callback is awaiting a user response */
  private hasPendingUserInput = false;
  /** Guards against concurrent renewSessionWithAgents calls */
  private _renewalPromise: Promise<void> | null = null;
  /** Map of tool call IDs to subagent information */
  private activeSubagents = new Map<string, { agentName: string; agentDisplayName: string }>();
  /** Map of tool call IDs to specialist role names extracted from task tool prompts.
   *  Populated in tool.execution_start, consumed in subagent.started to override
   *  the generic "general-purpose" display name with the actual specialist name. */
  private pendingAgentRoles = new Map<string, string>();

  /** Pre-built Anvil tools for the SDK integration */
  private _anvilTools: Tool<any>[] = getAnvilTools();
  /** Session hooks for guardrails and context enrichment */
  private _sessionHooks = createSessionHooks();
  /** Skill directories discovered from the project */
  private _skillDirectories: string[] = [];

  constructor() {
    this._projectPrefix = path.basename(process.cwd()) + "-";

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
   * These agents will be available for delegation by the tech lead.
   * If a session is already active, it will be recreated with the new agents.
   */
  async setCustomAgents(agents: CustomAgentDef[]): Promise<void> {
    // Merge orchestration agents with existing builtin agents.
    // Orchestration agents supersede existing agents that serve the same role:
    //   tech-lead and strategist are the new coordination agents.
    // All other existing agents (developers, specialists) are kept as-is
    // since the tech-lead references them by name in its delegation table.
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

  private getEffectiveReasoningEffort(): "low" | "medium" | "high" | "xhigh" | undefined {
    const model = this._availableModels.find((m) => m.id === this._currentModel);
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
    if (!this.session || !this.client || this.isProcessing) return;

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

    // Resume the same session with updated agents, tools, hooks, and system message
      const opts = {
        streaming: true as const,
        model: this._currentModel ?? undefined,
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

  get projectPrefix(): string {
    return this._projectPrefix;
  }

  // ── Internal helpers ─────────────────────────────────────────

  private emit(event: HarnessEvent): void {
    this.eventHandler?.(event);
  }

  /** Returns true when an event should be discarded (cancelled, not processing, or stale generation). */
  private isEventStale(gen: number): boolean {
    return this.isCancelled || !this.isProcessing || gen !== this.expectedRunGeneration;
  }

  /** Reset streaming / reasoning buffers and the content-emitted flag. */
  private resetStreamingState(): void {
    this.streamingBuffer = "";
    this.reasoningBuffer = "";
    this.hasEmittedContentForTurn = false;
    this.activeSubagents.clear();
    this.pendingAgentRoles.clear();
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
  private getUserInputCallback(): ((request: any) => Promise<{ answer: string; wasFreeform: boolean }>) | undefined {
    return this.userInputHandler
      ? async (request: any) => {
          this.hasPendingUserInput = true;
          this.emit(createLogEvent("debug", "User input requested — pausing idle handling"));
          try {
            return await this.userInputHandler!(request);
          } finally {
            this.hasPendingUserInput = false;
            this.emit(createLogEvent("debug", "User input received — resuming idle handling"));
          }
        }
      : undefined;
  }

  /** Generate a new project-scoped session ID. */
  private generateSessionId(): string {
    return this._projectPrefix + Date.now().toString(36);
  }

  /**
   * Build system message config for the session.
   *
   * If an active agent is selected, uses that agent's system prompt directly,
   * making the LLM behave AS that agent (the top-level agent).
   *
   * Additionally, advertises other available agents as potential subagents
   * that can be delegated to via the task tool, using agent_type "general-purpose"
   * with the specialist's role instructions embedded in the prompt.
   *
   * We use "general-purpose" instead of custom agent names because the CLI's
   * setAuthInfo flow calls loadCustomAgents() after every session.create/resume,
   * which overwrites any customAgents we register with an empty array from disk.
   */
  private buildSystemMessage(): SystemMessageConfig | undefined {
    // If an active agent is selected, use its system prompt as the primary instruction
    if (this._activeAgent) {
      this.emit(createLogEvent("debug", `Building system message for active agent: ${this._activeAgent.displayName ?? this._activeAgent.name}`));

      // Build delegation guide for other available agents
      const otherAgents = this._customAgents.filter(a => a.name !== this._activeAgent?.name);
      const delegationGuide = otherAgents.length > 0
        ? this.buildDelegationGuide(otherAgents)
        : '';

      return {
        mode: "replace" as const,
        content: `${this._activeAgent.prompt}\n\n${delegationGuide}`,
      };
    }

    // No active agent - just advertise all available agents as options
    if (this._customAgents.length === 0) return undefined;

    return {
      mode: "append" as const,
      content: `\n\n${this.buildDelegationGuide(this._customAgents)}`,
    };
  }

  /**
   * Build a delegation guide that instructs the LLM how to delegate to specialists.
   *
   * Uses agent_type "general-purpose" for ALL delegations, with the specialist's
   * role preamble embedded in the prompt. This avoids the customAgents overwrite
   * issue while preserving specialist behavior.
   *
   * Each specialist entry includes a `model` parameter so the subagent runs on
   * the correct model (e.g., claude-opus-4.6 for the Tech Lead, gpt-5-mini for
   * the Scout). The model is resolved from the central agent model config.
   *
   * The guide also includes a role marker format (## Role: Name) that we parse
   * in the event handler to extract display names for subagent UI attribution.
   */
  private buildDelegationGuide(agents: CustomAgentDef[]): string {
    // Load model config (user overrides + built-in defaults)
    const modelConfig = loadModelConfig();
    const availableModelIds = new Set(this._availableModels.map(m => m.id));

    const agentEntries = agents.map(a => {
      const displayName = a.displayName || a.name;
      // Extract the first meaningful line of the prompt as a condensed preamble
      const preambleLines = a.prompt.split('\n').filter(l => l.trim().length > 0);
      const preamble = preambleLines[0]?.trim() ?? '';

      // Resolve model for this agent
      const modelOverride = resolveAgentModel(a.name, modelConfig);
      const model = modelOverride.model && availableModelIds.has(modelOverride.model)
        ? modelOverride.model
        : undefined;

      let entry = `### ${displayName}
- **Description**: ${a.description || 'No description'}`;
      if (model) entry += `\n- **Model**: "${model}"`;
      entry += `\n- **Preamble**: "${preamble}"`;

      return entry;
    }).join('\n\n');

    // Pick a representative agent for the example
    const exampleAgent = agents.find(a => a.name === 'staff-engineer') ?? agents[0];
    const exampleName = exampleAgent?.displayName || exampleAgent?.name || 'Specialist';
    const examplePreamble = exampleAgent?.prompt.split('\n').filter(l => l.trim().length > 0)[0]?.trim() ?? 'You are a specialist.';
    const exampleModel = resolveAgentModel(exampleAgent?.name ?? '', modelConfig);
    const exampleModelStr = exampleModel.model && availableModelIds.has(exampleModel.model)
      ? `\n  "model": "${exampleModel.model}",`
      : '';

    return `<delegation_guide>
To delegate work to specialists, use the task tool with these parameters:
- **agent_type**: "general-purpose"  (ALWAYS use this exact value for ALL delegations)
- **model**: Use the specialist's listed Model value (overrides the default model)
- **prompt**: Start with the role marker line, then the specialist's preamble, then describe the task

## CRITICAL RULES
1. ALWAYS use agent_type "general-purpose" — never use specialist names as agent_type
2. ALWAYS include the specialist's model parameter if one is listed
3. ALWAYS start the prompt with a role marker: ## Role: [Specialist Display Name]
4. Follow the role marker with the specialist's preamble to set their persona
5. Then describe the specific task

## Available Specialists

${agentEntries}

## Delegation Format

\`\`\`json
{
  "agent_type": "general-purpose",${exampleModelStr}
  "prompt": "## Role: ${exampleName}\\n${examplePreamble}\\n\\nTask: [describe the specific task here]"
}
\`\`\`

## Sub-delegation
Specialists can also delegate to other specialists using the same format.
Each specialist has access to the task tool and can use agent_type "general-purpose".
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
        // Extract provider from model ID (e.g., "claude-sonnet-4.5" -> "Claude")
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

      const sessionId = this.generateSessionId();

      // Pre-load orchestration agents as defaults
      if (this._customAgents.length === 0) {
        this._customAgents = getOrchestrationAgents();
      }

      const session = await this.client.createSession({
        sessionId,
        streaming: true,
        model,
        onUserInputRequest: this.getUserInputCallback(),
        // NOTE: customAgents intentionally omitted. The CLI's setAuthInfo flow
        // calls loadCustomAgents() after every session.create, which async-overwrites
        // any customAgents we pass here with an empty array loaded from disk.
        // Instead, we embed specialist roles directly in the system message and
        // instruct the LLM to use agent_type "general-purpose" for all delegations.
        tools: this._anvilTools,
        hooks: this._sessionHooks,
        skillDirectories: this._skillDirectories.length > 0 ? this._skillDirectories : undefined,
        systemMessage: this.buildSystemMessage(),
        reasoningEffort: this.getEffectiveReasoningEffort(),
      });

      this._currentSessionId = sessionId;
      this._currentModel = model ?? this._availableModels[0]?.id ?? null;
      this.activateSession(session);
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
    if (!this.session) return;

    this.session.on((event) => {
      const gen = this.currentRunGeneration;

      switch (event.type) {
        case "assistant.turn_start": {
          if (this.isEventStale(gen)) return;

          this.resetStreamingState();

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

          const deltaContent = event.data?.deltaContent ?? "";
          if (!deltaContent) return;

          this.streamingBuffer += deltaContent;

          if (this.currentRunId) {
            const parentToolCallId = event.data?.parentToolCallId;
            // Check if this is from a subagent, otherwise use active agent
            const subagent = parentToolCallId ? this.activeSubagents.get(parentToolCallId) : undefined;
            const agentInfo = subagent || (this._activeAgent ? {
              agentName: this._activeAgent.name,
              agentDisplayName: this._activeAgent.displayName || this._activeAgent.name,
            } : undefined);
            
            // Debug logging for first delta of each message
            if (this.streamingBuffer.length === 0 && agentInfo) {
              this.emit(createLogEvent("debug", `${nf.send} Assistant delta starting - agent: ${agentInfo.agentDisplayName} (subagent: ${Boolean(subagent)}, parentToolCallId: ${parentToolCallId || "none"})`));
            }
            
            this.emit({
              type: "assistant.delta",
              runId: this.currentRunId,
              text: deltaContent,
              parentToolCallId,
              agentName: agentInfo?.agentName,
              agentDisplayName: agentInfo?.agentDisplayName,
            });
          }
          break;
        }

        case "assistant.message": {
          if (this.isEventStale(gen)) return;

          const content = event.data?.content ?? "";
          const resolvedContent = content || this.streamingBuffer;
          const parentToolCallId = event.data?.parentToolCallId;

          this.emit(createLogEvent("debug", `${nf.pencil} Assistant message: parentToolCallId=${parentToolCallId}, content length=${resolvedContent.length}`));

          if (resolvedContent && this.currentRunId) {
            const message = createAssistantMessage(resolvedContent);
            
            // Add agent information - from subagent if available, otherwise from active agent
            if (parentToolCallId) {
              this.emit(createLogEvent("debug", `Looking up subagent for toolCallId: ${parentToolCallId}`));
              const subagent = this.activeSubagents.get(parentToolCallId);
              if (subagent) {
                this.emit(createLogEvent("info", `${nf.magic} Message from subagent: ${subagent.agentDisplayName}`));
                message.agentName = subagent.agentName;
                message.agentDisplayName = subagent.agentDisplayName;
                message.parentToolCallId = parentToolCallId;
              } else {
                this.emit(createLogEvent("warn", `${nf.warning} No subagent found for toolCallId: ${parentToolCallId}. Active subagents: ${Array.from(this.activeSubagents.keys()).join(", ")}`));
              }
            } else if (this._activeAgent) {
              // Message from top-level active agent (e.g., Intake)
              message.agentName = this._activeAgent.name;
              message.agentDisplayName = this._activeAgent.displayName || this._activeAgent.name;
            }
            
            this.emit({
              type: "assistant.message",
              runId: this.currentRunId,
              message,
            });
            this.hasEmittedContentForTurn = true;
          }

          this.streamingBuffer = "";
          break;
        }

        case "assistant.turn_end": {
          if (this.isEventStale(gen)) return;

          if (!this.hasEmittedContentForTurn && this.streamingBuffer && this.currentRunId) {
            const message = createAssistantMessage(this.streamingBuffer);
            
            this.emit({
              type: "assistant.message",
              runId: this.currentRunId,
              message,
            });
          }

          if (this.currentRunId) {
            this.emit({
              type: "turn.ended",
              runId: this.currentRunId,
              turnId: event.data?.turnId ?? "",
            });
          }

          this.resetStreamingState();
          break;
        }

        case "tool.execution_start": {
          if (this.isEventStale(gen)) return;

          const toolName = event.data?.toolName;
          const args = parseToolArgs(event.data?.arguments);

          // Handle special tool calls
          if (toolName === "report_intent" && args && typeof args === "object") {
            const intentArg = (args as any).intent;
            if (intentArg && this.currentRunId) {
              this.emit({ type: "intent.updated", runId: this.currentRunId, intent: intentArg });
            }
          } else if (toolName === "update_todo" && args && typeof args === "object") {
            const todosArg = (args as any).todos;
            if (todosArg && this.currentRunId) {
              this.emit({ type: "todo.updated", runId: this.currentRunId, todos: todosArg });
            }
          }

          // Extract specialist role from task tool prompts for display attribution.
          // When the LLM delegates via agent_type "general-purpose", the prompt
          // starts with "## Role: <SpecialistName>\n..." — we capture that name
          // so the subagent.started event can show the real specialist instead of
          // "General Purpose Agent".
          if (toolName === "task" && args && typeof args === "object") {
            const toolCallId = event.data?.toolCallId;
            const prompt = (args as any).prompt;
            if (toolCallId && typeof prompt === "string") {
              const roleMatch = prompt.match(/^## Role:\s*(.+)/m);
              if (roleMatch) {
                this.pendingAgentRoles.set(toolCallId, roleMatch[1].trim());
              }
            }
          }

          if (this.currentRunId) {
            this.emit({
              type: "tool.started",
              runId: this.currentRunId,
              toolCallId: event.data?.toolCallId ?? "",
              toolName: event.data?.toolName ?? "unknown",
              arguments: typeof args === "object" && args !== null ? args as Record<string, unknown> : undefined,
            });
          }
          break;
        }

        case "assistant.intent": {
          if (this.isEventStale(gen)) return;

          const intent = event.data?.intent;
          if (intent && this.currentRunId) {
            this.emit({ type: "intent.updated", runId: this.currentRunId, intent });
          }
          break;
        }

        case "tool.execution_progress": {
          if (this.isEventStale(gen)) return;

          if (this.currentRunId) {
            this.emit({
              type: "tool.progress",
              runId: this.currentRunId,
              toolCallId: event.data?.toolCallId ?? "",
              message: event.data?.progressMessage ?? "",
            });
          }
          break;
        }

        case "tool.execution_complete": {
          if (this.isEventStale(gen)) return;

          if (this.currentRunId) {
            this.emit({
              type: "tool.completed",
              runId: this.currentRunId,
              toolCallId: event.data?.toolCallId ?? "",
              success: event.data?.success ?? false,
              output: extractToolOutput(event.data?.result),
              error: event.data?.error?.message,
            });
          }
          break;
        }

        case "assistant.reasoning_delta": {
          if (this.isEventStale(gen)) return;

          const reasoningDelta = event.data?.deltaContent ?? "";
          if (!reasoningDelta) return;

          this.reasoningBuffer += reasoningDelta;

          if (this.currentRunId) {
            this.emit({
              type: "reasoning.delta",
              runId: this.currentRunId,
              reasoningId: event.data?.reasoningId ?? "",
              text: reasoningDelta,
            });
          }
          break;
        }

        case "assistant.reasoning": {
          if (this.isEventStale(gen)) return;

          const reasoningContent = event.data?.content ?? "";
          if (this.currentRunId && reasoningContent) {
            this.emit({
              type: "reasoning.message",
              runId: this.currentRunId,
              reasoningId: event.data?.reasoningId ?? "",
              content: reasoningContent,
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

            if (this.streamingBuffer && !this.hasEmittedContentForTurn) {
              this.emit({
                type: "assistant.message",
                runId,
                message: createAssistantMessage(this.streamingBuffer),
              });
            }

            this.emit({ type: "run.finished", runId, createdAt: new Date() });
            this.emit(createLogEvent("info", "Response complete", runId));

            this.resetStreamingState();
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
            let agentName = event.data?.agentName ?? "";
            let agentDisplayName = event.data?.agentDisplayName ?? "";

            // Override generic "general-purpose" name with the real specialist
            // role extracted from the task tool's prompt (see tool.execution_start).
            const roleOverride = this.pendingAgentRoles.get(toolCallId);
            if (roleOverride) {
              agentDisplayName = roleOverride;
              // Derive a kebab-case name for consistent identification
              agentName = roleOverride.toLowerCase().replace(/\s+/g, '-');
              this.pendingAgentRoles.delete(toolCallId);
            }

            this.emit(createLogEvent("info", `${nf.rocket} Subagent STARTED: ${agentDisplayName} (${agentName}) - toolCallId: ${toolCallId}`));

            // Track this subagent so we can attribute its messages
            this.activeSubagents.set(toolCallId, { agentName, agentDisplayName });

            this.emit({
              type: "subagent.started",
              runId: this.currentRunId,
              toolCallId,
              agentName,
              agentDisplayName,
              agentDescription: event.data?.agentDescription ?? "",
            });
          }
          break;
        }

        case "subagent.completed": {
          if (this.isEventStale(gen)) return;
          if (this.currentRunId) {
            const toolCallId = event.data?.toolCallId ?? "";
            
            // Remove from active tracking
            this.activeSubagents.delete(toolCallId);
            
            this.emit({
              type: "subagent.completed",
              runId: this.currentRunId,
              toolCallId,
              agentName: event.data?.agentName ?? "",
            });
          }
          break;
        }

        case "subagent.failed": {
          if (this.isEventStale(gen)) return;
          if (this.currentRunId) {
            const toolCallId = event.data?.toolCallId ?? "";
            
            // Remove from active tracking
            this.activeSubagents.delete(toolCallId);
            
            this.emit({
              type: "subagent.failed",
              runId: this.currentRunId,
              toolCallId,
              agentName: event.data?.agentName ?? "",
              error: event.data?.error ?? "Unknown error",
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
    this.resetStreamingState();

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
        this.resetStreamingState();

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

    this.resetStreamingState();
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

    const sessionId = this._currentSessionId;
    if (!sessionId) throw new Error("No active session to switch model");

    await this.teardownSession();

    const opts = {
      streaming: true as const,
      model: modelId,
      onUserInputRequest: this.getUserInputCallback(),
      tools: this._anvilTools,
      hooks: this._sessionHooks,
      skillDirectories: this._skillDirectories.length > 0 ? this._skillDirectories : undefined,
      systemMessage: this.buildSystemMessage(),
      reasoningEffort: this.getEffectiveReasoningEffort(),
    };

    try {
      this.session = await this.client.resumeSession(sessionId, opts);
    } catch {
      this.session = await this.client.createSession({ sessionId, ...opts });
    }

    this._currentModel = modelId;
    // activateSession would overwrite this.session, so just do the post-setup directly
    this.workspacePath = this.session.workspacePath ?? null;
    this.setupSessionEventHandlers();
    if (this.workspacePath) this.setupPlanWatcher();

    this.emit({ type: "model.changed", model: modelId });
  }

  async createNewSession(): Promise<string> {
    if (!this.client) throw new Error("Client not initialized");
    if (this.isProcessing) throw new Error("Cannot create new session while processing");

    await this.teardownSession();

    const sessionId = this.generateSessionId();

    const session = await this.client.createSession({
      sessionId,
      streaming: true,
      model: this._currentModel ?? undefined,
      onUserInputRequest: this.getUserInputCallback(),
      tools: this._anvilTools,
      hooks: this._sessionHooks,
      skillDirectories: this._skillDirectories.length > 0 ? this._skillDirectories : undefined,
      systemMessage: this.buildSystemMessage(),
      reasoningEffort: this.getEffectiveReasoningEffort(),
    });

    this._currentSessionId = sessionId;
    this.activateSession(session);

    this.emit({
      type: "session.created",
      sessionId,
      sessionName: sessionId.slice(this._projectPrefix.length),
    });

    return sessionId;
  }

  async switchToSession(sessionId: string): Promise<void> {
    if (!this.client) throw new Error("Client not initialized");
    if (this.isProcessing) throw new Error("Cannot switch session while processing");

    await this.teardownSession();

    const session = await this.client.resumeSession(sessionId, {
      streaming: true,
      model: this._currentModel ?? undefined,
      onUserInputRequest: this.getUserInputCallback(),
      tools: this._anvilTools,
      hooks: this._sessionHooks,
      skillDirectories: this._skillDirectories.length > 0 ? this._skillDirectories : undefined,
      systemMessage: this.buildSystemMessage(),
      reasoningEffort: this.getEffectiveReasoningEffort(),
    });

    this._currentSessionId = sessionId;
    this.activateSession(session);

    const isCurrentProject = sessionId.startsWith(this._projectPrefix);
    this.emit({
      type: "session.switched",
      sessionId,
      sessionName: isCurrentProject ? sessionId.slice(this._projectPrefix.length) : sessionId,
      transcript: await this.getSessionHistory(),
    });
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
      const sessions = await this.client.listSessions();

      return sessions.map((s: any) => {
        const isCurrentProject = s.sessionId.startsWith(this._projectPrefix);
        const name = s.summary || (isCurrentProject
          ? s.sessionId.slice(this._projectPrefix.length)
          : s.sessionId);

        return {
          id: s.sessionId,
          name,
          createdAt: s.startTime ? new Date(s.startTime) : undefined,
          lastUsedAt: s.modifiedTime ? new Date(s.modifiedTime) : undefined,
          isCurrentProject,
        };
      });
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
        onUserInputRequest: this.getUserInputCallback(),
        reasoningEffort: this.getEffectiveReasoningEffort(),
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
              onEvent({
                type: "tool.started",
                runId,
                toolCallId: event.data?.toolCallId ?? "",
                toolName: event.data?.toolName ?? "unknown",
                arguments: typeof args === "object" && args !== null ? args as Record<string, unknown> : undefined,
              });
            }
            break;
          }

          case "tool.execution_complete": {
            onEvent?.({
              type: "tool.completed",
              runId,
              toolCallId: event.data?.toolCallId ?? "",
              success: event.data?.success ?? false,
              output: extractToolOutput(event.data?.result),
              error: event.data?.error?.message,
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
