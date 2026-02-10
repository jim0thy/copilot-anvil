import { Box, Text, useApp, useInput, useStdout } from 'ink'
import React, { useCallback, useEffect, useState } from 'react'
import type { Harness, HarnessState } from '../harness/Harness.js'
import { ChatPane } from './panes/ChatPane.js'
import { InputBar } from './panes/InputBar.js'
import { LogsPane } from './panes/LogsPane.js'

interface AppProps {
  harness: Harness;
}

const STATUS_BAR_HEIGHT = 3;
const INPUT_BAR_HEIGHT = 3;

export function App({ harness }: AppProps) {
  const { exit } = useApp();
  const { stdout } = useStdout();
  const [state, setState] = useState<HarnessState>(harness.getState());
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
      harness.dispatch({ type: "submit.prompt", text });
    },
    [harness]
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

  const statusColor = state.status === "running" ? "yellow" : "green";
  const statusText = state.status.toUpperCase();

  const modelDisplay = state.currentModel
    ? state.currentModel.split("/").pop() || state.currentModel
    : "loading...";

  const contentHeight = Math.max(1, dimensions.height - STATUS_BAR_HEIGHT);
  const chatHeight = Math.max(1, contentHeight - INPUT_BAR_HEIGHT);

  return (
    <Box flexDirection="column" width={dimensions.width} height={dimensions.height}>
      <Box
        height={STATUS_BAR_HEIGHT}
        borderStyle="single"
        borderColor="gray"
        paddingX={1}
        justifyContent="space-between"
      >
        <Text>
          <Text bold>Copilot Anvil</Text>
          <Text color="gray"> | </Text>
          <Text color={statusColor}>{statusText}</Text>
          <Text color="gray"> | </Text>
          <Text color="cyan">{modelDisplay}</Text>
        </Text>
        <Text color="gray">Tab: model | Esc: quit | Ctrl+C: cancel</Text>
      </Box>

      <Box height={contentHeight} flexDirection="row">
        <Box flexDirection="column" flexGrow={1} borderStyle="single" borderColor="gray">
          <Box height={chatHeight} overflow="hidden">
            <ChatPane
              messages={state.transcript}
              streamingContent={state.streamingContent}
              streamingReasoning={state.streamingReasoning}
              height={chatHeight}
            />
          </Box>
          <Box borderStyle="single" borderColor="cyan" borderTop={true} borderBottom={false} borderLeft={false} borderRight={false}>
            <InputBar onSubmit={handleSubmit} disabled={state.status === "running"} />
          </Box>
        </Box>
        <LogsPane logs={state.logs} height={contentHeight} />
      </Box>
    </Box>
  );
}
