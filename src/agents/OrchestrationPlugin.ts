/**
 * Orchestration Plugin for the Harness.
 * 
 * This plugin adds orchestrated mode support where prompts are routed through
 * the Intake → Tech Lead → Specialist agents pipeline instead of going
 * directly to the default Copilot agent.
 * 
 * The plugin:
 * - Manages orchestration mode state (direct vs orchestrated)
 * - Provides commands to toggle mode (/team, /direct)
 * - Intercepts prompts in orchestrated mode and routes appropriately
 * - Emits events for agent execution
 */

import type { HarnessPlugin, PluginContext } from "../harness/plugins.js";
import type { HarnessEvent } from "../harness/events.js";
import { AgentLoader } from "./loader.js";
import type { AgentDefinition, OrchestrationMode } from "./types.js";

const ORCHESTRATION_STATE_KEY = "orchestration";

interface OrchestrationState {
  mode: OrchestrationMode;
  availableAgents: AgentDefinition[];
  currentAgent: string | null;
  executionHistory: Array<{
    agentId: string;
    prompt: string;
    result: "success" | "failed" | "escalated";
    timestamp: Date;
  }>;
}

const INITIAL_ORCHESTRATION_STATE: OrchestrationState = {
  mode: "direct",
  availableAgents: [],
  currentAgent: null,
  executionHistory: [],
};

/**
 * Create the orchestration plugin.
 */
export function createOrchestrationPlugin(): HarnessPlugin {
  let loader: AgentLoader | null = null;
  let ctx: PluginContext | null = null;
  
  return {
    name: "orchestration",
    
    register(pluginContext) {
      ctx = pluginContext;
      
      // Initialize state slice
      ctx.state.register(ORCHESTRATION_STATE_KEY, INITIAL_ORCHESTRATION_STATE);
      
      // Load agents
      loader = new AgentLoader();
      loader.load().then(() => {
        const agents = loader!.getAgents();
        ctx!.state.update<OrchestrationState>(ORCHESTRATION_STATE_KEY, {
          availableAgents: agents,
        });
        
        // Emit agents.loaded event so harness can update its state
        // Top-level agents are specialists that users can directly select:
        // - Intake: first point of contact for ambiguous requests
        // - Tech Lead: coordinates work delegation
        // - Strategist: creates implementation plans
        // - Reviewer: code review and security checks
        const topLevelAgents = agents
          .filter(a => a.tier === "specialist" && 
            (a.domain === "clarification" || a.domain === "orchestration" || a.domain === "planning" || a.domain === "review"))
          .map(a => ({ id: a.id, name: a.name, description: a.description, model: a.model, tier: a.tier, domain: a.domain }));
        
        ctx!.emit({
          type: "agents.loaded",
          agents: topLevelAgents,
        } as any);
        
        // Set Intake as the default agent (always entry point in team mode)
        const intakeAgent = agents.find(a => a.domain === "clarification");
        if (intakeAgent) {
          // Switch to orchestrated mode
          ctx!.state.update<OrchestrationState>(ORCHESTRATION_STATE_KEY, { mode: "orchestrated" });

          ctx!.emit({
            type: "log",
            runId: null,
            level: "info",
            message: `🎯 Team mode enabled — using ${intakeAgent.name} as entry point`,
            createdAt: new Date(),
          });

          // Emit mode change event
          ctx!.emit({
            type: "orchestration.mode.changed",
            mode: "orchestrated",
          } as any);

          // Emit agent.changed event to switch to intake
          ctx!.emit({
            type: "agent.changed",
            agentId: intakeAgent.id,
            agentName: intakeAgent.name,
          } as any);
        }
        
        ctx!.emit({
          type: "log",
          runId: null,
          level: "info",
          message: `Loaded ${agents.length} agents (${topLevelAgents.length} top-level)`,
          createdAt: new Date(),
        });
      }).catch((err) => {
        ctx!.emit({
          type: "log",
          runId: null,
          level: "error",
          message: `Failed to load agents: ${err instanceof Error ? err.message : String(err)}`,
          createdAt: new Date(),
        });
      });
      
      // Register commands
      ctx.commands.register("team", () => {
        setMode("orchestrated");
      });
      
      ctx.commands.register("direct", () => {
        setMode("direct");
      });
      
      ctx.commands.register("agents", () => {
        listAgents();
      });
      
      ctx.commands.register("reload-agents", () => {
        reloadAgents();
      });
      
      function setMode(mode: OrchestrationMode) {
        ctx!.state.update<OrchestrationState>(ORCHESTRATION_STATE_KEY, { mode });
        ctx!.emit({
          type: "log",
          runId: null,
          level: "info",
          message: mode === "orchestrated" 
            ? "🎯 Team mode enabled — prompts will be routed through Intake → Tech Lead"
            : "⚡ Direct mode enabled — prompts go directly to Copilot",
          createdAt: new Date(),
        });
      }
      
      function listAgents() {
        if (!loader) return;
        
        const agents = loader.getAgents();
        const byTier = new Map<string, AgentDefinition[]>();
        
        for (const agent of agents) {
          const tier = agent.tier;
          if (!byTier.has(tier)) byTier.set(tier, []);
          byTier.get(tier)!.push(agent);
        }
        
        const lines: string[] = ["📋 Available Agents:", ""];
        
        const tierOrder = ["specialist", "senior", "mid", "junior"];
        for (const tier of tierOrder) {
          const tierAgents = byTier.get(tier);
          if (!tierAgents || tierAgents.length === 0) continue;
          
          const emoji = {
            specialist: "🔧",
            senior: "🏆",
            mid: "👨‍💻",
            junior: "⚡",
          }[tier] ?? "•";
          
          lines.push(`${emoji} ${tier.charAt(0).toUpperCase() + tier.slice(1)}:`);
          for (const agent of tierAgents) {
            lines.push(`   • ${agent.name} (${agent.domain}) — ${agent.description}`);
          }
          lines.push("");
        }
        
        ctx!.emit({
          type: "log",
          runId: null,
          level: "info",
          message: lines.join("\n"),
          createdAt: new Date(),
        });
      }
      
      function reloadAgents() {
        if (!loader) return;
        
        loader.reload().then(() => {
          const agents = loader!.getAgents();
          ctx!.state.update<OrchestrationState>(ORCHESTRATION_STATE_KEY, {
            availableAgents: agents,
          });
          
          ctx!.emit({
            type: "log",
            runId: null,
            level: "info",
            message: `Reloaded ${agents.length} agents`,
            createdAt: new Date(),
          });
        });
      }
    },
    
    onEvent(event: HarnessEvent) {
      // Track agent execution in history
      if (event.type === "subagent.completed" || event.type === "subagent.failed") {
        const state = ctx?.state.get<OrchestrationState>(ORCHESTRATION_STATE_KEY);
        if (!state) return;
        
        const history = [...state.executionHistory];
        history.push({
          agentId: event.agentName,
          prompt: "", // We don't have the prompt in these events
          result: event.type === "subagent.completed" ? "success" : "failed",
          timestamp: new Date(),
        });
        
        // Keep only last 100 entries
        if (history.length > 100) {
          history.splice(0, history.length - 100);
        }
        
        ctx?.state.update<OrchestrationState>(ORCHESTRATION_STATE_KEY, {
          executionHistory: history,
          currentAgent: null,
        });
      }
      
      if (event.type === "subagent.started") {
        ctx?.state.update<OrchestrationState>(ORCHESTRATION_STATE_KEY, {
          currentAgent: event.agentName,
        });
      }
    },
  };
}

/**
 * Get the current orchestration state.
 */
export function getOrchestrationState(ctx: PluginContext): OrchestrationState {
  return ctx.state.get<OrchestrationState>(ORCHESTRATION_STATE_KEY) ?? INITIAL_ORCHESTRATION_STATE;
}

/**
 * Check if orchestrated mode is active.
 */
export function isOrchestratedMode(ctx: PluginContext): boolean {
  const state = getOrchestrationState(ctx);
  return state.mode === "orchestrated";
}

/**
 * Build the system prompt injection for orchestrated mode.
 * This is added to the beginning of prompts when in orchestrated mode.
 */
export function buildOrchestrationContext(
  ctx: PluginContext,
  loader: AgentLoader
): string {
  const state = getOrchestrationState(ctx);
  if (state.mode !== "orchestrated") return "";
  
  const techLead = loader.getTechLead();
  if (!techLead) return "";
  
  const agents = loader.getAgents();
  const agentList = agents
    .filter(a => a.domain !== "orchestration" && a.domain !== "clarification")
    .map(a => `- **${a.name}** (${a.tier}/${a.domain}): ${a.description}`)
    .join("\n");
  
  return `
<orchestration_mode>
You are operating in TEAM MODE with access to specialized agents.

## Your Role
You are the Tech Lead. Break down complex requests into tasks and delegate to specialist agents.
Do NOT implement anything yourself - coordinate work through subagents.

## Available Agents
${agentList}

## Execution Flow
1. For ambiguous requests, clarify first
2. Create an execution plan with phases
3. Delegate tasks to appropriate agents (start with junior/mid level)
4. Escalate if agents struggle
5. Review before finalizing

## Agent Selection
- Simple tasks (1-2 files): Junior Developer
- Standard features: Frontend/Backend/Fullstack Developer  
- Complex/multi-file: Senior Developers
- Specialized: Designer, Data Engineer, DevOps, etc.

Use the task tool with appropriate agent_type to delegate work.
</orchestration_mode>
`;
}
