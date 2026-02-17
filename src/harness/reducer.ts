/**
 * Pure-ish state reducer for HarnessEvent → HarnessState transitions.
 *
 * Extracted from Harness.processEvent so the harness class stays
 * focused on coordination (dispatch, subscribe, adapter lifecycle).
 */

import type { ChatMessage, HarnessEvent, TranscriptItem, ToolCallItem } from "./events.js";
import { createAssistantMessage, createUserMessage, generateId } from "./events.js";
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
    streamingAgentName: null,
    currentIntent: null,
    // Keep currentTodo/currentPlan until a new message is sent
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
    case "run.started": {
      // Determine the agent name for streaming display
      // If there's an active agent selected, use its display name
      let agentName: string | null = null;
      if (state.currentAgentId) {
        const agent = state.availableAgents.find(a => a.id === state.currentAgentId);
        agentName = agent?.name ?? null;
      }
      
      return {
        ...state,
        status: "running",
        currentRunId: event.runId,
        ...resetRunFields(),
        streamingAgentName: agentName, // Set initial agent name for this run
      };
    }

    case "assistant.delta":
      if (event.parentToolCallId) {
        return state;
      }
      return {
        ...state,
        streamingContent: state.streamingContent + event.text,
        // Update streaming agent name for top-level assistant streaming
        streamingAgentName: event.agentDisplayName ?? state.streamingAgentName,
      };

    case "reasoning.delta":
      return {
        ...state,
        streamingReasoning: state.streamingReasoning + event.text,
      };

    case "reasoning.message":
      return state;

    case "assistant.message": {
      const isSubagentMessage = Boolean(event.message.parentToolCallId);
      const messageWithReasoning: ChatMessage = {
        ...event.message,
        kind: "message",
        reasoning: isSubagentMessage ? event.message.reasoning : (state.streamingReasoning || undefined),
      };
      const newTranscript = [...state.transcript, messageWithReasoning];
      trimTranscript(newTranscript, ctx);
      if (isSubagentMessage) {
        return {
          ...state,
          transcript: newTranscript,
        };
      }
      return {
        ...state,
        transcript: newTranscript,
        streamingContent: "",
        streamingReasoning: "",
        streamingAgentName: null,
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

    case "reasoning.effort.changed":
      return { ...state, reasoningEffort: event.effort };

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
        model: event.model,
        taskTitle: event.taskTitle,
        status: "running",
        startedAt: new Date(),
      };

      // Check if there's already a running subagent with the same agentDisplayName
      const runningWithSameName = state.subagents.some(
        (s) => s.status === "running" && s.agentDisplayName === event.agentDisplayName
      );

      // If a running one exists, just append (allow parallel instances)
      if (runningWithSameName) {
        return {
          ...state,
          subagents: [...state.subagents.slice(-MAX_SUBAGENTS + 1), newSubagent],
        };
      }

      // Find completed/failed entries with matching agentDisplayName
      const completedOrFailed = state.subagents.filter(
        (s) => (s.status === "completed" || s.status === "failed") && s.agentDisplayName === event.agentDisplayName
      );

      if (completedOrFailed.length === 0) {
        // No matching completed/failed entry exists, just append
        return {
          ...state,
          subagents: [...state.subagents.slice(-MAX_SUBAGENTS + 1), newSubagent],
        };
      }

      // Find the most recent completed/failed entry (highest completedAt)
      const mostRecent = completedOrFailed.reduce((latest, current) => {
        if (!latest.completedAt) return current;
        if (!current.completedAt) return latest;
        return current.completedAt > latest.completedAt ? current : latest;
      });
      const mostRecentIndex = state.subagents.indexOf(mostRecent);

      if (mostRecentIndex === -1) {
        // Fallback: just append if we couldn't find the most recent (shouldn't happen)
        return {
          ...state,
          subagents: [...state.subagents.slice(-MAX_SUBAGENTS + 1), newSubagent],
        };
      }

      // Replace the most recent completed/failed entry with the new running one
      const updatedSubagents = [...state.subagents];
      updatedSubagents[mostRecentIndex] = newSubagent;

      return {
        ...state,
        subagents: updatedSubagents,
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

    case "intent.updated": {
      if (event.toolCallId) {
        const updatedSubagents = state.subagents.map((agent) => {
          if (agent.toolCallId === event.toolCallId) {
            return { ...agent, currentIntent: event.intent };
          }
          return agent;
        });
        return { ...state, subagents: updatedSubagents };
      }
      return { ...state, currentIntent: event.intent };
    }

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

    case "question.answered": {
      // Show the user's answer in the transcript so the conversation flow is visible
      const answerMessage = createUserMessage(event.answer);
      const updatedTranscript = [...state.transcript, answerMessage];
      trimTranscript(updatedTranscript, ctx);
      return {
        ...state,
        pendingQuestion: null,
        transcript: updatedTranscript,
      };
    }

    case "session.switched":
      ctx.toolCallTranscriptIndex.clear();
      return {
        ...state,
        currentSessionId: event.sessionId,
        currentSessionName: event.sessionName || null,
        transcript: event.transcript ?? [],
        activeTools: [],
        ...resetRunFields(),
      };

    case "session.created":
      ctx.toolCallTranscriptIndex.clear();
      return {
        ...state,
        currentSessionId: event.sessionId,
        currentSessionName: event.sessionName || null,
        transcript: [],
        activeTools: [],
        ...resetRunFields(),
      };

    case "session.list.updated": {
      const currentName = state.currentSessionId
        ? event.sessions.find(s => s.id === state.currentSessionId)?.name ?? state.currentSessionName
        : state.currentSessionName;
      return { ...state, availableSessions: event.sessions, currentSessionName: currentName };
    }

    case "orchestration.mode.changed":
      return { ...state, orchestrationMode: event.mode };

    case "agent.changed":
      return { ...state, currentAgentId: event.agentId };

    case "agents.loaded":
      return { ...state, availableAgents: event.agents };

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

    // Handle tool calls in ephemeral runs
    case "tool.started": {
      const toolItem: ToolCallItem = {
        id: generateId(),
        kind: "tool-call",
        toolCallId: event.toolCallId,
        toolName: event.toolName,
        arguments: event.arguments,
        progress: [],
        status: "running",
        startedAt: new Date(),
      };
      return {
        ...state,
        ephemeralRun: {
          ...state.ephemeralRun,
          transcript: [...state.ephemeralRun.transcript, toolItem],
        },
      };
    }

    case "tool.progress": {
      const toolIndex = state.ephemeralRun.transcript.findIndex(
        (item) => item.kind === "tool-call" && item.toolCallId === event.toolCallId
      );
      if (toolIndex === -1) return state;
      
      const tool = state.ephemeralRun.transcript[toolIndex];
      if (tool.kind !== "tool-call") return state;

      const updatedTool: ToolCallItem = {
        ...tool,
        progress: [...tool.progress, event.message],
      };
      const newTranscript = [...state.ephemeralRun.transcript];
      newTranscript[toolIndex] = updatedTool;

      return {
        ...state,
        ephemeralRun: {
          ...state.ephemeralRun,
          transcript: newTranscript,
        },
      };
    }

    case "tool.completed": {
      const toolIndex = state.ephemeralRun.transcript.findIndex(
        (item) => item.kind === "tool-call" && item.toolCallId === event.toolCallId
      );
      if (toolIndex === -1) return state;
      
      const tool = state.ephemeralRun.transcript[toolIndex];
      if (tool.kind !== "tool-call") return state;

      const updatedTool: ToolCallItem = {
        ...tool,
        status: event.success ? "completed" : "failed",
        completedAt: new Date(),
        output: event.output,
        error: event.error,
      };
      const newTranscript = [...state.ephemeralRun.transcript];
      newTranscript[toolIndex] = updatedTool;

      return {
        ...state,
        ephemeralRun: {
          ...state.ephemeralRun,
          transcript: newTranscript,
        },
      };
    }

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
