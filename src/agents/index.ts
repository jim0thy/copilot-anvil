/**
 * Agent orchestration system.
 * 
 * This module provides:
 * - Agent definition types and parsing
 * - Agent loading from builtin, global, and project sources
 * - Orchestration plugin for the harness
 * 
 * @example
 * ```typescript
 * import { AgentLoader, createOrchestrationPlugin } from "./agents/index.js";
 * 
 * // Load agents
 * const loader = new AgentLoader();
 * await loader.load();
 * 
 * // Get available agents
 * const agents = loader.getAgents();
 * const techLead = loader.getTechLead();
 * 
 * // Use in harness
 * harness.use(createOrchestrationPlugin());
 * ```
 */

// Types
export type {
  AgentDefinition,
  AgentFrontmatter,
  AgentTier,
  AgentDomain,
  AgentContext,
  AgentResult,
  OrchestrationMode,
  ExecutionPlan,
  ExecutionPhase,
  ExecutionTask,
} from "./types.js";

// Parser
export { parseAgentFile, validateAgent } from "./parser.js";

// Loader
export { AgentLoader, getAgentLoader } from "./loader.js";

// Built-in agents
export { getBuiltinAgents } from "./builtin.js";

// Model configuration
export {
  loadModelConfig,
  saveModelConfig,
  ensureDefaultConfigExists,
  resolveAgentModel,
  getModelConfigPath,
  DEFAULT_AGENT_MODELS,
} from "./modelConfig.js";
export type { AgentModelConfig, AgentModelOverride } from "./modelConfig.js";

// Orchestration plugin
export {
  createOrchestrationPlugin,
  getOrchestrationState,
  isOrchestratedMode,
  buildOrchestrationContext,
} from "./OrchestrationPlugin.js";
