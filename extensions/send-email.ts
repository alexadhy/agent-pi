// ABOUTME: Agent email sending extension — enables agents to send emails via local outbox.
// ABOUTME: Registers a send_email tool that writes to .pi/mail/outbox/ for later dispatch.

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import { Text } from "@earendil-works/pi-tui";
import { writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

// ── Types ────────────────────────────────────────────────────────────

interface SendEmailParams {
  to?: string;
  subject?: string;
  body?: string;
  html?: string;
  type?: "generic" | "report" | "briefing";
  report_name?: string;
  format?: "markdown" | "html" | "text";
}

interface OutboxMessage {
  id: string;
  createdAt: string;
  to: string;
  subject: string;
  body: string;
  format: string;
  type: string;
  report_name?: string;
}

// ── Outbox helpers ───────────────────────────────────────────────────

function getOutboxDir(): string {
  return join(homedir(), ".pi", "mail", "outbox");
}

function ensureOutboxDir(): void {
  const dir = getOutboxDir();
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
}

function writeOutbox(msg: OutboxMessage): void {
  ensureOutboxDir();
  const filePath = join(getOutboxDir(), `${msg.id}.json`);
  writeFileSync(filePath, JSON.stringify(msg, null, 2), "utf-8");
}

function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

// ── Tool Registration ────────────────────────────────────────────────

export default function (pi: ExtensionAPI) {
  pi.registerTool({
    name: "send_email",
    label: "Send Email",
    description: [
      "Send an email via the local outbox. Emails are written as JSON files to",
      "~/.pi/mail/outbox/ for later dispatch by a separate process or cron job.",
      "",
      "Default recipient: ruizrica2@gmail.com",
      "",
      "Three modes:",
      "  generic  — send a custom email with subject and body/content",
      "  report   — send a formatted report (markdown auto-converted to styled HTML)",
      "  briefing — send a morning briefing email",
      "",
      "Content supports markdown (auto-converted to HTML), raw HTML, or plain text.",
      "",
      "Examples:",
      '  { type: "report", report_name: "Feature Complete", body: "## Summary\\nAdded auth..." }',
      '  { type: "generic", subject: "Build Results", body: "All 42 tests passed." }',
      '  { type: "generic", to: "team@example.com", subject: "Deploy Done", body: "v2.1 is live" }',
    ].join("\n"),
    parameters: Type.Object({
      to: Type.Optional(
        Type.String({
          description: "Recipient email address. Default: ruizrica2@gmail.com",
        }),
      ),
      subject: Type.Optional(
        Type.String({
          description:
            "Email subject line (required for generic, auto-generated for report/briefing).",
        }),
      ),
      body: Type.Optional(
        Type.String({
          description:
            "Email body content — markdown (default), HTML, or plain text.",
        }),
      ),
      html: Type.Optional(
        Type.String({ description: "Raw HTML email body (overrides body)." }),
      ),
      type: Type.Optional(
        Type.String({
          description:
            "Email type: 'generic' (default), 'report', or 'briefing'.",
        }),
      ),
      report_name: Type.Optional(
        Type.String({
          description: "Report name for subject line (for report type).",
        }),
      ),
      format: Type.Optional(
        Type.String({
          description: "Content format: 'markdown' (default), 'html', 'text'.",
        }),
      ),
    }),

    async execute(_toolCallId, params) {
      const p = params as SendEmailParams;
      const emailType = (p.type || "generic").toLowerCase();

      // Validate and build message
      let subject: string;
      let body: string;
      let format: string;

      if (emailType === "report") {
        if (!p.body && !p.html) {
          return {
            content: [{ type: "text" as const, text: "Email sending failed: 'body' content is required for report emails." }],
            details: { success: false, error: "missing_content" },
          };
        }
        subject = p.report_name || p.subject || "Completion Report";
        body = p.html || p.body || "";
        format = p.html ? "html" : p.format || "markdown";
      } else if (emailType === "briefing") {
        if (!p.body) {
          return {
            content: [{ type: "text" as const, text: "Email sending failed: 'body' content is required for briefing emails." }],
            details: { success: false, error: "missing_content" },
          };
        }
        subject = `Morning Briefing — ${new Date().toLocaleDateString()}`;
        body = p.body;
        format = p.format || "markdown";
      } else {
        // generic
        if (!p.subject) {
          return {
            content: [{ type: "text" as const, text: "Email sending failed: 'subject' is required for generic emails." }],
            details: { success: false, error: "missing_subject" },
          };
        }
        if (!p.body && !p.html) {
          return {
            content: [{ type: "text" as const, text: "Email sending failed: 'body' or 'html' is required for generic emails." }],
            details: { success: false, error: "missing_body" },
          };
        }
        subject = p.subject;
        body = p.html || p.body || "";
        format = p.html ? "html" : p.format || "markdown";
      }

      const msg: OutboxMessage = {
        id: generateId(),
        createdAt: new Date().toISOString(),
        to: p.to || "ruizrica2@gmail.com",
        subject,
        body,
        format,
        type: emailType,
        report_name: emailType === "report" ? (p.report_name || p.subject) : undefined,
      };

      try {
        writeOutbox(msg);
        const count = getOutboxCount();
        return {
          content: [{ type: "text" as const, text: `Email queued to outbox (${count} pending). Use a dispatch script to send.` }],
          details: { success: true, outboxId: msg.id },
        };
      } catch (err: any) {
        return {
          content: [{ type: "text" as const, text: `Email sending failed: ${err.message}` }],
          details: { success: false, error: err.message },
        };
      }
    },

    renderCall(args, theme) {
      const p = args as SendEmailParams;
      const type = p.type || "generic";
      const to = p.to || "default";
      const label = `${type} → ${to}`;
      return new Text(
        theme.fg("toolTitle", theme.bold("send_email ")) +
          theme.fg("accent", label),
        0,
        0,
      );
    },

    renderResult(result, _options, theme) {
      const details = result.details as any;
      const text = result.content?.[0];
      const textStr = text?.type === "text" ? text.text : "";

      if (details?.error || textStr.toLowerCase().includes("fail") || textStr.toLowerCase().includes("error")) {
        return new Text(theme.fg("error", `send_email failed: ${details?.error || textStr}`), 0, 0);
      }

      return new Text(theme.fg("success", `send_email ✓ ${textStr || "queued"}`), 0, 0);
    },
  });

  // Register a dispatch command to send queued emails
  pi.registerCommand("send-email-dispatch", {
    description: "Send all queued emails from the outbox",
    handler: async () => {
      const count = getOutboxCount();
      return `Outbox has ${count} pending emails. Use msmtp or a custom script to dispatch: ~/.pi/mail/outbox/`;
    },
  });
}

function getOutboxCount(): number {
  try {
    const fs = require("node:fs");
    const dir = join(homedir(), ".pi", "mail", "outbox");
    if (!existsSync(dir)) return 0;
    return fs.readdirSync(dir).filter((f: string) => f.endsWith(".json")).length;
  } catch {
    return 0;
  }
}
