// ABOUTME: File-based inter-agent mailbox — replaces commander_mailbox.
// ABOUTME: Agents send/receive messages via JSON files in .pi/mailbox/.

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import { readdirSync, readFileSync, writeFileSync, mkdirSync, existsSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { parseMailMessage, type MailMessage } from "./lib/mailbox-types.ts";

// ── Paths ────────────────────────────────────────────────────────────

// Session-scoped mailbox root. When this Pi process has captured a session
// hash, the entire mailbox lives under <root>/<hash>/ and is structurally
// unreachable from any other Pi instance on the same machine — no inbox
// paths can collide and no sent/ files can be ingested by the wrong
// orchestrator. Without a hash (tests, unusual invocations) the legacy
// shared root is used for back-compat.
function getMailboxDir(): string {
  const root = join(homedir(), ".pi", "mailbox");
  return sessionShortHash ? join(root, sessionShortHash) : root;
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
      const msg = parseMailMessage(JSON.parse(readFileSync(join(inboxDir, file), "utf-8")));
      if (msg) messages.push(msg);
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

// ── Session isolation ──────────────────────────────────────────────
//
// Multiple Pi instances on the same machine share ~/.pi/mailbox/. Without
// scoping, replies addressed to "coordinator" or "implementor" from one
// session leak into another's inbox. We capture the session ID at startup
// and append a short hash to canonical workflow-role recipients so each Pi
// instance sees its own conversation only. Cross-session sends to specific
// agent IDs (not in SESSION_SCOPED_ROLES) are unchanged.

let sessionShortHash: string | undefined;

// Canonical workflow-role prefixes. Any name starting with one of these
// (e.g. "coordinator", "coordinator-unifiedp", "jd-judge-a") is scoped.
// Exact-match only would miss custom-named coordinators like
// "coordinator-unifiedp" — prefix match catches them without forcing the
// user to use the bare canonical name.
const SESSION_SCOPED_PREFIXES = ["coordinator-", "implementor-", "jd-"];

function isSessionScopedName(name: string): boolean {
  if (SESSION_SCOPED_PREFIXES.some((p) => name.startsWith(p))) return true;
  return name === "coordinator" || name === "implementor";
}

function scopedRecipient(to: string): string {
  if (!sessionShortHash) return to;
  if (isSessionScopedName(to)) return `${to}-${sessionShortHash}`;
  return to;
}

// Sender scoping: tag canonical-role senders with the session hash so the
// receiving orchestrator can ignore cross-instance receipts. Mirrors
// scopedRecipient — symmetric so the orchestrator's filter on the `from`
// field and the recipient's inbox scoping stay aligned.
function scopedSender(from: string): string {
  if (!sessionShortHash) return from;
  if (isSessionScopedName(from)) return `${from}-${sessionShortHash}`;
  return from;
}

// ── Cleanup ────────────────────────────────────────────────────────

function cleanupMailbox(agentName: string, olderThanDays: number): { inbox: number; sent: number } {
  const cutoff = Date.now() - olderThanDays * 24 * 60 * 60 * 1000;
  let inboxRemoved = 0;

  const inboxDir = getInboxDir(agentName);
  if (existsSync(inboxDir)) {
    for (const file of readdirSync(inboxDir)) {
      if (!file.endsWith(".json")) continue;
      try {
        const filePath = join(inboxDir, file);
        const msg = JSON.parse(readFileSync(filePath, "utf-8"));
        if (new Date(msg.createdAt).getTime() < cutoff) {
          unlinkSync(filePath);
          inboxRemoved++;
        }
      } catch {}
    }
  }

  // Also purge `sent/` files older than the cutoff. Sent files accumulate
  // forever otherwise — no other code path deletes them. The agent_name
  // parameter doesn't filter sent (it applies to all sent/, not per-agent).
  let sentRemoved = 0;
  const sentDir = getSentDir();
  if (existsSync(sentDir)) {
    for (const file of readdirSync(sentDir)) {
      if (!file.endsWith(".json")) continue;
      try {
        const filePath = join(sentDir, file);
        const msg = JSON.parse(readFileSync(filePath, "utf-8"));
        if (new Date(msg.createdAt).getTime() < cutoff) {
          unlinkSync(filePath);
          sentRemoved++;
        }
      } catch {}
    }
  }

  return { inbox: inboxRemoved, sent: sentRemoved };
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
      const from = scopedSender(String(params.from));
      const to = scopedRecipient(String(params.to));
      const msg = sendMessage(
        from,
        to,
        String(params.body),
        String(params.message_type || "direct"),
      );

      // Notify orchestrator if available. Mailbox delivery must not fail just
      // because a diagnostic consumer rejects malformed or unrelated mail.
      const orch = (globalThis as any).__piOrchestrator;
      if (orch?.notifyMailbox) {
        try {
          orch.notifyMailbox(msg);
        } catch (error) {
          console.warn(`[mailbox] Orchestrator notification failed for ${msg.id}: ${error instanceof Error ? error.message : String(error)}`);
        }
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
      const agentName = scopedRecipient(String(params.agent_name));
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
      const total = removed.inbox + removed.sent;
      const parts: string[] = [];
      if (removed.inbox > 0) parts.push(`${removed.inbox} from "${agentName}" inbox`);
      if (removed.sent > 0) parts.push(`${removed.sent} from sent/`);
      const detail = parts.length > 0 ? ` (${parts.join(", ")})` : "";
      return {
        content: [{ type: "text" as const, text: `Cleaned up ${total} old message(s)${detail}.` }],
      };
    },
  });

  // ── Lifecycle hooks ──────────────────────────────────────────────

  pi.on("session_start", async (_event, ctx) => {
    // Ensure mailbox directories exist
    ensureDir(getMailboxDir());
    ensureDir(getSentDir());

    // Capture short session hash for per-instance inbox isolation
    const sid = ctx?.sessionManager?.getSessionId?.();
    if (sid) {
      sessionShortHash = sid.replace(/[^a-zA-Z0-9]/g, "").slice(0, 8) || sid.slice(0, 8);
    }
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
