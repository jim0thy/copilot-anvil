/**
 * Command loader — discovers and parses slash commands from installed skills.
 *
 * Skills can ship commands as markdown files at:
 *   .agents/skills/<skill-name>/command/<command-name>.md
 *
 * Command files use YAML frontmatter for metadata and markdown body for the
 * workflow instructions that get injected into the prompt.
 */

import { readFileSync, readdirSync, existsSync, statSync } from "node:fs";
import { join, basename, resolve } from "node:path";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CommandDefinition {
  /** Command name (derived from filename, e.g. "opentui" from opentui.md) */
  name: string;
  /** Human-readable description from frontmatter */
  description: string;
  /** The skill this command belongs to */
  skillName: string;
  /** Raw markdown body (after frontmatter) */
  body: string;
  /** Absolute path to the command file */
  filePath: string;
  /** Absolute path to the parent skill directory */
  skillDir: string;
}

export interface ParsedCommand {
  frontmatter: Record<string, string>;
  body: string;
}

// ---------------------------------------------------------------------------
// Frontmatter parser (minimal, no dependencies)
// ---------------------------------------------------------------------------

function parseFrontmatter(content: string): ParsedCommand {
  const trimmed = content.trimStart();
  if (!trimmed.startsWith("---")) {
    return { frontmatter: {}, body: content };
  }

  const endIndex = trimmed.indexOf("---", 3);
  if (endIndex === -1) {
    return { frontmatter: {}, body: content };
  }

  const fmBlock = trimmed.slice(3, endIndex).trim();
  const body = trimmed.slice(endIndex + 3).trim();

  const frontmatter: Record<string, string> = {};
  for (const line of fmBlock.split("\n")) {
    const colonIndex = line.indexOf(":");
    if (colonIndex === -1) continue;
    const key = line.slice(0, colonIndex).trim();
    const value = line.slice(colonIndex + 1).trim();
    frontmatter[key] = value;
  }

  return { frontmatter, body };
}

// ---------------------------------------------------------------------------
// Skill content loader
// ---------------------------------------------------------------------------

function loadSkillContent(skillDir: string): string | null {
  const skillPath = join(skillDir, "SKILL.md");
  if (!existsSync(skillPath)) return null;
  try {
    return readFileSync(skillPath, "utf-8");
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Command discovery
// ---------------------------------------------------------------------------

const SKILLS_DIR = ".agents/skills";

function getSkillsRoot(): string {
  return resolve(process.cwd(), SKILLS_DIR);
}

/**
 * Scan all installed skills for command files and return definitions.
 */
export function discoverCommands(): CommandDefinition[] {
  const skillsRoot = getSkillsRoot();
  if (!existsSync(skillsRoot)) return [];

  const commands: CommandDefinition[] = [];

  let skillDirs: string[];
  try {
    skillDirs = readdirSync(skillsRoot);
  } catch {
    return [];
  }

  for (const skillName of skillDirs) {
    const skillDir = join(skillsRoot, skillName);
    if (!statSync(skillDir).isDirectory()) continue;

    const commandDir = join(skillDir, "command");
    if (!existsSync(commandDir) || !statSync(commandDir).isDirectory()) continue;

    let commandFiles: string[];
    try {
      commandFiles = readdirSync(commandDir).filter((f) => f.endsWith(".md"));
    } catch {
      continue;
    }

    for (const file of commandFiles) {
      const filePath = join(commandDir, file);
      try {
        const raw = readFileSync(filePath, "utf-8");
        const parsed = parseFrontmatter(raw);
        const name = basename(file, ".md");

        commands.push({
          name,
          description: parsed.frontmatter.description ?? "",
          skillName,
          body: parsed.body,
          filePath,
          skillDir,
        });
      } catch {
        // Skip malformed command files
      }
    }
  }

  return commands;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export class CommandRegistry {
  private commands: Map<string, CommandDefinition> = new Map();

  constructor() {
    this.reload();
  }

  /** Re-scan the skills directory for command files. */
  reload(): void {
    this.commands.clear();
    for (const cmd of discoverCommands()) {
      this.commands.set(cmd.name, cmd);
    }
  }

  /** Get a command by name. */
  get(name: string): CommandDefinition | undefined {
    return this.commands.get(name);
  }

  /** List all discovered commands. */
  list(): CommandDefinition[] {
    return Array.from(this.commands.values());
  }

  /** Check if a name corresponds to a registered command. */
  has(name: string): boolean {
    return this.commands.has(name);
  }

  /**
   * Build the enhanced prompt for a command invocation.
   *
   * Loads the command body, substitutes $ARGUMENTS, and optionally prepends
   * the associated skill's SKILL.md content.
   */
  buildPrompt(name: string, args: string): string | null {
    const cmd = this.commands.get(name);
    if (!cmd) return null;

    const body = cmd.body.replace(/\$ARGUMENTS/g, args);
    const skillContent = loadSkillContent(cmd.skillDir);

    const parts: string[] = [];

    parts.push(`# Command: /${name}`);
    parts.push("");

    if (skillContent) {
      parts.push("## Skill Reference");
      parts.push("");
      parts.push(skillContent);
      parts.push("");
    }

    parts.push("## Command Instructions");
    parts.push("");
    parts.push(body);

    return parts.join("\n");
  }
}

/**
 * Parse a user input string to detect slash command invocation.
 *
 * Returns `{ name, args }` if the input starts with `/<name>`,
 * or `null` if it doesn't look like a command.
 */
export function parseSlashCommand(
  input: string
): { name: string; args: string } | null {
  const trimmed = input.trim();
  if (!trimmed.startsWith("/")) return null;

  const match = trimmed.match(/^\/([a-zA-Z0-9_-]+)(?:\s+(.*))?$/s);
  if (!match) return null;

  return {
    name: match[1],
    args: (match[2] ?? "").trim(),
  };
}
