import { useKeyboard } from "@opentui/react";
import { memo, useState, useCallback } from "react";
import type { Theme } from "../theme.js";
import type { PendingQuestion } from "../../harness/Harness.js";

interface QuestionModalProps {
  question: PendingQuestion;
  onAnswer: (answer: string, wasFreeform: boolean) => void;
  theme: Theme;
  width: number;
  height: number;
}

export const QuestionModal = memo(function QuestionModal({
  question,
  onAnswer,
  theme,
  width,
  height,
}: QuestionModalProps) {
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [freeformValue, setFreeformValue] = useState("");
  const [inputMode, setInputMode] = useState<"choices" | "freeform">(
    question.choices?.length ? "choices" : "freeform"
  );

  const choices = question.choices ?? [];
  const hasChoices = choices.length > 0;
  const canUseFreeform = question.allowFreeform;

  useKeyboard((key) => {
    // Navigation between choices
    if (inputMode === "choices" && hasChoices) {
      if (key.name === "up") {
        setSelectedIndex((i) => Math.max(0, i - 1));
        return;
      }
      if (key.name === "down") {
        const maxIndex = canUseFreeform ? choices.length : choices.length - 1;
        setSelectedIndex((i) => Math.min(maxIndex, i + 1));
        return;
      }
      if (key.name === "return") {
        if (selectedIndex < choices.length) {
          // Selected a choice
          onAnswer(choices[selectedIndex], false);
        } else if (canUseFreeform) {
          // Selected "Type custom answer..."
          setInputMode("freeform");
        }
        return;
      }
    }

    // Freeform input mode
    if (inputMode === "freeform") {
      if (key.name === "return") {
        if (freeformValue.trim()) {
          onAnswer(freeformValue.trim(), true);
        }
        return;
      }
      if (key.name === "backspace") {
        setFreeformValue((v) => v.slice(0, -1));
        return;
      }
      if (key.name === "escape" && hasChoices) {
        // Go back to choices if available
        setInputMode("choices");
        setFreeformValue("");
        return;
      }
      // Printable character
      if (key.sequence && key.sequence.length === 1 && !key.ctrl && !key.meta) {
        setFreeformValue((v) => v + key.sequence);
        return;
      }
    }
  });

  const modalWidth = Math.min(60, width - 4);
  const modalHeight = Math.min(hasChoices ? choices.length + 10 : 8, height - 4);
  const modalX = Math.floor((width - modalWidth) / 2);
  const modalY = Math.floor((height - modalHeight) / 2);

  return (
    <box
      position="absolute"
      left={0}
      top={0}
      width={width}
      height={height}
      backgroundColor="rgba(0,0,0,0.7)"
    >
      <box
        position="absolute"
        left={modalX}
        top={modalY}
        width={modalWidth}
        height={modalHeight}
        borderStyle="double"
        borderColor={theme.colors.primary}
        backgroundColor={theme.colors.statusBarBg}
        flexDirection="column"
        padding={1}
      >
        {/* Header */}
        <box marginBottom={1}>
          <text>
            <span fg={theme.colors.primary}><b>❓ Agent Question</b></span>
          </text>
        </box>

        {/* Question text */}
        <box marginBottom={1}>
          <text>
            <span fg={theme.colors.info}>{question.question}</span>
          </text>
        </box>

        {/* Choices or Freeform input */}
        {inputMode === "choices" && hasChoices ? (
          <box flexDirection="column">
            {choices.map((choice, index) => (
              <box key={index}>
                <text>
                  <span fg={selectedIndex === index ? theme.colors.primary : theme.colors.muted}>
                    {selectedIndex === index ? "› " : "  "}
                  </span>
                  <span fg={selectedIndex === index ? theme.colors.info : theme.colors.muted}>
                    {choice}
                  </span>
                </text>
              </box>
            ))}
            {canUseFreeform && (
              <box marginTop={1}>
                <text>
                  <span fg={selectedIndex === choices.length ? theme.colors.primary : theme.colors.muted}>
                    {selectedIndex === choices.length ? "› " : "  "}
                  </span>
                  <span fg={selectedIndex === choices.length ? theme.colors.info : theme.colors.muted}>
                    <i>Type custom answer...</i>
                  </span>
                </text>
              </box>
            )}
          </box>
        ) : (
          <box flexDirection="column">
            <box
              borderStyle="single"
              borderColor={theme.colors.border}
              paddingLeft={1}
              paddingRight={1}
            >
              <text>
                {freeformValue ? (
                  <>
                    <span>{freeformValue}</span>
                    <span fg="#000" bg={theme.colors.primary}>{" "}</span>
                  </>
                ) : (
                  <span fg={theme.colors.muted}>Type your answer...</span>
                )}
              </text>
            </box>
            {hasChoices && (
              <box marginTop={1}>
                <text>
                  <span fg={theme.colors.muted}>Press ESC to go back to choices</span>
                </text>
              </box>
            )}
          </box>
        )}

        {/* Footer with hints */}
        <box marginTop={1}>
          <text>
            <span fg={theme.colors.muted}>
              {inputMode === "choices"
                ? "↑↓ navigate • Enter select"
                : "Enter submit"}
            </span>
          </text>
        </box>
      </box>
    </box>
  );
});
