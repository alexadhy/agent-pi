# Agent Orchestrator — `agent-orchestrator.ts`

Local replacement for Commander MCP's task groups, waves, agent registry, and live dashboard.

## Tools

| Tool | Purpose |
|------|---------|
| `orch_group_create` | Create a task group with waves |
| `orch_group_list` | List all groups with progress |
| `orch_group_status` | Show detailed group/task breakdown by wave |
| `orch_task_add` | Add a task to a group (optionally at a specific wave) |
| `orch_task_list` | List tasks with optional group/status filters |
| `orch_task_update` | Update task status — auto-advances waves when all current wave tasks complete |
| `orch_agent_register` | Register an agent in the orchestrator registry |
| `orch_agent_heartbeat` | Update agent status and heartbeat |
| `orch_dashboard` | Open the live browser dashboard |

## Commands

| Command | Purpose |
|---------|---------|
| `/orch` | Open orchestrator dashboard (alias for `orch_dashboard`) |
| `/orch-close` | Close the orchestrator dashboard |

## Integration

- **`tasks.ts`**: Reads `globalThis.__piTaskList` to show task progress in the dashboard
- **`subagent-widget.ts`**: Automatically registers agents on spawn via `globalThis.__piOrchestrator`
- **`agent-team.ts`**: Automatically registers agents on dispatch via `globalThis.__piOrchestrator`

## Persistence

State is saved to `.pi/orchestrator-state.json` in the project root. Loaded on `session_start`, saved on `session_shutdown`, `session_before_switch`, and `session_before_fork`.

## Dashboard

The dashboard is a self-contained HTML page served on a local HTTP server (random port). It shows:
- Group cards with progress bars
- Tasks organized by wave with color-coded status badges
- Live agent panel with heartbeat status
- Auto-refreshes every 3 seconds
