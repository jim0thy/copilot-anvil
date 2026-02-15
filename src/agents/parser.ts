/**
 * Parser for agent markdown files with YAML frontmatter.
 * 
 * Agent files follow the pattern:
 * ---
 * name: Agent Name
 * description: Short description
 * model: claude-sonnet-4.5
 * tools: ['vscode', 'edit', 'search']
 * tier: mid
 * domain: frontend
 * escalatesTo: Senior Frontend Developer
 * ---
 * 
 * System prompt markdown content here...
 */

import type { AgentDefinition, AgentFrontmatter, AgentTier, AgentDomain } from "./types.js";

const FRONTMATTER_REGEX = /^---\s*\n([\s\S]*?)\n---\s*\n([\s\S]*)$/;

/**
 * Parse YAML-like frontmatter (simple key: value pairs and arrays).
 * We use a simple parser instead of a full YAML library to minimize dependencies.
 */
function parseFrontmatter(yaml: string): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  const lines = yaml.split("\n");
  
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    
    const colonIndex = trimmed.indexOf(":");
    if (colonIndex === -1) continue;
    
    const key = trimmed.slice(0, colonIndex).trim();
    let value: unknown = trimmed.slice(colonIndex + 1).trim();
    
    // Handle arrays like ['a', 'b', 'c'] or ["a", "b", "c"]
    if (typeof value === "string" && value.startsWith("[") && value.endsWith("]")) {
      const arrayContent = value.slice(1, -1);
      value = arrayContent
        .split(",")
        .map(item => item.trim().replace(/^['"]|['"]$/g, ""))
        .filter(Boolean);
    }
    // Handle quoted strings
    else if (typeof value === "string" && 
             ((value.startsWith('"') && value.endsWith('"')) ||
              (value.startsWith("'") && value.endsWith("'")))) {
      value = value.slice(1, -1);
    }
    
    result[key] = value;
  }
  
  return result;
}

/**
 * Infer tier from agent name if not specified.
 */
function inferTier(name: string): AgentTier {
  const lowerName = name.toLowerCase();
  if (lowerName.includes("senior") || lowerName.includes("sr-") || lowerName.includes("sr ")) {
    return "senior";
  }
  if (lowerName.includes("junior") || lowerName.includes("jr-") || lowerName.includes("jr ")) {
    return "junior";
  }
  if (lowerName.includes("orchestrator") || lowerName.includes("planner") || 
      lowerName.includes("clarifier") || lowerName.includes("reviewer")) {
    return "specialist";
  }
  return "mid";
}

/**
 * Infer domain from agent name if not specified.
 */
function inferDomain(name: string): AgentDomain {
  const lowerName = name.toLowerCase();
  if (lowerName.includes("frontend")) return "frontend";
  if (lowerName.includes("backend")) return "backend";
  if (lowerName.includes("fullstack")) return "fullstack";
  if (lowerName.includes("data")) return "data";
  if (lowerName.includes("design")) return "design";
  if (lowerName.includes("devops")) return "devops";
  if (lowerName.includes("prompt")) return "prompt";
  if (lowerName.includes("review")) return "review";
  if (lowerName.includes("plan")) return "planning";
  if (lowerName.includes("orchestrat")) return "orchestration";
  if (lowerName.includes("clarif")) return "clarification";
  return "general";
}

/**
 * Generate a stable ID from the agent name.
 */
function nameToId(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

/**
 * Parse an agent markdown file content into an AgentDefinition.
 */
export function parseAgentFile(
  content: string,
  sourcePath: string,
  priority: AgentDefinition["priority"] = "project"
): AgentDefinition | null {
  const match = content.match(FRONTMATTER_REGEX);
  
  if (!match) {
    // No frontmatter - treat entire content as system prompt with defaults
    const filename = sourcePath.split("/").pop()?.replace(/\.agent\.md$/i, "") ?? "unknown";
    return {
      id: nameToId(filename),
      name: filename,
      description: "Agent loaded from " + sourcePath,
      model: "claude-sonnet-4.5",
      tools: [],
      tier: inferTier(filename),
      domain: inferDomain(filename),
      systemPrompt: content.trim(),
      sourcePath,
      priority,
    };
  }
  
  const [, frontmatterYaml, body] = match;
  const frontmatter = parseFrontmatter(frontmatterYaml) as Partial<AgentFrontmatter>;
  
  if (!frontmatter.name) {
    console.warn(`Agent file missing name: ${sourcePath}`);
    return null;
  }
  
  return {
    id: nameToId(frontmatter.name),
    name: frontmatter.name,
    description: frontmatter.description ?? "",
    model: normalizeModel(frontmatter.model),
    tools: Array.isArray(frontmatter.tools) ? frontmatter.tools : [],
    tier: frontmatter.tier ?? inferTier(frontmatter.name),
    domain: frontmatter.domain ?? inferDomain(frontmatter.name),
    escalatesTo: frontmatter.escalatesTo,
    systemPrompt: body.trim(),
    sourcePath,
    priority,
  };
}

/**
 * Normalize model names from various formats to our standard format.
 */
function normalizeModel(model?: string): string {
  if (!model) return "claude-sonnet-4.5";
  
  const lowerModel = model.toLowerCase();
  
  // Map common vscode-agents model names to our model IDs
  if (lowerModel.includes("sonnet 4.5") || lowerModel.includes("sonnet-4.5")) {
    return "claude-sonnet-4.5";
  }
  if (lowerModel.includes("opus 4.6") || lowerModel.includes("opus-4.6")) {
    return "claude-opus-4.5"; // Map to closest available
  }
  if (lowerModel.includes("gemini 3 flash") || lowerModel.includes("gemini-3-flash")) {
    return "claude-haiku-4.5"; // Map flash to haiku (both are fast/cheap)
  }
  if (lowerModel.includes("gemini 3 pro") || lowerModel.includes("gemini-3-pro")) {
    return "gemini-3-pro-preview";
  }
  if (lowerModel.includes("gpt-5.2-codex")) {
    return "gpt-5.2-codex";
  }
  if (lowerModel.includes("gpt-5.2")) {
    return "gpt-5.2";
  }
  
  // Return as-is if already normalized or unknown
  return model;
}

/**
 * Validate that an agent definition has required fields.
 */
export function validateAgent(agent: AgentDefinition): string[] {
  const errors: string[] = [];
  
  if (!agent.id) errors.push("Missing id");
  if (!agent.name) errors.push("Missing name");
  if (!agent.systemPrompt) errors.push("Missing system prompt");
  
  return errors;
}
