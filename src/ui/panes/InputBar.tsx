import { useKeyboard, useTerminalDimensions, useRenderer } from "@opentui/react";
import { memo, useState, useEffect } from "react";
import type { Theme } from "../theme.js";
import type { PasteEvent } from "@opentui/core";

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
}

// Custom keyboard-driven input (OpenTUI's <input> doesn't work in child components)
export const InputBar = memo(function InputBar({ onSubmit, disabled = false, suppressKeys = false, queuedCount = 0, theme, onHeightChange }: InputBarProps) {
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

  const handleSubmit = () => {
    let textToSubmit = value;
    
    // Parse /attach commands and remove them from the text
    const attachRegex = /\/attach\s+([^\s]+)/g;
    const matches = [...textToSubmit.matchAll(attachRegex)];
    const newImages: string[] = [];
    
    for (const match of matches) {
      const imagePath = match[1];
      if (imagePath && !attachedImages.includes(imagePath)) {
        newImages.push(imagePath);
      }
      // Remove the /attach command from the text
      textToSubmit = textToSubmit.replace(match[0], '').trim();
    }
    
    const allImages = [...attachedImages, ...newImages];
    const fullText = pastedContent ? pastedContent + "\n" + textToSubmit : textToSubmit;
    
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
        // Single line paste - check if it's an /attach command
        const attachMatch = text.match(/^\/attach\s+(.+)$/);
        if (attachMatch) {
          const imagePath = attachMatch[1].trim();
          if (!attachedImages.includes(imagePath)) {
            setAttachedImages((prev) => [...prev, imagePath]);
          }
        } else {
          // Regular single line paste - insert at cursor position
          setValue((v) => {
            const newValue = v.slice(0, cursorPos) + text + v.slice(cursorPos);
            setCursorPos(cursorPos + text.length);
            return newValue;
          });
        }
      }
    };
    
    renderer.keyInput.on("paste", handlePaste);
    return () => {
      renderer.keyInput.off("paste", handlePaste);
    };
  }, [renderer, suppressKeys, disabled, cursorPos, attachedImages]);

  useKeyboard((key) => {
    if (suppressKeys) return;
    if (key.name === "return") {
      handleSubmit();
      return;
    }
    if (key.name === "backspace") {
      setValue((v) => {
        if (cursorPos === 0) return v;
        const newValue = v.slice(0, cursorPos - 1) + v.slice(cursorPos);
        setCursorPos(cursorPos - 1);
        return newValue;
      });
      return;
    }
    if (key.name === "delete") {
      setValue((v) => {
        if (cursorPos >= v.length) return v;
        return v.slice(0, cursorPos) + v.slice(cursorPos + 1);
      });
      return;
    }
    if (key.name === "left") {
      setCursorPos((pos) => Math.max(0, pos - 1));
      return;
    }
    if (key.name === "right") {
      setCursorPos((pos) => Math.min(value.length, pos + 1));
      return;
    }
    if (key.name === "home" || (key.ctrl && key.name === "a")) {
      setCursorPos(0);
      return;
    }
    if (key.name === "end" || (key.ctrl && key.name === "e")) {
      setCursorPos(value.length);
      return;
    }
    if (key.name === "escape" || key.name === "tab" || key.name === "up" || key.name === "down") return;
    if ((key.ctrl || key.meta) && ["s", "c"].includes(key.name || "")) return;
    if (key.shift && key.name === "tab") return;
    // Printable character
    if (key.sequence && key.sequence.length === 1) {
      setValue((v) => {
        const newValue = v.slice(0, cursorPos) + key.sequence + v.slice(cursorPos);
        setCursorPos(cursorPos + 1);
        return newValue;
      });
    }
  });

  const placeholder = queuedCount > 0
    ? `Ask anything... (${queuedCount} queued)`
    : "Ask anything...";
  const promptColor = disabled ? c.subtle : c.success;
  const showPlaceholder = !value && !pastedContent;

  // Calculate height based on wrapped text
  // Account for: border (2 lines) + padding + wrapped content + paste indicator + image indicators
  const contentWidth = Math.max(1, Math.floor(width * 0.65) - 4); // 65% width minus padding and border
  const prompt = "› ";
  const displayText = showPlaceholder ? placeholder : value;
  const fullText = prompt + displayText;
  const lines = Math.ceil(fullText.length / contentWidth) || 1;
  const pasteIndicatorLines = pastedContent ? 1 : 0;
  const imageIndicatorLines = attachedImages.length;
  const calculatedHeight = Math.max(3, lines + pasteIndicatorLines + imageIndicatorLines + 2); // Minimum 3, add 2 for borders

  // Notify parent of height change
  useEffect(() => {
    if (onHeightChange) {
      onHeightChange(calculatedHeight);
    }
  }, [calculatedHeight, onHeightChange]);

  return (
    <box key={resetKey} width="100%" height={calculatedHeight} flexShrink={0} borderStyle="single" borderColor={c.border}>
      <box paddingLeft={1} paddingRight={1} flexDirection="column">
        {pastedContent && (
          <text>
            <span fg="#000" bg="#ffff00">[pasted ~{pastedLineCount} lines]</span>
          </text>
        )}
        {attachedImages.map((img, idx) => (
          <text key={idx}>
            <span fg="#000" bg="#ffff00">[image {idx + 1}: {img}]</span>
          </text>
        ))}
        <text wrapMode="word">
          <span fg={promptColor}><b>{"› "}</b></span>
          {showPlaceholder ? (
            <span fg={c.subtle}>{placeholder}</span>
          ) : (
            <>
              <span fg={c.text}>{value.slice(0, cursorPos)}</span>
              <span fg={c.cursorText} bg={c.cursor}>{cursorPos < value.length ? value[cursorPos] : " "}</span>
              <span fg={c.text}>{value.slice(cursorPos + 1)}</span>
            </>
          )}
        </text>
      </box>
    </box>
  );
});
