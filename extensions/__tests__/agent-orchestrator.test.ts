/**
 * Tests for agent-orchestrator.ts — task groups, waves, agents, dashboard
 *
 * Tests the core data model operations (createGroup, addTask, updateTaskStatus)
 * and tool registration. Does NOT test the HTTP server or dashboard HTML.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// We import the extension and test its internal logic via tool execution
import orchestratorExt from "../agent-orchestrator";

// ── Test Helpers ─────────────────────────────────────────────────────

function createPiMock() {
	const tools: any[] = [];
	const commands: any[] = [];
	const handlers: Record<string, any> = {};
	return {
		registerTool(def: any) {
			tools.push(def);
		},
		registerCommand(name: string, def: any) {
			commands.push({ name, ...def });
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

// ── Tests ────────────────────────────────────────────────────────────

describe("agent-orchestrator", () => {
	let pi: ReturnType<typeof createPiMock>;

	beforeEach(() => {
		pi = createPiMock();
		orchestratorExt(pi as any);
	});

	afterEach(() => {
		delete (globalThis as any).__piOrchestrator;
		delete (globalThis as any).__piOrchestratorState;
		delete (globalThis as any).__piSubagentRuntime;
	});

	describe("tool registration", () => {
		it("registers all 9 orchestration tools", () => {
			const toolNames = pi.getTools().map((t: any) => t.name);
			expect(toolNames).toContain("orch_group_create");
			expect(toolNames).toContain("orch_group_list");
			expect(toolNames).toContain("orch_group_status");
			expect(toolNames).toContain("orch_task_add");
			expect(toolNames).toContain("orch_task_list");
			expect(toolNames).toContain("orch_task_update");
			expect(toolNames).toContain("orch_agent_register");
			expect(toolNames).toContain("orch_agent_heartbeat");
			expect(toolNames).toContain("orch_dashboard");
			expect(toolNames.length).toBeGreaterThanOrEqual(9);
		});

		it("registers /orch and /orch-close commands", () => {
			const cmdNames = pi.getCommands().map((c: any) => c.name);
			expect(cmdNames).toContain("orch");
			expect(cmdNames).toContain("orch-close");
		});
	});

	describe("orch_group_create", () => {
		it("creates a group and returns its ID", async () => {
			const tool = pi.getTools().find((t: any) => t.name === "orch_group_create");
			const result = await tool.execute("1", { name: "Auth Refactor", description: "Migrate JWT", totalWaves: 3 });

			const text = result.content[0].text;
			expect(text).toContain("Created group");
			expect(text).toContain("Auth Refactor");
			expect(text).toContain("3 waves");
		});

		it("creates a group with default 1 wave", async () => {
			const tool = pi.getTools().find((t: any) => t.name === "orch_group_create");
			const result = await tool.execute("1", { name: "Bug Bash" });

			const text = result.content[0].text;
			expect(text).toContain("1 waves");
		});
	});

	describe("orch_task_add", () => {
		it("adds a task to an existing group", async () => {
			const createTool = pi.getTools().find((t: any) => t.name === "orch_group_create");
			const addTool = pi.getTools().find((t: any) => t.name === "orch_task_add");

			await createTool.execute("1", { name: "Test Group", totalWaves: 2 });
			const result = await addTool.execute("1", { groupId: 1, text: "Add refresh token table", wave: 1 });

			const text = result.content[0].text;
			expect(text).toContain("Added task");
			expect(text).toContain("Add refresh token table");
		});

		it("returns error for non-existent group", async () => {
			const tool = pi.getTools().find((t: any) => t.name === "orch_task_add");
			const result = await tool.execute("1", { groupId: 999, text: "Orphan task" });

			expect(result.content[0].text).toContain("not found");
		});
	});

	describe("orch_task_update", () => {
		it("updates task status", async () => {
			const createTool = pi.getTools().find((t: any) => t.name === "orch_group_create");
			const addTool = pi.getTools().find((t: any) => t.name === "orch_task_add");
			const updateTool = pi.getTools().find((t: any) => t.name === "orch_task_update");

			await createTool.execute("1", { name: "Test", totalWaves: 1 });
			await addTool.execute("1", { groupId: 1, text: "Task 1" });
			const result = await updateTool.execute("1", { taskId: 1, status: "working" });

			expect(result.content[0].text).toContain("working");
		});

		it("advances wave when all tasks in current wave complete", async () => {
			const createTool = pi.getTools().find((t: any) => t.name === "orch_group_create");
			const addTool = pi.getTools().find((t: any) => t.name === "orch_task_add");
			const updateTool = pi.getTools().find((t: any) => t.name === "orch_task_update");
			const statusTool = pi.getTools().find((t: any) => t.name === "orch_group_status");

			await createTool.execute("1", { name: "Wave Test", totalWaves: 2 });
			await addTool.execute("1", { groupId: 1, text: "Wave 1 task A", wave: 1 });
			await addTool.execute("1", { groupId: 1, text: "Wave 1 task B", wave: 1 });
			await addTool.execute("1", { groupId: 1, text: "Wave 2 task A", wave: 2 });

			// Complete both wave 1 tasks — should advance to wave 2
			await updateTool.execute("1", { taskId: 1, status: "completed" });
			await updateTool.execute("1", { taskId: 2, status: "completed" });

			const status = await statusTool.execute("1", { groupId: 1 });
			expect(status.content[0].text).toContain("Wave 2/2");
		});
	});

	describe("orch_agent_register", () => {
		it("registers an agent and returns confirmation", async () => {
			const tool = pi.getTools().find((t: any) => t.name === "orch_agent_register");
			const result = await tool.execute("1", { name: "scout-1", role: "scout" });

			expect(result.content[0].text).toContain("Agent registered");
			expect(result.content[0].text).toContain("scout-1");
		});
	});

	describe("receipt diagnostics", () => {
		it("ignores malformed and unexpected mailbox receipts with diagnostics", () => {
			const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
			const orch = (globalThis as any).__piOrchestrator;

			expect(orch.notifyMailbox({ id: "bad-json", body: "{" })).toBe("ignore");
			expect(orch.notifyMailbox({ id: "bad-type", body: JSON.stringify({ change: "demo", type: "NOPE" }) })).toBe("ignore");
			expect(warn).toHaveBeenCalledTimes(2);
			warn.mockRestore();
		});
	});

	describe("runtime review loop", () => {
		it("dispatches judges, fix, re-review, and completion without subprocesses", async () => {
			const testCwd = mkdtempSync(join(tmpdir(), "orchestrator-review-"));
			try {
				await pi.getHandlers().session_start({}, { cwd: testCwd, hasUI: false });
				const spawned: Array<{ name: string; task: string }> = [];
			(globalThis as any).__piSubagentRuntime = {
				spawn: vi.fn((request: { name: string; task: string }) => {
					spawned.push(request);
					return `mock-${spawned.length}`;
				}),
			};
			const orch = (globalThis as any).__piOrchestrator;
			const change = `runtime-loop-${Date.now()}-${Math.random().toString(36).slice(2)}`;
			const send = (receipt: Record<string, unknown>) =>
				orch.notifyMailbox({ id: String(receipt.receiptId), body: JSON.stringify({ change, ...receipt }) });

			expect(send({ type: "IMPLEMENTATION_RECEIPT", receiptId: "impl" })).toBe("dispatch-judges");
			expect(spawned.map((agent) => agent.name)).toEqual(["jd-judge-a", "jd-judge-b"]);
			expect(send({ type: "REVIEW_A", receiptId: "a1", correlationId: "r1-a" })).toBe("ignore");
			expect(send({ type: "REVIEW_B", receiptId: "b1", correlationId: "r1-b" })).toBe("consolidate");
			expect(spawned.at(-1)?.name).toBe("jd-consolidator");
			expect(send({ type: "REVIEW_CONSOLIDATED", receiptId: "c1", verdict: "FAIL", blockingFindings: 1 })).toBe("dispatch-fix");
			expect(spawned.at(-1)?.name).toBe("jd-fix-agent");
			expect(send({ type: "FIX_RECEIPT", receiptId: "fix1" })).toBe("dispatch-judges");
			expect(spawned.slice(-2).map((agent) => agent.name)).toEqual(["jd-judge-a", "jd-judge-b"]);
			expect(send({ type: "REVIEW_A", receiptId: "a2", correlationId: "r2-a" })).toBe("ignore");
			expect(send({ type: "REVIEW_B", receiptId: "b2", correlationId: "r2-b" })).toBe("consolidate");
			expect(send({ type: "REVIEW_CONSOLIDATED", receiptId: "c2", verdict: "PASS", blockingFindings: 0 })).toBe("ignore");
			expect(send({ type: "REVIEW_FINAL", receiptId: "final", verdict: "PASS", blockingFindings: 0 })).toBe("complete");
			expect(orch.getReviewState(change)).toMatchObject({ status: "COMPLETE", passed: true, round: 2 });
			expect(send({ type: "REVIEW_A", receiptId: "duplicate-a", correlationId: "r2-a" })).toBe("ignore");
			} finally {
				rmSync(testCwd, { recursive: true, force: true });
			}
		});

		it("writes a dispatch lock file when judges are spawned", async () => {
			const testCwd = mkdtempSync(join(tmpdir(), "orchestrator-lock-"));
			try {
				await pi.getHandlers().session_start(
					{},
					{
						cwd: testCwd,
						hasUI: false,
						sessionManager: { getSessionId: () => "locktest123" },
					},
				);
				(globalThis as any).__piSubagentRuntime = {
					spawn: vi.fn(() => "mock-1"),
				};
				const orch = (globalThis as any).__piOrchestrator;
				const change = `lock-test-${Date.now()}-${Math.random().toString(36).slice(2)}`;
				orch.notifyMailbox({
					id: "impl",
					body: JSON.stringify({ type: "IMPLEMENTATION_RECEIPT", change, receiptId: "impl" }),
				});

				// Lock file should be written under <cwd>/.pi/
				const lockDir = join(testCwd, ".pi");
				const lockFiles = require("node:fs").readdirSync(lockDir).filter((f: string) =>
					f.startsWith(`dispatch-${change}-`) && f.endsWith(".lock"),
				);
				expect(lockFiles.length).toBeGreaterThan(0);
			} finally {
				rmSync(testCwd, { recursive: true, force: true });
			}
		});

		// ── Cross-instance isolation ───────────────────────────────────────
		// The user's bug: reviews dispatched by one Pi instance were being
		// re-dispatched (or seen) by another Pi on the same cwd because the
		// review state lived in a single shared SQLite file. After the fix,
		// each instance writes its own ledger under a session-hash-suffixed
		// filename, so cross-instance reads return empty state.
		it("two Pi instances on the same cwd write to separate review ledgers", async () => {
			const testCwd = mkdtempSync(join(tmpdir(), "orch-iso-ledger-"));
			try {
				// session IDs that survive the strip-non-alphanumerics + slice(0,8)
				// hash derivation unchanged.
				const sidA = "isoaaaaa";  // 8 chars
				const sidB = "isobbbbb";  // 8 chars

				// Instance A: capture session hash A, drive one round to COMPLETE.
				await pi.getHandlers().session_start({}, { cwd: testCwd, hasUI: false, sessionManager: { getSessionId: () => sidA } });
				const spawnedA: Array<{ name: string }> = [];
				(globalThis as any).__piSubagentRuntime = { spawn: vi.fn((r: { name: string }) => { spawnedA.push(r); return `mock-${spawnedA.length}`; }) };
				const change = `iso-${Date.now()}-${Math.random().toString(36).slice(2)}`;
				const sendA = (r: Record<string, unknown>) =>
					(globalThis as any).__piOrchestrator.notifyMailbox({ id: String(r.receiptId), body: JSON.stringify({ change, ...r }) });

				expect(sendA({ type: "IMPLEMENTATION_RECEIPT", receiptId: "impl-A" })).toBe("dispatch-judges");
				expect(sendA({ type: "REVIEW_A", receiptId: "a1", correlationId: "r1-a" })).toBe("ignore");
				expect(sendA({ type: "REVIEW_B", receiptId: "b1", correlationId: "r1-b" })).toBe("consolidate");
				expect(sendA({ type: "REVIEW_CONSOLIDATED", receiptId: "c1", verdict: "PASS", blockingFindings: 0 })).toBe("ignore");
				expect(sendA({ type: "REVIEW_FINAL", receiptId: "f1", verdict: "PASS", blockingFindings: 0 })).toBe("complete");

				// Instance A's ledger file must exist with sidA suffix
				const fs = require("node:fs");
				const ledgerA = join(testCwd, "openspec", `.review-ledger-${sidA}.sqlite`);
				expect(fs.existsSync(ledgerA)).toBe(true);

				// Instance B: capture session hash B on the same cwd. Its ledger
				// must be a separate file. Its dispatch must NOT see A's work.
				const piB = createPiMock();
				const extB = await import("../agent-orchestrator?iso=" + Date.now());
				extB.default(piB as any);
				await piB.getHandlers().session_start({}, { cwd: testCwd, hasUI: false, sessionManager: { getSessionId: () => sidB } });
				const spawnedB: Array<{ name: string }> = [];
				(globalThis as any).__piSubagentRuntime = { spawn: vi.fn((r: { name: string }) => { spawnedB.push(r); return `mock-${spawnedB.length}`; }) };
				const orchB = (globalThis as any).__piOrchestrator;

				// B spawns judges for ITS OWN change — A's spawn log must not be touched.
				const changeB = `iso-B-${Date.now()}`;
				const sendB = (r: Record<string, unknown>) =>
					orchB.notifyMailbox({ id: String(r.receiptId), body: JSON.stringify({ change: changeB, ...r }) });
				expect(sendB({ type: "IMPLEMENTATION_RECEIPT", receiptId: "impl-B" })).toBe("dispatch-judges");
				expect(spawnedB.map((s) => s.name)).toEqual(["jd-judge-a", "jd-judge-b"]);
				expect(spawnedA.length).toBe(3); // A: judges (a+b) + consolidator, no further spawns (PASS → complete)

				// B's ledger file must exist with sidB suffix
				const ledgerB = join(testCwd, "openspec", `.review-ledger-${sidB}.sqlite`);
				expect(fs.existsSync(ledgerB)).toBe(true);

				// Seed A's change dir so B's recoverReviews would pick it up
				// if we asked. Then B's loadReviewState for A's change must
				// be a fresh PENDING state — not A's COMPLETE state.
				fs.mkdirSync(join(testCwd, "openspec", "changes", change), { recursive: true });
				fs.writeFileSync(join(testCwd, "openspec", "changes", change, "proposal.md"), "# A's change");
				// Trigger B's recoverReviews so reviewStates map gets populated
				orchB.recoverReviews();

				const stateBForA = orchB.getReviewState(change);
				expect(stateBForA?.status).toBe("PENDING");
				expect(stateBForA?.round).toBe(0);
			} finally {
				rmSync(testCwd, { recursive: true, force: true });
			}
		});

		it("ingestMailboxReceipts drops receipts tagged for another session", async () => {
			// Simulates: orchestrator in session A runs recovery while a
			// stale receipt from another session C accidentally ends up in
			// A's session-scoped sent/ dir. The cross-instance filter must
			// skip C's receipt; A's own receipt must still be ingested.
			const testCwd = mkdtempSync(join(tmpdir(), "orch-iso-ingest-"));
			try {
				// 8-char IDs that survive the hash derivation unchanged
				const sidA = "ingestXX";  // hashes to "ingestXX"
				const sidC = "ingestZZ";  // hashes to "ingestZZ"
				const fs = require("node:fs");
				const path = require("node:path");
				const homedir = require("node:os").homedir;

				await pi.getHandlers().session_start({}, { cwd: testCwd, hasUI: false, sessionManager: { getSessionId: () => sidA } });
				const orch = (globalThis as any).__piOrchestrator;
				const ownChange = `own-${Date.now()}-${Math.random().toString(36).slice(2)}`;
				const crossChange = `cross-${Date.now()}-${Math.random().toString(36).slice(2)}`;

				// Seed openspec so both changes exist (orchestrator's
				// ingestMailboxReceipts rejects receipts referencing a
				// non-existent change).
				fs.mkdirSync(join(testCwd, "openspec", "changes", ownChange), { recursive: true });
				fs.mkdirSync(join(testCwd, "openspec", "changes", crossChange), { recursive: true });
				fs.writeFileSync(join(testCwd, "openspec", "changes", ownChange, "proposal.md"), "# own stub");
				fs.writeFileSync(join(testCwd, "openspec", "changes", crossChange, "proposal.md"), "# cross stub");

				// Write BOTH receipts into A's session-scoped sent/ dir —
				// one is A's own (correctly tagged with sidA), the other is
				// from session C (tagged with sidC). This is the worst-case
				// scenario: cross-instance pollution inside our own dir.
				const sessionSentDir = path.join(homedir(), ".pi", "mailbox", sidA, "sent");
				fs.mkdirSync(sessionSentDir, { recursive: true });

				const ownReceipt = {
					id: "own-1",
					from: `jd-judge-a-${sidA}`,
					to: `coordinator-${sidA}`,
					body: JSON.stringify({ type: "REVIEW_A", change: ownChange, receiptId: "own-1", correlationId: "own-c1" }),
					message_type: "REVIEW_A",
					createdAt: new Date(Date.now() - 1000).toISOString(),
					read: false,
				};
				fs.writeFileSync(path.join(sessionSentDir, "own-1.json"), JSON.stringify(ownReceipt));

				const crossReceipt = {
					id: "cross-1",
					from: `jd-judge-a-${sidC}`,  // <-- tagged with sidC, not sidA
					to: `coordinator-${sidC}`,
					body: JSON.stringify({ type: "REVIEW_A", change: crossChange, receiptId: "cross-1", correlationId: "cross-c1" }),
					message_type: "REVIEW_A",
					createdAt: new Date().toISOString(),
					read: false,
				};
				fs.writeFileSync(path.join(sessionSentDir, "cross-1.json"), JSON.stringify(crossReceipt));

				const spawned: Array<{ name: string }> = [];
				(globalThis as any).__piSubagentRuntime = { spawn: vi.fn((r: { name: string }) => { spawned.push(r); return `mock-${spawned.length}`; }) };

				// Recover
				orch.recoverReviews();

				// Own receipt must be ingested: state for ownChange has the receipt.
				const state = orch.getReviewState(ownChange);
				expect(state?.receiptIds?.length).toBeGreaterThan(0);

				// Cross-instance receipt must be silently dropped: state for
				// crossChange must still be PENDING, no receiptIds.
				const crossState = orch.getReviewState(crossChange);
				expect(crossState?.status).toBe("PENDING");
				expect(crossState?.receiptIds?.length || 0).toBe(0);
			} finally {
				rmSync(testCwd, { recursive: true, force: true });
			}
		});

		it("the spawning Pi (orchestrator) still receives its own judge's receipts", async () => {
			// End-to-end: orchestrator in session A; one of A's judges
			// (correctly tagged jd-judge-a-<sidA>) sends REVIEW_A AND REVIEW_B
			// to coordinator-<sidA>; orchestrator must process both, register
			// them, and dispatch the consolidator.
			const testCwd = mkdtempSync(join(tmpdir(), "orch-iso-own-"));
			try {
				// 8 chars that survive hash derivation unchanged
				const sidA = "ownreca";
				await pi.getHandlers().session_start({}, { cwd: testCwd, hasUI: false, sessionManager: { getSessionId: () => sidA } });
				const spawned: Array<{ name: string }> = [];
				(globalThis as any).__piSubagentRuntime = { spawn: vi.fn((r: { name: string }) => { spawned.push(r); return `mock-${spawned.length}`; }) };
				const orch = (globalThis as any).__piOrchestrator;
				const change = `recv-${Date.now()}-${Math.random().toString(36).slice(2)}`;

				const fs = require("node:fs");
				const path = require("node:path");
				const homedir = require("node:os").homedir;
				fs.mkdirSync(join(testCwd, "openspec", "changes", change), { recursive: true });
				fs.writeFileSync(join(testCwd, "openspec", "changes", change, "proposal.md"), "# stub");

				// Step 1: implementor sends receipt — orchestrator dispatches judges
				const spawnImpl = (id: string, body: Record<string, unknown>) =>
					orch.notifyMailbox({ id, body: JSON.stringify({ change, ...body }) });
				expect(spawnImpl("impl", { type: "IMPLEMENTATION_RECEIPT", receiptId: "impl" })).toBe("dispatch-judges");
				expect(spawned.map((s) => s.name).slice(-2)).toEqual(["jd-judge-a", "jd-judge-b"]);

				// Step 2: BOTH judges (correctly tagged with sidA) deposit their
				// REVIEW_A / REVIEW_B receipts into A's session-scoped sent/ dir.
				const sessionSentDir = path.join(homedir(), ".pi", "mailbox", sidA, "sent");
				fs.mkdirSync(sessionSentDir, { recursive: true });
				const aReceipt = {
					id: "a1", from: `jd-judge-a-${sidA}`, to: `coordinator-${sidA}`,
					body: JSON.stringify({ type: "REVIEW_A", change, receiptId: "a1", correlationId: "r1-a", verdict: "PASS", blockingFindings: 0 }),
					message_type: "REVIEW_A", createdAt: new Date().toISOString(), read: false,
				};
				const bReceipt = {
					id: "b1", from: `jd-judge-b-${sidA}`, to: `coordinator-${sidA}`,
					body: JSON.stringify({ type: "REVIEW_B", change, receiptId: "b1", correlationId: "r1-b", verdict: "PASS", blockingFindings: 0 }),
					message_type: "REVIEW_B", createdAt: new Date().toISOString(), read: false,
				};
				fs.writeFileSync(path.join(sessionSentDir, "a1.json"), JSON.stringify(aReceipt));
				fs.writeFileSync(path.join(sessionSentDir, "b1.json"), JSON.stringify(bReceipt));

				orch.recoverReviews();
				expect(spawned.at(-1)?.name).toBe("jd-consolidator");

				// State for this change must now have 3 receipts:
				// IMPLEMENTATION_RECEIPT (in-process via notifyMailbox)
				// + REVIEW_A + REVIEW_B (from session-scoped sent/ dir)
				const state = orch.getReviewState(change);
				expect(state?.receiptIds?.length).toBe(3);
			} finally {
				rmSync(testCwd, { recursive: true, force: true });
			}
		});
	});

	describe("globalThis.__piOrchestrator", () => {
		it("exposes orchestrator API on globalThis", () => {
			const orch = (globalThis as any).__piOrchestrator;
			expect(orch).toBeDefined();
			expect(typeof orch.registerAgent).toBe("function");
			expect(typeof orch.updateAgentStatus).toBe("function");
			expect(typeof orch.getState).toBe("function");
		});

		it("registerAgent creates an agent in state", () => {
			const orch = (globalThis as any).__piOrchestrator;
			orch.registerAgent("test-agent", "builder");

			const state = orch.getState();
			const agent = state.agents.find((a: any) => a.name === "test-agent");
			expect(agent).toBeDefined();
			expect(agent.role).toBe("builder");
		});

		it("updateAgentStatus updates agent heartbeat", () => {
			const orch = (globalThis as any).__piOrchestrator;
			orch.registerAgent("worker-1", "worker");
			orch.updateAgentStatus("worker-1", "working", 42);

			const state = orch.getState();
			const agent = state.agents.find((a: any) => a.name === "worker-1");
			expect(agent.status).toBe("working");
			expect(agent.currentTaskId).toBe(42);
		});
	});
});
