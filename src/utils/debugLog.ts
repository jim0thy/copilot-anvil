import { appendFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const DEBUG_LOG_PATH = join(process.cwd(), "debug.log");

let initialized = false;

/**
 * File-based debug logger that bypasses console.error.
 * console.error stops working after createCliRenderer because the renderer
 * redirects stderr to /dev/tty. This logger writes directly to debug.log
 * via fs.appendFileSync, which works regardless of renderer state.
 */
export function debugLog(message: string): void {
  if (!initialized) {
    try {
      writeFileSync(DEBUG_LOG_PATH, `[DEBUG] session started at ${new Date().toISOString()}\n`);
    } catch {
      // If we can't write, silently disable
      return;
    }
    initialized = true;
  }
  try {
    appendFileSync(DEBUG_LOG_PATH, message + "\n");
  } catch {
    // Silently ignore write failures
  }
}
