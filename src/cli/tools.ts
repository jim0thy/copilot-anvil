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
import {
  existsSync,
  readFileSync,
  readdirSync,
  statSync,
} from "node:fs";
import { spawnSync } from "node:child_process";
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
 * Tool: grep_search
 *
 * Search file contents using ripgrep. Returns matching lines with
 * file paths and line numbers. Used by agents for codebase exploration.
 */
export const grepSearch = defineTool("grep_search", {
  description:
    "Search file contents using ripgrep. Returns matching lines with file paths and line numbers. " +
    "Use for finding functions, patterns, keywords, or any text in the codebase.",
  parameters: {
    type: "object",
    properties: {
      pattern: {
        type: "string",
        description: "Regex or literal string to search for",
      },
      path: {
        type: "string",
        description:
          "Directory or file to search in (default: current working directory)",
      },
      glob: {
        type: "string",
        description: 'File glob filter, e.g. "*.ts", "*.{ts,tsx}"',
      },
      context_lines: {
        type: "number",
        description: "Lines of context before/after each match (default: 2)",
      },
      case_sensitive: {
        type: "boolean",
        description: "Case-sensitive search (default: false)",
      },
    },
    required: ["pattern"],
  },
  handler: (args: {
    pattern: string;
    path?: string;
    glob?: string;
    context_lines?: number;
    case_sensitive?: boolean;
  }) => {
    const searchPath = args.path || process.cwd();
    const contextLines = args.context_lines ?? 2;
    const caseSensitive = args.case_sensitive ?? false;

    const rgArgs = ["--json", `--context=${contextLines}`];
    if (!caseSensitive) rgArgs.push("--ignore-case");
    if (args.glob) rgArgs.push("--glob", args.glob);
    rgArgs.push(args.pattern, searchPath);

    const result = spawnSync("rg", rgArgs, {
      encoding: "utf-8",
      maxBuffer: 5 * 1024 * 1024,
    });

    if (result.error) {
      return {
        textResultForLlm: `Error running ripgrep: ${result.error.message}. Is 'rg' installed?`,
        resultType: "failure" as const,
      };
    }

    if (!result.stdout || result.stdout.trim() === "") {
      return {
        textResultForLlm: `No matches found for pattern: ${args.pattern}`,
        resultType: "success" as const,
      };
    }

    interface RgMatch {
      file: string;
      line: number;
      content: string;
      type: "match" | "context";
    }

    const matches: RgMatch[] = [];
    for (const line of result.stdout.split("\n")) {
      if (!line.trim()) continue;
      try {
        const entry = JSON.parse(line) as {
          type: string;
          data: {
            path?: { text: string };
            line_number?: number;
            lines?: { text: string };
          };
        };
        if (entry.type === "match" && entry.data.path && entry.data.line_number) {
          matches.push({
            type: "match",
            file: entry.data.path.text,
            line: entry.data.line_number,
            content: (entry.data.lines?.text || "").trimEnd(),
          });
        }
      } catch {
        // skip malformed JSON lines
      }
    }

    if (matches.length === 0) {
      return {
        textResultForLlm: `No matches found for pattern: ${args.pattern}`,
        resultType: "success" as const,
      };
    }

    const formatted = matches
      .map((m) => `${m.file}:${m.line}: ${m.content}`)
      .join("\n");

    return {
      textResultForLlm: `Found ${matches.length} match(es) for "${args.pattern}":\n\n${formatted}`,
      resultType: "success" as const,
    };
  },
});

/**
 * Tool: glob_find
 *
 * Find files matching a glob pattern. Returns absolute paths sorted
 * by modification time. Used by agents to discover files by name pattern.
 */
export const globFind = defineTool("glob_find", {
  description:
    "Find files matching a glob pattern. Returns absolute paths sorted by modification time. " +
    'Use for discovering files by name pattern, e.g. "src/**/*.ts", "**/*.test.ts".',
  parameters: {
    type: "object",
    properties: {
      pattern: {
        type: "string",
        description: 'Glob pattern, e.g. "src/**/*.ts", "**/*.test.ts"',
      },
      path: {
        type: "string",
        description: "Base directory to search from (default: cwd)",
      },
      exclude: {
        type: "array",
        items: { type: "string" },
        description: "Glob patterns to exclude from results",
      },
    },
    required: ["pattern"],
  },
  handler: (args: { pattern: string; path?: string; exclude?: string[] }) => {
    const basePath = args.path || process.cwd();

    const rgArgs = ["--files", "--glob", args.pattern];
    if (args.exclude) {
      for (const ex of args.exclude) {
        rgArgs.push("--glob", `!${ex}`);
      }
    }
    rgArgs.push(basePath);

    const result = spawnSync("rg", rgArgs, {
      encoding: "utf-8",
      maxBuffer: 5 * 1024 * 1024,
    });

    if (result.error) {
      return {
        textResultForLlm: `Error running ripgrep: ${result.error.message}. Is 'rg' installed?`,
        resultType: "failure" as const,
      };
    }

    const files = (result.stdout || "")
      .split("\n")
      .map((f) => f.trim())
      .filter(Boolean);

    if (files.length === 0) {
      return {
        textResultForLlm: `No files found matching pattern: ${args.pattern}`,
        resultType: "success" as const,
      };
    }

    // Sort by modification time (most recent first)
    const withMtime = files
      .map((f) => {
        try {
          return { file: f, mtime: statSync(f).mtimeMs };
        } catch {
          return { file: f, mtime: 0 };
        }
      })
      .sort((a, b) => b.mtime - a.mtime);

    const fileList = withMtime.map((e) => e.file).join("\n");

    return {
      textResultForLlm: `Found ${files.length} file(s) matching "${args.pattern}":\n\n${fileList}`,
      resultType: "success" as const,
    };
  },
});

/**
 * Tool: look_at
 *
 * Read a file with optional line range, or list a directory with stat info.
 * Better than raw read for large files — supports slicing by line range.
 */
export const lookAt = defineTool("look_at", {
  description:
    "Read a file with optional line range and line numbers, or list a directory with file metadata. " +
    "Better than reading an entire large file when you only need a section.",
  parameters: {
    type: "object",
    properties: {
      path: {
        type: "string",
        description: "Absolute or relative path to file or directory",
      },
      start_line: {
        type: "number",
        description: "First line to read, 1-indexed (optional, defaults to 1)",
      },
      end_line: {
        type: "number",
        description: "Last line to read (optional, defaults to end of file)",
      },
      show_line_numbers: {
        type: "boolean",
        description: "Prefix each line with its line number (default: true)",
      },
    },
    required: ["path"],
  },
  handler: (args: {
    path: string;
    start_line?: number;
    end_line?: number;
    show_line_numbers?: boolean;
  }) => {
    const targetPath = path.resolve(args.path);
    const showLineNumbers = args.show_line_numbers ?? true;

    if (!existsSync(targetPath)) {
      return {
        textResultForLlm: `Path does not exist: ${targetPath}`,
        resultType: "failure" as const,
      };
    }

    const stat = statSync(targetPath);

    if (stat.isDirectory()) {
      const entries = readdirSync(targetPath, { withFileTypes: true });
      const lines = entries
        .map((e) => {
          try {
            const entryPath = path.join(targetPath, e.name);
            const s = statSync(entryPath);
            const type = e.isDirectory() ? "dir " : "file";
            const size = e.isDirectory() ? "     -" : String(s.size).padStart(6);
            const mtime = new Date(s.mtimeMs).toISOString().slice(0, 10);
            return `${type}  ${size}  ${mtime}  ${e.name}${e.isDirectory() ? "/" : ""}`;
          } catch {
            return `????  ------  ----------  ${e.name}`;
          }
        })
        .sort();

      return {
        textResultForLlm: `Directory: ${targetPath}\n\ntype    size    modified    name\n${"─".repeat(50)}\n${lines.join("\n")}`,
        resultType: "success" as const,
      };
    }

    // File
    const content = readFileSync(targetPath, "utf-8");
    const allLines = content.split("\n");
    const totalLines = allLines.length;

    const startLine = Math.max(1, args.start_line ?? 1);
    const endLine = Math.min(totalLines, args.end_line ?? totalLines);

    if (startLine > totalLines) {
      return {
        textResultForLlm: `File has ${totalLines} lines but start_line=${startLine} is out of range.`,
        resultType: "failure" as const,
      };
    }

    const sliced = allLines.slice(startLine - 1, endLine);
    const formatted = showLineNumbers
      ? sliced.map((line, i) => `${String(startLine + i).padStart(6)}  ${line}`).join("\n")
      : sliced.join("\n");

    const rangeNote =
      startLine === 1 && endLine === totalLines
        ? `(${totalLines} lines total)`
        : `(lines ${startLine}-${endLine} of ${totalLines})`;

    return {
      textResultForLlm: `File: ${targetPath} ${rangeNote}\n\n${formatted}`,
      resultType: "success" as const,
    };
  },
});

/**
 * Returns all custom tools for the CLI integration.
 */
export function getAnvilTools() {
  return [
    enforceChecklist,
    updateTodo,
    summarizeContext,
    checkConventions,
    projectOverview,
    grepSearch,
    globFind,
    lookAt,
  ];
}
