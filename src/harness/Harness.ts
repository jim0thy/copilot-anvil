import type { HarnessEvent, UIAction } from "./events.js";
import { createLogEvent, createUserMessage, generateId } from "./events.js";
import type {
  HarnessState,
  ActiveTool,
  Task,
  Subagent,
  Skill,
  PendingQuestion,
  EphemeralRun,
  HarnessStatus,
} from "./state.js";
import { INITIAL_STATE } from "./state.js";
import { processEvent, processEphemeralEvent, freshContextInfo, type ReducerContext } from "./reducer.js";
import { HarnessPlugin, PluginManager } from "./plugins.js";
import type { CopilotSessionAdapter } from "../copilot/CopilotSessionAdapter.js";
import { CommandRegistry, parseSlashCommand } from "../commands/CommandLoader.js";
import type { CommandDefinition } from "../commands/CommandLoader.js";
import { loadConfig, saveConfig } from "../utils/config.js";
import type { ReasoningEffort } from "../utils/config.js";
import { nf } from "../ui/icons.js";

// Re-export state types so existing consumers don't need to change imports
export type {
  HarnessStatus,
  HarnessState,
  ActiveTool,
  Task,
  Subagent,
  Skill,
  PendingQuestion,
  EphemeralRun,
};

export type HarnessEventHandler = (event: HarnessEvent) => void;

export class Harness {
  private state: HarnessState = { ...INITIAL_STATE };

  private eventHandlers: Set<HarnessEventHandler> = new Set();
  private pluginManager: PluginManager;
  private adapter: CopilotSessionAdapter | null = null;
  private questionResolvers: Map<string, (answer: { answer: string; wasFreeform: boolean }) => void> = new Map();
  private commandRegistry: CommandRegistry;
  // Side-channel context shared with the event reducer for O(1) tool-call lookups
  private reducerCtx: ReducerContext = {
    toolCallTranscriptIndex: new Map(),
  };

  constructor() {
    this.pluginManager = new PluginManager((event) => this.emit(event));
    this.commandRegistry = new CommandRegistry();
  }

  // ── Adapter & plugin wiring ─────────────────────────────────

  setAdapter(adapter: CopilotSessionAdapter): void {
    this.adapter = adapter;

    adapter.onEvent((event: HarnessEvent) => {
      this.emit(event);
    });

    adapter.onUserInputRequest((request) => {
      return this.handleUserInputRequest(request);
    });
  }

  use(plugin: HarnessPlugin): void {
    this.pluginManager.use(plugin);
  }

  getCommands(): CommandDefinition[] {
    return this.commandRegistry.list();
  }

  // ── State & subscriptions ───────────────────────────────────

  getState(): Readonly<HarnessState> {
    return this.state;
  }

  subscribe(handler: HarnessEventHandler): () => void {
    this.eventHandlers.add(handler);
    return () => {
      this.eventHandlers.delete(handler);
    };
  }

  emit(event: HarnessEvent): void {
    // Check if this event is for an ephemeral run
    const isEphemeralEvent =
      this.state.ephemeralRun &&
      'runId' in event &&
      event.runId === this.state.ephemeralRun.runId;

    if (isEphemeralEvent) {
      this.state = processEphemeralEvent(this.state, event);
    } else {
      const prevRunId = this.state.currentRunId;
      this.state = processEvent(this.state, event, this.reducerCtx);

      // Side effect: schedule queue processing after a run finishes
      if (event.type === "run.finished" && prevRunId) {
        setTimeout(() => {
          this.processNextQueuedMessage().catch((err) => {
            this.emit(createLogEvent("error", `Queue processing failed: ${err instanceof Error ? err.message : String(err)}`));
          });
        }, 0);
      }
      
      // Side effect: pass loaded agents to the SDK adapter
      if (event.type === "agents.loaded" && this.adapter) {
        // Get full agent definitions from the plugin's state
        const pluginCtx = this.pluginManager.getContext();
        const orchestrationState = pluginCtx.state.get<{
          availableAgents: Array<{
            id: string;
            name: string;
            description: string;
            systemPrompt: string;
            tools: string[];
          }>;
        }>("orchestration");
        
        if (orchestrationState?.availableAgents) {
          const customAgents = orchestrationState.availableAgents.map(agent => ({
            name: agent.id,
            displayName: agent.name,
            description: agent.description,
            prompt: agent.systemPrompt,
            tools: agent.tools.length > 0 ? agent.tools : null,
            infer: true, // Explicitly enable agent for LLM inference
          }));
          
          // Find the default entry-point agent (engineering-manager/orchestration) from the
          // loaded event payload so we can activate it AFTER setCustomAgents
          // finishes. Without this, agent.changed fires before _customAgents is
          // populated and setActiveAgent silently fails to find the agent.
          const entryAgent = event.type === "agents.loaded"
            ? event.agents.find(a => a.domain === "orchestration")
            : null;
          this.adapter.setCustomAgents(customAgents).then(async () => {
            this.emit(createLogEvent("info", `Registered ${customAgents.length} custom agents with SDK`));
            if (entryAgent) {
              await this.adapter!.setActiveAgent(entryAgent.id).catch((err) => {
                this.emit(createLogEvent("error", `Failed to activate entry-point agent: ${err instanceof Error ? err.message : String(err)}`));
              });
            }
          }).catch((err) => {
            this.emit(createLogEvent("error", `Failed to register custom agents: ${err instanceof Error ? err.message : String(err)}`));
          });
        }
      }
      
      // Side effect: activate agent in adapter when agent.changed event comes from plugin
      if (event.type === "agent.changed" && this.adapter) {
        const pluginCtx = this.pluginManager.getContext();
        const orchestrationState = pluginCtx.state.get<{
          availableAgents: Array<{
            id: string;
            name: string;
            model: string;
            reasoningEffort?: ReasoningEffort;
          }>;
        }>("orchestration");
        
        const agent = orchestrationState?.availableAgents.find(a => a.id === event.agentId);
        this.adapter.setReasoningEffort(agent?.reasoningEffort ?? this.state.reasoningEffort);
        const targetModel = agent?.model ? this.resolveAvailableModel(agent.model) : null;
        const needsModelSwitch = Boolean(
          targetModel &&
          targetModel !== this.state.currentModel
        );
        
        this.adapter.setActiveAgent(event.agentId, needsModelSwitch).catch((err) => {
          this.emit(createLogEvent("error", `Failed to activate agent: ${err instanceof Error ? err.message : String(err)}`));
        });
        
        // Also switch model if needed
        if (needsModelSwitch && targetModel) {
          if (agent?.model && targetModel !== agent.model) {
            this.emit(createLogEvent("warn", `Model ${agent.model} unavailable; falling back to ${targetModel}`));
          }
          this.handleChangeModel(targetModel);
        }
      }
    }

    for (const handler of this.eventHandlers) {
      handler(event);
    }

    this.pluginManager.notifyEvent(event);
  }

  // ── Action dispatch ─────────────────────────────────────────

  async dispatch(action: UIAction): Promise<void> {
    switch (action.type) {
      case "submit.prompt":
        await this.handleSubmitPrompt(action.text, action.images);
        break;

      case "cancel":
        await this.handleCancel();
        break;

      case "change.model":
        await this.handleChangeModel(action.modelId);
        break;

      case "answer.question":
        this.handleAnswerQuestion(action.requestId, action.answer, action.wasFreeform);
        break;

      case "session.new":
        await this.handleNewSession();
        break;

      case "session.switch":
        await this.handleSwitchSession(action.sessionId);
        break;

      case "session.refresh":
        await this.handleRefreshSessions();
        break;

      case "ephemeral.close":
        this.handleCloseEphemeral();
        break;

      case "orchestration.toggle":
        this.handleToggleOrchestration(action.mode);
        break;

      case "agent.switch":
        this.handleSwitchAgent(action.agentId);
        break;

      case "agent.cycle":
        await this.handleCycleAgent(action.direction);
        break;
      
      case "agent.list":
        this.emit({ type: "show.agents.modal" });
        break;

      case "change.reasoning.effort":
        this.handleChangeReasoningEffort(action.effort);
        break;
    }
  }

  // ── Lifecycle ───────────────────────────────────────────────

  async initialize(): Promise<void> {
    if (!this.adapter) {
      throw new Error("Adapter not set. Call setAdapter() first.");
    }

    // Load persisted config
    const config = loadConfig();

    this.emit(createLogEvent("info", "Initializing Copilot session..."));

    try {
      await this.adapter.initialize(undefined, config.reasoningEffort);

      this.state = {
        ...this.state,
        currentModel: this.adapter.currentModel,
        availableModels: this.adapter.availableModels,
        currentSessionId: this.adapter.currentSessionId,
        reasoningEffort: config.reasoningEffort,
      };

      await this.applyCurrentAgentModel();
      this.emit(createLogEvent("info", `Initialized with model: ${this.state.currentModel}`));

      this.emit(createLogEvent("info", "Copilot session ready"));

      if (this.adapter.currentModel) {
        this.emit(createLogEvent("info", `Using model: ${this.adapter.currentModel}`));
      }

      await this.handleRefreshSessions();
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      this.emit(createLogEvent("error", `Initialization failed: ${errorMessage}`));
      throw error;
    }
  }

  async shutdown(): Promise<void> {
    if (this.adapter) {
      await this.adapter.shutdown();
    }
    this.emit(createLogEvent("info", "Harness shutdown complete"));
  }

  // ── Ephemeral runs ──────────────────────────────────────────

  async runEphemeralPrompt(
    prompt: string,
    options?: {
      model?: string;
      displayText?: string;
    }
  ): Promise<void> {
    if (!this.adapter) {
      this.emit(createLogEvent("error", "Copilot adapter not initialized"));
      return;
    }

    const runId = generateId();
    const displayText = options?.displayText ?? prompt;

    const userMessage = createUserMessage(displayText);
    this.state = {
      ...this.state,
      ephemeralRun: {
        runId,
        displayText,
        transcript: [userMessage],
        streamingContent: "",
        status: "running",
        startedAt: new Date(),
      },
    };

    this.emit({
      type: "run.started",
      runId,
      createdAt: new Date(),
    });

    this.emit(createLogEvent("info", `Ephemeral run started: ${runId}`, runId));

    try {
      await this.adapter.runEphemeralPrompt(prompt, runId, {
        model: options?.model,
        onEvent: (event) => {
          this.emit(event);
        },
      });
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      this.emit(createLogEvent("error", `Ephemeral run failed: ${errorMessage}`, runId));
      this.emit({
        type: "run.finished",
        runId,
        createdAt: new Date(),
      });

      if (this.state.ephemeralRun) {
        this.state = {
          ...this.state,
          ephemeralRun: {
            ...this.state.ephemeralRun,
            status: "failed",
            completedAt: new Date(),
          },
        };
      }
    }
  }

  // ── Private action handlers ─────────────────────────────────

  private emitCommandList(): void {
    const commands = this.commandRegistry.list();
    if (commands.length === 0) {
      this.emit(createLogEvent("info", "No skill commands installed. Add command files to .agents/skills/<name>/command/"));
      return;
    }

    const lines = commands.map(
      (cmd) => `  /${cmd.name} — ${cmd.description || cmd.skillName + " skill"}`
    );
    this.emit(createLogEvent("info", `Available commands:\n${lines.join("\n")}`));
  }

  private async handleSubmitPrompt(text: string, images?: string[]): Promise<void> {
    if (this.state.status === "running") {
      this.state = {
        ...this.state,
        messageQueue: [...this.state.messageQueue, text],
      };
      this.emit(
        createLogEvent("info", `Message queued (${this.state.messageQueue.length} waiting)`)
      );
      return;
    }

    if (!this.adapter) {
      this.emit(createLogEvent("error", "Copilot adapter not initialized"));
      return;
    }

    const parsed = parseSlashCommand(text);
    if (parsed) {
      // Built-in commands
      if (parsed.name === "commands" || parsed.name === "help") {
        this.emitCommandList();
        return;
      }

      // Orchestration mode commands
      if (parsed.name === "team") {
        this.handleToggleOrchestration("orchestrated");
        return;
      }

      if (parsed.name === "direct") {
        this.handleToggleOrchestration("direct");
        return;
      }

      if (parsed.name === "agents") {
        this.dispatch({ type: "agent.list" });
        return;
      }

      if (this.commandRegistry.has(parsed.name)) {
        const enhancedPrompt = this.commandRegistry.buildPrompt(parsed.name, parsed.args);
        if (enhancedPrompt) {
          this.emit(
            createLogEvent("info", `Invoking command: /${parsed.name}`)
          );
          await this.executePrompt(enhancedPrompt, text, images);
          return;
        }
      }
    }

    await this.executePrompt(text, undefined, images);
  }

  private async executePrompt(text: string, displayText?: string, images?: string[]): Promise<void> {
    const runId = generateId();

    const userMessage = createUserMessage(displayText ?? text);
    this.state = {
      ...this.state,
      transcript: [...this.state.transcript, userMessage],
      // Clear todo and plan when a new message is sent
      currentTodo: null,
      currentPlan: null,
    };

    this.emit({
      type: "run.started",
      runId,
      createdAt: new Date(),
    });

    this.emit(createLogEvent("info", `Run started: ${runId}`, runId));

    try {
      await this.adapter!.sendPrompt(text, runId, images);
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      this.emit(createLogEvent("error", `Run failed: ${errorMessage}`, runId));
      this.emit({
        type: "run.finished",
        runId,
        createdAt: new Date(),
      });
    }
  }

  private async handleCancel(): Promise<void> {
    if (this.state.status !== "running" || !this.state.currentRunId) {
      return;
    }

    const runId = this.state.currentRunId;

    if (this.adapter) {
      try {
        await this.adapter.abort();
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : String(error);
        this.emit(
          createLogEvent("warn", `Abort error: ${errorMessage}`, runId)
        );
      }
    }

    this.emit({
      type: "run.cancelled",
      runId,
      createdAt: new Date(),
    });

    this.emit(createLogEvent("info", `Run cancelled: ${runId}`, runId));
  }

  private async handleChangeModel(modelId: string): Promise<void> {
    if (this.state.status === "running") {
      this.emit(createLogEvent("warn", "Cannot switch model while a run is in progress"));
      return;
    }

    if (!this.adapter) {
      this.emit(createLogEvent("error", "Copilot adapter not initialized"));
      return;
    }

    this.emit(createLogEvent("info", `Switching to model: ${modelId}...`));

    try {
      await this.adapter.switchModel(modelId);

      this.state = {
        ...this.state,
        currentModel: this.adapter.currentModel,
        availableModels: this.adapter.availableModels,
      };

      this.emit(createLogEvent("info", `Model switched to: ${modelId}`));
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      this.emit(createLogEvent("error", `Model switch failed: ${errorMessage}`));
    }
  }

  private async processNextQueuedMessage(): Promise<void> {
    if (this.state.messageQueue.length === 0) {
      return;
    }

    const [nextMessage, ...remainingQueue] = this.state.messageQueue;
    this.state = {
      ...this.state,
      messageQueue: remainingQueue,
    };

    this.emit(
      createLogEvent("info", `Processing queued message (${remainingQueue.length} remaining)`)
    );

    await this.executePrompt(nextMessage);
  }

  private handleAnswerQuestion(requestId: string, answer: string, wasFreeform: boolean): void {
    const resolver = this.questionResolvers.get(requestId);
    if (resolver) {
      resolver({ answer, wasFreeform });
      this.questionResolvers.delete(requestId);
    }

    this.emit({
      type: "question.answered",
      requestId,
      answer,
      wasFreeform,
    });
  }

  handleUserInputRequest(
    request: { question: string; choices?: string[]; allowFreeform?: boolean }
  ): Promise<{ answer: string; wasFreeform: boolean }> {
    const requestId = generateId();

    this.emit({
      type: "question.requested",
      requestId,
      question: request.question,
      choices: request.choices,
      allowFreeform: request.allowFreeform ?? true,
    });

    return new Promise((resolve) => {
      this.questionResolvers.set(requestId, resolve);
    });
  }

  private async handleNewSession(): Promise<void> {
    if (this.state.status === "running") {
      this.emit(createLogEvent("warn", "Cannot create new session while a run is in progress"));
      return;
    }

    if (!this.adapter) {
      this.emit(createLogEvent("error", "Copilot adapter not initialized"));
      return;
    }

    this.emit(createLogEvent("info", "Creating new session..."));

    try {
      const sessionId = await this.adapter.createNewSession();

      this.state = {
        ...this.state,
        currentSessionId: sessionId,
        transcript: [],
        streamingContent: "",
        streamingReasoning: "",
        currentIntent: null,
        currentTodo: null,
        currentPlan: null,
        contextInfo: freshContextInfo(this.state),
      };

      await this.handleRefreshSessions();

      this.emit(createLogEvent("info", `New session created: ${sessionId}`));
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      this.emit(createLogEvent("error", `Failed to create session: ${errorMessage}`));
    }
  }

  private async handleSwitchSession(sessionId: string): Promise<void> {
    if (this.state.status === "running") {
      this.emit(createLogEvent("warn", "Cannot switch session while a run is in progress"));
      return;
    }

    if (!this.adapter) {
      this.emit(createLogEvent("error", "Copilot adapter not initialized"));
      return;
    }

    if (sessionId === this.state.currentSessionId) {
      return;
    }

    this.emit(createLogEvent("info", `Switching to session: ${sessionId}...`));

    try {
      await this.adapter.switchToSession(sessionId);

      this.state = {
        ...this.state,
        currentSessionId: sessionId,
        streamingContent: "",
        streamingReasoning: "",
        currentIntent: null,
        currentTodo: null,
        currentPlan: null,
        contextInfo: freshContextInfo(this.state),
      };

      this.emit(createLogEvent("info", `Switched to session: ${sessionId}`));
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      this.emit(createLogEvent("error", `Failed to switch session: ${errorMessage}`));
    }
  }

  private async handleRefreshSessions(): Promise<void> {
    if (!this.adapter) {
      return;
    }

    try {
      const sessions = await this.adapter.listSessions();

      this.emit({
        type: "session.list.updated",
        sessions,
      });
    } catch (error) {
      this.emit(createLogEvent("error", `Failed to load sessions: ${error}`));
    }
  }

  private handleCloseEphemeral(): void {
    this.state = {
      ...this.state,
      ephemeralRun: null,
    };
    this.emit(createLogEvent("info", "Ephemeral run closed"));
  }

  private handleToggleOrchestration(mode?: "direct" | "orchestrated"): void {
    const newMode = mode ?? (this.state.orchestrationMode === "direct" ? "orchestrated" : "direct");
    
    this.state = {
      ...this.state,
      orchestrationMode: newMode,
    };

    this.emit({
      type: "orchestration.mode.changed",
      mode: newMode,
    });

    this.emit(createLogEvent(
      "info",
      newMode === "orchestrated"
        ? `${nf.target} Team mode enabled — prompts route through Engineering Manager → Specialists`
        : `${nf.bolt} Direct mode enabled — prompts go directly to Copilot`
    ));
  }

  private async handleSwitchAgent(agentId: string | null): Promise<void> {
    if (this.state.status === "running") {
      this.emit(createLogEvent("warn", "Cannot switch agent while a run is in progress"));
      return;
    }

    const agent = agentId 
      ? this.state.availableAgents.find(a => a.id === agentId)
      : null;
    
    const agentName = agent?.name ?? "Copilot";

    this.state = {
      ...this.state,
      currentAgentId: agentId,
    };

    this.emit({
      type: "agent.changed",
      agentId,
      agentName,
    });

    // Activate the agent in the adapter - this sets the agent's system prompt
    // as the top-level prompt for the session, making the LLM behave AS that agent
    // If we'll also switch models, skip the session renew here and let model switch handle it
    const targetModel = agent?.model ? this.resolveAvailableModel(agent.model) : null;
    const needsModelSwitch = Boolean(
      targetModel &&
      targetModel !== this.state.currentModel
    );

    if (this.adapter) {
      this.adapter.setReasoningEffort(agent?.reasoningEffort ?? this.state.reasoningEffort);
    }
    
    if (this.adapter) {
      try {
        await this.adapter.setActiveAgent(agentId, needsModelSwitch);
      } catch (err) {
        this.emit(createLogEvent("error", `Failed to activate agent: ${err instanceof Error ? err.message : String(err)}`));
      }
    }

    // Also switch to the agent's required model (this will apply both agent prompt and model)
    if (needsModelSwitch && targetModel) {
      if (agent?.model && targetModel !== agent.model) {
        this.emit(createLogEvent("warn", `Model ${agent.model} unavailable; falling back to ${targetModel}`));
      }
      this.emit(createLogEvent("info", `Switched to agent: ${agentName} (switching to ${targetModel})`));
      await this.handleChangeModel(targetModel);
      return;
    }

    this.emit(createLogEvent("info", `Switched to agent: ${agentName}`));
  }

  private async handleCycleAgent(direction: "next" | "prev"): Promise<void> {
    if (this.state.status === "running") {
      return;
    }

    // Build the full list: null (SDK default) + available agents
    const agentList: Array<{ id: string | null; name: string }> = [
      { id: null, name: "Copilot" },
      ...this.state.availableAgents.map(a => ({ id: a.id, name: a.name })),
    ];

    if (agentList.length <= 1) {
      return;
    }

    const currentIndex = agentList.findIndex(a => a.id === this.state.currentAgentId);
    let newIndex: number;

    if (direction === "next") {
      newIndex = (currentIndex + 1) % agentList.length;
    } else {
      newIndex = (currentIndex - 1 + agentList.length) % agentList.length;
    }

    const newAgent = agentList[newIndex];
    await this.handleSwitchAgent(newAgent.id);
  }

  private handleChangeReasoningEffort(effort: ReasoningEffort): void {
    if (this.state.status === "running") {
      this.emit(createLogEvent("warn", "Cannot change reasoning effort while a run is in progress"));
      return;
    }

    const currentModelInfo = this.state.availableModels.find(m => m.id === this.state.currentModel);
    if (!currentModelInfo?.supportsReasoningEffort) {
      this.emit(createLogEvent("warn", "Current model does not support reasoning effort"));
      return;
    }

    this.state = {
      ...this.state,
      reasoningEffort: effort,
    };

    // Persist to config
    const config = loadConfig();
    config.reasoningEffort = effort;
    saveConfig(config);

    this.emit({
      type: "reasoning.effort.changed",
      effort,
    });

    // Apply to adapter
    if (this.adapter) {
      this.adapter.setReasoningEffort(effort);
    }

    this.emit(createLogEvent("info", `Reasoning effort set to: ${effort}`));
  }

  private resolveAvailableModel(modelId: string): string | null {
    if (this.state.availableModels.some(m => m.id === modelId)) {
      return modelId;
    }

    const requested = modelId.match(/^(.*?)(\d+)\.(\d+)(.*)$/);
    if (!requested) {
      return null;
    }

    const [, prefix, major, minor, suffix] = requested;
    const escapedPrefix = prefix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const escapedSuffix = suffix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const familyRegex = new RegExp(`^${escapedPrefix}(\\d+)\\.(\\d+)${escapedSuffix}$`);
    const requestedMajor = Number.parseInt(major, 10);
    const requestedMinor = Number.parseInt(minor, 10);

    const familyCandidates = this.state.availableModels
      .map((m) => {
        const match = m.id.match(familyRegex);
        if (!match) return null;
        return {
          id: m.id,
          major: Number.parseInt(match[1], 10),
          minor: Number.parseInt(match[2], 10),
        };
      })
      .filter((candidate): candidate is { id: string; major: number; minor: number } => Boolean(candidate))
      .sort((a, b) => (b.major - a.major) || (b.minor - a.minor));

    if (familyCandidates.length === 0) {
      return null;
    }

    const bestLowerOrEqual = familyCandidates.find((candidate) =>
      candidate.major < requestedMajor ||
      (candidate.major === requestedMajor && candidate.minor <= requestedMinor)
    );

    return bestLowerOrEqual?.id ?? familyCandidates[0].id;
  }

  private async applyCurrentAgentModel(): Promise<void> {
    if (!this.adapter || !this.state.currentAgentId) {
      return;
    }

    const agent = this.state.availableAgents.find(a => a.id === this.state.currentAgentId);
    if (!agent) {
      return;
    }

    this.adapter.setReasoningEffort(agent.reasoningEffort ?? this.state.reasoningEffort);

    if (!agent.model) {
      return;
    }

    const targetModel = this.resolveAvailableModel(agent.model);
    if (!targetModel || targetModel === this.state.currentModel) {
      return;
    }

    if (targetModel !== agent.model) {
      this.emit(createLogEvent("warn", `Model ${agent.model} unavailable; falling back to ${targetModel}`));
    }

    this.emit(createLogEvent("info", `Switching to model: ${targetModel}...`));
    await this.adapter.switchModel(targetModel);
    this.state = {
      ...this.state,
      currentModel: this.adapter.currentModel,
      availableModels: this.adapter.availableModels,
    };
    this.emit(createLogEvent("info", `Model switched to: ${targetModel}`));
  }
}
