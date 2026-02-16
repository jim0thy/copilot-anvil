---
name: orchestrate
description: Run a task through the full multi-agent orchestration pipeline (Sisyphus → specialists)
skill: opencode-orchestration
inputs:
  - name: task
    description: The task to orchestrate
    required: true
    type: freeform
---

You are now operating in **full orchestration mode**. Route this task through the multi-agent pipeline:

1. **Analyse** the task complexity and required domains.
2. **Delegate to Sisyphus** (the orchestrator) with a clear, lean task description.
3. Sisyphus will coordinate the appropriate specialists:
   - **Prometheus** for planning complex tasks
   - **Metis** to validate plans
   - **Hephaestus** for deep implementation
   - **Oracle** for investigation/debugging
   - **Librarian/Explore** for code discovery
   - Domain specialists (frontend, backend, etc.) for implementation

The user's task:

{task}

Remember: all agent delegation happens via the `task` tool and consumes 0 additional premium requests. Use agents liberally for the best result.
