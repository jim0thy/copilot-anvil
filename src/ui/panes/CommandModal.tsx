import { useKeyboard } from "@opentui/react";
import { memo } from "react";
import type { EphemeralRun } from "../../harness/Harness.js";
import type { ChatMessage, TranscriptItem } from "../../harness/events.js";
import type { Theme } from "../theme.js";
import { formatRole, getRoleColor } from "../formatters.js";

interface CommandModalProps {
  ephemeralRun: EphemeralRun;
  onClose: () => void;
  theme: Theme;
  width: number;
  height: number;
}

export const CommandModal = memo(function CommandModal({
  ephemeralRun,
  onClose,
  theme,
  width,
  height,
}: CommandModalProps) {
  const c = theme.colors;
  const isComplete = ephemeralRun.status === "completed" || ephemeralRun.status === "failed";

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

  // Render transcript (messages only, no tool calls or reasoning)
  const messages = ephemeralRun.transcript.filter(
    (item): item is ChatMessage => item.kind === "message"
  );

  // Calculate content height for scrolling
  const contentHeight = modalHeight - 6; // Account for header, footer, padding

  return (
    <box
      position="absolute"
      left={modalX}
      top={modalY}
      width={modalWidth}
      height={modalHeight}
      borderStyle="double"
      borderColor={ephemeralRun.status === "running" ? c.info : c.success}
      backgroundColor={c.mantle}
      flexDirection="column"
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

      {/* Content */}
      <box
        flexDirection="column"
        paddingLeft={1}
        paddingRight={1}
        height={contentHeight}
      >
        {messages.map((message, index) => {
          const roleColor = getRoleColor(message.role, theme);
          const roleLabel = formatRole(message.role);
          const lines = message.content.split("\n");

          return (
            <box key={message.id} flexDirection="column" marginBottom={1}>
              <text>
                <span fg={roleColor}>
                  <b>{roleLabel}:</b>
                </span>
              </text>
              {lines.map((line, lineIndex) => (
                <text key={lineIndex}>
                  <span fg={c.text}>{line}</span>
                </text>
              ))}
            </box>
          );
        })}

        {/* Show streaming content */}
        {ephemeralRun.streamingContent && (
          <box flexDirection="column" marginBottom={1}>
            <text>
              <span fg={c.secondary}>
                <b>Assistant:</b>
              </span>
            </text>
            {ephemeralRun.streamingContent.split("\n").map((line, index) => (
              <text key={index}>
                <span fg={c.text}>{line}</span>
              </text>
            ))}
          </box>
        )}

        {/* Show cursor when running */}
        {ephemeralRun.status === "running" && !ephemeralRun.streamingContent && (
          <text>
            <span fg={c.warning}>▊</span>
          </text>
        )}
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
