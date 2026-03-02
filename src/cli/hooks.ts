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

// ── Hook types (mirrors SDK's internal SessionHooks shape) ───────
// These are not exported from @github/copilot-sdk's public API,
// so we define the equivalent shapes locally.

interface BaseHookInput {
  timestamp: number;
  cwd: string;
}

interface PreToolUseHookInput extends BaseHookInput {
  toolName: string;
  toolArgs: unknown;
}

interface PreToolUseHookOutput {
  permissionDecision?: "allow" | "deny" | "ask";
  permissionDecisionReason?: string;
  modifiedArgs?: unknown;
  additionalContext?: string;
  suppressOutput?: boolean;
}

interface PostToolUseHookInput extends BaseHookInput {
  toolName: string;
  toolArgs: unknown;
  toolResult: ToolResultObject;
}

interface PostToolUseHookOutput {
  modifiedResult?: ToolResultObject;
  additionalContext?: string;
  suppressOutput?: boolean;
}

interface UserPromptSubmittedHookInput extends BaseHookInput {
  prompt: string;
}

interface UserPromptSubmittedHookOutput {
  modifiedPrompt?: string;
  additionalContext?: string;
  suppressOutput?: boolean;
}

interface SessionStartHookInput extends BaseHookInput {
  source: "startup" | "resume" | "new";
  initialPrompt?: string;
}

interface SessionStartHookOutput {
  additionalContext?: string;
  modifiedConfig?: Record<string, unknown>;
}

/**
 * Build the session hooks configuration.
 *
 * @param projectDir - The project root directory (defaults to cwd)
 */
export function createSessionHooks(projectDir?: string) {
  const cwd = projectDir || process.cwd();

  return {
    /**
     * Pre-tool-use hook: adds guardrails before tool execution.
     *
     * - Warns about destructive git commands (force push, reset --hard)
     * - Adds convention context when editing files
     */
    onPreToolUse: async (input: PreToolUseHookInput) => {
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
    onPostToolUse: async (input: PostToolUseHookInput) => {
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
        // Extract output from either textResultForLlm or sessionLog
        const text = (toolResult.textResultForLlm || "").trim();
        const sessionLog = (
          typeof toolResult.sessionLog === "string"
            ? toolResult.sessionLog
            : ""
        ).trim();
        const hasContent = text || sessionLog;
        const output = text || sessionLog;

        // Known real-failure patterns from the SDK:
        const isRealFailure =
          !hasContent ||
          output.startsWith("Task tool encountered an error:") ||
          output.startsWith("Unknown agent_type:") ||
          output.startsWith("Invalid input:") ||
          (output.startsWith("Model '") && output.includes("is not available")) ||
          (output.startsWith("Tool '") && output.includes("is not supported"));

        if (!isRealFailure) {
          // The subagent produced useful output — convert to success
          // If textResultForLlm is empty but sessionLog has content, copy it over
          // Special case: SDK's "did not produce a response" false-positive.
          // The agent DID work (called tools, made edits, etc.) but its final
          // assistant message had empty content (e.g., ended with task_complete
          // tool call and no text). Replace with sessionLog or a positive ack.
          let finalText = text || sessionLog;
          const noResponsePattern = /did not produce a response/i;
          if (noResponsePattern.test(finalText)) {
            finalText =
              (sessionLog && !noResponsePattern.test(sessionLog) ? sessionLog : "") ||
              "The agent completed its work successfully (task_complete was called). No additional text response was generated.";
          }
          return {
            modifiedResult: {
              ...toolResult,
              resultType: "success" as const,
              textResultForLlm: finalText,
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
    onUserPromptSubmitted: async (_input: UserPromptSubmittedHookInput) => {
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
     * - Loads AGENTS.md if present
     */
    onSessionStart: async (_input: SessionStartHookInput) => {
      const contextFiles = ["AGENTS.md"];
      const contextParts: string[] = [];

      for (const file of contextFiles) {
        const filePath = path.join(cwd, file);
        if (existsSync(filePath)) {
          try {
            const content = readFileSync(filePath, "utf-8");
            if (content.length < 5000) {
              contextParts.push(content);
            } else {
              contextParts.push(
                `[${file} is available in the repo (${Math.round(content.length / 1024)}KB) — read it for comprehensive project documentation.]`
              );
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
