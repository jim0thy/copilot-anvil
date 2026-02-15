import { useKeyboard } from "@opentui/react";
import { memo, useState, useCallback, useRef, useEffect } from "react";
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
  const c = theme.colors;
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [freeformValue, setFreeformValue] = useState("");
  const [inputMode, setInputMode] = useState<"choices" | "freeform">(
    question.choices?.length ? "choices" : "freeform"
  );

  const choices = question.choices ?? [];
  const hasChoices = choices.length > 0;
  const canUseFreeform = question.allowFreeform;
  const modalRef = useRef<any>(null);
  const [scrollOffset, setScrollOffset] = useState(0);

  // Total selectable items (choices + freeform option if available)
  const totalItems = hasChoices ? (canUseFreeform ? choices.length + 1 : choices.length) : 0;

  // Focus modal when mounted to capture keyboard events
  useEffect(() => {
    if (modalRef.current) {
      modalRef.current.focus();
    }
  }, []);

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

  // Calculate modal dimensions
  const modalWidth = Math.min(70, width - 4);
  const bottomOffset = 4; // Space for status bar and input bar
  const maxAvailableHeight = height - bottomOffset;
  // Height: question (2 lines) + choices + freeform option + footer + padding/borders
  const maxListHeight = Math.max(4, maxAvailableHeight - 8);
  const listHeight = Math.min(totalItems, maxListHeight);
  // Ensure modal doesn't exceed available space and expands upward
  const desiredHeight = listHeight + 8;
  const modalHeight = Math.min(desiredHeight, maxAvailableHeight);
  const modalX = Math.floor((width - modalWidth) / 2);
  // Anchor bottom edge just above input bar, expand upward
  const modalY = Math.max(0, height - bottomOffset - modalHeight);

  // Calculate scroll offset to keep selected item visible
  const maxScrollOffset = Math.max(0, totalItems - listHeight);
  useEffect(() => {
    // Auto-scroll to keep selection visible
    if (selectedIndex < scrollOffset) {
      setScrollOffset(selectedIndex);
    } else if (selectedIndex >= scrollOffset + listHeight) {
      setScrollOffset(selectedIndex - listHeight + 1);
    }
  }, [selectedIndex, listHeight, scrollOffset]);

  const visibleStartIndex = scrollOffset;
  const visibleEndIndex = Math.min(scrollOffset + listHeight, totalItems);

  return (
    <box
      ref={modalRef}
      position="absolute"
      left={modalX}
      top={modalY}
      width={modalWidth}
      height={modalHeight}
      borderStyle="double"
      borderColor={c.primary}
      backgroundColor={c.mantle}
      flexDirection="column"
      padding={1}
      focusable={true}
    >
      {/* Question header */}
      <box marginBottom={1}>
        <text>
          <span fg={c.primary}><b>❓ Question</b></span>
        </text>
      </box>

      {/* Question text */}
      <box marginBottom={1}>
        <text>
          <span fg={c.info}>{question.question}</span>
        </text>
      </box>

      {inputMode === "choices" && hasChoices && (
        <>
          {/* Choices list - scrollable */}
          <box flexDirection="column" height={listHeight} overflow="hidden">
            {Array.from({ length: Math.min(choices.length - visibleStartIndex, visibleEndIndex - visibleStartIndex) }, (_, visibleIndex) => {
              const index = visibleStartIndex + visibleIndex;
              const choice = choices[index];
              const isSelected = selectedIndex === index;
              return (
                <box key={index}>
                  <text>
                    <span fg={isSelected ? c.primary : c.subtle}>
                      {isSelected ? "› " : "  "}
                    </span>
                    <span fg={isSelected ? c.text : c.subtext0}>
                      {choice}
                    </span>
                  </text>
                </box>
              );
            })}
            {/* Show freeform option if visible in current scroll range */}
            {canUseFreeform && visibleEndIndex > choices.length && (
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

          {/* Scroll indicator */}
          {maxScrollOffset > 0 && (
            <box marginTop={1}>
              <text>
                <span fg={c.subtle}>
                  {scrollOffset > 0 ? "↑ " : "  "}
                  {scrollOffset + listHeight}/{totalItems}
                  {scrollOffset < maxScrollOffset ? " ↓" : "  "}
                </span>
              </text>
            </box>
          )}

          {/* Footer with hints */}
          <box marginTop={1}>
            <text>
              <span fg={c.subtle}>↑↓ navigate • Enter select</span>
            </text>
          </box>
        </>
      )}

      {inputMode === "freeform" && (
        <>
          {/* Freeform input */}
          <box 
            height={3} 
            borderStyle="single" 
            borderColor={c.borderActive}
            paddingLeft={1}
            paddingRight={1}
          >
            <text>
              {freeformValue ? (
                <>
                  <span fg={c.text}>{freeformValue}</span>
                  <span fg={c.cursorText} bg={c.cursor}>{" "}</span>
                </>
              ) : (
                <span fg={c.subtle}>Type your answer...</span>
              )}
            </text>
          </box>

          {/* Footer with hints */}
          <box marginTop={1}>
            <text>
              <span fg={c.subtle}>
                Enter submit
                {hasChoices && " • Esc back to choices"}
              </span>
            </text>
          </box>
        </>
      )}
    </box>
  );
});
