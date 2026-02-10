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
  private finalContent = "";
  private reasoningBuffer = "";
  private currentReasoningId: string | null = null;
  private isCancelled = false;
  private isProcessing = false;
  private expectedRunGeneration = 0;
  private currentRunGeneration = 0;
  private _currentModel: string | null = null;
  private _availableModels: ModelDescription[] = [];

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

      this.setupSessionEventHandlers();
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

          const content = event.data?.content ?? "";
          if (content) {
            if (this.finalContent) {
              this.finalContent += "\n\n";
            }
            this.finalContent += content;
          }
          break;
        }

        case "assistant.reasoning_delta": {
          if (this.isCancelled) return;
          if (!this.isProcessing) return;
          if (gen !== this.expectedRunGeneration) return;

          const deltaContent = event.data?.deltaContent ?? "";
          const reasoningId = event.data?.reasoningId ?? "";
          if (!deltaContent) return;

          this.reasoningBuffer += deltaContent;
          this.currentReasoningId = reasoningId;

          if (this.currentRunId) {
            this.emit({
              type: "reasoning.delta",
              runId: this.currentRunId,
              reasoningId,
              text: deltaContent,
            });
          }
          break;
        }

        case "assistant.reasoning": {
          if (this.isCancelled) return;
          if (!this.isProcessing) return;
          if (gen !== this.expectedRunGeneration) return;

          const content = event.data?.content ?? "";
          const reasoningId = event.data?.reasoningId ?? "";

          if (this.currentRunId && content) {
            this.emit({
              type: "reasoning.message",
              runId: this.currentRunId,
              reasoningId,
              content,
            });
          }
          break;
        }

        case "session.idle": {
          if (!this.isProcessing) return;

          if (this.currentRunId) {
            const runId = this.currentRunId;
            // Prefer finalContent (complete formatted message) over streamingBuffer
            const content = this.finalContent || this.streamingBuffer;

            if (content) {
              const message = createAssistantMessage(content);
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
              createLogEvent(
                "info",
                `Response complete (${content.length} chars)`,
                runId
              )
            );

            this.streamingBuffer = "";
            this.finalContent = "";
            this.reasoningBuffer = "";
            this.currentReasoningId = null;
            this.currentRunId = null;
            this.isProcessing = false;
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
          // Extract remaining premium requests from quota snapshots
          const quotaSnapshots = event.data?.quotaSnapshots;
          if (quotaSnapshots) {
            // Look for premium model quota snapshot (usually keyed by model name)
            for (const [, quota] of Object.entries(quotaSnapshots)) {
              if (!quota.isUnlimitedEntitlement) {
                const remaining = quota.entitlementRequests - quota.usedRequests;
                this.emit({
                  type: "quota.info",
                  remainingPremiumRequests: remaining,
                });
                break;
              }
            }
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
    this.finalContent = "";
    this.reasoningBuffer = "";
    this.currentReasoningId = null;
    this.isCancelled = false;
    this.isProcessing = true;

    await this.session.send({ prompt });
  }

  async abort(): Promise<void> {
    this.isCancelled = true;
    this.isProcessing = false;
    
    if (this.session) {
      try {
        await this.session.abort();
      } catch {
        // Best-effort abort
      }
    }

    this.streamingBuffer = "";
    this.reasoningBuffer = "";
    this.currentReasoningId = null;
    this.currentRunId = null;
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

  async shutdown(): Promise<void> {
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
