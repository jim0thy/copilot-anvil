/**
 * Custom tool definitions for the Anvil Copilot SDK integration.
 *
 * These tools extend the SDK's built-in tools with Anvil-specific
 * capabilities:
 *
 * - enforce_checklist: prevents agents from abandoning incomplete work
 * - summarize_context: compresses conversation context for lean delegation
 * - check_conventions: validates code against project conventions
 * - project_overview: quick structural overview of the project
 *
 * All tools are defined using the SDK's `defineTool` helper and can
 * be passed directly to `createSession({ tools: [...] })`.
 */

import { defineTool } from "@github/copilot-sdk";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import * as path from "node:path";

/**
 * Tool: enforce_checklist
 *
 * Agents call this
 * tool to register a checklist of tasks they intend to complete. If the
 * agent tries to finish without completing all items, the tool reminds
 * them of outstanding work.
 */
export const enforceChecklist = defineTool("enforce_checklist", {
  description:
    "Register or update a checklist of tasks for the current work unit. " +
    "Call with action='register' to set the checklist, action='complete' to mark an item done, " +
    "action='status' to see outstanding items. Ensures no work is abandoned.",
  parameters: {
    type: "object",
    properties: {
      action: {
        type: "string",
        enum: ["register", "complete", "status"],
        description: "Action to perform on the checklist",
      },
      items: {
        type: "array",
        items: { type: "string" },
        description:
          "List of task descriptions (required for 'register' action)",
      },
      item_index: {
        type: "number",
        description: "Index of the item to mark complete (for 'complete' action)",
      },
    },
    required: ["action"],
  },
  handler: (args: {
    action: "register" | "complete" | "status";
    items?: string[];
    item_index?: number;
  }) => {
    // Stateless tool - the checklist state is maintained in the conversation
    // context by the LLM. This tool just structures the interaction pattern.
    switch (args.action) {
      case "register": {
        if (!args.items || args.items.length === 0) {
          return {
            textResultForLlm:
              "Error: 'items' array is required for 'register' action.",
            resultType: "failure" as const,
          };
        }
        const checklist = args.items
          .map((item, i) => `  [ ] ${i}. ${item}`)
          .join("\n");
        return {
          textResultForLlm: `Checklist registered with ${args.items.length} items:\n${checklist}\n\nYou MUST call enforce_checklist(action='complete', item_index=N) as you finish each item. Do NOT consider your task complete until all items are checked off.`,
          resultType: "success" as const,
        };
      }
      case "complete": {
        if (args.item_index === undefined) {
          return {
            textResultForLlm:
              "Error: 'item_index' is required for 'complete' action.",
            resultType: "failure" as const,
          };
        }
        return {
          textResultForLlm: `Item ${args.item_index} marked complete. Continue with remaining items.`,
          resultType: "success" as const,
        };
      }
      case "status": {
        return {
          textResultForLlm:
            "Review your checklist above. List all items with their current status (completed or pending). If any items remain, continue working on them before finishing.",
          resultType: "success" as const,
        };
      }
      default:
        return {
          textResultForLlm: `Unknown action: ${args.action}`,
          resultType: "failure" as const,
        };
    }
  },
});

/**
 * Tool: update_todo
 *
 * Updates the UI-visible checklist in the TUI (Plan & Progress section).
 */
export const updateTodo = defineTool("update_todo", {
  description:
    "Update the UI's Plan & Progress checklist. Provide a markdown checklist, one item per line, e.g. '- [ ] Do thing'.",
  parameters: {
    type: "object",
    properties: {
      todos: {
        type: "string",
        description: "Markdown checklist, e.g. '- [ ] item' and '- [x] item'",
      },
    },
    required: ["todos"],
  },
  handler: (args: { todos: string }) => {
    if (!args.todos || !args.todos.trim()) {
      return {
        textResultForLlm: "Error: 'todos' is required.",
        resultType: "failure" as const,
      };
    }
    return {
      textResultForLlm: `Todo list updated:\n${args.todos}`,
      resultType: "success" as const,
    };
  },
});

/**
 * Tool: summarize_context
 *
 * Compresses context for lean subagent delegation.
 */
export const summarizeContext = defineTool("summarize_context", {
  description:
    "Compress a set of facts and context into a lean summary suitable for " +
    "subagent delegation. Returns a structured context block that can be " +
    "pasted into a task prompt.",
  parameters: {
    type: "object",
    properties: {
      task_description: {
        type: "string",
        description: "Brief description of the task being delegated",
      },
      relevant_files: {
        type: "array",
        items: { type: "string" },
        description: "File paths relevant to the task",
      },
      constraints: {
        type: "array",
        items: { type: "string" },
        description: "Constraints or requirements the subagent must follow",
      },
      background: {
        type: "string",
        description: "Additional background context the subagent needs",
      },
    },
    required: ["task_description"],
  },
  handler: (args: {
    task_description: string;
    relevant_files?: string[];
    constraints?: string[];
    background?: string;
  }) => {
    const sections: string[] = [];

    sections.push(`## Task\n${args.task_description}`);

    if (args.relevant_files && args.relevant_files.length > 0) {
      sections.push(
        `## Relevant Files\n${args.relevant_files.map((f) => `- ${f}`).join("\n")}`
      );
    }

    if (args.constraints && args.constraints.length > 0) {
      sections.push(
        `## Constraints\n${args.constraints.map((c) => `- ${c}`).join("\n")}`
      );
    }

    if (args.background) {
      sections.push(`## Background\n${args.background}`);
    }

    return {
      textResultForLlm: sections.join("\n\n"),
      resultType: "success" as const,
    };
  },
});

/**
 * Tool: check_conventions
 *
 * Scans the project for convention files (CONVENTIONS.md, .editorconfig,
 * eslint configs, etc.) and returns a summary of project conventions
 * that agents should follow. Used by agents to ensure project conventions
 * awareness in its hooks system.
 */
export const checkConventions = defineTool("check_conventions", {
  description:
    "Scan the current project for coding convention files and return a summary " +
    "of conventions that should be followed. Checks for CONVENTIONS.md, " +
    ".github/copilot-instructions.md, AGENTS.md, and .editorconfig / eslint / prettier configs.",
  parameters: {
    type: "object",
    properties: {
      directory: {
        type: "string",
        description:
          "Directory to scan (defaults to cwd)",
      },
    },
  },
  handler: (args: { directory?: string }) => {
    const dir = args.directory || process.cwd();
    const conventions: string[] = [];

    const conventionFiles = [
      "CONVENTIONS.md",
      ".github/copilot-instructions.md",
      "AGENTS.md",
      ".editorconfig",
      ".eslintrc",
      ".eslintrc.json",
      ".eslintrc.js",
      ".prettierrc",
      ".prettierrc.json",
      "biome.json",
      "deno.json",
    ];

    for (const file of conventionFiles) {
      const filePath = path.join(dir, file);
      if (existsSync(filePath)) {
        try {
          const stat = statSync(filePath);
          if (stat.size < 10_000) {
            const content = readFileSync(filePath, "utf-8");
            conventions.push(`### ${file}\n\`\`\`\n${content}\n\`\`\``);
          } else {
            conventions.push(
              `### ${file}\n(File exists but is too large to include — ${stat.size} bytes)`
            );
          }
        } catch {
          conventions.push(`### ${file}\n(File exists but could not be read)`);
        }
      }
    }

    // Check for package.json scripts as conventions
    const pkgPath = path.join(dir, "package.json");
    if (existsSync(pkgPath)) {
      try {
        const pkg = JSON.parse(readFileSync(pkgPath, "utf-8"));
        if (pkg.scripts) {
          const scripts = Object.entries(pkg.scripts)
            .map(([k, v]) => `  ${k}: ${v}`)
            .join("\n");
          conventions.push(`### package.json scripts\n\`\`\`\n${scripts}\n\`\`\``);
        }
      } catch {
        // ignore parse errors
      }
    }

    if (conventions.length === 0) {
      return {
        textResultForLlm:
          "No convention files found in the project. Follow standard best practices for the detected language/framework.",
        resultType: "success" as const,
      };
    }

    return {
      textResultForLlm: `# Project Conventions\n\n${conventions.join("\n\n")}`,
      resultType: "success" as const,
    };
  },
});

/**
 * Tool: project_overview
 *
 * Provides a quick structural overview of the project — top-level dirs,
 * key config files, detected language/framework. Helps agents orient
 * themselves quickly without exhaustive file reads.
 */
export const projectOverview = defineTool("project_overview", {
  description:
    "Get a quick structural overview of the project: top-level directories, " +
    "key config files, detected language/framework, and repository info.",
  parameters: {
    type: "object",
    properties: {
      directory: {
        type: "string",
        description: "Directory to scan (defaults to cwd)",
      },
    },
  },
  handler: (args: { directory?: string }) => {
    const dir = args.directory || process.cwd();
    const sections: string[] = [];

    // Top-level entries
    try {
      const entries = readdirSync(dir, { withFileTypes: true });
      const dirs = entries
        .filter((e) => e.isDirectory() && !e.name.startsWith("."))
        .map((e) => `  ${e.name}/`)
        .sort();
      const files = entries
        .filter((e) => e.isFile())
        .map((e) => `  ${e.name}`)
        .sort();

      sections.push(`## Structure\n### Directories\n${dirs.join("\n")}`);
      sections.push(`### Top-level Files\n${files.join("\n")}`);
    } catch {
      sections.push("## Structure\nCould not read directory.");
    }

    // Detect language/framework
    const indicators: string[] = [];
    const check = (file: string, label: string) => {
      if (existsSync(path.join(dir, file))) indicators.push(label);
    };

    check("package.json", "Node.js/JavaScript");
    check("tsconfig.json", "TypeScript");
    check("bun.lock", "Bun");
    check("yarn.lock", "Yarn");
    check("pnpm-lock.yaml", "pnpm");
    check("Cargo.toml", "Rust");
    check("go.mod", "Go");
    check("pyproject.toml", "Python");
    check("requirements.txt", "Python");
    check("Gemfile", "Ruby");
    check("build.gradle", "Java/Kotlin (Gradle)");
    check("pom.xml", "Java (Maven)");
    check(".swift", "Swift");
    check("next.config.js", "Next.js");
    check("next.config.ts", "Next.js");
    check("nuxt.config.ts", "Nuxt");
    check("vite.config.ts", "Vite");
    check("angular.json", "Angular");

    if (indicators.length > 0) {
      sections.push(`## Detected Stack\n${indicators.map((i) => `- ${i}`).join("\n")}`);
    }

    return {
      textResultForLlm: sections.join("\n\n"),
      resultType: "success" as const,
    };
  },
});

/**
 * Returns all custom tools for the CLI integration.
 */
export function getAnvilTools() {
  return [enforceChecklist, updateTodo, summarizeContext, checkConventions, projectOverview];
}
