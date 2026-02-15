import { CopilotClient, CopilotSession } from "@github/copilot-sdk";
import type { ModelInfo, SessionEvent, SystemMessageConfig } from "@github/copilot-sdk";
import type { HarnessEvent, SessionInfo, TranscriptItem, ToolCallItem } from "../harness/events.js";
import { createAssistantMessage, createLogEvent } from "../harness/events.js";
import * as path from "path";
import { existsSync, readFileSync, watch, type FSWatcher } from "node:fs";

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
  /** Map of tool call IDs to subagent information */
  private activeSubagents = new Map<string, { agentName: string; agentDisplayName: string }>();

  constructor() {
    this._projectPrefix = path.basename(process.cwd()) + "-";
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
   * These agents will be available for delegation by the orchestrator.
   * If a session is already active, it will be recreated with the new agents.
   */
  async setCustomAgents(agents: CustomAgentDef[]): Promise<void> {
    this._customAgents = agents;
    this.emit(createLogEvent("info", `🤖 Setting ${agents.length} custom agents: ${agents.map(a => a.displayName || a.name).join(", ")}`));
    
    // If we have an active session, recreate it to include the new agents
    if (this.session && this.client && !this.isProcessing) {
      this.emit(createLogEvent("info", "Renewing session with custom agents..."));
      await this.renewSessionWithAgents();
    }
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
    
    // If we have an active session, recreate it with the new system prompt
    // (unless skipSessionRenew is true, meaning caller will handle session update)
    if (this.session && this.client && !this.isProcessing && !skipSessionRenew) {
      const agentName = agent?.displayName ?? agent?.name ?? "Copilot";
      this.emit(createLogEvent("info", `Activating agent: ${agentName}`));
      await this.renewSessionWithAgents();
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
   * Recreate the current session with updated custom agents.
   * Preserves the current session ID to maintain conversation history.
   */
  private async renewSessionWithAgents(): Promise<void> {
    if (!this.client) throw new Error("Client not initialized");
    
    const currentSessionId = this._currentSessionId;
    if (!currentSessionId) return;

    await this.teardownSession();

    // Resume the same session with updated agents and system message
      const opts = {
        streaming: true as const,
        model: this._currentModel ?? undefined,
        onUserInputRequest: this.getUserInputCallback(),
        customAgents: this._customAgents.length > 0 ? this._customAgents : undefined,
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

  /** Build the `onUserInputRequest` callback suitable for SDK session options. */
  private getUserInputCallback(): ((request: any) => Promise<{ answer: string; wasFreeform: boolean }>) | undefined {
    return this.userInputHandler
      ? async (request: any) => this.userInputHandler!(request)
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
   * that can be delegated to via the task tool.
   */
  private buildSystemMessage(): SystemMessageConfig | undefined {
    // If an active agent is selected, use its system prompt as the primary instruction
    if (this._activeAgent) {
      this.emit(createLogEvent("debug", `Building system message for active agent: ${this._activeAgent.displayName ?? this._activeAgent.name}`));
      
      // Build list of OTHER agents available for delegation (excluding the active one)
      const otherAgents = this._customAgents.filter(a => a.name !== this._activeAgent?.name);
      const agentList = otherAgents.length > 0
        ? otherAgents.map(a => `- **${a.displayName || a.name}**: ${a.description || 'No description'}`).join('\n')
        : '';
      
      const subagentSection = otherAgents.length > 0 ? `

<available_subagents>
You can delegate to these specialist agents via the task tool:

${agentList}

To delegate: use task tool with agent name as agent_type parameter.
</available_subagents>` : '';

      return {
        mode: "replace" as const,
        content: `${this._activeAgent.prompt}

${subagentSection}
`,
      };
    }
    
    // No active agent - just advertise all available agents as options
    if (this._customAgents.length === 0) return undefined;

    const agentList = this._customAgents
      .map(a => `- **${a.displayName || a.name}**: ${a.description || 'No description'}`)
      .join('\n');

    return {
      mode: "append" as const,
      content: `
<custom_agents>
You have access to the following custom agents that you can delegate tasks to via the task tool:

${agentList}

When delegating to a custom agent:
1. Use the task tool with the agent's name as the agent_type parameter
2. Provide a clear, specific prompt describing what the agent should do
3. Custom agents have specialized knowledge and should be preferred for their domain

Example: To use the "clarifier" agent:
\`\`\`json
{"agent_type": "clarifier", "prompt": "Analyze this request for ambiguity: ..."}
\`\`\`
</custom_agents>
`,
    };
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

      const session = await this.client.createSession({
        sessionId,
        streaming: true,
        model,
        onUserInputRequest: this.getUserInputCallback(),
        customAgents: this._customAgents.length > 0 ? this._customAgents : undefined,
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

          this.emit(createLogEvent("debug", `📝 Assistant message: parentToolCallId=${parentToolCallId}, content length=${resolvedContent.length}`));

          if (resolvedContent && this.currentRunId) {
            const message = createAssistantMessage(resolvedContent);
            
            // Add agent information - from subagent if available, otherwise from active agent
            if (parentToolCallId) {
              this.emit(createLogEvent("debug", `Looking up subagent for toolCallId: ${parentToolCallId}`));
              const subagent = this.activeSubagents.get(parentToolCallId);
              if (subagent) {
                this.emit(createLogEvent("info", `✨ Message from subagent: ${subagent.agentDisplayName}`));
                message.agentName = subagent.agentName;
                message.agentDisplayName = subagent.agentDisplayName;
                message.parentToolCallId = parentToolCallId;
              } else {
                this.emit(createLogEvent("warn", `⚠️ No subagent found for toolCallId: ${parentToolCallId}. Active subagents: ${Array.from(this.activeSubagents.keys()).join(", ")}`));
              }
            } else if (this._activeAgent) {
              // Message from top-level active agent (e.g., Clarifier)
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
          this.emit(createLogEvent("info", `🔍 Subagent selected: ${event.data?.agentName} (${event.data?.agentDisplayName})`));
          break;
        }

        case "subagent.started": {
          if (this.isEventStale(gen)) return;
          if (this.currentRunId) {
            const toolCallId = event.data?.toolCallId ?? "";
            const agentName = event.data?.agentName ?? "";
            const agentDisplayName = event.data?.agentDisplayName ?? "";
            
            this.emit(createLogEvent("info", `🚀 Subagent STARTED: ${agentDisplayName} (${agentName}) - toolCallId: ${toolCallId}`));
            
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
      customAgents: this._customAgents.length > 0 ? this._customAgents : undefined,
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
      customAgents: this._customAgents.length > 0 ? this._customAgents : undefined,
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
      customAgents: this._customAgents.length > 0 ? this._customAgents : undefined,
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
      customAgents: this._customAgents.length > 0 ? this._customAgents : undefined,
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
