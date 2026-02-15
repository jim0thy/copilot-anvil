# Testing Guide for Agent Name Bug Fixes

## Overview
This document explains how to test the bug fixes for agent name display and subagent tracking.

## Prerequisites
- Bun 1.0+
- GitHub Copilot CLI authenticated
- Project dependencies installed (`bun install`)

## Test 1: Agent Name Display (Primary Fix)

### Expected Behavior
When an agent (like Clarifier or Orchestrator) is active, their name should display in the chat pane instead of "Assistant".

### Steps
1. Start the TUI:
   ```bash
   bun run dev
   ```

2. The TUI should auto-enable team mode and set Clarifier as the active agent
   - Look for log: "🎯 Team mode enabled — using Clarifier as entry point"
   - Status bar should show "Clarifier" as the active agent

3. Send a test prompt:
   ```
   What is your role?
   ```

4. **Verify**: The streaming response should show "Clarifier" (or the active agent name) instead of "Assistant"

5. Try cycling through agents:
   - Press `Tab` to cycle between agents
   - Send another prompt
   - **Verify**: The new agent's name displays correctly

### What to Look For
- ✅ Agent name appears in chat during streaming (e.g., "**Clarifier** ▮")
- ✅ Name persists in the message history after streaming completes
- ❌ Should NOT show "**Assistant**" when an agent is selected

## Test 2: Enhanced Logging

### Expected Behavior
Logs should show agent activation and streaming information.

### Steps
1. Start TUI with logs visible or check the logs pane

2. When an agent is activated, look for:
   - `✅ Active agent set: <AgentName>`
   - `Activating agent: <AgentName>`

3. When streaming starts, look for (may need debug level):
   - `📤 Assistant delta starting - agent: <AgentName> (subagent: false, parentToolCallId: none)`

4. If an invalid agent ID is used:
   - `⚠️ Agent '<id>' not found in registered agents. Available: ...`

## Test 3: Subagent Delegation (Verification)

### Expected Behavior
When agents delegate to subagents via the task tool, subagents should appear in the sidebar.

### Steps
1. Start TUI in team mode (Clarifier should be active)

2. Send a complex prompt that requires delegation:
   ```
   Create a new React component for user profiles with TypeScript
   ```

3. **Expected Flow**:
   - Clarifier receives prompt
   - Clarifier delegates to Orchestrator (via task tool)
   - Orchestrator delegates to Frontend Developer (via task tool)

4. **Check Logs**:
   - `🚀 Subagent STARTED: <AgentName> (<agent-id>) - toolCallId: <id>`
   - `✨ Message from subagent: <AgentName>`

5. **Check Sidebar**:
   - "Subagents & Skills" pane should show:
     - Active subagents (with ▮ icon)
     - Completed subagents (with ✓ or ✗ icon)

### Known Limitations
- If subagents DON'T appear in the sidebar, it may indicate:
  - SDK version doesn't support subagent events
  - Task tool is not being used (agents using different delegation method)
  - Custom agents not properly registered

### What to Look For
- ✅ Subagent names appear in sidebar when delegation occurs
- ✅ Status updates from "running" to "completed"
- ✅ Multiple subagents can be tracked simultaneously
- ✅ Duration shown for completed subagents

## Debugging Tips

### Agent Names Not Showing
1. Check if `currentAgentId` is set in harness state
2. Verify agent is in `availableAgents` array
3. Check adapter logs for "✅ Active agent set"
4. Ensure agents were loaded successfully

### Subagents Not Appearing
1. Check for "🚀 Subagent STARTED" in logs
2. If missing, SDK may not emit events
3. Verify agents are using task tool (not custom tool)
4. Check SDK version supports `subagent.started` events

### Log Levels
- `info`: General operation logs
- `debug`: Detailed streaming and agent info
- `warn`: Problems or unexpected states
- `error`: Critical failures

## Verification Checklist

- [ ] Agent name displays correctly in chat (not "Assistant")
- [ ] Agent name persists in message history
- [ ] Cycling agents updates display name
- [ ] Logs show "✅ Active agent set" messages
- [ ] Logs show "📤 Assistant delta starting" with agent info
- [ ] Subagents appear in sidebar (if SDK supports)
- [ ] Subagent status updates correctly
- [ ] Multiple subagents tracked simultaneously

## Reporting Issues

If bugs persist after these fixes:

1. **Agent Name Issue**:
   - Capture screenshot showing "Assistant" instead of agent name
   - Check logs for "✅ Active agent set" - is it present?
   - Verify `state.currentAgentId` and `state.availableAgents`

2. **Subagent Issue**:
   - Capture logs showing task tool usage
   - Check for "🚀 Subagent STARTED" messages
   - Note SDK version (`@github/copilot-sdk` package version)
   - Verify agents are using task tool (check agent prompts)

## Additional Notes

- The agent name fix is **complete** - it sets the name on `run.started`
- Subagent tracking depends on SDK emitting the correct events
- Custom agents must be registered with SDK via `setCustomAgents()`
- Agent cycling only works with top-level agents (specialist tier)
