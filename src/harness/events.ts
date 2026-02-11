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
  kind: "message";
  role: MessageRole;
  content: string;
  reasoning?: string;
  createdAt: Date;
}

export interface ToolCallItem {
  id: string;
  kind: "tool-call";
  toolCallId: string;
  toolName: string;
  arguments?: Record<string, unknown>;
  progress: string[];
  status: "running" | "completed" | "failed";
  startedAt: Date;
  completedAt?: Date;
  output?: string;
  error?: string;
}

/** A single item in the chat transcript — either a text message or an inline tool call. */
export type TranscriptItem = ChatMessage | ToolCallItem;

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
  consumedRequests: number;
}

export interface ToolStartedEvent {
  type: "tool.started";
  runId: string;
  toolCallId: string;
  toolName: string;
  arguments?: Record<string, unknown>;
}

export interface ToolProgressEvent {
  type: "tool.progress";
  runId: string;
  toolCallId: string;
  message: string;
}

export interface ToolCompletedEvent {
  type: "tool.completed";
  runId: string;
  toolCallId: string;
  success: boolean;
  output?: string;
  error?: string;
}

export interface SubagentStartedEvent {
  type: "subagent.started";
  runId: string;
  toolCallId: string;
  agentName: string;
  agentDisplayName: string;
  agentDescription: string;
}

export interface SubagentCompletedEvent {
  type: "subagent.completed";
  runId: string;
  toolCallId: string;
  agentName: string;
}

export interface SubagentFailedEvent {
  type: "subagent.failed";
  runId: string;
  toolCallId: string;
  agentName: string;
  error: string;
}

export interface SkillInvokedEvent {
  type: "skill.invoked";
  runId: string;
  name: string;
  path: string;
}

export interface IntentUpdatedEvent {
  type: "intent.updated";
  runId: string;
  intent: string;
}

export interface TodoUpdatedEvent {
  type: "todo.updated";
  runId: string;
  todos: string;
}

export interface PlanUpdatedEvent {
  type: "plan.updated";
  content: string;
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

export interface QuestionRequestedEvent {
  type: "question.requested";
  requestId: string;
  question: string;
  choices?: string[];
  allowFreeform: boolean;
}

export interface QuestionAnsweredEvent {
  type: "question.answered";
  requestId: string;
  answer: string;
  wasFreeform: boolean;
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
  | ToolProgressEvent
  | ToolCompletedEvent
  | SubagentStartedEvent
  | SubagentCompletedEvent
  | SubagentFailedEvent
  | SkillInvokedEvent
  | IntentUpdatedEvent
  | TodoUpdatedEvent
  | PlanUpdatedEvent
  | TurnStartedEvent
  | TurnEndedEvent
  | QuestionRequestedEvent
  | QuestionAnsweredEvent;

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

export interface AnswerQuestionAction {
  type: "answer.question";
  requestId: string;
  answer: string;
  wasFreeform: boolean;
}

export type UIAction =
  | SubmitPromptAction
  | CancelAction
  | SelectResourceAction
  | PermissionRespondAction
  | ApprovePatchAction
  | ChangeModelAction
  | AnswerQuestionAction;

// ============================================================
// Helper functions
// ============================================================

export function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

export function createUserMessage(content: string): ChatMessage {
  return {
    id: generateId(),
    kind: "message",
    role: "user",
    content,
    createdAt: new Date(),
  };
}

export function createAssistantMessage(content: string): ChatMessage {
  return {
    id: generateId(),
    kind: "message",
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
