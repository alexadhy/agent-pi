// ABOUTME: File-based inter-agent mailbox — replaces commander_mailbox.
// ABOUTME: Agents send/receive messages via JSON files in .pi/mailbox/.

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import { readdirSync, readFileSync, writeFileSync, mkdirSync, existsSync, unlinkSync, renameSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

// ── Types ────────────────────────────────────────────────────────────

interface MailMessage {
  id: string;
  from: string;
  to: string;
  body: string;
  message_type: string;
  createdAt: string;
  read: boolean;
}

// ── Paths ────────────────────────────────────────────────────────────

function getMailboxDir(): string {
  return join(homedir(), ".pi", "mailbox");
}

function getInboxDir(agentName: string): string {
  return join(getMailboxDir(), "inboxes", agentName);
}

function getSentDir(): string {
  return join(getMailboxDir(), "sent");
}

function ensureDir(dir: string): void {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

// ── Mailbox operations ───────────────────────────────────────────────

function sendMessage(from: string, to: string, body: string, messageType: string): MailMessage {
  const msg: MailMessage = {
    id: generateId(),
    from,
    to,
    body,
    message_type: messageType || "direct",
    createdAt: new Date().toISOString(),
    read: false,
  };

  // Write to recipient's inbox
  const inboxDir = getInboxDir(to);
  ensureDir(inboxDir);
  writeFileSync(join(inboxDir, `${msg.id}.json`), JSON.stringify(msg, null, 2), "utf-8");

  // Also write to sent directory
  const sentDir = getSentDir();
  ensureDir(sentDir);
  writeFileSync(join(sentDir, `${msg.id}.json`), JSON.stringify({ ...msg, _sentBy: from }, null, 2), "utf-8");

  return msg;
}

function getInbox(agentName: string, markRead?: boolean): MailMessage[] {
  const inboxDir = getInboxDir(agentName);
  if (!existsSync(inboxDir)) return [];

  const messages: MailMessage[] = [];
  const files = readdirSync(inboxDir).filter(f => f.endsWith(".json")).sort();

  for (const file of files) {
    try {
      const msg = JSON.parse(readFileSync(join(inboxDir, file), "utf-8")) as MailMessage;
      messages.push(msg);
    } catch {}
  }

  // Mark as read if requested
  if (markRead) {
    for (const msg of messages) {
      if (!msg.read) {
        msg.read = true;
        writeFileSync(join(inboxDir, `${msg.id}.json`), JSON.stringify(msg, null, 2), "utf-8");
      }
    }
  }

  return messages;
}

function getUnreadCount(agentName: string): number {
  return getInbox(agentName).filter(m => !m.read).length;
}

function cleanupMailbox(agentName: string, olderThanDays: number): number {
  const inboxDir = getInboxDir(agentName);
  if (!existsSync(inboxDir)) return 0;

  const cutoff = Date.now() - olderThanDays * 24 * 60 * 60 * 1000;
  let removed = 0;

  for (const file of readdirSync(inboxDir)) {
    if (!file.endsWith(".json")) continue;
    try {
      const stat = readdirSync(inboxDir); // just for the path
      const filePath = join(inboxDir, file);
      const msg = JSON.parse(readFileSync(filePath, "utf-8"));
      if (new Date(msg.createdAt).getTime() < cutoff) {
        unlinkSync(filePath);
        removed++;
      }
    } catch {}
  }

  return removed;
}

// ── Tool Registration ────────────────────────────────────────────────

export default function (pi: ExtensionAPI) {
  pi.registerTool({
    name: "mailbox_send",
    label: "Mailbox: Send Message",
    description: "Send a message from one agent to another. Messages are stored as JSON files in ~/.pi/mailbox/.",
    parameters: Type.Object({
      from: Type.String({ description: "Sender agent name" }),
      to: Type.String({ description: "Recipient agent name" }),
      body: Type.String({ description: "Message body text" }),
      message_type: Type.Optional(Type.String({ description: "Message type (default: 'direct')" })),
    }),
    execute: async (_id, params) => {
      const msg = sendMessage(
        String(params.from),
        String(params.to),
        String(params.body),
        String(params.message_type || "direct"),
      );

      // Notify orchestrator if available
      const orch = (globalThis as any).__piOrchestrator;
      if (orch?.notifyMailbox) {
        orch.notifyMailbox(msg);
      }

      return {
        content: [{ type: "text" as const, text: `Message sent to "${params.to}" (id: ${msg.id})` }],
      };
    },
  });

  pi.registerTool({
    name: "mailbox_inbox",
    label: "Mailbox: Check Inbox",
    description: "Check inbox for a given agent name. Optionally mark messages as read.",
    parameters: Type.Object({
      agent_name: Type.String({ description: "Agent name to check inbox for" }),
      mark_read: Type.Optional(Type.Boolean({ description: "Mark messages as read (default: false)" })),
    }),
    execute: async (_id, params) => {
      const agentName = String(params.agent_name);
      const markRead = params.mark_read === true;
      const messages = getInbox(agentName, markRead);
      const unread = messages.filter(m => !m.read).length;

      if (messages.length === 0) {
        return { content: [{ type: "text" as const, text: `No messages in inbox for "${agentName}".` }] };
      }

      const lines = messages.map(m => {
        const readStatus = m.read ? "" : " [UNREAD]";
        return `[${m.createdAt}] from ${m.from}${readStatus}: ${m.body.slice(0, 200)}`;
      });

      const summary = `Inbox for "${agentName}": ${messages.length} messages (${unread} unread)\n${lines.join("\n")}`;
      return { content: [{ type: "text" as const, text: summary }] };
    },
  });

  pi.registerTool({
    name: "mailbox_cleanup",
    label: "Mailbox: Cleanup",
    description: "Archive old messages from an agent's inbox. Removes messages older than the specified days.",
    parameters: Type.Object({
      agent_name: Type.String({ description: "Agent name to clean up" }),
      older_than_days: Type.Optional(Type.Number({ description: "Remove messages older than this many days (default: 7)" })),
    }),
    execute: async (_id, params) => {
      const agentName = String(params.agent_name);
      const days = params.older_than_days !== undefined ? Number(params.older_than_days) : 7;
      const removed = cleanupMailbox(agentName, days);
      return {
        content: [{ type: "text" as const, text: `Cleaned up ${removed} old message(s) from "${agentName}" inbox.` }],
      };
    },
  });

  // ── Lifecycle hooks ──────────────────────────────────────────────

  pi.on("session_start", async () => {
    // Ensure mailbox directories exist
    ensureDir(getMailboxDir());
    ensureDir(getSentDir());

    // Publish unread count to globalThis for other extensions
    (globalThis as any).__piMailboxUnread = {};
  });

  pi.registerCommand("mailbox-status", {
    description: "Show mailbox status — unread counts for all agents with inboxes",
    handler: async () => {
      const inboxBase = join(getMailboxDir(), "inboxes");
      if (!existsSync(inboxBase)) return "No mailbox directories found.";

      const agents = readdirSync(inboxBase).filter(f => {
        const dir = join(inboxBase, f);
        try { return existsSync(dir); } catch { return false; }
      });

      if (agents.length === 0) return "No agents have inboxes yet.";

      const lines = agents.map(a => `${a}: ${getUnreadCount(a)} unread`);
      return `Mailbox Status:\n${lines.join("\n")}`;
    },
  });
}

export { getInbox, getUnreadCount, sendMessage, cleanupMailbox };
