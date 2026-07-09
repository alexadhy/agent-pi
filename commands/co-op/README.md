---
description: "Spawn up to 10 cooperative agents that actively help each other, share discoveries, request assistance, and spawn helpers"
argument-hint: "[task description]"
---

# /co-op — Cooperative Agent Team Mode

Spawn up to **10 cooperative agents** that actively help each other through the orchestrator + mailbox system. Unlike regular teams where agents work in isolation, `/co-op` agents share discoveries, request help when stuck, offer assistance when done early, and can request helper spawns for specialist work.

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    COORDINATOR (You)                         │
│              Monitor cooperation, handle spawns              │
└──────────────────────┬──────────────────────────────────────┘
                       │ dispatch_agent up to 10
        ┌──────────────┼──────────────┐
        ▼              ▼              ▼
  ┌───────────┐  ┌───────────┐  ┌───────────┐
  │ co-op-1   │  │ co-op-2   │  │ co-op-N   │
  │           │◄─►│           │◄─►│           │
  │ share     │  │ help      │  │ discover  │
  │ discover  │  │ offer     │  │ spawn     │
  └───────────┘  └───────────┘  └───────────┘
        │              │              │
        └──────────────┼──────────────┘
                       ▼
              mailbox_send/mailbox_inbox
              (shared discoveries,
               help requests, team status)
```

## Step 1: Decompose the Task

Break the work into 3-10 independent subtasks. Think about:
- What are the independent work streams?
- What dependencies exist?
- What specialist knowledge is needed?

## Step 2: Create Task Group

Use the orchestrator to create a cooperative task group:

```
orch_group_create name="co-op: [brief summary]" description="[1-2 sentence summary]" totalWaves=1
```

For each subtask:
```
orch_task_add groupId=[id] text="[subtask description]"
```

## Step 3: Spawn Cooperative Agents (Up to 10)

For each task, dispatch an agent with the **cooperative protocol** baked into its system prompt.

Spawn ALL agents in parallel for maximum efficiency:

```
dispatch_agent agent="general-purpose" task="You are co-op-agent-1, a COOPERATIVE agent in /co-op team mode.

## Your Task
Description: [subtask description]
Your Agent Name: co-op-agent-1

## Sibling Agents (your teammates):
[list of other agents and their tasks]

## COOPERATIVE PROTOCOL

### 1. Check in with team FIRST
mailbox_inbox { agent_name: "co-op-agent-1" }
(Check if any teammates have already shared discoveries relevant to your work)

### 2. Do your work — SHARE discoveries as you go
When you find something useful (file locations, API patterns, config, architecture insights):
mailbox_send { from: "co-op-agent-1", to: "coordinator", body: "Discovery: [what you found]", message_type: "discovery" }

### 3. Ask for help if stuck (after 2+ failed attempts)
mailbox_send { from: "co-op-agent-1", to: "coordinator", body: "Stuck on: [description of what's blocking you]", message_type: "help_request" }

### 4. When done, report findings
Summarize what you accomplished and any discoveries worth sharing.
Mark your task complete.

## Rules
- ALWAYS check for team discoveries before starting work
- Share discoveries IMMEDIATELY — don't hoard knowledge
- Ask for help after 2 failed attempts
- Keep status updates concise"
```

## Step 4: Monitor Cooperation

While agents work, periodically check their progress and facilitate cooperation:

```
# Check for help requests
mailbox_inbox { agent_name: "coordinator" }

# Or check a specific agent's inbox for internal communication
mailbox_inbox { agent_name: "co-op-1" }
```

### Forward discoveries between agents

When an agent shares a discovery, forward it to relevant teammates:
```
mailbox_send { from: "coordinator", to: "co-op-2", body: "Teammate co-op-1 found: [discovery]", message_type: "forward" }
```

## Step 5: Report Summary

When all agents complete, report:

```
## /co-op Summary

### Results
- **Tasks**: X completed, Y failed out of Z total
- **Agents**: N cooperative agents spawned

### Cooperation Activity
- **Discoveries shared**: D findings (list highlights)
- **Help interactions**: H (who helped whom)

### Key Discoveries
1. [Most impactful discovery]
2. [Second discovery]
...

### Execution Time
Total: Xm Ys
```

## Notes

- **Maximum 10 agents** at once
- You are the **coordinator** — do NOT do the work yourself. Use `dispatch_agent` for everything
- Use `mailbox_send`/`mailbox_inbox` for all inter-agent communication
- The orchestrator dashboard (`orch_dashboard`) shows live status of all agents
