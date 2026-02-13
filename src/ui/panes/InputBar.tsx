import { useKeyboard, useTerminalDimensions, useRenderer } from "@opentui/react";
import { memo, useState, useEffect, useRef, useCallback } from "react";
import type { Theme } from "../theme.js";
import type { PasteEvent } from "@opentui/core";

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
  
  // Use refs for values accessed in keyboard/paste callbacks to avoid stale closures
  const cursorPosRef = useRef(cursorPos);
  cursorPosRef.current = cursorPos;
  const valueRef = useRef(value);
  valueRef.current = value;
  const attachedImagesRef = useRef(attachedImages);
  attachedImagesRef.current = attachedImages;
  const pastedContentRef = useRef(pastedContent);
  pastedContentRef.current = pastedContent;
  
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
          if (!attachedImagesRef.current.includes(imagePath)) {
            setAttachedImages((prev) => [...prev, imagePath]);
          }
        } else {
          // Regular single line paste - insert at cursor position
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
    if (key.name === "escape" || key.name === "tab" || key.name === "up" || key.name === "down") return;
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
  const promptColor = disabled ? c.subtle : c.success;
  const showPlaceholder = !value && !pastedContent;

  // Calculate height based on wrapped text
  // Account for: padding (top+bottom) + wrapped content + paste indicator + image indicators
  const contentWidth = Math.max(1, Math.floor(width * 0.65) - 4); // 65% width minus padding
  const prompt = "› ";
  const displayText = showPlaceholder ? placeholder : value;
  const fullText = prompt + displayText;
  const lines = Math.ceil(fullText.length / contentWidth) || 1;
  const pasteIndicatorLines = pastedContent ? 1 : 0;
  const imageIndicatorLines = attachedImages.length;
  const calculatedHeight = Math.max(3, lines + pasteIndicatorLines + imageIndicatorLines + 2); // Minimum 3, add 2 for top/bottom padding

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
      borderStyle="single"
      border={["left"]}
      borderColor={c.info}
      backgroundColor={c.mantle}
      paddingLeft={1}
      justifyContent="center"
    >
      <box flexDirection="column" justifyContent="center">
        {pastedContent && (
          <text>
            <span fg={c.text} bg={c.surface1}> 📋 {pastedLineCount} lines pasted </span>
          </text>
        )}
        {attachedImages.map((img, idx) => (
          <text key={idx}>
            <span fg={c.text} bg={c.surface1}> 🖼 {img.split('/').pop()} </span>
          </text>
        ))}
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
      </box>
    </box>
  );
});
