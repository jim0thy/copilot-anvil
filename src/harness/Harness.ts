import type { HarnessEvent, UIAction } from "./events.js";
import {
  createAssistantMessage,
  createLogEvent,
  createUserMessage,
  generateId,
} from "./events.js";
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
import type { CopilotSessionAdapter, ModelDescription } from "../copilot/CopilotSessionAdapter.js";
import { CommandRegistry, parseSlashCommand } from "../commands/CommandLoader.js";
import type { CommandDefinition } from "../commands/CommandLoader.js";

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
    }
  }

  // ── Lifecycle ───────────────────────────────────────────────

  async initialize(): Promise<void> {
    if (!this.adapter) {
      throw new Error("Adapter not set. Call setAdapter() first.");
    }

    this.emit(createLogEvent("info", "Initializing Copilot session..."));

    try {
      await this.adapter.initialize();

      this.state = {
        ...this.state,
        currentModel: this.adapter.currentModel,
        availableModels: this.adapter.availableModels,
        currentSessionId: this.adapter.currentSessionId,
      };

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
      if (parsed.name === "commands" || parsed.name === "help") {
        this.emitCommandList();
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
}
