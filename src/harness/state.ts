/**
 * Public state types for the Harness.
 *
 * These types define the contract between the harness layer and the UI layer.
 * UI components import from here (or via Harness re-exports) to type-check
 * against the harness state shape.
 */

import type { LogEvent, SessionInfo, TranscriptItem } from "./events.js";
import type { ModelDescription } from "../copilot/CopilotSessionAdapter.js";

// ── Status ────────────────────────────────────────────────────

export type HarnessStatus = "idle" | "running" | "error";

// ── Entity types ──────────────────────────────────────────────

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

export interface EphemeralRun {
  runId: string;
  displayText: string;
  transcript: TranscriptItem[];
  streamingContent: string;
  status: "running" | "completed" | "failed";
  startedAt: Date;
  completedAt?: Date;
}

// ── Aggregate state ───────────────────────────────────────────

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
  currentSessionId: string | null;
  availableSessions: SessionInfo[];
  ephemeralRun: EphemeralRun | null;
  contextInfo: {
    currentTokens: number;
    tokenLimit: number;
    conversationLength: number;
    remainingPremiumRequests: number | null;
    consumedRequests: number;
  };
}

// ── Constants ─────────────────────────────────────────────────

export const MAX_LOGS = 100;
export const MAX_TASKS = 50;
export const MAX_SUBAGENTS = 50;
export const MAX_SKILLS = 50;
export const MAX_TRANSCRIPT = 500;

// ── Initial state ─────────────────────────────────────────────

export const INITIAL_STATE: HarnessState = {
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
  currentSessionId: null,
  availableSessions: [],
  ephemeralRun: null,
  contextInfo: {
    currentTokens: 0,
    tokenLimit: 0,
    conversationLength: 0,
    remainingPremiumRequests: null,
    consumedRequests: 0,
  },
};
