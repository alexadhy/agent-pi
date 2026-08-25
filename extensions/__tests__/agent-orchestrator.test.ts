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
