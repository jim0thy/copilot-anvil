import type {
  ChatMessage,
  HarnessEvent,
  LogEvent,
  TranscriptItem,
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

export interface ActiveTool {
  toolCallId: string;
  toolName: string;
  arguments?: Record<string, unknown>;
  progress: string[];
  startedAt: Date;
  status: "running" | "completed" | "failed";
  completedAt?: Date;
  output?: string;
  error?: string;
}

export interface Task {
  id: string;
  name: string;
  status: "running" | "completed" | "failed";
  startedAt: Date;
  completedAt?: Date;
  error?: string;
}

export interface Subagent {
  toolCallId: string;
  agentName: string;
  agentDisplayName: string;
  agentDescription: string;
  status: "running" | "completed" | "failed";
  startedAt: Date;
  completedAt?: Date;
  error?: string;
}

export interface Skill {
  name: string;
  path: string;
  invokedAt: Date;
  invokeCount: number;
}

export interface PendingQuestion {
  requestId: string;
  question: string;
  choices?: string[];
  allowFreeform: boolean;
}

export interface HarnessState {
  status: HarnessStatus;
  transcript: TranscriptItem[];
  logs: LogEvent[];
  currentRunId: string | null;
  streamingContent: string;
  streamingReasoning: string;
  activeTools: ActiveTool[];
  tasks: Task[];
  subagents: Subagent[];
  skills: Skill[];
  currentModel: string | null;
  availableModels: ModelDescription[];
  messageQueue: string[];
  currentTodo: string | null;
  currentPlan: string | null;
  currentIntent: string | null;
  pendingQuestion: PendingQuestion | null;
  contextInfo: {
    currentTokens: number;
    tokenLimit: number;
    conversationLength: number;
    remainingPremiumRequests: number | null;
    consumedRequests: number;
  };
}

const MAX_LOGS = 100;
const MAX_TASKS = 50;
const MAX_SUBAGENTS = 50;
const MAX_SKILLS = 50;

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
    subagents: [],
    skills: [],
    currentModel: null,
    availableModels: [],
    messageQueue: [],
    currentTodo: null,
    currentPlan: null,
    currentIntent: null,
    pendingQuestion: null,
    contextInfo: {
      currentTokens: 0,
      tokenLimit: 0,
      conversationLength: 0,
      remainingPremiumRequests: null,
      consumedRequests: 0,
    },
  };

  private eventHandlers: Set<HarnessEventHandler> = new Set();
  private pluginManager: PluginManager;
  private adapter: CopilotSessionAdapter | null = null;
  private questionResolvers: Map<string, (answer: { answer: string; wasFreeform: boolean }) => void> = new Map();

  constructor() {
    this.pluginManager = new PluginManager((event) => this.emit(event));
  }

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
        const messageWithReasoning: ChatMessage = {
          ...event.message,
          kind: "message",
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
        };
        break;

      case "run.finished":
        this.state = {
          ...this.state,
          status: "idle",
          currentRunId: null,
          contextInfo: {
            ...this.state.contextInfo,
            consumedRequests: this.state.contextInfo.consumedRequests + 1,
          },
        };
        this.processNextQueuedMessage();
        break;

      case "tool.started": {
        const newTask: Task = {
          id: event.toolCallId,
          name: event.toolName,
          status: "running",
          startedAt: new Date(),
        };
        const toolItem: TranscriptItem = {
          id: generateId(),
          kind: "tool-call",
          toolCallId: event.toolCallId,
          toolName: event.toolName,
          arguments: event.arguments,
          progress: [],
          status: "running",
          startedAt: new Date(),
        };
        this.state = {
          ...this.state,
          transcript: [...this.state.transcript, toolItem],
          activeTools: [
            ...this.state.activeTools,
            { 
              toolCallId: event.toolCallId, 
              toolName: event.toolName,
              arguments: event.arguments,
              progress: [],
              startedAt: new Date(),
              status: "running",
            },
          ],
          tasks: [...this.state.tasks.slice(-MAX_TASKS + 1), newTask],
        };
        break;
      }

      case "tool.progress": {
        const updatedTools = this.state.activeTools.map((tool) => {
          if (tool.toolCallId === event.toolCallId) {
            return {
              ...tool,
              progress: [...tool.progress, event.message],
            };
          }
          return tool;
        });
        const updatedTranscript = this.state.transcript.map((item) => {
          if (item.kind === "tool-call" && item.toolCallId === event.toolCallId) {
            return { ...item, progress: [...item.progress, event.message] };
          }
          return item;
        });
        this.state = {
          ...this.state,
          activeTools: updatedTools,
          transcript: updatedTranscript,
        };
        break;
      }

      case "tool.completed": {
        const updatedTools = this.state.activeTools.map((tool) => {
          if (tool.toolCallId === event.toolCallId) {
            return {
              ...tool,
              status: event.success ? ("completed" as const) : ("failed" as const),
              completedAt: new Date(),
              output: event.output,
              error: event.error,
            };
          }
          return tool;
        });
        
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

        const updatedTranscript = this.state.transcript.map((item) => {
          if (item.kind === "tool-call" && item.toolCallId === event.toolCallId) {
            return {
              ...item,
              status: event.success ? ("completed" as const) : ("failed" as const),
              completedAt: new Date(),
              output: event.output,
              error: event.error,
            };
          }
          return item;
        });

        this.state = {
          ...this.state,
          activeTools: updatedTools,
          tasks: updatedTasks,
          transcript: updatedTranscript,
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
            // Only update remaining premium requests from SDK
            // consumedRequests is tracked locally via run.finished
            remainingPremiumRequests: event.remainingPremiumRequests,
          },
        };
        break;

      case "subagent.started": {
        const newSubagent: Subagent = {
          toolCallId: event.toolCallId,
          agentName: event.agentName,
          agentDisplayName: event.agentDisplayName,
          agentDescription: event.agentDescription,
          status: "running",
          startedAt: new Date(),
        };
        this.state = {
          ...this.state,
          subagents: [...this.state.subagents.slice(-MAX_SUBAGENTS + 1), newSubagent],
        };
        break;
      }

      case "subagent.completed": {
        const updatedSubagents = this.state.subagents.map((agent) => {
          if (agent.toolCallId === event.toolCallId) {
            return {
              ...agent,
              status: "completed" as const,
              completedAt: new Date(),
            };
          }
          return agent;
        });
        this.state = {
          ...this.state,
          subagents: updatedSubagents,
        };
        break;
      }

      case "subagent.failed": {
        const updatedSubagents = this.state.subagents.map((agent) => {
          if (agent.toolCallId === event.toolCallId) {
            return {
              ...agent,
              status: "failed" as const,
              completedAt: new Date(),
              error: event.error,
            };
          }
          return agent;
        });
        this.state = {
          ...this.state,
          subagents: updatedSubagents,
        };
        break;
      }

      case "skill.invoked": {
        const existingSkill = this.state.skills.find(s => s.name === event.name);
        if (existingSkill) {
          // Increment invoke count for existing skill
          const updatedSkills = this.state.skills.map((skill) => {
            if (skill.name === event.name) {
              return {
                ...skill,
                invokedAt: new Date(),
                invokeCount: skill.invokeCount + 1,
              };
            }
            return skill;
          });
          this.state = {
            ...this.state,
            skills: updatedSkills,
          };
        } else {
          // Add new skill
          const newSkill: Skill = {
            name: event.name,
            path: event.path,
            invokedAt: new Date(),
            invokeCount: 1,
          };
          this.state = {
            ...this.state,
            skills: [...this.state.skills.slice(-MAX_SKILLS + 1), newSkill],
          };
        }
        break;
      }

      case "intent.updated":
        this.state = {
          ...this.state,
          currentIntent: event.intent,
        };
        break;

      case "todo.updated":
        this.state = {
          ...this.state,
          currentTodo: event.todos,
        };
        break;

      case "plan.updated":
        this.state = {
          ...this.state,
          currentPlan: event.content,
        };
        break;

      case "question.requested":
        this.state = {
          ...this.state,
          pendingQuestion: {
            requestId: event.requestId,
            question: event.question,
            choices: event.choices,
            allowFreeform: event.allowFreeform,
          },
        };
        break;

      case "question.answered":
        this.state = {
          ...this.state,
          pendingQuestion: null,
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

      case "answer.question":
        this.handleAnswerQuestion(action.requestId, action.answer, action.wasFreeform);
        break;
    }
  }

  private async handleSubmitPrompt(text: string): Promise<void> {
    if (this.state.status === "running") {
      // Queue the message for later processing
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

    await this.executePrompt(text);
  }

  private async executePrompt(text: string): Promise<void> {
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
      await this.adapter!.sendPrompt(text, runId);
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

  async shutdown(): Promise<void> {
    if (this.adapter) {
      await this.adapter.shutdown();
    }
    this.emit(createLogEvent("info", "Harness shutdown complete"));
  }
}
