import { useKeyboard } from "@opentui/react";
import { memo, useRef, useEffect } from "react";
import type { EphemeralRun } from "../../harness/Harness.js";
import type { Theme } from "../theme.js";
import { ChatPane } from "./ChatPane.js";

interface EphemeralModalProps {
  ephemeralRun: EphemeralRun;
  onClose: () => void;
  theme: Theme;
  width: number;
  height: number;
}

export const EphemeralModal = memo(function EphemeralModal({
  ephemeralRun,
  onClose,
  theme,
  width,
  height,
}: EphemeralModalProps) {
  const c = theme.colors;
  const isComplete = ephemeralRun.status === "completed" || ephemeralRun.status === "failed";
  const modalRef = useRef<any>(null);

  // Focus modal when mounted to capture keyboard events
  useEffect(() => {
    if (modalRef.current) {
      modalRef.current.focus();
    }
  }, []);

  useKeyboard((key) => {
    // Only allow closing when complete
    if (!isComplete) return;

    if (key.name === "escape" || key.name === "return") {
      onClose();
      return;
    }
  });

  const modalWidth = Math.min(100, width - 4);
  const modalHeight = Math.min(40, height - 4);
  const modalX = Math.floor((width - modalWidth) / 2);
  const modalY = Math.floor((height - modalHeight) / 2);

  // Calculate content height for ChatPane (subtract header + footer)
  const chatPaneHeight = modalHeight - 6;

  return (
    <box
      ref={modalRef}
      position="absolute"
      left={modalX}
      top={modalY}
      width={modalWidth}
      height={modalHeight}
      borderStyle="double"
      borderColor={ephemeralRun.status === "running" ? c.info : c.success}
      backgroundColor={c.mantle}
      flexDirection="column"
      focusable={true}
    >
      {/* Header */}
      <box
        paddingLeft={1}
        paddingRight={1}
        paddingTop={1}
        marginBottom={1}
      >
        <text>
          <span fg={c.info}>
            <b>{ephemeralRun.displayText}</b>
          </span>
          {ephemeralRun.status === "running" && (
            <span fg={c.warning}> (Running...)</span>
          )}
          {ephemeralRun.status === "completed" && (
            <span fg={c.success}> (Complete)</span>
          )}
          {ephemeralRun.status === "failed" && (
            <span fg={c.error}> (Failed)</span>
          )}
        </text>
      </box>

      {/* Content - Use ChatPane */}
      <box height={chatPaneHeight}>
        <ChatPane
          transcript={ephemeralRun.transcript}
          streamingContentChunks={[ephemeralRun.streamingContent]}
          streamingReasoningChunks={[]}
          streamingAgentName={null}
          isStreaming={ephemeralRun.status === "running"}
          height={chatPaneHeight}
          theme={theme}
        />
      </box>

      {/* Footer */}
      <box
        paddingLeft={1}
        paddingRight={1}
        paddingBottom={1}
        marginTop={1}
      >
        <text>
          <span fg={c.subtle}>
            {isComplete
              ? "Press Enter or Esc to close"
              : "Command is running..."}
          </span>
        </text>
      </box>
    </box>
  );
});
