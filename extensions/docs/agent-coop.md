# Agent Co-op — `agent-coop.ts` + `commands/co-op/README.md`

Cooperative multi-agent mode — spawn up to 10 agents that share discoveries and help each other.

## Command

| Command | Purpose |
|---------|---------|
| `/co-op` | Initialize cooperative multi-agent session |

## Workflow

```
1. orch_group_create name="co-op: <task>" ...    — Create task group
2. orch_task_add for each subtask                 — Define tasks
3. dispatch_agent for each subtask                — Spawn cooperative agents
4. mailbox_send / mailbox_inbox                   — Share discoveries, request help
5. orch_dashboard                                 — Monitor live status
```

Each agent follows the **Cooperative Protocol**:
1. Check inbox for team discoveries first
2. Do their work, sharing discoveries via `mailbox_send`
3. Ask for help when stuck (after 2+ failed attempts)
4. Offer help when done early
5. Report findings on completion

The coordinator (you) facilitates by forwarding discoveries between agents and handling help requests.

## Full Protocol

See `commands/co-op/README.md` for the complete cooperative protocol specification.
