/**
 * Tests for the rewritten send-email.ts — local outbox system
 *
 * Tests that the send_email tool writes to ~/.pi/mail/outbox/ as JSON files.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, existsSync, readdirSync, readFileSync, unlinkSync, rmdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

// ── Test Helpers ─────────────────────────────────────────────────────

function createPiMock() {
	let tool: any;
	const commands: any[] = [];
	return {
		registerTool(def: any) {
			tool = def;
		},
		registerCommand(name: string, def: any) {
			commands.push({ name, ...def });
		},
		getTool() {
			return tool;
		},
		getCommands() {
			return commands;
		},
	};
}

describe("send-email (local outbox)", () => {
	let pi: ReturnType<typeof createPiMock>;
	let tool: any;
	let tempDir: string;

	beforeEach(async () => {
		tempDir = mkdtempSync(join(tmpdir(), "sendmail-test-"));

		// Set up the mock before importing
		vi.doMock("node:os", async () => {
			const actual = await vi.importActual("node:os");
			return {
				...actual,
				homedir: () => tempDir,
			};
		});

		// Dynamic import to pick up the mock
		const sendEmailExt = (await import("../send-email")).default;
		pi = createPiMock();
		sendEmailExt(pi as any);
		tool = pi.getTool();
	});

	afterEach(() => {
		vi.restoreAllMocks();
		// Clean up temp dir
		try {
			const mailDir = join(tempDir, ".pi", "mail", "outbox");
			if (existsSync(mailDir)) {
				for (const f of readdirSync(mailDir)) {
					unlinkSync(join(mailDir, f));
				}
				rmdirSync(join(tempDir, ".pi", "mail", "outbox"));
				rmdirSync(join(tempDir, ".pi", "mail"));
				rmdirSync(join(tempDir, ".pi"));
			}
			try { rmdirSync(tempDir); } catch {}
		} catch {}
	});

	describe("tool registration", () => {
		it("registers send_email tool", () => {
			expect(tool).toBeDefined();
			expect(tool.name).toBe("send_email");
		});

		it("registers send-email-dispatch command", () => {
			const cmdNames = pi.getCommands().map((c: any) => c.name);
			expect(cmdNames).toContain("send-email-dispatch");
		});
	});

	describe("generic email", () => {
		it("sends a generic email and writes to outbox", async () => {
			const result = await tool.execute("1", {
				to: "test@example.com",
				subject: "Build Results",
				body: "All 42 tests passed.",
			});

			expect(result.content[0].text).toContain("queued to outbox");
			expect(result.details.success).toBe(true);
		});

		it("writes JSON file to outbox directory", async () => {
			await tool.execute("1", {
				to: "team@example.com",
				subject: "Deploy Done",
				body: "v2.1 is live",
			});

			const outboxDir = join(tempDir, ".pi", "mail", "outbox");
			expect(existsSync(outboxDir)).toBe(true);

			const files = readdirSync(outboxDir).filter(f => f.endsWith(".json"));
			expect(files.length).toBe(1);

			const msg = JSON.parse(readFileSync(join(outboxDir, files[0]), "utf-8"));
			expect(msg.to).toBe("team@example.com");
			expect(msg.subject).toBe("Deploy Done");
			expect(msg.body).toBe("v2.1 is live");
			expect(msg.type).toBe("generic");
		});

		it("errors when subject is missing for generic", async () => {
			const result = await tool.execute("1", {
				to: "test@example.com",
				body: "No subject",
			});

			expect(result.details.error).toBe("missing_subject");
		});

		it("errors when body is missing for generic", async () => {
			const result = await tool.execute("1", {
				to: "test@example.com",
				subject: "Empty",
			});

			expect(result.details.error).toBe("missing_body");
		});
	});

	describe("report email", () => {
		it("sends a report email", async () => {
			const result = await tool.execute("1", {
				type: "report",
				report_name: "Feature Complete",
				body: "## Summary\nAdded auth...",
			});

			expect(result.details.success).toBe(true);
			const msg = readOutbox();
			expect(msg.subject).toBe("Feature Complete");
			expect(msg.type).toBe("report");
		});
	});

	describe("briefing email", () => {
		it("sends a briefing email", async () => {
			const result = await tool.execute("1", {
				type: "briefing",
				body: "Morning update: all systems go",
			});

			expect(result.details.success).toBe(true);
			const msg = readOutbox();
			expect(msg.type).toBe("briefing");
			expect(msg.body).toBe("Morning update: all systems go");
		});
	});

	// ── Helper ────────────────────────────────────────────────────

	function readOutbox(): any {
		const outboxDir = join(tempDir, ".pi", "mail", "outbox");
		const files = readdirSync(outboxDir).filter(f => f.endsWith(".json"));
		if (files.length === 0) throw new Error("No outbox files");
		return JSON.parse(readFileSync(join(outboxDir, files[0]), "utf-8"));
	}
});
