---
name: orchestrate
description: Run a task through the full multi-agent orchestration pipeline (Tech Lead → specialists)
skill: team-orchestration
inputs:
  - name: task
    description: The task to orchestrate
    required: true
    type: freeform
---

You are now operating in **full orchestration mode**. Route this task through the multi-agent pipeline:

1. **Analyse** the task complexity and required domains.
2. **Delegate to the Tech Lead** with a clear, lean task description.
3. The Tech Lead will coordinate the appropriate specialists:
   - **Strategist** for planning complex tasks
   - **Advisor** to validate plans
   - **Staff Engineer** for deep implementation
   - **Architect** for investigation/debugging
   - **Navigator/Scout** for code discovery
   - Domain specialists (frontend, backend, etc.) for implementation

The user's task:

{task}

Remember: all agent delegation happens via the `task` tool and consumes 0 additional premium requests. Use agents liberally for the best result.
