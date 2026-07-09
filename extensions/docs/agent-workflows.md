# Agent Workflows — `agent-workflows.ts`

YAML-based workflow template system. Replaces Commander MCP's `commander_workflow`.

## Tools

| Tool | Purpose |
|------|---------|
| `workflow_list` | List all available workflow templates (built-in + user-defined) |
| `workflow_get` | Get a specific workflow template by name |
| `workflow_create` | Create a new workflow template from YAML |

## Built-in Templates

| Template | Steps | Purpose |
|----------|-------|---------|
| `contextos` | 5 | Full spec-driven feature workflow: requirements → spec → implement |
| `plan-first` | 4 | Standard plan-first workflow: analyze → plan → approve → implement |
| `bug-fix` | 4 | Structured bug investigation: reproduce → root cause → fix → verify |

## Custom Templates

User-defined templates are stored as `.yaml` files in `~/.pi/workflows/`:

```yaml
name: My Custom Workflow
description: A test workflow
steps:
  - phase: "Research"
    actions:
      - "Read the docs"
      - "Ask questions"
  - phase: "Build"
    actions:
      - "Write code"
      - "Test it"
```

## Usage

```typescript
// List available templates
workflow_list {}

// Get a built-in template
workflow_get { name: "contextos" }

// Create a custom template
workflow_create {
  name: "my-workflow",
  content: "name: My Workflow\nsteps:\n  - phase: \"Step 1\"\n    actions:\n      - \"Do thing\""
}
```
