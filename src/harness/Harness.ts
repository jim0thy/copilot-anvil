import type {
  ChatMessage,
  HarnessEvent,
  LogEvent,
  UIAction,
} from "./events.js";
import {
  createLogEvent,
  createUserMessage,
  generateId,
} from "./events.js";
import { HarnessPlugin, PluginManager } from "./plugins.js";
import type { CopilotSessionAdapter, ModelDescription } from "../copilot/CopilotSessionAdapter.js";

export type HarnessStatus = "idle" | "running" | "error";

export type HarnessEventHandler = (event: HarnessEvent) => void;

export interface HarnessState {
  status: HarnessStatus;
  transcript: ChatMessage[];
  logs: LogEvent[];
  currentRunId: string | null;
  streamingContent: string;
  streamingReasoning: string;
  currentModel: string | null;
  availableModels: ModelDescription[];
  contextInfo: {
    currentTokens: number;
    tokenLimit: number;
    conversationLength: number;
    remainingPremiumRequests: number | null;
  };
}

const MAX_LOGS = 100;

export class Harness {
  private state: HarnessState = {
    status: "idle",
    transcript: [],
    logs: [],
    currentRunId: null,
    streamingContent: "",
    streamingReasoning: "",
    activeTools: [],
    tasks: [],
    currentModel: null,
    availableModels: [],
    contextInfo: {
      currentTokens: 0,
      tokenLimit: 0,
      conversationLength: 0,
      remainingPremiumRequests: null,
    },
  };

  private eventHandlers: Set<HarnessEventHandler> = new Set();
  private pluginManager: PluginManager;
  private adapter: CopilotSessionAdapter | null = null;

  constructor() {
    this.pluginManager = new PluginManager((event) => this.emit(event));
  }

  setAdapter(adapter: CopilotSessionAdapter): void {
    this.adapter = adapter;
    
    adapter.onEvent((event: HarnessEvent) => {
      this.emit(event);
    });
  }

  use(plugin: HarnessPlugin): void {
    this.pluginManager.use(plugin);
  }

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
    this.processEvent(event);
    
    for (const handler of this.eventHandlers) {
      handler(event);
    }
    
    this.pluginManager.notifyEvent(event);
  }

  private processEvent(event: HarnessEvent): void {
    switch (event.type) {
      case "run.started":
        this.state = {
          ...this.state,
          status: "running",
          currentRunId: event.runId,
          streamingContent: "",
          streamingReasoning: "",
          activeTools: [],
        };
        break;

      case "assistant.delta":
        this.state = {
          ...this.state,
          streamingContent: this.state.streamingContent + event.text,
        };
        break;

      case "reasoning.delta":
        this.state = {
          ...this.state,
          streamingReasoning: this.state.streamingReasoning + event.text,
        };
        break;

      case "reasoning.message":
        break;

      case "assistant.message": {
        const messageWithReasoning = {
          ...event.message,
          reasoning: this.state.streamingReasoning || undefined,
        };
        this.state = {
          ...this.state,
          transcript: [...this.state.transcript, messageWithReasoning],
          streamingContent: "",
          streamingReasoning: "",
        };
        break;
      }

      case "log":
        this.state = {
          ...this.state,
          logs: [...this.state.logs.slice(-MAX_LOGS + 1), event],
        };
        break;

      case "run.cancelled":
        this.state = {
          ...this.state,
          status: "idle",
          currentRunId: null,
          streamingContent: "",
          streamingReasoning: "",
          activeTools: [],
        };
        break;

      case "run.finished":
        this.state = {
          ...this.state,
          status: "idle",
          currentRunId: null,
          activeTools: [],
        };
        break;

      case "tool.started": {
        const newTask: Task = {
          id: event.toolCallId,
          name: event.toolName,
          status: "running",
          startedAt: new Date(),
        };
        this.state = {
          ...this.state,
          activeTools: [
            ...this.state.activeTools,
            { toolCallId: event.toolCallId, toolName: event.toolName },
          ],
          tasks: [...this.state.tasks.slice(-MAX_TASKS + 1), newTask],
        };
        break;
      }

      case "tool.completed": {
        const updatedTasks = this.state.tasks.map((task) => {
          if (task.id === event.toolCallId) {
            return {
              ...task,
              status: event.success ? ("completed" as const) : ("failed" as const),
              completedAt: new Date(),
              error: event.error,
            };
          }
          return task;
        });
        this.state = {
          ...this.state,
          activeTools: this.state.activeTools.filter(
            (t) => t.toolCallId !== event.toolCallId
          ),
          tasks: updatedTasks,
        };
        break;
      }

      case "turn.started":
      case "turn.ended":
        break;

      case "model.changed":
        this.state = {
          ...this.state,
          currentModel: event.model,
        };
        break;

      case "usage.info":
        this.state = {
          ...this.state,
          contextInfo: {
            ...this.state.contextInfo,
            currentTokens: event.currentTokens,
            tokenLimit: event.tokenLimit,
            conversationLength: event.messagesLength,
          },
        };
        break;

      case "quota.info":
        this.state = {
          ...this.state,
          contextInfo: {
            ...this.state.contextInfo,
            remainingPremiumRequests: event.remainingPremiumRequests,
          },
        };
        break;
    }
  }

  async dispatch(action: UIAction): Promise<void> {
    switch (action.type) {
      case "submit.prompt":
        await this.handleSubmitPrompt(action.text);
        break;

      case "cancel":
        await this.handleCancel();
        break;

      case "change.model":
        await this.handleChangeModel(action.modelId);
        break;
    }
  }

  private async handleSubmitPrompt(text: string): Promise<void> {
    if (this.state.status === "running") {
      this.emit(
        createLogEvent("warn", "Cannot submit while a run is in progress")
      );
      return;
    }

    if (!this.adapter) {
      this.emit(createLogEvent("error", "Copilot adapter not initialized"));
      return;
    }

    const runId = generateId();

    const userMessage = createUserMessage(text);
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
      await this.adapter.sendPrompt(text, runId);
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
      };
      
      this.emit(createLogEvent("info", "Copilot session ready"));
      
      if (this.adapter.currentModel) {
        this.emit(createLogEvent("info", `Using model: ${this.adapter.currentModel}`));
      }
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      this.emit(createLogEvent("error", `Initialization failed: ${errorMessage}`));
      throw error;
    }
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
        availableModels: this.adapter.availableModels,
      };
      
      this.emit(createLogEvent("info", `Model switched to: ${modelId}`));
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      this.emit(createLogEvent("error", `Model switch failed: ${errorMessage}`));
    }
  }

  async shutdown(): Promise<void> {
    if (this.adapter) {
      await this.adapter.shutdown();
    }
    this.emit(createLogEvent("info", "Harness shutdown complete"));
  }
}
