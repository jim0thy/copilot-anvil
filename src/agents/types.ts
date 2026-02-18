/**
 * Agent definition types for the orchestration system.
 *
 * Agents are defined in markdown files with YAML frontmatter, following
 * the vscode-agents convention. This module provides types and parsing
 * utilities to load agents from both global (~/.config/anvil/agents/)
 * and project-local (.agents/) directories.
 */

import type { ReasoningEffort } from "../utils/config.js";

/**
 * Complexity level for agent selection.
 * Used by the engineering manager to pick the right agent based on task scope.
 */
export type AgentTier = "junior" | "mid" | "senior" | "specialist";

/**
 * Domain specialization for routing tasks.
 */
export type AgentDomain = 
  | "frontend" 
  | "backend" 
  | "fullstack" 
  | "data" 
  | "design" 
  | "devops" 
  | "prompt" 
  | "review" 
  | "planning" 
  | "orchestration"
  | "clarification"
  | "general";

/**
 * Frontmatter schema for agent markdown files.
 */
export interface AgentFrontmatter {
  name: string;
  description: string;
  model?: string;
  reasoningEffort?: ReasoningEffort;
  tools?: string[];
  tier?: AgentTier;
  domain?: AgentDomain;
  escalatesTo?: string;  // Name of the agent to escalate to if struggling
  escalatesFrom?: string; // Name of the agent this can receive escalations from
}

/**
 * Full agent definition including parsed markdown content.
 */
export interface AgentDefinition {
  /** Unique identifier (derived from filename or frontmatter.name) */
  id: string;
  
  /** Display name */
  name: string;
  
  /** Short description for UI */
  description: string;
  
  /** Model to use (e.g., "claude-sonnet-4.6", "gemini-3-pro") */
  model: string;

  /** Reasoning effort level (maps to Copilot variant: max → xhigh) */
  reasoningEffort?: ReasoningEffort;

  /** Tools available to this agent */
  tools: string[];
  
  /** Complexity tier for task routing */
  tier: AgentTier;
  
  /** Domain specialization */
  domain: AgentDomain;
  
  /** Agent to escalate to when task proves too complex */
  escalatesTo?: string;
  
  /** Full system prompt (markdown body without frontmatter) */
  systemPrompt: string;
  
  /** Source path for debugging */
  sourcePath: string;
  
  /** Priority for merging (project > global > builtin) */
  priority: "builtin" | "global" | "project";
}

/**
 * Orchestration mode configuration.
 */
export type OrchestrationMode = "direct" | "orchestrated";

/**
 * Agent execution context passed to agents when invoked.
 */
export interface AgentContext {
  /** Current working directory */
  cwd: string;
  
  /** Available agents for delegation (for engineering manager) */
  availableAgents: AgentDefinition[];
  
  /** Current orchestration mode */
  mode: OrchestrationMode;
  
  /** Callback for the agent to invoke subagents */
  invokeAgent?: (agentId: string, prompt: string) => Promise<string>;
}

/**
 * Result of an agent execution.
 */
export interface AgentResult {
  success: boolean;
  output: string;
  error?: string;
  escalatedTo?: string;  // If the agent escalated to another
  filesModified?: string[];
}

/**
 * Execution plan phase for parallel task execution.
 */
export interface ExecutionPhase {
  name: string;
  tasks: ExecutionTask[];
  dependsOn?: string[];  // Names of phases this depends on
}

/**
 * A single task within an execution phase.
 */
export interface ExecutionTask {
  id: string;
  description: string;
  agentId: string;
  files: string[];
  status: "pending" | "running" | "completed" | "failed" | "escalated";
  result?: AgentResult;
}

/**
 * Full execution plan created by the Strategist agent.
 */
export interface ExecutionPlan {
  summary: string;
  phases: ExecutionPhase[];
  edgeCases: string[];
  openQuestions: string[];
}
