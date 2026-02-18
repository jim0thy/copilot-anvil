/**
 * Headless CLI entry point for the Anvil Copilot SDK integration.
 *
 * This module provides a non-TUI way to use Anvil's orchestration
 * agents, tools, and skills with the GitHub Copilot CLI. It can be used:
 *
 * 1. Directly: `bun src/cli/index.ts "your prompt here"`
 * 2. Programmatically: import { createAnvilSession } from "./cli/index.js"
 *
 * Key design principle: 1 message = 1 premium request. All agent
 * orchestration happens within a single SDK session.send() call.
 * The SDK handles subagent delegation via its built-in task tool,
 * so even complex multi-agent flows consume only 1 premium request.
 */

import { CopilotClient } from "@github/copilot-sdk";
import type {
  CopilotSession,
  SessionConfig,
  CustomAgentConfig,
  Tool,
} from "@github/copilot-sdk";
import { execSync } from "node:child_process";
import * as path from "node:path";
import { existsSync } from "node:fs";

import { getOrchestrationAgents } from "./agents.js";
import { getAnvilTools } from "./tools.js";
import { createSessionHooks } from "./hooks.js";

// ── Types ────────────────────────────────────────────────────────

export interface AnvilSessionOptions {
  /** Model to use (e.g., "claude-sonnet-4.6", "gpt-5.2") */
  model?: string;
  /** Reasoning effort for supported models */
  reasoningEffort?: "low" | "medium" | "high" | "xhigh";
  /** Working directory (defaults to cwd) */
  workingDirectory?: string;
  /** Additional custom agents to register alongside the built-in ones */
  additionalAgents?: CustomAgentConfig[];
  /** Additional tools beyond the built-in ones */
  additionalTools?: Tool<any>[];
  /** Skill directories to load */
  skillDirectories?: string[];
  /** Whether to enable streaming output */
  streaming?: boolean;
  /** Callback for streaming text deltas */
  onDelta?: (text: string) => void;
  /** Callback for tool execution events */
  onToolStart?: (toolName: string, args?: unknown) => void;
  /** Callback for tool completion */
  onToolComplete?: (toolName: string, success: boolean) => void;
  /** Callback for subagent events */
  onSubagentStart?: (name: string, displayName: string) => void;
  /** Callback for subagent completion */
  onSubagentComplete?: (name: string) => void;
  /** Callback for session idle (request complete) */
  onComplete?: (fullResponse: string) => void;
  /** Handler for user input requests (ask_user tool) */
  onUserInputRequest?: (request: {
    question: string;
    choices?: string[];
    allowFreeform?: boolean;
  }) => Promise<{ answer: string; wasFreeform: boolean }>;
}

export interface AnvilSession {
  /** Send a prompt and wait for the complete response */
  send: (prompt: string, attachments?: Array<{ type: "file"; path: string }>) => Promise<string>;
  /** Abort the current execution */
  abort: () => Promise<void>;
  /** Clean up resources */
  destroy: () => Promise<void>;
  /** The underlying SDK session (for advanced usage) */
  session: CopilotSession;
}

// ── Session Factory ─────────────────────────────────────────────

/**
 * Create an AnvilSession with orchestration agents, tools, and hooks
 * pre-configured. This is the main programmatic entry point.
 *
 * All agent orchestration happens within a single `session.send()` call,
 * meaning 1 user message = 1 premium request regardless of how many
 * subagents are invoked.
 *
 * @example
 * ```typescript
 * const session = await createAnvilSession({ model: "claude-sonnet-4.6" });
 * const response = await session.send("Refactor the auth module");
 * await session.destroy();
 * ```
 */
export async function createAnvilSession(
  options: AnvilSessionOptions = {}
): Promise<AnvilSession> {
  // Fix Bun's execPath for the SDK
  if (process.execPath.includes("bun")) {
    try {
      const nodePath = execSync("which node", { encoding: "utf-8" }).trim();
      (process as any).execPath = nodePath;
    } catch {
      // fall through
    }
  }

  const cwd = options.workingDirectory || process.cwd();

  // Merge agents: orchestration agents + any additional custom agents
  const agents: CustomAgentConfig[] = [
    ...getOrchestrationAgents(),
    ...(options.additionalAgents || []),
  ];

  // Merge tools: anvil tools + any additional custom tools
  const tools: Tool<any>[] = [
    ...getAnvilTools(),
    ...(options.additionalTools || []),
  ];

  // Build skill directories
  const skillDirs: string[] = [...(options.skillDirectories || [])];

  // Auto-discover skill directories in the project
  const projectSkillDir = path.join(cwd, ".agents", "skills");
  if (existsSync(projectSkillDir)) {
    skillDirs.push(projectSkillDir);
  }
  const dotAnvilSkills = path.join(cwd, ".anvil", "skills");
  if (existsSync(dotAnvilSkills)) {
    skillDirs.push(dotAnvilSkills);
  }

  // Create the client
  const client = new CopilotClient({
    autoStart: true,
    logLevel: "error",
  });

  await client.start();

  // Build session config
  const sessionConfig: SessionConfig = {
    sessionId: `anvil-cli-${Date.now().toString(36)}`,
    streaming: options.streaming !== false,
    model: options.model,
    reasoningEffort: options.reasoningEffort,
    workingDirectory: cwd,
    customAgents: agents,
    tools,
    hooks: createSessionHooks(cwd),
    skillDirectories: skillDirs.length > 0 ? skillDirs : undefined,
    systemMessage: {
      mode: "append",
      content: buildSystemPromptAppendix(agents),
    },
    onUserInputRequest: options.onUserInputRequest,
  };

  const session = await client.createSession(sessionConfig);

  // Wire up event handlers
  let responseBuffer = "";

  session.on((event) => {
    switch (event.type) {
      case "assistant.message_delta": {
        const delta = event.data?.deltaContent ?? "";
        if (delta) {
          responseBuffer += delta;
          options.onDelta?.(delta);
        }
        break;
      }
      case "tool.execution_start": {
        options.onToolStart?.(
          event.data?.toolName ?? "unknown",
          event.data?.arguments
        );
        break;
      }
      case "tool.execution_complete": {
        options.onToolComplete?.(
          event.data?.toolCallId ?? "unknown",
          event.data?.success ?? false
        );
        break;
      }
      case "subagent.started": {
        options.onSubagentStart?.(
          event.data?.agentName ?? "",
          event.data?.agentDisplayName ?? ""
        );
        break;
      }
      case "subagent.completed": {
        options.onSubagentComplete?.(event.data?.agentName ?? "");
        break;
      }
    }
  });

  // Build the session wrapper
  const anvilSession: AnvilSession = {
    session,

    async send(prompt, attachments) {
      responseBuffer = "";

      const payload: { prompt: string; attachments?: Array<{ type: "file"; path: string }> } = {
        prompt,
      };
      if (attachments && attachments.length > 0) {
        payload.attachments = attachments;
      }

      await session.send(payload);

      // Wait for session to go idle (request complete)
      const response = await new Promise<string>((resolve) => {
        const handler = (event: any) => {
          if (event.type === "session.idle") {
            resolve(responseBuffer);
          }
        };
        session.on(handler);
      });

      options.onComplete?.(response);
      return response;
    },

    async abort() {
      try {
        await session.abort();
      } catch {
        // best-effort
      }
    },

    async destroy() {
      try {
        await session.destroy();
      } catch {
        // ignore
      }
      try {
        await client.stop();
      } catch {
        await client.forceStop();
      }
    },
  };

  return anvilSession;
}

// ── System prompt appendix ──────────────────────────────────────

function buildSystemPromptAppendix(agents: CustomAgentConfig[]): string {
  const agentList = agents
    .map((a) => `- **${a.displayName || a.name}**: ${a.description || ""}`)
    .join("\n");

  return `
<anvil_agents>
You have access to the following specialist agents via the task tool:

${agentList}

## Orchestration Guidelines

1. For complex tasks, delegate to **tech-lead** who will coordinate specialists.
2. For quick code searches, use **scout** directly.
3. For investigation/debugging, use **architect**.
4. For planning, use **strategist** then validate with **advisor**.
5. For deep implementation work, use **staff-engineer**.

## Single-Request Constraint

All agent orchestration happens within this single request. Subagent
invocations via the task tool do NOT consume additional premium requests.
Use agents freely to produce the best result.
</anvil_agents>
`;
}

// ── CLI runner ───────────────────────────────────────────────────

/**
 * Run the CLI in one-shot mode: send a prompt, stream output, exit.
 */
async function main() {
  const args = process.argv.slice(2);
  const prompt = args.join(" ").trim();

  if (!prompt) {
    console.error(
      "Usage: bun src/cli/index.ts <prompt>\n" +
        "       bun src/cli/index.ts 'Refactor the auth module to use JWT'\n"
    );
    process.exit(1);
  }

  // Parse optional flags
  let model: string | undefined;
  let promptText = prompt;

  const modelMatch = prompt.match(/--model[= ](\S+)/);
  if (modelMatch) {
    model = modelMatch[1];
    promptText = prompt.replace(/--model[= ]\S+/, "").trim();
  }

  try {
    const session = await createAnvilSession({
      model,
      streaming: true,
      onDelta: (text) => process.stdout.write(text),
      onSubagentStart: (name, displayName) => {
        process.stderr.write(`\n[agent: ${displayName}]\n`);
      },
      onToolStart: (toolName) => {
        process.stderr.write(`  [tool: ${toolName}]\n`);
      },
      onUserInputRequest: async (request) => {
        // In CLI mode, print question and use first choice or empty answer
        process.stderr.write(`\n? ${request.question}\n`);
        if (request.choices && request.choices.length > 0) {
          process.stderr.write(
            `  Choices: ${request.choices.join(", ")}\n`
          );
          return { answer: request.choices[0], wasFreeform: false };
        }
        return { answer: "", wasFreeform: true };
      },
    });

    await session.send(promptText);
    process.stdout.write("\n");

    await session.destroy();
    process.exit(0);
  } catch (error) {
    console.error(
      "\nError:",
      error instanceof Error ? error.message : String(error)
    );
    process.exit(1);
  }
}

// Run if invoked directly
const isDirectExecution =
  process.argv[1] &&
  (process.argv[1].endsWith("cli/index.ts") ||
    process.argv[1].endsWith("cli/index.js"));

if (isDirectExecution) {
  main();
}
