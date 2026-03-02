/**
 * Configuration persistence for the TUI harness.
 * Stores user preferences like reasoning effort level.
 */

import { homedir } from "node:os";
import { join } from "node:path";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";

export type ReasoningEffort = "low" | "medium" | "high" | "xhigh";

export interface TuiConfig {
  reasoningEffort: ReasoningEffort;
}

const DEFAULT_CONFIG: TuiConfig = {
  reasoningEffort: "medium",
};

const CONFIG_DIR = join(homedir(), ".config", "anvil");
const CONFIG_FILE = join(CONFIG_DIR, "config.json");

/**
 * Load configuration from disk.
 * Returns default config if file doesn't exist or is invalid.
 */
export function loadConfig(): TuiConfig {
  try {
    if (!existsSync(CONFIG_FILE)) {
      return { ...DEFAULT_CONFIG };
    }

    const data = readFileSync(CONFIG_FILE, "utf-8");
    const parsed = JSON.parse(data);

    // Validate reasoning effort
    const effort = parsed.reasoningEffort;
    if (!["low", "medium", "high", "xhigh"].includes(effort)) {
      return { ...DEFAULT_CONFIG };
    }

    return {
      reasoningEffort: effort as ReasoningEffort,
    };
  } catch {
    // If reading fails, return defaults
    return { ...DEFAULT_CONFIG };
  }
}

/**
 * Save configuration to disk.
 * Creates config directory if it doesn't exist.
 */
export function saveConfig(config: TuiConfig): void {
  try {
    if (!existsSync(CONFIG_DIR)) {
      mkdirSync(CONFIG_DIR, { recursive: true });
    }

    writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2), "utf-8");
  } catch (error) {
    // Silently fail - config is not critical
    console.error("Failed to save config:", error);
  }
}

/**
 * Cycle to the next reasoning effort level.
 */
export function cycleReasoningEffort(
  current: ReasoningEffort,
  supportedLevels?: ReasoningEffort[]
): ReasoningEffort {
  const order: ReasoningEffort[] = supportedLevels ?? ["low", "medium", "high", "xhigh"];
  const currentIndex = order.indexOf(current);
  if (currentIndex === -1) return order[0];
  const nextIndex = (currentIndex + 1) % order.length;
  return order[nextIndex];
}
