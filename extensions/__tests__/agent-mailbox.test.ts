/**
 * Tests for agent-mailbox.ts — file-based inter-agent messaging
 *
 * Tests the mailbox_send, mailbox_inbox, and mailbox_cleanup tools.
 * Uses a temp directory for mailbox files to avoid polluting real state.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

// We need to monkey-patch homedir before importing the extension
import { homedir } from "node:os";

let tempDir: string;

// ── Test Helpers ─────────────────────────────────────────────────────

function createPiMock() {
	const tools: any[] = [];
	const commands: any[] = [];
	const handlers: Record<string, any> = {};
	return {
		registerTool(def: any) {
			tools.push(def);
		},
		registerCommand(nameOrDef: any, maybeDef?: any) {
			commands.push(maybeDef === undefined ? nameOrDef : { name: nameOrDef, ...maybeDef });
		},
		on(event: string, handler: any) {
			handlers[event] = handler;
		},
		getTools() {
			return tools;
		},
		getCommands() {
			return commands;
		},
		getHandlers() {
			return handlers;
		},
	};
}

describe("agent-mailbox", () => {
	let pi: ReturnType<typeof createPiMock>;
	let mailboxExt: any;

	beforeEach(async () => {
		tempDir = mkdtempSync(join(tmpdir(), "mailbox-test-"));
		// Monkey-patch homedir to return our temp dir
		const originalHomedir = homedir;
		// We'll import the module fresh each time after setting up
		vi.mock("node:os", async () => {
			const actual = await vi.importActual("node:os");
			return {
				...actual,
				homedir: () => tempDir,
			};
		});

		pi = createPiMock();
		mailboxExt = await import("../agent-mailbox");
		mailboxExt.default(pi as any);

		// Trigger session_start to create directories
		const sessionStart = pi.getHandlers().session_start;
		if (sessionStart) await sessionStart();
	});

	afterEach(() => {
		vi.restoreAllMocks();
		// Clean up tempDir
		try {
			const fs = require("node:fs");
			const rmDir = (dir: string) => {
				if (existsSync(dir)) {
					for (const f of readdirSync(dir)) {
						const fp = join(dir, f);
						try {
							fs.rmSync(fp, { recursive: true });
						} catch {}
					}
					try { fs.rmdirSync(dir); } catch {}
				}
			};
			rmDir(join(tempDir, ".pi", "mailbox"));
		} catch {}
	});

	describe("tool registration", () => {
		it("registers mailbox_send, mailbox_inbox, mailbox_cleanup", () => {
			const toolNames = pi.getTools().map((t: any) => t.name);
			expect(toolNames).toContain("mailbox_send");
			expect(toolNames).toContain("mailbox_inbox");
			expect(toolNames).toContain("mailbox_cleanup");
		});

		it("registers mailbox-status command", () => {
			const cmdNames = pi.getCommands().map((c: any) => c.name);
			expect(cmdNames).toContain("mailbox-status");
		});
	});

	describe("mailbox_send", () => {
		it("sends a message and returns a message ID", async () => {
			const tool = pi.getTools().find((t: any) => t.name === "mailbox_send");
			const result = await tool.execute("1", {
				from: "scout-1",
				to: "coordinator",
				body: "Found the bug! It's in auth.ts line 42",
			});

			expect(result.content[0].text).toContain("Message sent");
			expect(result.content[0].text).toContain("coordinator");
		});

		it("writes message to recipient's inbox directory", async () => {
			const tool = pi.getTools().find((t: any) => t.name === "mailbox_send");
			await tool.execute("1", {
				from: "agent-a",
				to: "agent-b",
				body: "Hello from A",
			});

			const inboxDir = join(tempDir, ".pi", "mailbox", "inboxes", "agent-b");
			expect(existsSync(inboxDir)).toBe(true);

			const files = readdirSync(inboxDir).filter(f => f.endsWith(".json"));
			expect(files.length).toBe(1);

			const msg = JSON.parse(readFileSync(join(inboxDir, files[0]), "utf-8"));
			expect(msg.from).toBe("agent-a");
			expect(msg.body).toBe("Hello from A");
			expect(msg.read).toBe(false);
		});
	});

	describe("mailbox_inbox", () => {
		it("returns messages for an agent", async () => {
			const sendTool = pi.getTools().find((t: any) => t.name === "mailbox_send");
			const inboxTool = pi.getTools().find((t: any) => t.name === "mailbox_inbox");

			await sendTool.execute("1", { from: "alice", to: "bob", body: "Hey Bob" });
			const result = await inboxTool.execute("1", { agent_name: "bob" });

			expect(result.content[0].text).toContain("alice");
			expect(result.content[0].text).toContain("Hey Bob");
		});

		it("returns empty for agents with no messages", async () => {
			const tool = pi.getTools().find((t: any) => t.name === "mailbox_inbox");
			const result = await tool.execute("1", { agent_name: "nobody" });

			expect(result.content[0].text).toContain("No messages");
		});
	});

	describe("mailbox_cleanup", () => {
		it("cleans up old messages", async () => {
			const sendTool = pi.getTools().find((t: any) => t.name === "mailbox_send");
			const cleanupTool = pi.getTools().find((t: any) => t.name === "mailbox_cleanup");

			await sendTool.execute("1", { from: "x", to: "y", body: "test" });
			const result = await cleanupTool.execute("1", { agent_name: "y", older_than_days: 0 });

			expect(result.content[0].text).toContain("Cleaned up");
		});
	});
});
