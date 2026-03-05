import { appendFileSync, writeFileSync } from "node:fs";
import { appendFile } from "node:fs/promises";
import { join } from "node:path";

const DEBUG_LOG_PATH = join(process.cwd(), "debug.log");

let initialized = false;
const buffer: string[] = [];
let flushTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * File-based debug logger that bypasses console.error.
 * console.error stops working after createCliRenderer because the renderer
 * redirects stderr to /dev/tty. This logger writes directly to debug.log
 * via buffered async writes, which works regardless of renderer state.
 *
 * Gated behind the DEBUG environment variable — no-op when DEBUG is not set.
 * Messages are buffered in memory and flushed every 500ms to avoid
 * synchronous I/O on every call (critical for streaming token performance).
 */
export function debugLog(message: string): void {
  if (!process.env.DEBUG) return;

  if (!initialized) {
    try {
      writeFileSync(DEBUG_LOG_PATH, `[DEBUG] session started at ${new Date().toISOString()}\n`);
    } catch {
      // If we can't write, silently disable
      return;
    }
    initialized = true;
  }

  buffer.push(message);

  if (!flushTimer) {
    flushTimer = setTimeout(flushBuffer, 500);
  }
}

async function flushBuffer(): Promise<void> {
  flushTimer = null;
  if (buffer.length === 0) return;
  const batch = buffer.splice(0);
  try {
    await appendFile(DEBUG_LOG_PATH, batch.join("\n") + "\n");
  } catch {
    // Silently ignore write failures
  }
}

/**
 * Synchronously flush any remaining buffered log messages.
 * Call this during graceful shutdown / process exit.
 */
export function flushDebugLog(): void {
  if (flushTimer) {
    clearTimeout(flushTimer);
    flushTimer = null;
  }
  if (buffer.length === 0) return;
  const batch = buffer.splice(0);
  try {
    appendFileSync(DEBUG_LOG_PATH, batch.join("\n") + "\n");
  } catch {
    // Silently ignore write failures
  }
}
