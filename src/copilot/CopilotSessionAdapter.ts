import { CopilotClient, CopilotSession } from "@github/copilot-sdk";
import type { ModelInfo } from "@github/copilot-sdk";
import type { HarnessEvent, SessionInfo } from "../harness/events.js";
import { createAssistantMessage, createLogEvent } from "../harness/events.js";
import * as path from "path";

export type AdapterEventHandler = (event: HarnessEvent) => void;

export type UserInputHandler = (
  request: { question: string; choices?: string[]; allowFreeform?: boolean }
) => Promise<{ answer: string; wasFreeform: boolean }>;

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
  private userInputHandler: UserInputHandler | null = null;
  private _currentSessionId: string | null = null;
  private _projectPrefix: string;

  constructor() {
    // Generate project prefix from current working directory
    this._projectPrefix = path.basename(process.cwd()) + "-";
  }

  onEvent(handler: AdapterEventHandler): void {
    this.eventHandler = handler;
  }

  onUserInputRequest(handler: UserInputHandler): void {
    this.userInputHandler = handler;
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

      // Generate a project-scoped session ID
      const sessionId = this._projectPrefix + Date.now().toString(36);
      
      this.session = await this.client.createSession({
        sessionId,
        streaming: true,
        model,
        onUserInputRequest: this.userInputHandler
          ? async (request: any) => {
              return this.userInputHandler!(request);
            }
          : undefined,
      });

      this._currentSessionId = sessionId;
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
              arguments: typeof args === "object" && args !== null ? args as Record<string, unknown> : undefined,
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
            let output: string | undefined;
            const result = event.data?.result;
            if (result) {
              if (typeof result === "string") {
                output = result;
              } else if (typeof result === "object" && result !== null) {
                const resultObj = result as Record<string, unknown>;
                if (typeof resultObj.textResultForLlm === "string") {
                  output = resultObj.textResultForLlm;
                } else if (typeof resultObj.sessionLog === "string") {
                  output = resultObj.sessionLog;
                }
              }
            }

            this.emit({
              type: "tool.completed",
              runId: this.currentRunId,
              toolCallId: event.data?.toolCallId ?? "",
              success: event.data?.success ?? false,
              output,
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

  async sendPrompt(prompt: string, runId: string, images?: string[]): Promise<void> {
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

    // Build attachments from images
    const attachments = images?.map((imagePath) => ({
      type: "file" as const,
      path: imagePath,
    }));

    try {
      await this.session.send({ 
        prompt, 
        attachments: attachments && attachments.length > 0 ? attachments : undefined 
      });
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
        await this.session!.send({ 
          prompt, 
          attachments: attachments && attachments.length > 0 ? attachments : undefined 
        });
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

    const sessionId = this._currentSessionId;
    if (!sessionId) {
      throw new Error("No active session to switch model");
    }

    if (this.session) {
      try {
        await this.session.destroy();
      } catch {
        // Ignore destroy errors
      }
    }

    const sessionOpts = {
      sessionId,
      streaming: true as const,
      model: modelId,
      onUserInputRequest: this.userInputHandler
        ? async (request: any) => {
            return this.userInputHandler!(request);
          }
        : undefined,
    };

    try {
      this.session = await this.client.resumeSession(sessionId, {
        streaming: true,
        model: modelId,
        onUserInputRequest: sessionOpts.onUserInputRequest,
      });
    } catch {
      this.session = await this.client.createSession(sessionOpts);
    }

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
    const pathModule = require("path");
    const planPath = pathModule.join(this.workspacePath, "plan.md");

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

  async listSessions(): Promise<SessionInfo[]> {
    if (!this.client) {
      return [];
    }

    try {
      const sessions = await this.client.listSessions();
      
      return sessions.map((s: any) => {
        const isCurrentProject = s.sessionId.startsWith(this._projectPrefix);
        
        // Use summary if available, otherwise extract name from session ID
        let name = s.summary || "";
        if (!name) {
          name = isCurrentProject 
            ? s.sessionId.slice(this._projectPrefix.length)
            : s.sessionId;
        }
        
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

  async createNewSession(): Promise<string> {
    if (!this.client) {
      throw new Error("Client not initialized");
    }

    if (this.isProcessing) {
      throw new Error("Cannot create new session while processing");
    }

    // Clean up current session
    if (this.session) {
      try {
        await this.session.destroy();
      } catch {
        // Ignore destroy errors
      }
    }

    // Generate new project-scoped session ID
    const sessionId = this._projectPrefix + Date.now().toString(36);

    this.session = await this.client.createSession({
      sessionId,
      streaming: true,
      model: this._currentModel ?? undefined,
      onUserInputRequest: this.userInputHandler
        ? async (request: any) => {
            return this.userInputHandler!(request);
          }
        : undefined,
    });

    this._currentSessionId = sessionId;
    this.workspacePath = this.session.workspacePath ?? null;
    this.setupSessionEventHandlers();

    if (this.workspacePath) {
      this.setupPlanWatcher();
    }

    this.emit({
      type: "session.created",
      sessionId,
      sessionName: sessionId.slice(this._projectPrefix.length),
    });

    return sessionId;
  }

  async switchToSession(sessionId: string): Promise<void> {
    if (!this.client) {
      throw new Error("Client not initialized");
    }

    if (this.isProcessing) {
      throw new Error("Cannot switch session while processing");
    }

    // Clean up current session
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
        // Ignore destroy errors
      }
    }

    // Resume the target session
    this.session = await this.client.resumeSession(sessionId, {
      streaming: true,
      model: this._currentModel ?? undefined,
      onUserInputRequest: this.userInputHandler
        ? async (request: any) => {
            return this.userInputHandler!(request);
          }
        : undefined,
    });

    this._currentSessionId = sessionId;
    this.workspacePath = this.session.workspacePath ?? null;
    this.setupSessionEventHandlers();

    if (this.workspacePath) {
      this.setupPlanWatcher();
    }

    const isCurrentProject = sessionId.startsWith(this._projectPrefix);
    const sessionName = isCurrentProject 
      ? sessionId.slice(this._projectPrefix.length)
      : sessionId;

    this.emit({
      type: "session.switched",
      sessionId,
      sessionName,
    });
  }

  /**
   * Run a prompt in an ephemeral background session that is not stored in session history.
   * Uses a separate session and model (Gemini 3 Flash by default) so it doesn't affect
   * the user's current session.
   * 
   * IMPORTANT: This method creates a completely independent session object.
   * It does NOT touch this.session, this._currentSessionId, or any other user session state.
   */
  async runEphemeralPrompt(
    prompt: string,
    runId: string,
    options?: {
      model?: string;
      onEvent?: (event: HarnessEvent) => void;
    }
  ): Promise<void> {
    if (!this.client) {
      throw new Error("Client not initialized");
    }

    const model = options?.model ?? "gemini-3-flash";
    const onEvent = options?.onEvent;

    // Create an ephemeral session with a unique ID that won't be saved.
    // Using underscore prefix to mark as internal/ephemeral.
    // This is a LOCAL variable - we never assign it to this.session.
    const ephemeralSessionId = `_ephemeral_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;

    // Store in local variable only - NOT in this.session
    let ephemeralSession: CopilotSession | null = null;

    try {
      ephemeralSession = await this.client.createSession({
        sessionId: ephemeralSessionId,
        streaming: true,
        model,
        // Disable infinite sessions to prevent persistence
        infiniteSessions: { enabled: false },
        onUserInputRequest: this.userInputHandler
          ? async (request: any) => {
              return this.userInputHandler!(request);
            }
          : undefined,
      });

      // Set up event handlers for the ephemeral session
      ephemeralSession.on((event) => {
        switch (event.type) {
          case "assistant.message_delta": {
            const deltaContent = event.data?.deltaContent ?? "";
            if (deltaContent && onEvent) {
              onEvent({
                type: "assistant.delta",
                runId,
                text: deltaContent,
              });
            }
            break;
          }

          case "assistant.message": {
            const content = event.data?.content ?? "";
            if (content && onEvent) {
              const message = createAssistantMessage(content);
              onEvent({
                type: "assistant.message",
                runId,
                message,
              });
            }
            break;
          }

          case "tool.execution_start": {
            if (onEvent) {
              let args = event.data?.arguments;
              if (typeof args === "string") {
                try {
                  args = JSON.parse(args);
                } catch {
                  // Not valid JSON, keep as string
                }
              }
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
            if (onEvent) {
              let output: string | undefined;
              const result = event.data?.result;
              if (result) {
                if (typeof result === "string") {
                  output = result;
                } else if (typeof result === "object" && result !== null) {
                  const resultObj = result as Record<string, unknown>;
                  if (typeof resultObj.textResultForLlm === "string") {
                    output = resultObj.textResultForLlm;
                  } else if (typeof resultObj.sessionLog === "string") {
                    output = resultObj.sessionLog;
                  }
                }
              }
              onEvent({
                type: "tool.completed",
                runId,
                toolCallId: event.data?.toolCallId ?? "",
                success: event.data?.success ?? false,
                output,
                error: event.data?.error?.message,
              });
            }
            break;
          }

          case "session.idle": {
            if (onEvent) {
              onEvent({
                type: "run.finished",
                runId,
                createdAt: new Date(),
              });
            }
            break;
          }

          case "assistant.intent": {
            const intent = event.data?.intent;
            if (intent && onEvent) {
              onEvent({
                type: "intent.updated",
                runId,
                intent,
              });
            }
            break;
          }
        }
      });

      // Send the prompt
      await ephemeralSession.send({ prompt });

      // Wait for the session to complete (session.idle event)
      await new Promise<void>((resolve) => {
        const checkIdle = ephemeralSession!.on((event) => {
          if (event.type === "session.idle") {
            resolve();
          }
        });
      });

    } finally {
      // Clean up ONLY the ephemeral session - user's this.session is untouched
      if (ephemeralSession) {
        try {
          await ephemeralSession.destroy();
        } catch {
          // Ignore destroy errors
        }
      }
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
