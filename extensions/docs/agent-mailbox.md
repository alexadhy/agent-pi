# Agent Mailbox — `agent-mailbox.ts`

File-based inter-agent messaging system. Replaces Commander MCP's `commander_mailbox`.

## Tools

| Tool | Purpose |
|------|---------|
| `mailbox_send` | Send a message from one agent to another |
| `mailbox_inbox` | Check inbox for a given agent (optionally mark read) |
| `mailbox_cleanup` | Remove messages older than N days |

## Commands

| Command | Purpose |
|---------|---------|
| `mailbox-status` | Show unread counts for all agents |

## Data Structure

Messages are stored as JSON files at `~/.pi/mailbox/`:

```
~/.pi/mailbox/
  inboxes/
    coordinator/
      1698412345-001.json    # { from, to, body, message_type, createdAt, read }
    scout-1/
      ...
  sent/
    1698412345-001.json      # Copy with _sentBy field
```

## Usage

```typescript
// Agent A shares a discovery
mailbox_send {
  from: "scout-1",
  to: "coordinator",
  body: "Found the bug in auth.ts line 42",
  message_type: "discovery"
}

// Coordinator checks inbox
mailbox_inbox {
  agent_name: "coordinator",
  mark_read: true
}

// Clean up old messages
mailbox_cleanup {
  agent_name: "coordinator",
  older_than_days: 7
}
```

## Integration

When a message is sent, the orchestrator is notified via `globalThis.__piOrchestrator.notifyMailbox()` if available, so the dashboard can show recent messages.
