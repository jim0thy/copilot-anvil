# Custom agents

Put project-specific custom agent definition files in this folder as `*.agent.md`.
Each agent file should start with YAML frontmatter (between `---` lines) followed by the agent's prompt.

## Example format

```markdown
---
name: My Custom Agent
description: What this agent does
model: claude-sonnet-4.5
tools: ['grep', 'view', 'edit']
tier: mid
domain: fullstack
escalatesTo: Senior Fullstack Developer
---

System prompt content here...
```

## Loading / precedence

Project agents found under `.agents/` (for example `.agents/*.agent.md`, and any similar project agent paths) are treated as project-level overrides and take priority over built-in agent definitions.

This repo intentionally does not include any agent prompts here beyond this README; add your own `*.agent.md` files as needed.
