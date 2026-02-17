import { useKeyboard, useTerminalDimensions, useRenderer } from "@opentui/react";
import { memo, useState, useEffect, useRef } from "react";
import { existsSync } from "node:fs";
import type { Theme } from "../theme.js";
import type { PasteEvent } from "@opentui/core";
import { nf } from "../icons.js";

const IMAGE_EXTENSIONS = new Set([
  ".png", ".jpg", ".jpeg", ".gif", ".bmp", ".webp", ".svg", ".ico", ".tiff", ".tif",
]);

function isImageFilePath(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed.startsWith("/") && !trimmed.startsWith("./") && !trimmed.startsWith("~/") && !trimmed.startsWith("..")) {
    return false;
  }
  // Unescape backslash-escaped spaces and other characters (common when dragging files)
  const unescaped = trimmed.replace(/\\(.)/g, "$1");
  const ext = unescaped.slice(unescaped.lastIndexOf(".")).toLowerCase();
  if (!IMAGE_EXTENSIONS.has(ext)) return false;
  const resolved = unescaped.startsWith("~") ? unescaped.replace("~", process.env.HOME || "") : unescaped;
  return existsSync(resolved);
}

// Blinking cursor interval in ms
const CURSOR_BLINK_INTERVAL = 530;

export interface SubmitData {
  text: string;
  images?: string[]; // File paths to attached images
}

interface InputBarProps {
  onSubmit: (data: SubmitData) => void;
  disabled?: boolean;
  suppressKeys?: boolean;
  queuedCount?: number;
  theme: Theme;
  onHeightChange?: (height: number) => void;
  agentName?: string;
  modelName?: string;
  reasoningEffort?: "low" | "medium" | "high" | "xhigh";
}

// Custom keyboard-driven input (OpenTUI's <input> doesn't work in child components)
export const InputBar = memo(function InputBar({ onSubmit, disabled = false, suppressKeys = false, queuedCount = 0, theme, onHeightChange, agentName, modelName, reasoningEffort }: InputBarProps) {
  const c = theme.colors;
  const [value, setValue] = useState("");
  const [cursorPos, setCursorPos] = useState(0);
  // Key changes when input is cleared to force height recalculation
  const [resetKey, setResetKey] = useState(0);
  const { width } = useTerminalDimensions();
  const renderer = useRenderer();

  // Track pasted content separately
  const [pastedContent, setPastedContent] = useState("");
  const [pastedLineCount, setPastedLineCount] = useState(0);

  // Track attached images
  const [attachedImages, setAttachedImages] = useState<string[]>([]);
  // Track which attachment is selected for removal (null = none selected)
  const [selectedAttachment, setSelectedAttachment] = useState<number | null>(null);

  // Use refs for values accessed in keyboard/paste callbacks to avoid stale closures
  const cursorPosRef = useRef(cursorPos);
  cursorPosRef.current = cursorPos;
  const valueRef = useRef(value);
  valueRef.current = value;
  const attachedImagesRef = useRef(attachedImages);
  attachedImagesRef.current = attachedImages;
  const pastedContentRef = useRef(pastedContent);
  pastedContentRef.current = pastedContent;
  const selectedAttachmentRef = useRef(selectedAttachment);
  selectedAttachmentRef.current = selectedAttachment;

  const [cursorVisible, setCursorVisible] = useState(true);
  const blinkIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (!disabled) {
      blinkIntervalRef.current = setInterval(() => {
        setCursorVisible((v) => !v);
      }, CURSOR_BLINK_INTERVAL);
    } else {
      setCursorVisible(false);
    }

    return () => {
      if (blinkIntervalRef.current) {
        clearInterval(blinkIntervalRef.current);
      }
    };
  }, [disabled]);

  // Reset cursor visibility on any input change
  useEffect(() => {
    setCursorVisible(true);
  }, [value, cursorPos]);

  const handleSubmit = () => {
    let textToSubmit = valueRef.current;

    // Parse /attach commands and remove them from the text
    const attachRegex = /\/attach\s+([^\s]+)/g;
    const matches = [...textToSubmit.matchAll(attachRegex)];
    const newImages: string[] = [];

    for (const match of matches) {
      const imagePath = match[1];
      if (imagePath && !attachedImagesRef.current.includes(imagePath)) {
        newImages.push(imagePath);
      }
      // Remove the /attach command from the text
      textToSubmit = textToSubmit.replace(match[0], '').trim();
    }

    const allImages = [...attachedImagesRef.current, ...newImages];
    const currentPasted = pastedContentRef.current;
    const fullText = currentPasted ? currentPasted + "\n" + textToSubmit : textToSubmit;

    if (fullText.trim() || allImages.length > 0) {
      onSubmit({
        text: fullText.trim(),
        images: allImages.length > 0 ? allImages : undefined,
      });
      setValue("");
      setCursorPos(0);
      setPastedContent("");
      setPastedLineCount(0);
      setAttachedImages([]);
      setSelectedAttachment(null);
      setResetKey((k) => k + 1);
      // Reset height to minimum when message is sent
      if (onHeightChange) {
        onHeightChange(3);
      }
    }
  };

  // Handle paste events
  useEffect(() => {
    const handlePaste = (event: PasteEvent) => {
      if (suppressKeys || disabled) return;

      const text = event.text;
      const lines = text.split("\n");

      // If multiline, store separately
      if (lines.length > 1) {
        setPastedContent(text);
        setPastedLineCount(lines.length);
      } else {
        const attachMatch = text.match(/^\/attach\s+(.+)$/);
        if (attachMatch) {
          const imagePath = attachMatch[1].trim();
          if (!attachedImagesRef.current.includes(imagePath)) {
            setAttachedImages((prev) => [...prev, imagePath]);
            setSelectedAttachment(null); // Clear selection when adding new attachment
          }
        } else if (isImageFilePath(text)) {
          // Unescape backslash-escaped characters (common when dragging files)
          const unescaped = text.trim().replace(/\\(.)/g, "$1");
          const resolved = unescaped.startsWith("~")
            ? unescaped.replace("~", process.env.HOME || "")
            : unescaped;
          if (!attachedImagesRef.current.includes(resolved)) {
            setAttachedImages((prev) => [...prev, resolved]);
            setSelectedAttachment(null); // Clear selection when adding new attachment
          }
        } else {
          const pos = cursorPosRef.current;
          setValue((v) => {
            const newValue = v.slice(0, pos) + text + v.slice(pos);
            setCursorPos(pos + text.length);
            return newValue;
          });
        }
      }
    };

    renderer.keyInput.on("paste", handlePaste);
    return () => {
      renderer.keyInput.off("paste", handlePaste);
    };
  }, [renderer, suppressKeys, disabled]);

  useKeyboard((key) => {
    if (suppressKeys) return;

    // Handle attachment removal with Ctrl+X when attachments exist
    if ((key.ctrl || key.meta) && key.name === "x" && attachedImagesRef.current.length > 0) {
      const currentSelected = selectedAttachmentRef.current;
      if (currentSelected !== null) {
        // Remove the selected attachment
        setAttachedImages((prev) => prev.filter((_, idx) => idx !== currentSelected));
        // If there are more attachments, select the next one (or previous if we removed the last one)
        if (attachedImagesRef.current.length > 1) {
          setSelectedAttachment((prev) => {
            if (prev === null) return null;
            if (prev >= attachedImagesRef.current.length - 1) {
              return Math.max(0, prev - 1);
            }
            return prev;
          });
        } else {
          setSelectedAttachment(null);
        }
      } else {
        // Select the last attachment for removal
        setSelectedAttachment(attachedImagesRef.current.length - 1);
      }
      return;
    }

    // Cycle through attachments with up/down when an attachment is selected
    if (key.name === "up" && selectedAttachmentRef.current !== null && attachedImagesRef.current.length > 0) {
      setSelectedAttachment((prev) => {
        if (prev === null) return null;
        return prev > 0 ? prev - 1 : attachedImagesRef.current.length - 1;
      });
      return;
    }

    if (key.name === "down" && selectedAttachmentRef.current !== null && attachedImagesRef.current.length > 0) {
      setSelectedAttachment((prev) => {
        if (prev === null) return null;
        return prev < attachedImagesRef.current.length - 1 ? prev + 1 : 0;
      });
      return;
    }

    // Clear selection on escape if an attachment is selected
    if (key.name === "escape" && selectedAttachmentRef.current !== null) {
      setSelectedAttachment(null);
      return;
    }

    if (key.name === "return") {
      handleSubmit();
      return;
    }
    if (key.name === "backspace") {
      setValue((v) => {
        const pos = cursorPosRef.current;
        if (pos === 0) return v;
        const newValue = v.slice(0, pos - 1) + v.slice(pos);
        setCursorPos(pos - 1);
        return newValue;
      });
      return;
    }
    if (key.name === "delete") {
      setValue((v) => {
        const pos = cursorPosRef.current;
        if (pos >= v.length) return v;
        return v.slice(0, pos) + v.slice(pos + 1);
      });
      return;
    }
    if (key.name === "left") {
      setCursorPos((pos) => Math.max(0, pos - 1));
      return;
    }
    if (key.name === "right") {
      setCursorPos((pos) => Math.min(valueRef.current.length, pos + 1));
      return;
    }
    if (key.name === "home" || (key.ctrl && key.name === "a")) {
      setCursorPos(0);
      return;
    }
    if (key.name === "end" || (key.ctrl && key.name === "e")) {
      setCursorPos(valueRef.current.length);
      return;
    }
    if (key.name === "escape" || key.name === "tab") return;
    // Only block up/down if no attachment is selected (otherwise they're used for cycling)
    if ((key.name === "up" || key.name === "down") && selectedAttachmentRef.current === null) return;
    if ((key.ctrl || key.meta) && ["s", "c"].includes(key.name || "")) return;
    if (key.shift && key.name === "tab") return;
    // Printable character
    if (key.sequence && key.sequence.length === 1) {
      setValue((v) => {
        const pos = cursorPosRef.current;
        const newValue = v.slice(0, pos) + key.sequence + v.slice(pos);
        setCursorPos(pos + 1);
        return newValue;
      });
    }
  });

  const placeholder = queuedCount > 0
    ? `Ask anything... (${queuedCount} queued)`
    : "Ask anything...";
  const showPlaceholder = !value && !pastedContent;

  // Calculate height based on wrapped text
  // Account for: padding (left+right) + wrapped content + paste indicator + image indicators + help text
  const contentWidth = Math.max(1, Math.floor(width * 0.825) - 4); // 82.5% width minus padding (matching ChatPane)
  const displayText = showPlaceholder ? placeholder : value;
  const lines = Math.ceil(displayText.length / contentWidth) || 1;
  const pasteIndicatorLines = pastedContent ? 1 : 0;
  const imageIndicatorLines = attachedImages.length;
  const helpTextLines = attachedImages.length > 0 && selectedAttachment === null ? 1 : 0;
  const footerLines = (agentName || modelName) ? 1 : 0;
  const footerSpacerLines = footerLines ? 1 : 0; // Blank line between input text and footer
  const calculatedHeight = Math.max(3, lines + pasteIndicatorLines + imageIndicatorLines + helpTextLines + footerSpacerLines + footerLines); // Minimum 3

  // Notify parent of height change
  useEffect(() => {
    if (onHeightChange) {
      onHeightChange(calculatedHeight);
    }
  }, [calculatedHeight, onHeightChange]);

  return (
    <box
      key={resetKey}
      width="100%"
      height={calculatedHeight}
      flexShrink={0}
      backgroundColor={c.mantle}
      borderStyle="single"
      border={["left"]}
      borderColor={c.info}
      paddingLeft={2}
      paddingRight={2}
      paddingTop={0}
      paddingBottom={0}
    >
      <box flexDirection="column">
        {pastedContent && (
          <text>
            <span fg={c.text} bg={c.surface1}> {nf.clipboard} {pastedLineCount} lines pasted </span>
          </text>
        )}
        {attachedImages.map((img, idx) => {
          const isSelected = idx === selectedAttachment;
          const bgColor = isSelected ? c.error : c.surface1;
          const fgColor = isSelected ? c.base : c.text;
          return (
            <text key={idx}>
              <span fg={c.text} bg={c.surface1}> {nf.image} {img.split('/').pop()}{isSelected ? " [↑/↓ to cycle, Ctrl+X to remove, Esc to cancel]" : ""} </span>
            </text>
          );
        })}
        {attachedImages.length > 0 && selectedAttachment === null && (
          <text>
            <span fg={c.subtle}> Press Ctrl+X to remove attachments </span>
          </text>
        )}
        <text wrapMode="word">
          {showPlaceholder ? (
            <>
              <span fg={c.cursorText} bg={cursorVisible ? c.cursor : undefined}>{" "}</span>
              <span fg={c.subtle}>{placeholder}</span>
            </>
          ) : (
            <>
              <span fg={c.text}>{value.slice(0, cursorPos)}</span>
              <span fg={c.cursorText} bg={cursorVisible ? c.cursor : undefined}>{cursorPos < value.length ? value[cursorPos] : " "}</span>
              <span fg={c.text}>{value.slice(cursorPos + 1)}</span>
            </>
          )}
        </text>
        {(agentName || modelName) && <text> </text>}
        {(agentName || modelName) && (
          <text>
            {agentName && <span fg={c.accent}><b>{agentName}</b></span>}
            {agentName && modelName && <span fg={c.subtle}> · </span>}
            {modelName && <span fg={c.link}><b>{modelName}</b></span>}
            {modelName && reasoningEffort && (
              <>
                <span fg={c.subtle}> (</span>
                <span
                  fg={
                    reasoningEffort === "low" ? c.success :
                    reasoningEffort === "medium" ? c.warning :
                    reasoningEffort === "high" ? "#FFA500" :
                    c.error
                  }
                >
                  {reasoningEffort}
                </span>
                <span fg={c.subtle}>)</span>
              </>
            )}
          </text>
        )}
      </box>
    </box>
  );
});
