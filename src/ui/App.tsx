import { useKeyboard, useTerminalDimensions } from '@opentui/react'
import type { CliRenderer } from '@opentui/core'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { basename } from 'node:path'
import type { Harness, HarnessState, HarnessStatus } from '../harness/Harness.js'
import type { HarnessEvent, SubagentStreamEntry } from '../harness/events.js'
import { ChatPane } from './panes/ChatPane.js'
import { InputBar } from './panes/InputBar.js'
import { StartScreen } from './panes/StartScreen.js'
import { QuestionModal } from './panes/QuestionModal.js'
import { ModelSelector } from './panes/ModelSelector.js'

import { AgentsModal } from './panes/AgentsModal.js'
import { SkillsPane } from './panes/SkillsPane.js'
import { ConfirmModal } from './panes/ConfirmModal.js'
import { EphemeralModal } from './panes/EphemeralModal.js'
import { SessionHistoryPane } from './panes/SessionHistoryPane.js'
import { Sidebar } from './panes/Sidebar.js'
import { DebugOverlay } from './panes/DebugOverlay.js'
import { getTheme } from './theme.js'
import { getGitInfo, getGitInfoAsync, type GitInfo } from '../utils/git.js'
import { getModifiedFiles, getModifiedFilesAsync, type FileChange } from '../utils/gitDiff.js'
import { cycleReasoningEffort } from '../utils/config.js'

interface AppProps {
  harness: Harness;
  renderer: CliRenderer;
}

const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
const STATUS_BAR_HEIGHT = 2;
const MIN_INPUT_BAR_HEIGHT = 3;

interface StreamingSlice {
  streamingContentChunks: string[];
  streamingReasoningChunks: string[];
  streamingAgentName: string | null;
  subagentStreaming: Record<string, SubagentStreamEntry>;
}

interface TranscriptSlice {
  transcript: HarnessState["transcript"];
}

interface SidebarSlice {
  contextInfo: HarnessState["contextInfo"];
  orchestrationMode: HarnessState["orchestrationMode"];
  subagents: HarnessState["subagents"];
  skills: HarnessState["skills"];
  currentIntent: string | null;
  currentTodo: string | null;
  currentPlan: string | null;
  currentSessionName: string | null;
}

interface UISlice {
  status: HarnessStatus;
  currentModel: string | null;
  availableModels: HarnessState["availableModels"];
  currentAgentId: string | null;
  availableAgents: HarnessState["availableAgents"];
  currentRunId: string | null;
  messageQueue: string[];
  pendingQuestion: HarnessState["pendingQuestion"];
  availableSessions: HarnessState["availableSessions"];
  currentSessionId: string | null;
  ephemeralRun: HarnessState["ephemeralRun"];
  reasoningEffort: HarnessState["reasoningEffort"];
}

function useSpinner(active: boolean): string {
  const [frame, setFrame] = useState(0);
  useEffect(() => {
    if (!active) return;
    const interval = setInterval(() => {
      setFrame((f) => (f + 1) % SPINNER_FRAMES.length);
    }, 80);
    return () => clearInterval(interval);
  }, [active]);
  return active ? SPINNER_FRAMES[frame] : "";
}

export function App({ harness, renderer }: AppProps) {
  const { width, height } = useTerminalDimensions();
  const initialState = harness.getState();
  const [streamingState, setStreamingState] = useState<StreamingSlice>({
    streamingContentChunks: initialState.streamingContentChunks,
    streamingReasoningChunks: initialState.streamingReasoningChunks,
    streamingAgentName: initialState.streamingAgentName,
    subagentStreaming: initialState.subagentStreaming,
  });
  const [transcriptState, setTranscriptState] = useState<TranscriptSlice>({
    transcript: initialState.transcript,
  });
  const [sidebarState, setSidebarState] = useState<SidebarSlice>({
    contextInfo: initialState.contextInfo,
    orchestrationMode: initialState.orchestrationMode,
    subagents: initialState.subagents,
    skills: initialState.skills,
    currentIntent: initialState.currentIntent,
    currentTodo: initialState.currentTodo,
    currentPlan: initialState.currentPlan,
    currentSessionName: initialState.currentSessionName,
  });
  const [uiState, setUiState] = useState<UISlice>({
    status: initialState.status,
    currentModel: initialState.currentModel,
    availableModels: initialState.availableModels,
    currentAgentId: initialState.currentAgentId,
    availableAgents: initialState.availableAgents,
    currentRunId: initialState.currentRunId,
    messageQueue: initialState.messageQueue,
    pendingQuestion: initialState.pendingQuestion,
    availableSessions: initialState.availableSessions,
    currentSessionId: initialState.currentSessionId,
    ephemeralRun: initialState.ephemeralRun,
    reasoningEffort: initialState.reasoningEffort,
  });
  const [hasStarted, setHasStarted] = useState(false);
  const [gitInfo, setGitInfo] = useState<GitInfo>(getGitInfo());
  const [modifiedFiles, setModifiedFiles] = useState<FileChange[]>(getModifiedFiles());
  const [showModelSelector, setShowModelSelector] = useState(false);
  const [showSessionHistory, setShowSessionHistory] = useState(false);
  const [sessionFocused, setSessionFocused] = useState(false);
  const [showSkillsPane, setShowSkillsPane] = useState(false);
  const [showCommitConfirm, setShowCommitConfirm] = useState(false);
  const [showAgentsModal, setShowAgentsModal] = useState(false);
  const [inputBarHeight, setInputBarHeight] = useState(MIN_INPUT_BAR_HEIGHT);
  const streamingUpdateTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const spinner = useSpinner(uiState.status === "running");

  // Subscribe to harness events.
  // Primary: useRef-based subscription fires synchronously during first render,
  // ensuring we never miss events (useEffect may not fire in all React reconcilers).
  // Fallback: useEffect subscription as backup in case useRef doesn't work.
  const unsubRef = useRef<(() => void) | null>(null);
  const STREAMING_THROTTLE_MS = 100;
  const subscriberFn = useCallback((event: HarnessEvent) => {
    const isStreamingEvent = event.type === "assistant.delta" || event.type === "reasoning.delta";
    if (isStreamingEvent) {
      if (streamingUpdateTimerRef.current === null) {
        streamingUpdateTimerRef.current = setTimeout(() => {
          streamingUpdateTimerRef.current = null;
          const latest = harness.getState();
          setStreamingState({
            streamingContentChunks: latest.streamingContentChunks,
            streamingReasoningChunks: latest.streamingReasoningChunks,
            streamingAgentName: latest.streamingAgentName,
            subagentStreaming: latest.subagentStreaming,
          });
        }, STREAMING_THROTTLE_MS);
      }
    } else {
      if (streamingUpdateTimerRef.current !== null) {
        clearTimeout(streamingUpdateTimerRef.current);
        streamingUpdateTimerRef.current = null;
      }
      const s = harness.getState();
      setStreamingState({
        streamingContentChunks: s.streamingContentChunks,
        streamingReasoningChunks: s.streamingReasoningChunks,
        streamingAgentName: s.streamingAgentName,
        subagentStreaming: s.subagentStreaming,
      });
      setTranscriptState({ transcript: s.transcript });
      setSidebarState({
        contextInfo: s.contextInfo,
        orchestrationMode: s.orchestrationMode,
        subagents: s.subagents,
        skills: s.skills,
        currentIntent: s.currentIntent,
        currentTodo: s.currentTodo,
        currentPlan: s.currentPlan,
        currentSessionName: s.currentSessionName,
      });
      setUiState({
        status: s.status,
        currentModel: s.currentModel,
        availableModels: s.availableModels,
        currentAgentId: s.currentAgentId,
        availableAgents: s.availableAgents,
        currentRunId: s.currentRunId,
        messageQueue: s.messageQueue,
        pendingQuestion: s.pendingQuestion,
        availableSessions: s.availableSessions,
        currentSessionId: s.currentSessionId,
        ephemeralRun: s.ephemeralRun,
        reasoningEffort: s.reasoningEffort,
      });
    }

    if (event.type === "show.agents.modal") {
      setShowAgentsModal(true);
    }
    if (event.type === "run.started") {
      renderer.requestLive();
    } else if (event.type === "run.finished" || event.type === "run.cancelled") {
      renderer.dropLive();
    }
  }, [harness, renderer]);

  // Try synchronous subscription during render
  if (unsubRef.current === null) {
    unsubRef.current = harness.subscribe(subscriberFn);
  }

  // Fallback: useEffect subscription in case the ref-based one didn't work
  useEffect(() => {
    // If ref-based subscription already worked, this is a no-op backup.
    // If it didn't work (ref was null somehow), this ensures we subscribe.
    const unsub = harness.subscribe(subscriberFn);
    return () => {
      unsub();
      if (streamingUpdateTimerRef.current !== null) {
        clearTimeout(streamingUpdateTimerRef.current);
        streamingUpdateTimerRef.current = null;
      }
    };
  }, [harness, subscriberFn]);

  // Session refresh on mount
  const sessionRefreshRef = useRef(false);
  if (!sessionRefreshRef.current) {
    sessionRefreshRef.current = true;
    queueMicrotask(() => harness.dispatch({ type: "session.refresh" }));
  }

  useEffect(() => {
    let cancelled = false;
    const poll = async () => {
      if (cancelled) return;
      const [info, files] = await Promise.all([getGitInfoAsync(), getModifiedFilesAsync()]);
      if (!cancelled) {
        setGitInfo(info);
        setModifiedFiles(files);
      }
    };
    poll();
    const interval = setInterval(poll, 5000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  const handleSubmit = useCallback(
    (data: { text: string; images?: string[] }) => {
      if (!hasStarted) {
        setHasStarted(true);
      }
      harness.dispatch({ type: "submit.prompt", text: data.text, images: data.images });
      // Reset input bar height when submitting
      setInputBarHeight(MIN_INPUT_BAR_HEIGHT);
    },
    [harness, hasStarted]
  );

  const handleCancel = useCallback(() => {
    if (uiState.status === "running") {
      harness.dispatch({ type: "cancel" });
    } else {
      renderer.destroy();
      process.exit(0);
    }
  }, [harness, uiState.status, renderer]);

  const handleSelectModel = useCallback((modelId: string) => {
    harness.dispatch({ type: "change.model", modelId });
    setShowModelSelector(false);
  }, [harness]);

  const handleCloseModelSelector = useCallback(() => {
    setShowModelSelector(false);
  }, []);

  const handleSelectAgent = useCallback((agentId: string | null) => {
    harness.dispatch({ type: "agent.switch", agentId });
    setShowAgentsModal(false);
  }, [harness]);

  const handleCloseAgentsModal = useCallback(() => {
    setShowAgentsModal(false);
  }, []);

  const handleSelectSkill = useCallback((skillName: string) => {
    setShowSkillsPane(false);
    // Invoke the skill by sending a prompt to use it
    harness.dispatch({ 
      type: "submit.prompt", 
      text: `Use the ${skillName} skill` 
    });
    if (!hasStarted) {
      setHasStarted(true);
    }
  }, [harness, hasStarted]);

  const handleCloseSkillsPane = useCallback(() => {
    setShowSkillsPane(false);
  }, []);

  const handleSelectSession = useCallback((sessionId: string) => {
    harness.dispatch({ type: "session.switch", sessionId });
    setHasStarted(true);
  }, [harness]);

  const handleNewSession = useCallback(() => {
    harness.dispatch({ type: "session.new" });
  }, [harness]);

  const handleSessionClose = useCallback(() => {
    setSessionFocused(false);
  }, []);

  const handleInputHeightChange = useCallback((height: number) => {
    setInputBarHeight(height);
  }, []);

  const handleAnswerQuestion = useCallback(
    (answer: string, wasFreeform: boolean) => {
      if (uiState.pendingQuestion) {
        harness.dispatch({
          type: "answer.question",
          requestId: uiState.pendingQuestion.requestId,
          answer,
          wasFreeform,
        });
      }
    },
    [harness, uiState.pendingQuestion]
  );

  const handleSmartCommitConfirm = useCallback(() => {
    setShowCommitConfirm(false);
    if (!hasStarted) {
      setHasStarted(true);
    }
    const prompt = `Categorize the current uncommitted changes in this repository, create a distinct commit for each logical category with a descriptive commit message, and push all commits to the remote. Show me what you're doing at each step.`;
    harness.runEphemeralPrompt(prompt, {
      model: "gemini-3-flash",
      displayText: "[Smart Commit & Push]",
    });
  }, [harness, hasStarted]);

  const handleSmartCommitCancel = useCallback(() => {
    setShowCommitConfirm(false);
  }, []);

  const handleCloseCommandModal = useCallback(() => {
    harness.dispatch({ type: "ephemeral.close" });
  }, [harness]);

  const effectiveSessionFocused = sessionFocused && showSessionHistory &&
    !uiState.pendingQuestion && !showModelSelector && !showSkillsPane &&
    !showCommitConfirm && !showAgentsModal && !uiState.ephemeralRun;

  useKeyboard((key) => {
    if (key.ctrl && key.name === "s") {
      if (!showSessionHistory) {
        setShowSessionHistory(true);
        setSessionFocused(true);
      } else if (!sessionFocused) {
        setSessionFocused(true);
      } else {
        setSessionFocused(false);
        setShowSessionHistory(false);
      }
      return;
    }

    if (effectiveSessionFocused && !(key.ctrl && key.name === "c")) return;
    if (uiState.pendingQuestion || showModelSelector || showSkillsPane || showCommitConfirm || showAgentsModal || uiState.ephemeralRun) return;

    if (key.name === "escape") {
      renderer.destroy();
      process.exit(0);
    }
    if (key.ctrl && key.name === "c") {
      handleCancel();
    }
    // Tab cycles through agents
    if (key.name === "tab" && !key.shift && !key.ctrl) {
      if (uiState.status !== "running") {
        harness.dispatch({ type: "agent.cycle", direction: "next" });
      }
    }
    // Shift+Tab opens model selector
    if (key.shift && key.name === "tab") {
      if (uiState.status !== "running" && uiState.availableModels.length > 0) {
        setShowModelSelector(true);
      }
    }
    if (key.ctrl && key.name === "n") {
      if (uiState.status !== "running") {
        handleNewSession();
      }
    }

    if (key.ctrl && key.name === "g") {
      if (uiState.status !== "running" && gitInfo.hasChanges) {
        setShowCommitConfirm(true);
      }
    }
    // Ctrl+T cycles through reasoning effort
    if (key.ctrl && key.name === "t") {
      if (uiState.status !== "running") {
        const currentModelInfo = uiState.availableModels.find(m => m.id === uiState.currentModel);
        if (currentModelInfo?.supportsReasoningEffort) {
          const newEffort = cycleReasoningEffort(
            uiState.reasoningEffort,
            currentModelInfo.supportedReasoningEfforts
          );
          harness.dispatch({ type: "change.reasoning.effort", effort: newEffort });
        }
      }
    }
  });

  const theme = getTheme();
  const c = theme.colors; // Shorthand for cleaner code

  const statusColor = uiState.status === "running" ? c.warning : c.success;
  const statusText = uiState.status === "running" ? "Processing" : "Ready";
  const projectName = basename(process.cwd());

  const modelDisplay = useMemo(() =>
    uiState.currentModel
      ? uiState.currentModel.split("/").pop() || uiState.currentModel
      : "loading...",
    [uiState.currentModel]
  );

  // Get current agent name for status bar
  const currentAgent = useMemo(() =>
    uiState.currentAgentId
      ? uiState.availableAgents.find(a => a.id === uiState.currentAgentId)
      : null,
    [uiState.currentAgentId, uiState.availableAgents]
  );
  const agentDisplay = currentAgent?.name ?? "Copilot";
  const effectiveReasoningEffort = currentAgent?.reasoningEffort ?? uiState.reasoningEffort;

  const contentHeight = Math.max(1, height - STATUS_BAR_HEIGHT - 1);
  const sessionHistoryWidth = Math.floor(width * 0.25);
  const sidebarWidth = Math.floor(width * 0.20125);
  const mainWidth = width - (showSessionHistory ? sessionHistoryWidth : 0) - sidebarWidth;

  return (
    <box flexDirection="column" width={width} height={height - 1}>
      {hasStarted ? (
        <box height={contentHeight} flexDirection="row">
          {showSessionHistory && (
            <box width="25%">
              <SessionHistoryPane
                sessions={uiState.availableSessions || []}
                currentSessionId={uiState.currentSessionId || null}
                onSelect={handleSelectSession}
                onNewSession={handleNewSession}
                onClose={handleSessionClose}
                focused={effectiveSessionFocused}
                height={contentHeight}
                width={sessionHistoryWidth}
                theme={theme}
              />
            </box>
          )}
          <box flexDirection="column" width={mainWidth}>
            <ChatPane
              transcript={transcriptState.transcript}
              streamingContentChunks={streamingState.streamingContentChunks}
              streamingReasoningChunks={streamingState.streamingReasoningChunks}
              streamingAgentName={streamingState.streamingAgentName}
              subagentStreaming={streamingState.subagentStreaming}
              hasStarted={hasStarted}
              isStreaming={uiState.status === "running"}
              height={contentHeight - inputBarHeight}
              theme={theme}
            />
            <InputBar
              onSubmit={handleSubmit}
              disabled={uiState.status === "running" || !!uiState.pendingQuestion}
              suppressKeys={showModelSelector || showSkillsPane || showCommitConfirm || showAgentsModal || !!uiState.ephemeralRun || !!uiState.pendingQuestion || effectiveSessionFocused}
              queuedCount={uiState.messageQueue.length}
              theme={theme}
              onHeightChange={handleInputHeightChange}
              agentName={agentDisplay}
              modelName={modelDisplay}
              reasoningEffort={uiState.availableModels.find(m => m.id === uiState.currentModel)?.supportsReasoningEffort ? effectiveReasoningEffort : undefined}
              containerWidth={mainWidth}
            />
          </box>
          <box flexDirection="column" width={sidebarWidth} paddingLeft={2}>
            <Sidebar
              contextInfo={sidebarState.contextInfo}
              orchestrationMode={sidebarState.orchestrationMode}
              isRunning={uiState.status === "running"}
              files={modifiedFiles}
              currentSessionName={sidebarState.currentSessionName}
              currentIntent={sidebarState.currentIntent}
              currentTodo={sidebarState.currentTodo}
              currentPlan={sidebarState.currentPlan}
              subagents={sidebarState.subagents}
              skills={sidebarState.skills}
              agentName={agentDisplay}
              modelName={modelDisplay}
              height={contentHeight}
              width={sidebarWidth - 2}
              theme={theme}
            />
          </box>
        </box>
      ) : (
        <box height={contentHeight} flexDirection="row">
          {showSessionHistory && (
            <box width="25%">
              <SessionHistoryPane
                sessions={uiState.availableSessions || []}
                currentSessionId={uiState.currentSessionId || null}
                onSelect={handleSelectSession}
                onNewSession={handleNewSession}
                onClose={handleSessionClose}
                focused={effectiveSessionFocused}
                height={contentHeight}
                width={sessionHistoryWidth}
                theme={theme}
              />
            </box>
          )}
          <box flexDirection="column" width={width - (showSessionHistory ? sessionHistoryWidth : 0)}>
            <StartScreen
              onSubmit={handleSubmit}
              disabled={uiState.status === "running"}
              suppressKeys={showModelSelector || showSkillsPane || showCommitConfirm || showAgentsModal || !!uiState.ephemeralRun || effectiveSessionFocused}
              theme={theme}
              width={width - (showSessionHistory ? sessionHistoryWidth : 0)}
              height={contentHeight}
              agentName={agentDisplay}
              modelName={modelDisplay}
              reasoningEffort={uiState.availableModels.find(m => m.id === uiState.currentModel)?.supportsReasoningEffort ? effectiveReasoningEffort : undefined}
            />
          </box>
        </box>
      )}

      <box
        height={STATUS_BAR_HEIGHT}
        paddingLeft={2}
        paddingRight={2}
        paddingTop={1}
        backgroundColor={c.base}
        flexDirection="row"
        justifyContent="space-between"
      >
        <text>
          {uiState.status === "running" && (
            <span>{spinner}  </span>
          )}
          <span fg={statusColor}>{statusText}</span>
          <span>  </span>
          <span fg={c.info}>{"\uF07B"} {projectName}</span>
          {/* Git status with Nerd Font icons: \uE0A0=, \uF111=, \uF44D=, \uF059=, \uF062=, \uF063=, \uF00C= */}
          {gitInfo.branch && (
            <>
              <span>  </span>
              <span fg={c.link}>{"\uE0A0"} {gitInfo.branch}</span>
              {gitInfo.staged > 0 && <span fg={c.success}> {"\uF111"} {gitInfo.staged}</span>}
              {gitInfo.unstaged > 0 && <span fg={c.warning}> {"\uF44D"} {gitInfo.unstaged}</span>}
              {gitInfo.untracked > 0 && <span fg={c.subtle}> {"\uF059"} {gitInfo.untracked}</span>}
              {gitInfo.ahead > 0 && <span fg={c.success}> {"\uF062"}{gitInfo.ahead}</span>}
              {gitInfo.behind > 0 && <span fg={c.warning}> {"\uF063"}{gitInfo.behind}</span>}
              {!gitInfo.hasChanges && gitInfo.ahead === 0 && gitInfo.behind === 0 && (
                <span fg={c.success}> {"\uF00C"}</span>
              )}
            </>
          )}
        </text>
        <text>
          <span fg={c.subtext0}>Tab</span><span fg={c.text}> agent  </span>
          <span fg={c.subtext0}>esc</span><span fg={c.text}> quit  </span>
          <span fg={c.subtext0}>^N</span><span fg={c.text}> new  </span>
          <span fg={c.subtext0}>S-Tab</span><span fg={c.text}> model  </span>
          {gitInfo.hasChanges && (
            <><span fg={c.subtext0}>^G</span><span fg={c.text}> commit  </span></>
          )}
          <span fg={c.subtext0}>^C</span><span fg={c.text}> cancel</span>
        </text>
      </box>

      {/* Model Selector Modal */}
      {showModelSelector && (
        <ModelSelector
          models={uiState.availableModels}
          currentModelId={uiState.currentModel}
          onSelect={handleSelectModel}
          onClose={handleCloseModelSelector}
          theme={theme}
          width={width}
          height={height - 1}
        />
      )}

      {/* Skills Pane Modal */}
      {showSkillsPane && (
        <SkillsPane
          skills={sidebarState.skills}
          onSelect={handleSelectSkill}
          onClose={handleCloseSkillsPane}
          theme={theme}
          width={width}
          height={height - 1}
        />
      )}

      {/* Agents Modal */}
      {showAgentsModal && (
        <AgentsModal
          agents={uiState.availableAgents}
          currentAgentId={uiState.currentAgentId}
          onSelect={handleSelectAgent}
          onClose={handleCloseAgentsModal}
          theme={theme}
          width={width}
          height={height - 1}
        />
      )}

      {/* Smart Commit Confirm Modal */}
      {showCommitConfirm && (
        <ConfirmModal
          title="Smart Commit & Push"
          message={`This will:\n- Categorize uncommitted changes\n- Create a commit for each category\n- Push all commits to remote\n\nProceed?`}
          confirmLabel="Commit & Push"
          cancelLabel="Cancel"
          onConfirm={handleSmartCommitConfirm}
          onCancel={handleSmartCommitCancel}
          theme={theme}
          width={width}
          height={height - 1}
        />
      )}

      {/* Ephemeral Modal (Smart Commit & Push) */}
      {uiState.ephemeralRun && (
        <EphemeralModal
          ephemeralRun={uiState.ephemeralRun}
          onClose={handleCloseCommandModal}
          theme={theme}
          width={width}
          height={height - 1}
        />
      )}

      {/* Question Modal */}
      {uiState.pendingQuestion && (
        <QuestionModal
          question={uiState.pendingQuestion}
          onAnswer={handleAnswerQuestion}
          theme={theme}
          width={width}
          height={height - 1}
        />
      )}

      <DebugOverlay theme={theme} width={width} height={height - 1} />
    </box>
  );
}
