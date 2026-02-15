# Bug Fix: Agent Name Display and Subagent Tracking

## Issues Fixed

### Issue #1: Agent Name Shows "Assistant" Instead of Actual Agent Name

**Problem**: When using orchestration mode with agents (Clarifier, Orchestrator, etc.), the chat pane displayed "Assistant" instead of showing the actual agent name that was generating the response.

**Root Cause**: The `streamingAgentName` state field was:
1. Reset to `null` on every `run.started` event
2. Only updated from `assistant.delta` events if they included `agentDisplayName`
3. For top-level agents (not subagents), the SDK may not include `agentDisplayName` in every delta
4. The UI defaulted to "Assistant" when `streamingAgentName` was null

**Solution**: Modified the `run.started` event handler in the reducer to:
- Look up the current active agent from `state.currentAgentId`
- Set `streamingAgentName` to the agent's display name at the start of each run
- This ensures the correct agent name is shown immediately when streaming begins
- Subagents can still override this via `assistant.delta` events with `agentDisplayName`

**Files Modified**:
- `src/harness/reducer.ts` - Enhanced `run.started` case to set initial agent name

**Code Changes**:
```typescript
case "run.started": {
  // Determine the agent name for streaming display
  // If there's an active agent selected, use its display name
  let agentName: string | null = null;
  if (state.currentAgentId) {
    const agent = state.availableAgents.find(a => a.id === state.currentAgentId);
    agentName = agent?.name ?? null;
  }
  
  return {
    ...state,
    status: "running",
    currentRunId: event.runId,
    ...resetRunFields(),
    streamingAgentName: agentName, // Set initial agent name for this run
  };
}
```

### Issue #2: Enhanced Debugging for Subagent Tracking

**Problem**: When agents delegate to subagents using the task tool, it was unclear whether:
1. The active agent was being set correctly
2. Agent information was being passed through the event chain
3. Subagent events were being emitted by the SDK

**Solution**: Added comprehensive logging to help diagnose issues:
- Log when `setActiveAgent` is called, showing which agent was activated
- Warning log if agent ID not found in registered agents
- Debug log for the first delta of each assistant message, showing agent info
- Existing logs for subagent.started events were already in place

**Files Modified**:
- `src/copilot/CopilotSessionAdapter.ts` - Added logging to `setActiveAgent()` and `assistant.delta` handler

**Code Changes**:
```typescript
async setActiveAgent(agentId: string | null, skipSessionRenew = false): Promise<void> {
  const agent = agentId 
    ? this._customAgents.find(a => a.name === agentId)
    : null;
  
  this._activeAgent = agent ?? null;
  
  if (agentId && !agent) {
    this.emit(createLogEvent("warn", `⚠️ Agent '${agentId}' not found in registered agents. Available: ${this._customAgents.map(a => a.name).join(", ")}`));
  } else if (agent) {
    this.emit(createLogEvent("info", `✅ Active agent set: ${agent.displayName || agent.name}`));
  }
  // ... rest of method
}

// In assistant.delta handler:
if (this.streamingBuffer.length === 0 && agentInfo) {
  this.emit(createLogEvent("debug", `📤 Assistant delta starting - agent: ${agentInfo.agentDisplayName} (subagent: ${Boolean(subagent)}, parentToolCallId: ${parentToolCallId || "none"})`));
}
```

## Testing

To verify the fixes work:

1. **Test Agent Name Display**:
   - Start the TUI: `bun run dev`
   - Enable team mode (it may auto-enable with Clarifier)
   - Send a prompt
   - Verify the agent name (e.g., "Clarifier") displays instead of "Assistant"
   - Check logs for "✅ Active agent set:" messages

2. **Test Subagent Delegation**:
   - With team mode enabled, send a complex request that requires delegation
   - The Clarifier should delegate to the Orchestrator
   - The Orchestrator should delegate to specialist agents
   - Check logs for:
     - "✅ Active agent set:" when switching agents
     - "🚀 Subagent STARTED:" when delegation occurs
     - "📤 Assistant delta starting" with agent names
   - Verify the subagents pane in the sidebar shows active/completed subagents

3. **Debugging**:
   - If subagents still don't appear in the sidebar, check logs for:
     - Are "🚀 Subagent STARTED:" messages appearing?
     - Are `subagent.started` events being emitted by the SDK?
     - Check if SDK version supports subagent events

## Architecture Notes

The agent name flow works as follows:

1. **Agent Selection**:
   - User selects agent via Tab key or `/team` command
   - `agent.changed` event → `handleSwitchAgent()` → `adapter.setActiveAgent(agentId)`
   - Adapter finds agent in `_customAgents` array and sets `_activeAgent`

2. **Session Setup**:
   - Active agent's system prompt becomes the session's system message
   - Other agents are advertised as available for delegation via task tool

3. **Streaming**:
   - On `run.started`, reducer sets `streamingAgentName` from `currentAgentId`
   - On `assistant.delta`, adapter includes `agentDisplayName` from `_activeAgent` or `activeSubagents`
   - Reducer updates `streamingAgentName` if delta includes new name (for subagents)
   - ChatPane displays `streamingAgentName || "Assistant"`

4. **Subagent Delegation**:
   - Agent calls task tool with `agent_type` parameter
   - SDK handles task tool internally, spawns subagent
   - SDK emits `subagent.started` event with toolCallId, agentName, agentDisplayName
   - Adapter tracks in `activeSubagents` map
   - Adapter adds to harness events
   - Reducer adds to `state.subagents` array
   - SubagentsPane displays from `state.subagents`

## Known Limitations

1. **SDK Dependency**: The subagent tracking relies on the SDK emitting `subagent.started`, `subagent.completed`, and `subagent.failed` events. If the SDK version doesn't emit these, subagents won't appear in the UI.

2. **Custom Agents Registration**: Agents must be properly registered with the SDK via `setCustomAgents()` for delegation to work. The current implementation does this automatically when agents are loaded.

3. **Timing**: There's a brief moment between agent selection and session renewal where the old agent name might still display. This is acceptable UX.

## Related Files

- `src/harness/reducer.ts` - State management for streaming agent name
- `src/harness/events.ts` - Event type definitions
- `src/harness/state.ts` - State type definitions  
- `src/copilot/CopilotSessionAdapter.ts` - SDK event handling and agent management
- `src/ui/panes/ChatPane.tsx` - Agent name display in UI
- `src/ui/panes/SubagentsPane.tsx` - Subagent list display
- `src/agents/OrchestrationPlugin.ts` - Agent loading and orchestration
- `src/agents/loader.ts` - Agent discovery from filesystem
- `src/agents/builtin.ts` - Built-in agent definitions
