import { CopilotClient, CopilotSession } from "@github/copilot-sdk";
import type { ModelInfo } from "@github/copilot-sdk";
import type { HarnessEvent } from "../harness/events.js";
import { createAssistantMessage, createLogEvent } from "../harness/events.js";

export type AdapterEventHandler = (event: HarnessEvent) => void;

export interface ModelDescription {
  id: string;
  name: string;
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
  private planWatcher: any = null;
  private workspacePath: string | null = null;

  onEvent(handler: AdapterEventHandler): void {
    this.eventHandler = handler;
  }

  get currentModel(): string | null {
    return this._currentModel;
  }

  get availableModels(): ModelDescription[] {
    return this._availableModels;
  }

  private emit(event: HarnessEvent): void {
    if (this.eventHandler) {
      this.eventHandler(event);
    }
  }

  async initialize(model?: string): Promise<void> {
    try {
      this.client = new CopilotClient({
        autoStart: true,
        logLevel: "error",
      });

      await this.client.start();

      const models = await this.client.listModels();
      this._availableModels = models.map((m: ModelInfo) => ({
        id: m.id,
        name: m.name,
      }));

      this.session = await this.client.createSession({
        streaming: true,
        model,
      });

      this._currentModel = model ?? this._availableModels[0]?.id ?? null;
      this.workspacePath = this.session.workspacePath ?? null;

      this.setupSessionEventHandlers();
      
      // Setup plan.md watcher if workspace exists
      if (this.workspacePath) {
        this.setupPlanWatcher();
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

  private setupSessionEventHandlers(): void {
    if (!this.session) return;

    this.session.on((event) => {
      const gen = this.currentRunGeneration;

      switch (event.type) {
        case "assistant.turn_start": {
          if (this.isCancelled) return;
          if (!this.isProcessing) return;
          if (gen !== this.expectedRunGeneration) return;

          // Reset per-turn state
          this.streamingBuffer = "";
          this.reasoningBuffer = "";
          this.hasEmittedContentForTurn = false;

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
          if (this.isCancelled) return;
          if (!this.isProcessing) return;
          if (gen !== this.expectedRunGeneration) return;

          const deltaContent = event.data?.deltaContent ?? "";
          if (!deltaContent) return;

          this.streamingBuffer += deltaContent;

          if (this.currentRunId) {
            this.emit({
              type: "assistant.delta",
              runId: this.currentRunId,
              text: deltaContent,
            });
          }
          break;
        }

        case "assistant.message": {
          if (this.isCancelled) return;
          if (!this.isProcessing) return;
          if (gen !== this.expectedRunGeneration) return;

          // The SDK fires assistant.message at the end of each LLM call.
          // It may contain content, toolRequests, or both.
          // We use the content from this event if available, otherwise
          // fall back to the streaming buffer.
          const content = event.data?.content ?? "";
          const resolvedContent = content || this.streamingBuffer;

          if (resolvedContent && this.currentRunId) {
            const message = createAssistantMessage(resolvedContent);
            this.emit({
              type: "assistant.message",
              runId: this.currentRunId,
              message,
            });
            this.hasEmittedContentForTurn = true;
          }

          // Reset streaming buffer after emitting (ready for next turn)
          this.streamingBuffer = "";
          break;
        }

        case "assistant.turn_end": {
          if (this.isCancelled) return;
          if (!this.isProcessing) return;
          if (gen !== this.expectedRunGeneration) return;

          // If there's leftover streaming content that wasn't captured
          // by an assistant.message event, emit it now
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

          // Reset for next turn
          this.streamingBuffer = "";
          this.reasoningBuffer = "";
          this.hasEmittedContentForTurn = false;
          break;
        }

        case "tool.execution_start": {
          if (this.isCancelled) return;
          if (!this.isProcessing) return;
          if (gen !== this.expectedRunGeneration) return;

          const toolName = event.data?.toolName;
          let args = event.data?.arguments;

          // Parse args if they're a JSON string
          if (typeof args === "string") {
            try {
              args = JSON.parse(args);
            } catch {
              // Not valid JSON, keep as string
            }
          }

          // Handle special tool calls
          if (toolName === "report_intent" && args && typeof args === "object") {
            const intentArg = (args as any).intent;
            if (intentArg && this.currentRunId) {
              this.emit({
                type: "intent.updated",
                runId: this.currentRunId,
                intent: intentArg,
              });
            }
          } else if (toolName === "update_todo" && args && typeof args === "object") {
            const todosArg = (args as any).todos;
            if (todosArg && this.currentRunId) {
              this.emit({
                type: "todo.updated",
                runId: this.currentRunId,
                todos: todosArg,
              });
            }
          }

          if (this.currentRunId) {
            this.emit({
              type: "tool.started",
              runId: this.currentRunId,
              toolCallId: event.data?.toolCallId ?? "",
              toolName: event.data?.toolName ?? "unknown",
            });
          }
          break;
        }

        case "assistant.intent": {
          if (this.isCancelled) return;
          if (!this.isProcessing) return;
          if (gen !== this.expectedRunGeneration) return;

          const intent = event.data?.intent;
          if (intent && this.currentRunId) {
            this.emit({
              type: "intent.updated",
              runId: this.currentRunId,
              intent,
            });
          }
          break;
        }

        case "tool.execution_progress": {
          if (this.isCancelled) return;
          if (!this.isProcessing) return;
          if (gen !== this.expectedRunGeneration) return;

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
          if (this.isCancelled) return;
          if (!this.isProcessing) return;
          if (gen !== this.expectedRunGeneration) return;

          if (this.currentRunId) {
            this.emit({
              type: "tool.completed",
              runId: this.currentRunId,
              toolCallId: event.data?.toolCallId ?? "",
              success: event.data?.success ?? false,
              error: event.data?.error?.message,
            });
          }
          break;
        }

        case "assistant.reasoning_delta": {
          if (this.isCancelled) return;
          if (!this.isProcessing) return;
          if (gen !== this.expectedRunGeneration) return;

          const reasoningDelta = event.data?.deltaContent ?? "";
          const reasoningId = event.data?.reasoningId ?? "";
          if (!reasoningDelta) return;

          this.reasoningBuffer += reasoningDelta;

          if (this.currentRunId) {
            this.emit({
              type: "reasoning.delta",
              runId: this.currentRunId,
              reasoningId,
              text: reasoningDelta,
            });
          }
          break;
        }

        case "assistant.reasoning": {
          if (this.isCancelled) return;
          if (!this.isProcessing) return;
          if (gen !== this.expectedRunGeneration) return;

          const reasoningContent = event.data?.content ?? "";
          const rId = event.data?.reasoningId ?? "";

          if (this.currentRunId && reasoningContent) {
            this.emit({
              type: "reasoning.message",
              runId: this.currentRunId,
              reasoningId: rId,
              content: reasoningContent,
            });
          }
          break;
        }

        case "session.idle": {
          if (!this.isProcessing) return;

          if (this.currentRunId) {
            const runId = this.currentRunId;

            // Emit any remaining streaming content that wasn't captured by turn events.
            // Guard with hasEmittedContentForTurn to avoid duplicating content
            // that was already flushed by assistant.message or turn_end handlers.
            if (this.streamingBuffer && !this.hasEmittedContentForTurn) {
              const message = createAssistantMessage(this.streamingBuffer);
              this.emit({
                type: "assistant.message",
                runId,
                message,
              });
            }

            this.emit({
              type: "run.finished",
              runId,
              createdAt: new Date(),
            });

            this.emit(
              createLogEvent("info", "Response complete", runId)
            );

            this.streamingBuffer = "";
            this.reasoningBuffer = "";
            this.currentRunId = null;
            this.isProcessing = false;
            this.hasEmittedContentForTurn = false;
          }
          break;
        }

        case "session.error": {
          const errorMsg = event.data?.message || "Unknown session error";
          this.emit(
            createLogEvent("error", `Session error: ${errorMsg}`, this.currentRunId)
          );
          break;
        }

        case "session.model_change": {
          this._currentModel = event.data?.newModel ?? null;
          this.emit({
            type: "model.changed",
            model: this._currentModel,
          });
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
          // Extract remaining premium requests from quota snapshots if available
          const quotaSnapshots = event.data?.quotaSnapshots;
          let remainingPremiumRequests: number | null = null;
          
          if (quotaSnapshots && Object.keys(quotaSnapshots).length > 0) {
            for (const [, quota] of Object.entries(quotaSnapshots)) {
              // Use SDK-reported remaining if available
              remainingPremiumRequests = Math.max(0, quota.entitlementRequests - quota.usedRequests);
              break;
            }
          }
          
          // Emit remaining quota info (consumedRequests tracked by harness)
          this.emit({
            type: "quota.info",
            remainingPremiumRequests,
            consumedRequests: 0, // Not used - harness tracks this via run.finished
          });
          break;
        }

        case "subagent.started": {
          if (this.isCancelled) return;
          if (!this.isProcessing) return;
          if (gen !== this.expectedRunGeneration) return;

          if (this.currentRunId) {
            this.emit({
              type: "subagent.started",
              runId: this.currentRunId,
              toolCallId: event.data?.toolCallId ?? "",
              agentName: event.data?.agentName ?? "",
              agentDisplayName: event.data?.agentDisplayName ?? "",
              agentDescription: event.data?.agentDescription ?? "",
            });
          }
          break;
        }

        case "subagent.completed": {
          if (this.isCancelled) return;
          if (!this.isProcessing) return;
          if (gen !== this.expectedRunGeneration) return;

          if (this.currentRunId) {
            this.emit({
              type: "subagent.completed",
              runId: this.currentRunId,
              toolCallId: event.data?.toolCallId ?? "",
              agentName: event.data?.agentName ?? "",
            });
          }
          break;
        }

        case "subagent.failed": {
          if (this.isCancelled) return;
          if (!this.isProcessing) return;
          if (gen !== this.expectedRunGeneration) return;

          if (this.currentRunId) {
            this.emit({
              type: "subagent.failed",
              runId: this.currentRunId,
              toolCallId: event.data?.toolCallId ?? "",
              agentName: event.data?.agentName ?? "",
              error: event.data?.error ?? "Unknown error",
            });
          }
          break;
        }

        case "skill.invoked": {
          if (this.isCancelled) return;
          if (!this.isProcessing) return;
          if (gen !== this.expectedRunGeneration) return;

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

  async sendPrompt(prompt: string, runId: string): Promise<void> {
    if (!this.session) {
      throw new Error("Session not initialized");
    }

    this.expectedRunGeneration++;
    this.currentRunGeneration = this.expectedRunGeneration;
    this.currentRunId = runId;
    this.streamingBuffer = "";
    this.reasoningBuffer = "";
    this.isCancelled = false;
    this.isProcessing = true;
    this.hasEmittedContentForTurn = false;

    try {
      await this.session.send({ prompt });
    } catch (error) {
      // Check if the error is due to an expired/invalid session
      const message = error instanceof Error ? error.message : String(error);
      const lowerMessage = message.toLowerCase();
      
      if (lowerMessage.includes("session") || 
          lowerMessage.includes("expired") ||
          lowerMessage.includes("invalid") ||
          lowerMessage.includes("closed") ||
          lowerMessage.includes("terminated")) {
        // Attempt to renew the session
        this.emit(createLogEvent("warn", "Session expired, renewing...", runId));
        await this.renewSession();
        
        // Bump generation to invalidate any stale events from the old session
        this.expectedRunGeneration++;
        this.currentRunGeneration = this.expectedRunGeneration;
        this.streamingBuffer = "";
        this.reasoningBuffer = "";
        this.hasEmittedContentForTurn = false;

        this.emit(createLogEvent("info", "Session renewed, retrying prompt...", runId));
        
        // Retry the prompt with the new session
        await this.session!.send({ prompt });
      } else {
        // Re-throw if it's not a session-related error
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
      try {
        await this.session.abort();
      } catch {
        // Best-effort abort
      }
    }

    this.streamingBuffer = "";
    this.reasoningBuffer = "";
    this.currentRunId = null;

    if (runId) {
      this.emit({
        type: "run.cancelled",
        runId,
        createdAt: new Date(),
      });
    }
  }

  private async renewSession(): Promise<void> {
    if (!this.client) {
      throw new Error("Client not initialized");
    }

    const currentModel = this._currentModel;

    if (this.session) {
      try {
        await this.session.destroy();
      } catch {
        // Ignore destroy errors
      }
    }

    this.session = await this.client.createSession({
      streaming: true,
      model: currentModel ?? undefined,
    });

    this.setupSessionEventHandlers();
  }

  async switchModel(modelId: string): Promise<void> {
    if (!this.client) {
      throw new Error("Client not initialized");
    }

    if (this.isProcessing) {
      throw new Error("Cannot switch model while processing");
    }

    if (this.session) {
      try {
        await this.session.destroy();
      } catch {
        // Ignore destroy errors
      }
    }

    this.session = await this.client.createSession({
      streaming: true,
      model: modelId,
    });

    this._currentModel = modelId;
    this.setupSessionEventHandlers();

    this.emit({
      type: "model.changed",
      model: modelId,
    });
  }

  private setupPlanWatcher(): void {
    if (!this.workspacePath) return;

    const fs = require("fs");
    const path = require("path");
    const planPath = path.join(this.workspacePath, "plan.md");

    const readAndEmitPlan = () => {
      try {
        if (fs.existsSync(planPath)) {
          const content = fs.readFileSync(planPath, "utf-8");
          this.emit({
            type: "plan.updated",
            content,
          });
        }
      } catch {
        // Ignore errors
      }
    };

    // Read initial plan if it exists
    readAndEmitPlan();

    // Watch the directory for plan.md creation/changes
    try {
      this.planWatcher = fs.watch(this.workspacePath, (eventType: string, filename: string) => {
        if (filename === "plan.md") {
          readAndEmitPlan();
        }
      });
    } catch {
      // Directory doesn't exist or can't be watched
    }
  }

  async shutdown(): Promise<void> {
    if (this.planWatcher) {
      try {
        this.planWatcher.close();
      } catch {
        // Ignore
      }
      this.planWatcher = null;
    }

    if (this.session) {
      try {
        await this.session.destroy();
      } catch {
        // Ignore destroy errors during shutdown
      }
      this.session = null;
    }

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
