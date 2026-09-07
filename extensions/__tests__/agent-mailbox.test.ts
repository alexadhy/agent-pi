/**
 * Tests for agent-mailbox.ts — file-based inter-agent messaging
 *
 * Tests the mailbox_send, mailbox_inbox, and mailbox_cleanup tools.
 * Uses a temp directory for mailbox files to avoid polluting real state.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
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
		it("cleans up old inbox messages", async () => {
			const sendTool = pi.getTools().find((t: any) => t.name === "mailbox_send");
			const cleanupTool = pi.getTools().find((t: any) => t.name === "mailbox_cleanup");

			await sendTool.execute("1", { from: "x", to: "y", body: "test" });
			// Backdate the inbox file so the cutoff (older_than_days=0) actually excludes it
			const inboxDir = join(tempDir, ".pi", "mailbox", "inboxes", "y");
			const inboxFile = join(inboxDir, readdirSync(inboxDir)[0]);
			const msg = JSON.parse(readFileSync(inboxFile, "utf-8"));
			msg.createdAt = new Date(Date.now() - 60_000).toISOString();
			writeFileSync(inboxFile, JSON.stringify(msg), "utf-8");

			const result = await cleanupTool.execute("1", { agent_name: "y", older_than_days: 0 });

			expect(result.content[0].text).toContain("Cleaned up");
			expect(result.content[0].text).toContain("from \"y\" inbox");
			expect(existsSync(inboxFile)).toBe(false);
		});

		it("purges old sent/ files (TTL cleanup)", async () => {
			const sendTool = pi.getTools().find((t: any) => t.name === "mailbox_send");
			const cleanupTool = pi.getTools().find((t: any) => t.name === "mailbox_cleanup");

			// Send a message — this writes a file to sent/ with current timestamp
			await sendTool.execute("1", { from: "x", to: "y", body: "old sent" });

			// Backdate the file by 8 days (older than default 7-day TTL)
			const sentDir = join(tempDir, ".pi", "mailbox", "sent");
			const sentFile = join(sentDir, readdirSync(sentDir)[0]);
			const msg = JSON.parse(readFileSync(sentFile, "utf-8"));
			msg.createdAt = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString();
			writeFileSync(sentFile, JSON.stringify(msg), "utf-8");

			// Default TTL is 7 days — the backdated file should be purged
			const result = await cleanupTool.execute("1", { agent_name: "y" });
			expect(result.content[0].text).toContain("Cleaned up");
			expect(result.content[0].text).toContain("from sent/");
			expect(existsSync(sentFile)).toBe(false);
		});

		it("preserves fresh sent/ files within TTL", async () => {
			const sendTool = pi.getTools().find((t: any) => t.name === "mailbox_send");
			const cleanupTool = pi.getTools().find((t: any) => t.name === "mailbox_cleanup");

			await sendTool.execute("1", { from: "x", to: "y", body: "fresh sent" });

			const result = await cleanupTool.execute("1", { agent_name: "y" });
			expect(result.content[0].text).not.toContain("from sent/");

			const sentDir = join(tempDir, ".pi", "mailbox", "sent");
			expect(readdirSync(sentDir).length).toBeGreaterThan(0);
		});
	});

	describe("session isolation", () => {
		it("scopes canonical-role senders AND recipients to the local session", async () => {
			// Re-trigger session_start with a stubbed sessionManager so the module
			// captures a session hash. Each Pi process picks up its own hash at
			// startup; without one, behavior is unchanged (back-compat).
			const sessionStart = pi.getHandlers().session_start;
			await sessionStart({}, { sessionManager: { getSessionId: () => "abc12345xyz" } });

			const sendTool = pi.getTools().find((t: any) => t.name === "mailbox_send");
			const inboxTool = pi.getTools().find((t: any) => t.name === "mailbox_inbox");

			await sendTool.execute("1", { from: "jd-judge-a", to: "coordinator", body: "review ready" });
			await sendTool.execute("1", { from: "x", to: "y", body: "non-canonical recipient" });

			// Session-scoped mailbox root: <root>/<hash>/inboxes/<name>
			const scopedDir = join(tempDir, ".pi", "mailbox", "abc12345", "inboxes", "coordinator-abc12345");
			expect(existsSync(scopedDir)).toBe(true);

			// Sender scoping: file written to sent/ must have session-tagged `from`
			const sentDir = join(tempDir, ".pi", "mailbox", "abc12345", "sent");
			const sentFiles = readdirSync(sentDir).filter((f: string) => f.endsWith(".json"));
			const tagged = sentFiles
				.map((f: string) => JSON.parse(readFileSync(join(sentDir, f), "utf-8")))
				.find((m: any) => m.from === "jd-judge-a-abc12345");
			expect(tagged).toBeDefined();

			// Non-canonical recipient lives under the same session root, no name-scoping
			const unscopedDir = join(tempDir, ".pi", "mailbox", "abc12345", "inboxes", "y");
			expect(existsSync(unscopedDir)).toBe(true);

			// LLM-side: mailbox_inbox("coordinator") resolves to the local session's view
			const result = await inboxTool.execute("1", { agent_name: "coordinator" });
			expect(result.content[0].text).toContain("review ready");
		});

		it("scopes custom-named coordinators via the coordinator- prefix", async () => {
			// Custom-named coordinators like "coordinator-unifiedp" must still be
			// scoped; otherwise cross-instance leakage reappears whenever someone
			// adds a project-specific suffix.
			const sessionStart = pi.getHandlers().session_start;
			await sessionStart({}, { sessionManager: { getSessionId: () => "uniq1234xx" } });

			const sendTool = pi.getTools().find((t: any) => t.name === "mailbox_send");
			await sendTool.execute("1", { from: "jd-judge-a", to: "coordinator-unifiedp", body: "scoped by prefix" });
			await sendTool.execute("1", { from: "jd-fix", to: "implementor-backend", body: "scoped implementor prefix" });

			const inboxRoot = join(tempDir, ".pi", "mailbox", "uniq1234", "inboxes");
			expect(existsSync(join(inboxRoot, "coordinator-unifiedp-uniq1234"))).toBe(true);
			expect(existsSync(join(inboxRoot, "implementor-backend-uniq1234"))).toBe(true);

			// Non-workflow names keep their original name (no prefix collision)
			expect(existsSync(join(inboxRoot, "alex"))).toBe(false);
		});

		it("does not scope when no session ID is provided", async () => {
			// Fresh module without session_start being called with a ctx
			const freshPi = createPiMock();
			const freshExt = await import("../agent-mailbox?fresh=" + Date.now());
			freshExt.default(freshPi as any);
			const freshStart = freshPi.getHandlers().session_start;
			if (freshStart) await freshStart(); // no ctx -> sessionShortHash stays undefined

			const sendTool = freshPi.getTools().find((t: any) => t.name === "mailbox_send");
			await sendTool.execute("1", { from: "jd-judge-a", to: "coordinator", body: "no scope" });

			const unscopedDir = join(tempDir, ".pi", "mailbox", "inboxes", "coordinator");
			expect(existsSync(unscopedDir)).toBe(true);
			const sentFile = readdirSync(join(tempDir, ".pi", "mailbox", "sent"))
				.map((f: string) => JSON.parse(readFileSync(join(tempDir, ".pi", "mailbox", "sent", f), "utf-8")))
				.find((m: any) => m.from === "jd-judge-a");
			expect(sentFile).toBeDefined();
		});

		it("two Pi instances on the same machine do not see each other's receipts", async () => {
			// Simulate two Pi processes on the same homedir: each captures its
			// own session hash, each writes to its own subtree. Cross-instance
			// reads must NOT find the other's inbox files.
			const hashA = "sessiona";  // 8-char alphanumeric
			const hashB = "sessionb";  // 8-char alphanumeric

			// Session A captures hash A
			await pi.getHandlers().session_start({}, { sessionManager: { getSessionId: () => hashA } });
			const sendA = pi.getTools().find((t: any) => t.name === "mailbox_send");
			await sendA.execute("1", { from: "jd-judge-a", to: "coordinator", body: "from A" });

			// Fresh module simulates session B in a different Pi process
			const piB = createPiMock();
			const extB = await import("../agent-mailbox?freshB=" + Date.now());
			extB.default(piB as any);
			await piB.getHandlers().session_start({}, { sessionManager: { getSessionId: () => hashB } });
			const sendB = piB.getTools().find((t: any) => t.name === "mailbox_send");
			await sendB.execute("1", { from: "jd-judge-a", to: "coordinator", body: "from B" });

			// Session A's subtree holds A's message only
			const sentA = readdirSync(join(tempDir, ".pi", "mailbox", hashA, "sent"))
				.map((f: string) => JSON.parse(readFileSync(join(tempDir, ".pi", "mailbox", hashA, "sent", f), "utf-8")));
			const inboxA = readdirSync(join(tempDir, ".pi", "mailbox", hashA, "inboxes", `coordinator-${hashA}`))
				.map((f: string) => JSON.parse(readFileSync(join(tempDir, ".pi", "mailbox", hashA, "inboxes", `coordinator-${hashA}`, f), "utf-8")));
			expect(sentA.some((m: any) => m.body === "from A")).toBe(true);
			expect(sentA.some((m: any) => m.body === "from B")).toBe(false);
			expect(inboxA.some((m: any) => m.body === "from A")).toBe(true);
			expect(inboxA.some((m: any) => m.body === "from B")).toBe(false);

			// Session B's subtree is structurally separate
			const sentB = readdirSync(join(tempDir, ".pi", "mailbox", hashB, "sent"))
				.map((f: string) => JSON.parse(readFileSync(join(tempDir, ".pi", "mailbox", hashB, "sent", f), "utf-8")));
			expect(sentB.some((m: any) => m.body === "from B")).toBe(true);
			expect(sentB.some((m: any) => m.body === "from A")).toBe(false);
		});
	});
});
