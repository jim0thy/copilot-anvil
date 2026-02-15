/**
 * Pure-ish state reducer for HarnessEvent → HarnessState transitions.
 *
 * Extracted from Harness.processEvent so the orchestrator class stays
 * focused on coordination (dispatch, subscribe, adapter lifecycle).
 */

import type { ChatMessage, HarnessEvent, TranscriptItem } from "./events.js";
import { createAssistantMessage, generateId } from "./events.js";
import type {
  HarnessState,
  Task,
  Subagent,
  Skill,
} from "./state.js";
import {
  MAX_LOGS,
  MAX_TASKS,
  MAX_SUBAGENTS,
  MAX_SKILLS,
  MAX_TRANSCRIPT,
} from "./state.js";

// ── Side-channel context ────────────────────────────────────────
// The tool-call transcript index lives outside HarnessState for
// performance (O(1) lookups instead of linear scans). The reducer
// reads and mutates it as a side effect.

export interface ReducerContext {
  toolCallTranscriptIndex: Map<string, number>;
}

// ── Helpers ─────────────────────────────────────────────────────

/** Fields cleared at the end of every run or session switch. */
function resetRunFields(): Partial<HarnessState> {
  return {
    streamingContent: "",
    streamingReasoning: "",
    currentIntent: null,
    currentTodo: null,
    currentPlan: null,
  };
}

/** Fresh context info preserving request counts across session switches. */
function freshContextInfo(state: HarnessState): HarnessState["contextInfo"] {
  return {
    currentTokens: 0,
    tokenLimit: 0,
    conversationLength: 0,
    remainingPremiumRequests: state.contextInfo.remainingPremiumRequests,
    consumedRequests: state.contextInfo.consumedRequests,
  };
}

function trimTranscript(transcript: TranscriptItem[], ctx: ReducerContext): void {
  if (transcript.length <= MAX_TRANSCRIPT) return;
  const excess = transcript.length - MAX_TRANSCRIPT;
  transcript.splice(0, excess);
  // Rebuild the index map after trimming since indices shifted
  ctx.toolCallTranscriptIndex.clear();
  for (let i = 0; i < transcript.length; i++) {
    const item = transcript[i];
    if (item.kind === "tool-call") {
      ctx.toolCallTranscriptIndex.set(item.toolCallId, i);
    }
  }
}

// ── Main reducer ────────────────────────────────────────────────

export function processEvent(
  state: HarnessState,
  event: HarnessEvent,
  ctx: ReducerContext,
): HarnessState {
  switch (event.type) {
    case "run.started":
      return {
        ...state,
        status: "running",
        currentRunId: event.runId,
        ...resetRunFields(),
      };

    case "assistant.delta":
      return {
        ...state,
        streamingContent: state.streamingContent + event.text,
      };

    case "reasoning.delta":
      return {
        ...state,
        streamingReasoning: state.streamingReasoning + event.text,
      };

    case "reasoning.message":
      return state;

    case "assistant.message": {
      const messageWithReasoning: ChatMessage = {
        ...event.message,
        kind: "message",
        reasoning: state.streamingReasoning || undefined,
      };
      const newTranscript = [...state.transcript, messageWithReasoning];
      trimTranscript(newTranscript, ctx);
      return {
        ...state,
        transcript: newTranscript,
        streamingContent: "",
        streamingReasoning: "",
      };
    }

    case "log":
      return {
        ...state,
        logs: [...state.logs.slice(-MAX_LOGS + 1), event],
      };

    case "run.cancelled":
      return {
        ...state,
        status: "idle",
        currentRunId: null,
        ...resetRunFields(),
      };

    case "run.finished": {
      // Flush any remaining streaming content to transcript as a safety measure
      let newTranscript = state.transcript;
      if (state.streamingContent) {
        const finalMessage: ChatMessage = {
          ...createAssistantMessage(state.streamingContent),
          reasoning: state.streamingReasoning || undefined,
        };
        newTranscript = [...newTranscript, finalMessage];
      }

      return {
        ...state,
        status: "idle",
        currentRunId: null,
        transcript: newTranscript,
        ...resetRunFields(),
        contextInfo: {
          ...state.contextInfo,
          consumedRequests: state.contextInfo.consumedRequests + 1,
        },
      };
    }

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
      const newTranscript = [...state.transcript, toolItem];
      ctx.toolCallTranscriptIndex.set(event.toolCallId, newTranscript.length - 1);
      trimTranscript(newTranscript, ctx);
      return {
        ...state,
        transcript: newTranscript,
        activeTools: [
          ...state.activeTools,
          {
            toolCallId: event.toolCallId,
            toolName: event.toolName,
            arguments: event.arguments,
            progress: [],
            startedAt: new Date(),
            status: "running",
          },
        ],
        tasks: [...state.tasks.slice(-MAX_TASKS + 1), newTask],
      };
    }

    case "tool.progress": {
      const updatedTools = state.activeTools.map((tool) => {
        if (tool.toolCallId === event.toolCallId) {
          return { ...tool, progress: [...tool.progress, event.message] };
        }
        return tool;
      });

      const idx = ctx.toolCallTranscriptIndex.get(event.toolCallId);
      let updatedTranscript = state.transcript;
      if (idx !== undefined && idx < updatedTranscript.length) {
        const item = updatedTranscript[idx];
        if (item.kind === "tool-call" && item.toolCallId === event.toolCallId) {
          updatedTranscript = [...updatedTranscript];
          updatedTranscript[idx] = { ...item, progress: [...item.progress, event.message] };
        }
      }

      return {
        ...state,
        activeTools: updatedTools,
        transcript: updatedTranscript,
      };
    }

    case "tool.completed": {
      const updatedTools = state.activeTools.map((tool) => {
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

      const updatedTasks = state.tasks.map((task) => {
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

      const idx = ctx.toolCallTranscriptIndex.get(event.toolCallId);
      let updatedTranscript = state.transcript;
      if (idx !== undefined && idx < updatedTranscript.length) {
        const item = updatedTranscript[idx];
        if (item.kind === "tool-call" && item.toolCallId === event.toolCallId) {
          updatedTranscript = [...updatedTranscript];
          updatedTranscript[idx] = {
            ...item,
            status: event.success ? ("completed" as const) : ("failed" as const),
            completedAt: new Date(),
            output: event.output,
            error: event.error,
          };
        }
      }

      return {
        ...state,
        activeTools: updatedTools,
        tasks: updatedTasks,
        transcript: updatedTranscript,
      };
    }

    case "turn.started":
    case "turn.ended":
      return state;

    case "model.changed":
      return { ...state, currentModel: event.model };

    case "usage.info":
      return {
        ...state,
        contextInfo: {
          ...state.contextInfo,
          currentTokens: event.currentTokens,
          tokenLimit: event.tokenLimit,
          conversationLength: event.messagesLength,
        },
      };

    case "quota.info":
      return {
        ...state,
        contextInfo: {
          ...state.contextInfo,
          remainingPremiumRequests: event.remainingPremiumRequests,
        },
      };

    case "subagent.started": {
      const newSubagent: Subagent = {
        toolCallId: event.toolCallId,
        agentName: event.agentName,
        agentDisplayName: event.agentDisplayName,
        agentDescription: event.agentDescription,
        status: "running",
        startedAt: new Date(),
      };
      return {
        ...state,
        subagents: [...state.subagents.slice(-MAX_SUBAGENTS + 1), newSubagent],
      };
    }

    case "subagent.completed": {
      const updatedSubagents = state.subagents.map((agent) => {
        if (agent.toolCallId === event.toolCallId) {
          return { ...agent, status: "completed" as const, completedAt: new Date() };
        }
        return agent;
      });
      return { ...state, subagents: updatedSubagents };
    }

    case "subagent.failed": {
      const updatedSubagents = state.subagents.map((agent) => {
        if (agent.toolCallId === event.toolCallId) {
          return { ...agent, status: "failed" as const, completedAt: new Date(), error: event.error };
        }
        return agent;
      });
      return { ...state, subagents: updatedSubagents };
    }

    case "skill.invoked": {
      const existingSkill = state.skills.find(s => s.name === event.name);
      if (existingSkill) {
        const updatedSkills = state.skills.map((skill) => {
          if (skill.name === event.name) {
            return { ...skill, invokedAt: new Date(), invokeCount: skill.invokeCount + 1 };
          }
          return skill;
        });
        return { ...state, skills: updatedSkills };
      }
      const newSkill: Skill = {
        name: event.name,
        path: event.path,
        invokedAt: new Date(),
        invokeCount: 1,
      };
      return { ...state, skills: [...state.skills.slice(-MAX_SKILLS + 1), newSkill] };
    }

    case "intent.updated":
      return { ...state, currentIntent: event.intent };

    case "todo.updated":
      return { ...state, currentTodo: event.todos };

    case "plan.updated":
      return { ...state, currentPlan: event.content };

    case "question.requested":
      return {
        ...state,
        pendingQuestion: {
          requestId: event.requestId,
          question: event.question,
          choices: event.choices,
          allowFreeform: event.allowFreeform,
        },
      };

    case "question.answered":
      return { ...state, pendingQuestion: null };

    case "session.switched":
      ctx.toolCallTranscriptIndex.clear();
      return {
        ...state,
        currentSessionId: event.sessionId,
        transcript: event.transcript ?? [],
        activeTools: [],
        ...resetRunFields(),
      };

    case "session.created":
      ctx.toolCallTranscriptIndex.clear();
      return {
        ...state,
        currentSessionId: event.sessionId,
        transcript: [],
        activeTools: [],
        ...resetRunFields(),
      };

    case "session.list.updated":
      return { ...state, availableSessions: event.sessions };

    default:
      return state;
  }
}

// ── Ephemeral event reducer ─────────────────────────────────────

export function processEphemeralEvent(
  state: HarnessState,
  event: HarnessEvent,
): HarnessState {
  if (!state.ephemeralRun) return state;

  switch (event.type) {
    case "assistant.delta":
      return {
        ...state,
        ephemeralRun: {
          ...state.ephemeralRun,
          streamingContent: state.ephemeralRun.streamingContent + event.text,
        },
      };

    case "assistant.message": {
      const message: ChatMessage = { ...event.message, kind: "message" };
      return {
        ...state,
        ephemeralRun: {
          ...state.ephemeralRun,
          transcript: [...state.ephemeralRun.transcript, message],
          streamingContent: "",
        },
      };
    }

    case "run.finished": {
      let newTranscript = state.ephemeralRun.transcript;
      if (state.ephemeralRun.streamingContent) {
        const finalMessage = createAssistantMessage(state.ephemeralRun.streamingContent);
        newTranscript = [...newTranscript, finalMessage];
      }
      return {
        ...state,
        ephemeralRun: {
          ...state.ephemeralRun,
          transcript: newTranscript,
          streamingContent: "",
          status: "completed",
          completedAt: new Date(),
        },
      };
    }

    case "run.cancelled":
      return {
        ...state,
        ephemeralRun: {
          ...state.ephemeralRun,
          status: "failed",
          completedAt: new Date(),
        },
      };

    // Ignore reasoning events for ephemeral runs
    case "reasoning.delta":
    case "reasoning.message":
      return state;

    default:
      return state;
  }
}

/** Exposed for use by Harness when resetting context on session switch. */
export { freshContextInfo };
