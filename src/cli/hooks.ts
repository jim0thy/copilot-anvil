/**
 * Session hooks for the Anvil Copilot SDK integration.
 *
 * These hooks add guardrails and intelligence to the agent execution
 * pipeline. They run within the SDK's hook system and do NOT consume
 * additional premium requests.
 *
 * Hooks:
 * - onPreToolUse:  convention awareness, dangerous-command guardrails
 * - onPostToolUse: output quality checks
 * - onUserPromptSubmitted: prompt enrichment with project context
 * - onSessionStart: project context injection
 */

import type { ToolResultObject } from "@github/copilot-sdk";
import { existsSync, readFileSync } from "node:fs";
import * as path from "node:path";

// ── Hook types (not exported from SDK's public API) ─────────────
// We define them inline to avoid depending on internal module paths.

interface BaseHookInput {
  timestamp: number;
  cwd: string;
}

interface PreToolUseInput extends BaseHookInput {
  toolName: string;
  toolArgs: unknown;
}

interface PreToolUseOutput {
  permissionDecision?: "allow" | "deny" | "ask";
  permissionDecisionReason?: string;
  modifiedArgs?: unknown;
  additionalContext?: string;
  suppressOutput?: boolean;
}

interface PostToolUseInput extends BaseHookInput {
  toolName: string;
  toolArgs: unknown;
  toolResult: ToolResultObject;
}

interface PostToolUseOutput {
  modifiedResult?: ToolResultObject;
  additionalContext?: string;
  suppressOutput?: boolean;
}

interface UserPromptInput extends BaseHookInput {
  prompt: string;
}

interface UserPromptOutput {
  modifiedPrompt?: string;
  additionalContext?: string;
  suppressOutput?: boolean;
}

interface SessionStartInput extends BaseHookInput {
  source: "startup" | "resume" | "new";
  initialPrompt?: string;
}

interface SessionStartOutput {
  additionalContext?: string;
  modifiedConfig?: Record<string, unknown>;
}

/**
 * Hook configuration object matching the SDK's SessionHooks shape.
 */
export interface AnvilSessionHooks {
  onPreToolUse?: (
    input: PreToolUseInput,
    invocation: { sessionId: string }
  ) => Promise<PreToolUseOutput | void> | PreToolUseOutput | void;
  onPostToolUse?: (
    input: PostToolUseInput,
    invocation: { sessionId: string }
  ) => Promise<PostToolUseOutput | void> | PostToolUseOutput | void;
  onUserPromptSubmitted?: (
    input: UserPromptInput,
    invocation: { sessionId: string }
  ) => Promise<UserPromptOutput | void> | UserPromptOutput | void;
  onSessionStart?: (
    input: SessionStartInput,
    invocation: { sessionId: string }
  ) => Promise<SessionStartOutput | void> | SessionStartOutput | void;
}

/**
 * Build the session hooks configuration.
 *
 * @param projectDir - The project root directory (defaults to cwd)
 */
export function createSessionHooks(projectDir?: string): AnvilSessionHooks {
  const cwd = projectDir || process.cwd();

  return {
    /**
     * Pre-tool-use hook: adds guardrails before tool execution.
     *
     * - Warns about destructive git commands (force push, reset --hard)
     * - Adds convention context when editing files
     */
    onPreToolUse: async (input: PreToolUseInput) => {
      const { toolName, toolArgs } = input;

      // Guard against destructive git operations
      if (toolName === "shell" || toolName === "bash") {
        const command =
          typeof toolArgs === "object" && toolArgs !== null
            ? (toolArgs as Record<string, unknown>).command
            : undefined;
        if (typeof command === "string") {
          const dangerous = [
            "git push --force",
            "git push -f",
            "git reset --hard",
            "git clean -fd",
            "rm -rf",
            "git branch -D",
          ];
          for (const pattern of dangerous) {
            if (command.includes(pattern)) {
              return {
                additionalContext: `WARNING: This command contains '${pattern}' which is destructive and hard to reverse. Confirm with the user before proceeding.`,
              };
            }
          }
        }
      }

      // Add convention context when writing files
      if (toolName === "write" || toolName === "edit") {
        const conventionsPath = path.join(cwd, "CONVENTIONS.md");
        if (existsSync(conventionsPath)) {
          try {
            const conventions = readFileSync(conventionsPath, "utf-8");
            if (conventions.length < 2000) {
              return {
                additionalContext: `Follow these project conventions:\n${conventions}`,
              };
            }
          } catch {
            // ignore
          }
        }
      }

      return undefined;
    },

    /**
     * Post-tool-use hook: validates tool outputs and fixes false failures.
     *
     * - Converts task tool "false failures" to success so the parent LLM
     *   doesn't retry subagents that actually completed their work.
     * - Flags if a file write left TODO/FIXME markers
     */
    onPostToolUse: async (input: PostToolUseInput) => {
      const { toolName, toolResult } = input;

      // ── Task tool false-failure interception ─────────────────────
      //
      // The SDK's task tool returns resultType "failure" in many cases
      // where the subagent actually ran and produced useful output. The
      // parent LLM sees "failure" and retries, causing wasteful loops.
      //
      // We intercept here and convert false failures to success. Real
      // failures (validation errors, crashes, empty output) are left as-is
      // so the parent LLM can handle them appropriately.
      if (toolName === "task" && toolResult.resultType !== "success") {
        const text = (toolResult.textResultForLlm || "").trim();

        // Known real-failure patterns from the SDK:
        const isRealFailure =
          !text ||
          text.startsWith("Task tool encountered an error:") ||
          text.startsWith("Unknown agent_type:") ||
          text.startsWith("Invalid input:") ||
          (text.startsWith("Model '") && text.includes("is not available")) ||
          (text.startsWith("Tool '") && text.includes("is not supported"));

        if (!isRealFailure) {
          // The subagent produced useful output — convert to success
          return {
            modifiedResult: {
              ...toolResult,
              resultType: "success" as const,
            },
          };
        }
        // Real failure — leave as-is so the parent LLM can retry/escalate
      }

      // ── File write quality checks ───────────────────────────────
      if (
        (toolName === "write" || toolName === "edit") &&
        toolResult.resultType === "success"
      ) {
        const output = toolResult.textResultForLlm || "";
        const hasTodo = /\bTODO\b|\bFIXME\b|\bHACK\b/i.test(output);
        if (hasTodo) {
          return {
            additionalContext:
              "The file you just wrote contains TODO/FIXME/HACK comments. " +
              "Please complete the implementation or document why the marker " +
              "is intentionally left.",
          };
        }
      }

      return undefined;
    },

    /**
     * User-prompt-submitted hook: enriches prompts with project context.
     *
     * - Appends git branch info
     * - Appends brief project stack detection
     */
    onUserPromptSubmitted: async (_input: UserPromptInput) => {
      const contextParts: string[] = [];

      // Add git branch context
      try {
        const { execSync } = await import("node:child_process");
        const branch = execSync("git branch --show-current", {
          cwd,
          encoding: "utf-8",
          timeout: 3000,
        }).trim();
        if (branch) {
          contextParts.push(`Current git branch: ${branch}`);
        }
      } catch {
        // not in a git repo or git unavailable
      }

      // Detect project type from package.json
      const pkgPath = path.join(cwd, "package.json");
      if (existsSync(pkgPath)) {
        try {
          const pkg = JSON.parse(readFileSync(pkgPath, "utf-8"));
          const deps = {
            ...pkg.dependencies,
            ...pkg.devDependencies,
          };
          const frameworks: string[] = [];
          if (deps.react) frameworks.push("React");
          if (deps.next) frameworks.push("Next.js");
          if (deps.vue) frameworks.push("Vue");
          if (deps.nuxt) frameworks.push("Nuxt");
          if (deps.svelte) frameworks.push("Svelte");
          if (deps.angular) frameworks.push("Angular");
          if (deps.express) frameworks.push("Express");
          if (deps.fastify) frameworks.push("Fastify");
          if (deps.typescript) frameworks.push("TypeScript");

          if (frameworks.length > 0) {
            contextParts.push(`Project stack: ${frameworks.join(", ")}`);
          }
        } catch {
          // ignore
        }
      }

      if (contextParts.length > 0) {
        return {
          additionalContext: contextParts.join("\n"),
        };
      }

      return undefined;
    },

    /**
     * Session-start hook: injects project-level context.
     *
     * - Loads CLAUDE.md / AGENTS.md if present
     */
    onSessionStart: async (_input: SessionStartInput) => {
      const contextFiles = ["CLAUDE.md", "AGENTS.md"];
      const contextParts: string[] = [];

      for (const file of contextFiles) {
        const filePath = path.join(cwd, file);
        if (existsSync(filePath)) {
          try {
            const content = readFileSync(filePath, "utf-8");
            if (content.length < 5000) {
              contextParts.push(content);
            }
          } catch {
            // ignore
          }
        }
      }

      if (contextParts.length > 0) {
        return {
          additionalContext: contextParts.join("\n\n---\n\n"),
        };
      }

      return undefined;
    },
  };
}
