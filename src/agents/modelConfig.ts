/**
 * Agent model configuration.
 *
 * Provides default model / reasoning-effort assignments for every agent and
 * lets users override them via ~/.config/anvil/agents.json without touching
 * source code.
 *
 * Config file format:
 * ```json
 * {
 *   "agents": {
 *     "<agent-id>": {
 *       "model": "claude-opus-4.6",
 *       "reasoningEffort": "xhigh"
 *     }
 *   }
 * }
 * ```
 *
 * Only the fields you specify are overridden — everything else keeps its
 * built-in default.
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import type { ReasoningEffort } from "../utils/config.js";

// ── Types ────────────────────────────────────────────────────────

export interface AgentModelOverride {
  model?: string;
  reasoningEffort?: ReasoningEffort;
}

export interface AgentModelConfig {
  agents: Record<string, AgentModelOverride>;
}

// ── Paths ────────────────────────────────────────────────────────

const CONFIG_DIR = join(homedir(), ".config", "anvil");
const CONFIG_FILE = join(CONFIG_DIR, "agents.json");

// ── Built-in defaults (matches oh-my-opencode config) ────────────
//
// Copilot variant mapping:  max → xhigh, high → high, medium → medium
//
// These are the "source of truth" defaults. The config file lets
// users override any of them at runtime.

export const DEFAULT_AGENT_MODELS: Record<string, AgentModelOverride> = {
  // ── CLI orchestration agents ─────────────────────────────────
  "tech-lead":       { model: "claude-opus-4.6",       reasoningEffort: "xhigh"  },
  "staff-engineer":  { model: "gpt-5.2-codex",         reasoningEffort: "medium" },
  "architect":       { model: "gpt-5.2",               reasoningEffort: "high"   },
  "navigator":       { model: "claude-sonnet-4.5"                                },
  "scout":           { model: "gpt-5-mini"                                       },
  "strategist":      { model: "claude-opus-4.6",       reasoningEffort: "xhigh"  },
  "advisor":         { model: "claude-opus-4.6",       reasoningEffort: "xhigh"  },

  // ── Built-in TUI agents ──────────────────────────────────────
  "intake":                    { model: "claude-sonnet-4.5"                                },
  "junior-developer":          { model: "claude-haiku-4.5"                                 },
  "frontend-developer":        { model: "gemini-3-pro-preview"                             },
  "backend-developer":         { model: "claude-sonnet-4.5"                                },
  "fullstack-developer":       { model: "gemini-3-pro-preview"                             },
  "senior-frontend-developer": { model: "gpt-5.2-codex"                                   },
  "senior-backend-developer":  { model: "claude-sonnet-4.5"                                },
  "senior-fullstack-developer":{ model: "gpt-5.2-codex"                                   },
  "data-engineer":             { model: "claude-sonnet-4.5"                                },
  "designer":                  { model: "gemini-3-pro-preview"                             },
  "prompt-writer":             { model: "gemini-3-flash-preview"                           },
  "devops":                    { model: "gpt-5.2-codex"                                   },
  "reviewer":                  { model: "gpt-5.2",              reasoningEffort: "medium"  },
};

// ── Load / save ──────────────────────────────────────────────────

/**
 * Load agent model overrides from ~/.config/anvil/agents.json.
 * Returns an empty config if the file doesn't exist or is malformed.
 */
export function loadModelConfig(): AgentModelConfig {
  try {
    if (!existsSync(CONFIG_FILE)) {
      return { agents: {} };
    }

    const raw = readFileSync(CONFIG_FILE, "utf-8");
    const parsed = JSON.parse(raw);

    if (!parsed || typeof parsed !== "object" || typeof parsed.agents !== "object") {
      return { agents: {} };
    }

    // Validate each entry
    const agents: Record<string, AgentModelOverride> = {};
    const validEfforts: ReasoningEffort[] = ["low", "medium", "high", "xhigh"];

    for (const [id, override] of Object.entries(parsed.agents)) {
      if (!override || typeof override !== "object") continue;

      const entry: AgentModelOverride = {};
      const o = override as Record<string, unknown>;

      if (typeof o.model === "string" && o.model.length > 0) {
        // Strip "github-copilot/" prefix if present (gist format compat)
        entry.model = o.model.replace(/^github-copilot\//, "");
      }
      if (typeof o.reasoningEffort === "string" && validEfforts.includes(o.reasoningEffort as ReasoningEffort)) {
        entry.reasoningEffort = o.reasoningEffort as ReasoningEffort;
      }
      // Also support "variant" as an alias (oh-my-opencode format)
      if (typeof o.variant === "string" && !entry.reasoningEffort) {
        const variantMap: Record<string, ReasoningEffort> = {
          max: "xhigh",
          high: "high",
          medium: "medium",
          low: "low",
        };
        const mapped = variantMap[o.variant as string];
        if (mapped) entry.reasoningEffort = mapped;
      }

      if (entry.model || entry.reasoningEffort) {
        agents[id] = entry;
      }
    }

    return { agents };
  } catch {
    return { agents: {} };
  }
}

/**
 * Save a model config to ~/.config/anvil/agents.json.
 */
export function saveModelConfig(config: AgentModelConfig): void {
  try {
    if (!existsSync(CONFIG_DIR)) {
      mkdirSync(CONFIG_DIR, { recursive: true });
    }
    writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2) + "\n", "utf-8");
  } catch (error) {
    console.error("Failed to save agent model config:", error);
  }
}

/**
 * Write a default agents.json if one doesn't exist yet.
 * Useful for bootstrapping so users can see the format.
 */
export function ensureDefaultConfigExists(): void {
  if (existsSync(CONFIG_FILE)) return;

  saveModelConfig({ agents: DEFAULT_AGENT_MODELS });
}

/**
 * Resolve the effective model and reasoning effort for an agent.
 *
 * Priority: user config > built-in defaults > agent definition fallback.
 */
export function resolveAgentModel(
  agentId: string,
  userConfig: AgentModelConfig,
): AgentModelOverride {
  const builtin = DEFAULT_AGENT_MODELS[agentId];
  const userOverride = userConfig.agents[agentId];

  return {
    model: userOverride?.model ?? builtin?.model,
    reasoningEffort: userOverride?.reasoningEffort ?? builtin?.reasoningEffort,
  };
}

/**
 * Get the config file path (exposed for UI / help text).
 */
export function getModelConfigPath(): string {
  return CONFIG_FILE;
}
