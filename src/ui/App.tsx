import { useKeyboard, useTerminalDimensions } from '@opentui/react'
import type { CliRenderer } from '@opentui/core'
import { useCallback, useEffect, useRef, useState } from 'react'
import type { Harness, HarnessState } from '../harness/Harness.js'
import { ChatPane } from './panes/ChatPane.js'
import { InputBar } from './panes/InputBar.js'
import { StartScreen } from './panes/StartScreen.js'
import { QuestionModal } from './panes/QuestionModal.js'
import { ModelSelector } from './panes/ModelSelector.js'
import { SessionSwitcher } from './panes/SessionSwitcher.js'
import { SkillsPane } from './panes/SkillsPane.js'
import { ConfirmModal } from './panes/ConfirmModal.js'
import { CommandModal } from './panes/CommandModal.js'
import { Sidebar } from './panes/Sidebar.js'
import { DebugOverlay } from './panes/DebugOverlay.js'
import { getTheme } from './theme.js'
import { getGitInfo, getGitInfoAsync, type GitInfo } from '../utils/git.js'
import { getModifiedFiles, getModifiedFilesAsync, type FileChange } from '../utils/gitDiff.js'

interface AppProps {
  harness: Harness;
  renderer: CliRenderer;
}

const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
const STATUS_BAR_HEIGHT = 2;
const MIN_INPUT_BAR_HEIGHT = 3;

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
  const [state, setState] = useState<HarnessState>(harness.getState());
  const [hasStarted, setHasStarted] = useState(false);
  const [gitInfo, setGitInfo] = useState<GitInfo>(getGitInfo());
  const [modifiedFiles, setModifiedFiles] = useState<FileChange[]>(getModifiedFiles());
  const [showModelSelector, setShowModelSelector] = useState(false);
  const [showSessionSwitcher, setShowSessionSwitcher] = useState(false);
  const [showSkillsPane, setShowSkillsPane] = useState(false);
  const [showCommitConfirm, setShowCommitConfirm] = useState(false);
  const [inputBarHeight, setInputBarHeight] = useState(MIN_INPUT_BAR_HEIGHT);
  const spinner = useSpinner(state.status === "running");

  // Coalesce rapid events into a single setState per microtask
  const rafRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    return harness.subscribe(() => {
      if (rafRef.current === null) {
        rafRef.current = setTimeout(() => {
          rafRef.current = null;
          setState(harness.getState());
        }, 0);
      }
    });
  }, [harness]);

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
    if (state.status === "running") {
      harness.dispatch({ type: "cancel" });
    } else {
      renderer.destroy();
      process.exit(0);
    }
  }, [harness, state.status, renderer]);

  const handleSelectModel = useCallback((modelId: string) => {
    harness.dispatch({ type: "change.model", modelId });
    setShowModelSelector(false);
  }, [harness]);

  const handleCloseModelSelector = useCallback(() => {
    setShowModelSelector(false);
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

  const handleCloseSessionSwitcher = useCallback(() => {
    setShowSessionSwitcher(false);
  }, []);

  const handleInputHeightChange = useCallback((height: number) => {
    setInputBarHeight(height);
  }, []);

  const handleAnswerQuestion = useCallback(
    (answer: string, wasFreeform: boolean) => {
      if (state.pendingQuestion) {
        harness.dispatch({
          type: "answer.question",
          requestId: state.pendingQuestion.requestId,
          answer,
          wasFreeform,
        });
      }
    },
    [harness, state.pendingQuestion]
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

  useKeyboard((key) => {
    if (state.pendingQuestion || showModelSelector || showSkillsPane || showSessionSwitcher || showCommitConfirm || state.ephemeralRun) return;

    if (key.name === "escape") {
      renderer.destroy();
      process.exit(0);
    }
    if (key.ctrl && key.name === "c") {
      handleCancel();
    }
    if (key.shift && key.name === "tab") {
      if (state.status !== "running" && state.availableModels.length > 0) {
        setShowModelSelector(true);
      }
    }
    if (key.ctrl && key.name === "s") {
      setShowSkillsPane(true);
    }
    if (key.ctrl && key.name === "n") {
      if (state.status !== "running") {
        handleNewSession();
      }
    }
    if (key.ctrl && key.name === "o") {
      if (state.status !== "running") {
        // Refresh sessions when opening switcher
        harness.dispatch({ type: "session.refresh" }).then(() => {
          setShowSessionSwitcher(true);
        });
      }
    }
    if (key.ctrl && key.name === "g") {
      if (state.status !== "running" && gitInfo.hasChanges) {
        setShowCommitConfirm(true);
      }
    }
  });

  const theme = getTheme();
  const c = theme.colors; // Shorthand for cleaner code

  const statusColor = state.status === "running" ? c.warning : c.success;
  const statusText = state.status === "running" ? "Processing" : "Ready";

  const modelDisplay = state.currentModel
    ? state.currentModel.split("/").pop() || state.currentModel
    : "loading...";

  const contentHeight = Math.max(1, height - STATUS_BAR_HEIGHT - 1);

  return (
    <box flexDirection="column" width={width} height={height - 1}>
      {hasStarted ? (
        <box height={contentHeight} flexDirection="row">
          <box flexDirection="column" width="82.5%">
            <ChatPane
              transcript={state.transcript}
              streamingContent={state.streamingContent}
              streamingReasoning={state.streamingReasoning}
              isStreaming={state.status === "running"}
              height={contentHeight - inputBarHeight}
              theme={theme}
            />
            {state.pendingQuestion ? (
              <QuestionModal
                question={state.pendingQuestion}
                onAnswer={handleAnswerQuestion}
                theme={theme}
              />
            ) : (
              <InputBar
                onSubmit={handleSubmit}
                disabled={state.status === "running"}
                suppressKeys={showModelSelector || showSkillsPane || showSessionSwitcher || showCommitConfirm || !!state.ephemeralRun}
                queuedCount={state.messageQueue.length}
                theme={theme}
                onHeightChange={handleInputHeightChange}
              />
            )}
          </box>
          <box flexDirection="column" width="17.5%">
            <Sidebar
              contextInfo={state.contextInfo}
              files={modifiedFiles}
              currentIntent={state.currentIntent}
              currentTodo={state.currentTodo}
              currentPlan={state.currentPlan}
              subagents={state.subagents}
              skills={state.skills}
              height={contentHeight}
              width={Math.floor(width * 0.175)}
              theme={theme}
            />
          </box>
        </box>
      ) : (
        <box height={contentHeight} flexDirection="column">
          <StartScreen
            onSubmit={handleSubmit}
            disabled={state.status === "running"}
            suppressKeys={showModelSelector || showSkillsPane || showSessionSwitcher || showCommitConfirm || !!state.ephemeralRun}
            theme={theme}
            height={contentHeight}
          />
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
          {state.status === "running" && (
            <span>{spinner}  </span>
          )}
          <span fg={statusColor}>{statusText}</span>
          <span>  </span>
          <span fg={c.link}>{modelDisplay}</span>
          {gitInfo.branch && (
            <>
              <span>  </span>
              <span fg={c.link}> {gitInfo.branch}</span>
              {gitInfo.staged > 0 && <span fg={c.success}> ● {gitInfo.staged}</span>}
              {gitInfo.unstaged > 0 && <span fg={c.warning}> ✚ {gitInfo.unstaged}</span>}
              {gitInfo.untracked > 0 && <span fg={c.subtle}> ? {gitInfo.untracked}</span>}
              {gitInfo.ahead > 0 && <span fg={c.success}> ⇡{gitInfo.ahead}</span>}
              {gitInfo.behind > 0 && <span fg={c.warning}> ⇣{gitInfo.behind}</span>}
              {!gitInfo.hasChanges && gitInfo.ahead === 0 && gitInfo.behind === 0 && (
                <span fg={c.success}> ✓</span>
              )}
            </>
          )}
        </text>
        <text>
          <span fg={c.subtext0}>esc</span><span fg={c.text}> quit  </span>
          <span fg={c.subtext0}>^N</span><span fg={c.text}> new  </span>
          <span fg={c.subtext0}>^O</span><span fg={c.text}> sessions  </span>
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
          models={state.availableModels}
          currentModelId={state.currentModel}
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
          skills={state.skills}
          onSelect={handleSelectSkill}
          onClose={handleCloseSkillsPane}
          theme={theme}
          width={width}
          height={height - 1}
        />
      )}

      {/* Session Switcher Modal */}
      {showSessionSwitcher && (
        <SessionSwitcher
          sessions={state.availableSessions}
          currentSessionId={state.currentSessionId}
          onSelect={handleSelectSession}
          onNewSession={handleNewSession}
          onClose={handleCloseSessionSwitcher}
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

      {/* Command Modal (Ephemeral Run) */}
      {state.ephemeralRun && (
        <CommandModal
          ephemeralRun={state.ephemeralRun}
          onClose={handleCloseCommandModal}
          theme={theme}
          width={width}
          height={height - 1}
        />
      )}

      <DebugOverlay theme={theme} width={width} height={height - 1} />
    </box>
  );
}
