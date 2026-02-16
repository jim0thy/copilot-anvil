/**
 * Agent loader that discovers and merges agents from multiple sources.
 * 
 * Loading priority (later overrides earlier):
 * 1. Built-in agents (hardcoded defaults)
 * 2. Global agents (~/.config/anvil/agents/*.agent.md)
 * 3. Project agents (./.agents/*.agent.md)
 * 
 * This allows users to customize agents globally or per-project while
 * having sensible defaults that work out of the box.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import type { AgentDefinition } from "./types.js";
import { parseAgentFile } from "./parser.js";
import { getBuiltinAgents } from "./builtin.js";

const GLOBAL_AGENTS_DIR = path.join(os.homedir(), ".config", "anvil", "agents");
const PROJECT_AGENTS_DIR = ".agents";
const AGENT_FILE_PATTERN = /\.agent\.md$/i;

/**
 * Load all agent files from a directory.
 */
async function loadAgentsFromDirectory(
  dir: string,
  priority: AgentDefinition["priority"]
): Promise<AgentDefinition[]> {
  const agents: AgentDefinition[] = [];
  
  if (!fs.existsSync(dir)) {
    return agents;
  }
  
  const files = fs.readdirSync(dir);
  
  for (const file of files) {
    if (!AGENT_FILE_PATTERN.test(file)) continue;
    
    const filePath = path.join(dir, file);
    const stat = fs.statSync(filePath);
    
    if (!stat.isFile()) continue;
    
    try {
      const content = fs.readFileSync(filePath, "utf-8");
      const agent = parseAgentFile(content, filePath, priority);
      
      if (agent) {
        agents.push(agent);
      }
    } catch (error) {
      console.warn(`Failed to load agent from ${filePath}:`, error);
    }
  }
  
  return agents;
}

/**
 * Merge agents, with later arrays taking priority over earlier ones.
 * Agents with the same ID from higher-priority sources replace lower ones.
 */
function mergeAgents(...agentArrays: AgentDefinition[][]): AgentDefinition[] {
  const agentMap = new Map<string, AgentDefinition>();
  
  for (const agents of agentArrays) {
    for (const agent of agents) {
      agentMap.set(agent.id, agent);
    }
  }
  
  return Array.from(agentMap.values());
}

/**
 * Main loader class for agent definitions.
 */
export class AgentLoader {
  private agents: AgentDefinition[] = [];
  private projectDir: string;
  private loaded = false;
  
  constructor(projectDir: string = process.cwd()) {
    this.projectDir = projectDir;
  }
  
  /**
   * Load all agents from builtin, global, and project sources.
   */
  async load(): Promise<void> {
    // 1. Built-in agents
    const builtinAgents = getBuiltinAgents();
    
    // 2. Global agents
    const globalAgents = await loadAgentsFromDirectory(GLOBAL_AGENTS_DIR, "global");
    
    // 3. Project agents
    const projectAgentsDir = path.join(this.projectDir, PROJECT_AGENTS_DIR);
    const projectAgents = await loadAgentsFromDirectory(projectAgentsDir, "project");
    
    // Merge with priority (later overrides earlier)
    this.agents = mergeAgents(builtinAgents, globalAgents, projectAgents);
    this.loaded = true;
  }
  
  /**
   * Get all loaded agents.
   */
  getAgents(): AgentDefinition[] {
    if (!this.loaded) {
      throw new Error("Agents not loaded. Call load() first.");
    }
    return [...this.agents];
  }
  
  /**
   * Get an agent by ID.
   */
  getAgent(id: string): AgentDefinition | undefined {
    return this.agents.find(a => a.id === id);
  }
  
  /**
   * Get agents by domain.
   */
  getAgentsByDomain(domain: AgentDefinition["domain"]): AgentDefinition[] {
    return this.agents.filter(a => a.domain === domain);
  }
  
  /**
   * Get agents by tier.
   */
  getAgentsByTier(tier: AgentDefinition["tier"]): AgentDefinition[] {
    return this.agents.filter(a => a.tier === tier);
  }
  
  /**
   * Get the tech lead agent (coordinates work delegation).
   */
  getTechLead(): AgentDefinition | undefined {
    return this.agents.find(a => a.domain === "orchestration");
  }
  
  /**
   * Get the intake agent (first point of contact).
   */
  getIntake(): AgentDefinition | undefined {
    return this.agents.find(a => a.domain === "clarification");
  }
  
  /**
   * Get the strategist agent (implementation planner).
   */
  getStrategist(): AgentDefinition | undefined {
    return this.agents.find(a => a.domain === "planning");
  }
  
  /**
   * Get the reviewer agent.
   */
  getReviewer(): AgentDefinition | undefined {
    return this.agents.find(a => a.domain === "review");
  }
  
  /**
   * Get escalation path for an agent.
   * Returns the sequence of agents this one can escalate through.
   */
  getEscalationPath(agentId: string): AgentDefinition[] {
    const path: AgentDefinition[] = [];
    let current = this.getAgent(agentId);
    
    while (current?.escalatesTo) {
      const next = this.agents.find(
        a => a.name.toLowerCase() === current!.escalatesTo!.toLowerCase() ||
             a.id === current!.escalatesTo
      );
      if (!next || path.includes(next)) break; // Prevent cycles
      path.push(next);
      current = next;
    }
    
    return path;
  }
  
  /**
   * Select the best agent for a task based on domain and estimated complexity.
   */
  selectAgent(
    domain: AgentDefinition["domain"],
    complexity: "simple" | "moderate" | "complex"
  ): AgentDefinition | undefined {
    const domainAgents = this.getAgentsByDomain(domain);
    
    if (domainAgents.length === 0) {
      // Fallback to general agents
      const generalAgents = this.getAgentsByDomain("general");
      if (generalAgents.length === 0) return undefined;
      return generalAgents[0];
    }
    
    // Map complexity to tier
    const tierMap: Record<string, AgentDefinition["tier"]> = {
      simple: "junior",
      moderate: "mid",
      complex: "senior",
    };
    const targetTier = tierMap[complexity];
    
    // Try to find exact tier match
    const exactMatch = domainAgents.find(a => a.tier === targetTier);
    if (exactMatch) return exactMatch;
    
    // Find closest tier (prefer higher tier if exact not available)
    const tierOrder: AgentDefinition["tier"][] = ["junior", "mid", "senior", "specialist"];
    const targetIndex = tierOrder.indexOf(targetTier);
    
    // First try higher tiers
    for (let i = targetIndex + 1; i < tierOrder.length; i++) {
      const match = domainAgents.find(a => a.tier === tierOrder[i]);
      if (match) return match;
    }
    
    // Then try lower tiers
    for (let i = targetIndex - 1; i >= 0; i--) {
      const match = domainAgents.find(a => a.tier === tierOrder[i]);
      if (match) return match;
    }
    
    // Return first available
    return domainAgents[0];
  }
  
  /**
   * Reload agents (useful after config changes).
   */
  async reload(): Promise<void> {
    this.agents = [];
    this.loaded = false;
    await this.load();
  }
  
  /**
   * Get paths being searched.
   */
  getSearchPaths(): string[] {
    return [
      "(builtin)",
      GLOBAL_AGENTS_DIR,
      path.join(this.projectDir, PROJECT_AGENTS_DIR),
    ];
  }
}

/**
 * Create a singleton loader for the current project.
 */
let defaultLoader: AgentLoader | null = null;

export function getAgentLoader(projectDir?: string): AgentLoader {
  if (!defaultLoader || (projectDir && projectDir !== process.cwd())) {
    defaultLoader = new AgentLoader(projectDir);
  }
  return defaultLoader;
}
