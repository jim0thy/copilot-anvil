import { Box, Text, useApp, useInput, useStdout } from 'ink'
import Spinner from 'ink-spinner'
import React, { useCallback, useEffect, useState } from 'react'
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
  const [state, setState] = useState<HarnessState>(harness.getState());
  const [hasStarted, setHasStarted] = useState(false);
  const [dimensions, setDimensions] = useState({
    width: stdout?.columns ?? 80,
    height: stdout?.rows ?? 24,
  });

  useEffect(() => {
    const handleResize = () => {
      setDimensions({
        width: stdout?.columns ?? 80,
        height: stdout?.rows ?? 24,
      });
    };

    stdout?.on('resize', handleResize);
    return () => {
      stdout?.off('resize', handleResize);
    };
  }, [stdout]);

  useEffect(() => {
    return harness.subscribe(() => {
      setState({ ...harness.getState() });
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

  useInput((input, key) => {
    if (key.escape) {
      exit();
    }
    if (key.ctrl && input === "c") {
      handleCancel();
    }
    if (key.tab) {
      handleCycleModel();
    }
  });

  const theme = getTheme();

  const statusColor = state.status === "running" ? theme.colors.warning : theme.colors.success;
  const statusText = state.status === "running" ? "Processing" : "Ready";

  const modelDisplay = state.currentModel
    ? state.currentModel.split("/").pop() || state.currentModel
    : "loading...";

  const contentHeight = Math.max(1, dimensions.height - STATUS_BAR_HEIGHT - 1);
  const chatHeight = Math.max(1, contentHeight - INPUT_BAR_HEIGHT);

  return (
    <Box flexDirection="column" width={dimensions.width} height={dimensions.height - 1}>
      {hasStarted ? (
        <Box height={contentHeight} flexDirection="row">
          <Box flexDirection="column" flexGrow={1} borderStyle="round" borderColor={theme.colors.border}>
            <Box height={chatHeight} overflow="hidden">
              <ChatPane
                messages={state.transcript}
                streamingContent={state.streamingContent}
                streamingReasoning={state.streamingReasoning}
                activeTools={state.activeTools}
                height={chatHeight}
                theme={theme}
              />
            </Box>
            <Box borderStyle="single" borderColor={theme.colors.borderActive} borderTop={true} borderBottom={false} borderLeft={false} borderRight={false}>
              <InputBar
                onSubmit={handleSubmit}
                disabled={state.status === "running"}
                theme={theme}
              />
            </Box>
          </Box>
          <Box flexDirection="column" width="40%">
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
          </Box>
        </Box>
      ) : (
        <Box height={contentHeight} flexDirection="column" borderStyle="round" borderColor={theme.colors.border}>
          <StartScreen
            onSubmit={handleSubmit}
            disabled={state.status === "running"}
            theme={theme}
            height={contentHeight}
          />
        </Box>
      )}

      <Box
        height={STATUS_BAR_HEIGHT}
        paddingX={1}
        backgroundColor={theme.colors.statusBarBg}
        justifyContent="space-between"
      >
        <Text>
          {state.status === "running" && (
            <>
              <Spinner type="dots" />
              <Text>  </Text>
            </>
          )}
          <Text color={statusColor}>{statusText}</Text>
          <Text>  </Text>
          <Text color={theme.colors.primary} bold>Copilot Anvil</Text>
          <Text>  </Text>
          <Text color={theme.colors.info}>{modelDisplay}</Text>
        </Text>
        <Text>
          <Text color={theme.colors.muted}>esc</Text><Text> quit  </Text>
          <Text color={theme.colors.muted}>tab</Text><Text> model  </Text>
          <Text color={theme.colors.muted}>^C</Text><Text> cancel</Text>
        </Text>
      </Box>
    </Box>
  );
}
