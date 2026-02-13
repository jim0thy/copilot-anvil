import { memo, useCallback, useEffect, useRef, useState } from "react";
import type { StderrLine } from "../../utils/stderrCapture.js";
import { getStderrBuffer } from "../../utils/stderrCapture.js";
import type { Theme } from "../theme.js";

interface DebugOverlayProps {
  theme: Theme;
  width: number;
  height: number;
}

const AUTO_DISMISS_MS = 6000;
const MAX_VISIBLE_LINES = 8;
const OVERLAY_WIDTH_RATIO = 0.4;

export const DebugOverlay = memo(function DebugOverlay({
  theme,
  width,
  height,
}: DebugOverlayProps) {
  const c = theme.colors;
  const [visibleLines, setVisibleLines] = useState<StderrLine[]>([]);
  const dismissTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastDismissedAt = useRef(0);

  const scheduleDismiss = useCallback(() => {
    if (dismissTimer.current) clearTimeout(dismissTimer.current);
    dismissTimer.current = setTimeout(() => {
      const allLines = getStderrBuffer();
      lastDismissedAt.current = allLines.length;
      setVisibleLines([]);
    }, AUTO_DISMISS_MS);
  }, []);

  useEffect(() => {
    const interval = setInterval(() => {
      const allLines = getStderrBuffer();
      if (allLines.length > lastDismissedAt.current) {
        const newLines = allLines.slice(lastDismissedAt.current).slice(-MAX_VISIBLE_LINES);
        setVisibleLines(newLines);
        scheduleDismiss();
      }
    }, 500);
    return () => {
      clearInterval(interval);
      if (dismissTimer.current) clearTimeout(dismissTimer.current);
    };
  }, [scheduleDismiss]);

  const overlayWidth = Math.max(30, Math.floor(width * OVERLAY_WIDTH_RATIO));

  if (visibleLines.length === 0) {
    return <box position="absolute" left={0} top={0} width={0} height={0} />;
  }

  const overlayHeight = Math.min(visibleLines.length + 2, MAX_VISIBLE_LINES + 2);
  const left = width - overlayWidth - 1;
  const top = height - overlayHeight - 2;

  return (
    <box
      position="absolute"
      left={left}
      top={top}
      width={overlayWidth}
      height={overlayHeight}
      borderStyle="single"
      borderColor={c.warning}
      backgroundColor={c.mantle}
      paddingLeft={1}
      paddingRight={1}
      flexDirection="column"
    >
      {visibleLines.map((line, i) => (
        <text key={`${line.timestamp}-${i}`}>
          <span fg={c.warning}>{line.text}</span>
        </text>
      ))}
    </box>
  );
});
