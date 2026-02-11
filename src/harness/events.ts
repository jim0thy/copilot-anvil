/**
 * Internal event protocol for the TUI harness.
 * Decouples UI from Copilot SDK specifics.
 */

// ============================================================
// Chat Message (for UI transcript)
// ============================================================

export type MessageRole = "user" | "assistant" | "tool" | "system";

export interface ChatMessage {
  id: string;
  role: MessageRole;
  content: string;
  reasoning?: string;
  createdAt: Date;
}

// ============================================================
// Resource Model (scaffolding for future features)
// ============================================================

export interface Resource {
  uri: string; // e.g., "git://diff?...", "file:///...", "github://pull/123"
  type: "git-diff" | "file" | "github-pr" | "unknown";
  metadata?: Record<string, unknown>;
}

// ============================================================
// Harness Events
// ============================================================

export interface RunStartedEvent {
  type: "run.started";
  runId: string;
  createdAt: Date;
}

export interface AssistantDeltaEvent {
  type: "assistant.delta";
  runId: string;
  text: string;
}

export interface AssistantMessageEvent {
  type: "assistant.message";
  runId: string;
  message: ChatMessage;
}

export interface ReasoningDeltaEvent {
  type: "reasoning.delta";
  runId: string;
  reasoningId: string;
  text: string;
}

export interface ReasoningMessageEvent {
  type: "reasoning.message";
  runId: string;
  reasoningId: string;
  content: string;
}

export interface LogEvent {
  type: "log";
  runId: string | null;
  level: "info" | "warn" | "error" | "debug";
  message: string;
  data?: unknown;
  createdAt: Date;
}

export interface RunCancelledEvent {
  type: "run.cancelled";
  runId: string;
  createdAt: Date;
}

export interface RunFinishedEvent {
  type: "run.finished";
  runId: string;
  createdAt: Date;
}

// Scaffolding for future features
export interface ResourceCreatedEvent {
  type: "resource.created";
  resource: Resource;
}

export interface PermissionRequestedEvent {
  type: "permission.requested";
  requestId: string;
  prompt: string;
}

export interface StateUpdatedEvent {
  type: "state.updated";
  slice: string;
  patch: unknown;
}

export interface ModelChangedEvent {
  type: "model.changed";
  model: string | null;
}

export interface UsageInfoEvent {
  type: "usage.info";
  tokenLimit: number;
  currentTokens: number;
  messagesLength: number;
}

export interface QuotaInfoEvent {
  type: "quota.info";
  remainingPremiumRequests: number | null;
}

export interface ToolStartedEvent {
  type: "tool.started";
  runId: string;
  toolCallId: string;
  toolName: string;
}

export interface ToolCompletedEvent {
  type: "tool.completed";
  runId: string;
  toolCallId: string;
  success: boolean;
  error?: string;
}

export interface TurnStartedEvent {
  type: "turn.started";
  runId: string;
  turnId: string;
}

export interface TurnEndedEvent {
  type: "turn.ended";
  runId: string;
  turnId: string;
}

export type HarnessEvent =
  | RunStartedEvent
  | AssistantDeltaEvent
  | AssistantMessageEvent
  | ReasoningDeltaEvent
  | ReasoningMessageEvent
  | LogEvent
  | RunCancelledEvent
  | RunFinishedEvent
  | ResourceCreatedEvent
  | PermissionRequestedEvent
  | StateUpdatedEvent
  | ModelChangedEvent
  | UsageInfoEvent
  | QuotaInfoEvent
  | ToolStartedEvent
  | ToolCompletedEvent
  | TurnStartedEvent
  | TurnEndedEvent;

// ============================================================
// UI Actions (dispatched from UI to harness)
// ============================================================

export interface SubmitPromptAction {
  type: "submit.prompt";
  text: string;
}

export interface CancelAction {
  type: "cancel";
}

// Scaffolding for future features
export interface SelectResourceAction {
  type: "select.resource";
  uri: string;
}

export interface PermissionRespondAction {
  type: "permission.respond";
  requestId: string;
  allow: boolean;
}

export interface ApprovePatchAction {
  type: "approve.patch";
  patchId: string;
}

export interface ChangeModelAction {
  type: "change.model";
  modelId: string;
}

export type UIAction =
  | SubmitPromptAction
  | CancelAction
  | SelectResourceAction
  | PermissionRespondAction
  | ApprovePatchAction
  | ChangeModelAction;

// ============================================================
// Helper functions
// ============================================================

export function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

export function createUserMessage(content: string): ChatMessage {
  return {
    id: generateId(),
    role: "user",
    content,
    createdAt: new Date(),
  };
}

export function createAssistantMessage(content: string): ChatMessage {
  return {
    id: generateId(),
    role: "assistant",
    content,
    createdAt: new Date(),
  };
}

export function createLogEvent(
  level: LogEvent["level"],
  message: string,
  runId: string | null = null,
  data?: unknown
): LogEvent {
  return {
    type: "log",
    runId,
    level,
    message,
    data,
    createdAt: new Date(),
  };
}
