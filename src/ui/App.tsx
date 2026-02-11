import { useKeyboard, useTerminalDimensions } from '@opentui/react'
import type { CliRenderer } from '@opentui/core'
import { useCallback, useEffect, useState } from 'react'
import type { Harness, HarnessState } from '../harness/Harness.js'
import { ChatPane } from './panes/ChatPane.js'
import { ContextPane } from './panes/ContextPane.js'
import { InputBar } from './panes/InputBar.js'
import { StartScreen } from './panes/StartScreen.js'
import { TasksPane } from './panes/TasksPane.js'
import { getTheme } from './theme.js'

interface AppProps {
  harness: Harness;
}

const STATUS_BAR_HEIGHT = 1;
const INPUT_BAR_HEIGHT = 2;

export function App({ harness }: AppProps) {
  const { exit } = useApp();
  const { stdout } = useStdout();
export function App({ harness, renderer }: AppProps) {
  const { width, height } = useTerminalDimensions();
  const [state, setState] = useState<HarnessState>(harness.getState());
  const [hasStarted, setHasStarted] = useState(false);

  useEffect(() => {
    return harness.subscribe(() => {
      setState(harness.getState());
    });
  }, [harness]);

  const handleSubmit = useCallback(
    (text: string) => {
      if (!hasStarted) {
        setHasStarted(true);
      }
      harness.dispatch({ type: "submit.prompt", text });
    },
    [harness, hasStarted]
  );

  const handleCancel = useCallback(() => {
    if (state.status === "running") {
      harness.dispatch({ type: "cancel" });
    } else {
      exit();
    }
  }, [harness, state.status, exit]);

  const handleCycleModel = useCallback(() => {
    if (state.status === "running") return;
    if (state.availableModels.length === 0) return;

    const currentIndex = state.availableModels.findIndex(
      (m) => m.id === state.currentModel
    );
    const nextIndex = (currentIndex + 1) % state.availableModels.length;
    const nextModel = state.availableModels[nextIndex];

    harness.dispatch({ type: "change.model", modelId: nextModel.id });
  }, [harness, state.status, state.currentModel, state.availableModels]);

  useKeyboard((key) => {
    if (key.name === "escape") {
      renderer.destroy();
      process.exit(0);
    }
    if (key.ctrl && key.name === "c") {
      handleCancel();
    }
    if (key.name === "tab") {
      handleCycleModel();
    }
  });

  const theme = getTheme();

  const statusColor = state.status === "running" ? theme.colors.warning : theme.colors.success;
  const statusText = state.status === "running" ? "Processing" : "Ready";

  const modelDisplay = state.currentModel
    ? state.currentModel.split("/").pop() || state.currentModel
    : "loading...";

  const contentHeight = Math.max(1, height - STATUS_BAR_HEIGHT - 1);
  // Account for rounded border (2 rows: top + bottom)
  const innerHeight = Math.max(1, contentHeight - 2);
  const chatHeight = Math.max(1, innerHeight - INPUT_BAR_HEIGHT);

  return (
    <box flexDirection="column" width={width} height={height - 1}>
      {hasStarted ? (
        <box height={contentHeight} flexDirection="row">
          <box flexDirection="column" flexGrow={1} borderStyle="rounded" borderColor={theme.colors.border}>
            <box height={chatHeight} overflow="hidden">
              <ChatPane
                messages={state.transcript}
                streamingContent={state.streamingContent}
                streamingReasoning={state.streamingReasoning}
                activeTools={state.activeTools}
                height={chatHeight}
                theme={theme}
              />
            </box>
            <box borderStyle="single" borderColor={theme.colors.borderActive} border={["top"]} flexShrink={0} height={2}>
              <InputBar
                onSubmit={handleSubmit}
                disabled={state.status === "running"}
                theme={theme}
              />
            </box>
          </box>
          <box flexDirection="column" width="40%">
            <ContextPane 
              contextInfo={state.contextInfo} 
              width="100%" 
              theme={theme} 
            />
            <TasksPane 
              tasks={state.tasks} 
              height={contentHeight - 10} 
              theme={theme} 
            />
          </box>
        </box>
      ) : (
        <box height={contentHeight} flexDirection="column" borderStyle="rounded" borderColor={theme.colors.border}>
          <StartScreen
            onSubmit={handleSubmit}
            disabled={state.status === "running"}
            theme={theme}
            height={innerHeight}
          />
        </box>
      )}

      <box
        height={STATUS_BAR_HEIGHT}
        paddingLeft={1}
        paddingRight={1}
        backgroundColor={theme.colors.statusBarBg}
      >
        <text>
          {state.status === "running" && (
            <span>{spinner}  </span>
          )}
          <span fg={statusColor}>{statusText}</span>
          <span>  </span>
          <span fg={theme.colors.primary}><b>Copilot Anvil</b></span>
          <span>  </span>
          <span fg={theme.colors.info}>{modelDisplay}</span>
          <span>{"  ·  "}</span>
          <span fg={theme.colors.muted}>esc</span><span> quit  </span>
          <span fg={theme.colors.muted}>tab</span><span> model  </span>
          <span fg={theme.colors.muted}>^C</span><span> cancel</span>
        </text>
      </box>
    </box>
  );
}
