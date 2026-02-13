import { useKeyboard } from "@opentui/react";
import { memo, useState, useCallback } from "react";
import type { Theme } from "../theme.js";
import type { PendingQuestion } from "../../harness/Harness.js";

interface QuestionModalProps {
  question: PendingQuestion;
  onAnswer: (answer: string, wasFreeform: boolean) => void;
  theme: Theme;
}

export const QuestionModal = memo(function QuestionModal({
  question,
  onAnswer,
  theme,
}: QuestionModalProps) {
  const c = theme.colors;
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

  return (
    <box flexDirection="column" width="100%" flexShrink={0}>
      {/* Question text - expands above input area */}
      {inputMode === "choices" && hasChoices && (
        <box
          flexDirection="column"
          borderStyle="single"
          borderColor={c.borderActive}
          backgroundColor={c.mantle}
          paddingLeft={1}
          paddingRight={1}
          paddingTop={1}
          paddingBottom={1}
        >
          <text>
            <span fg={c.primary}><b>❓ </b></span>
            <span fg={c.info}>{question.question}</span>
          </text>
          <box flexDirection="column" marginTop={1}>
            {choices.map((choice, index) => (
              <box key={index}>
                <text>
                  <span fg={selectedIndex === index ? c.primary : c.subtle}>
                    {selectedIndex === index ? "› " : "  "}
                  </span>
                  <span fg={selectedIndex === index ? c.text : c.subtext0}>
                    {choice}
                  </span>
                </text>
              </box>
            ))}
            {canUseFreeform && (
              <box>
                <text>
                  <span fg={selectedIndex === choices.length ? c.primary : c.subtle}>
                    {selectedIndex === choices.length ? "› " : "  "}
                  </span>
                  <span fg={selectedIndex === choices.length ? c.text : c.subtext0}>
                    <i>Type custom answer...</i>
                  </span>
                </text>
              </box>
            )}
          </box>
          <box marginTop={1}>
            <text>
              <span fg={c.subtle}>↑↓ navigate • Enter select</span>
            </text>
          </box>
        </box>
      )}

      {/* Input area - replaces normal input bar */}
      <box 
        height={3} 
        borderStyle="single" 
        borderColor={inputMode === "freeform" ? c.borderActive : c.border}
      >
        <box paddingLeft={1} paddingRight={1}>
          <text>
            {inputMode === "freeform" ? (
              <>
                <span fg={c.primary}><b>{"❓ "}</b></span>
                <span fg={c.info}>{question.question}</span>
                <span> </span>
                {freeformValue ? (
                  <>
                    <span fg={c.text}>{freeformValue}</span>
                    <span fg={c.cursorText} bg={c.cursor}>{" "}</span>
                  </>
                ) : (
                  <span fg={c.subtle}>Type answer...</span>
                )}
              </>
            ) : (
              <>
                <span fg={c.primary}><b>{"› "}</b></span>
                <span fg={c.subtle}>Use ↑↓ to select answer</span>
              </>
            )}
          </text>
        </box>
      </box>
    </box>
  );
});
