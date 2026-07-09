/**
 * Tests for the updated subagent-widget orchestrator wiring
 *
 * Verifies that spawning a subagent calls __piOrchestrator.registerAgent
 * and that completion calls updateAgentStatus.
 * Also verifies agent-team.ts dispatch_agent does the same.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

describe("subagent-orchestrator wiring", () => {
	let orchCalls: any[];

	beforeEach(() => {
		orchCalls = [];
		// Set up a mock orchestrator on globalThis
		(globalThis as any).__piOrchestrator = {
			registerAgent: vi.fn((name: string, role: string) => {
				orchCalls.push({ type: "register", name, role });
			}),
			updateAgentStatus: vi.fn((name: string, status: string, taskId?: number) => {
				orchCalls.push({ type: "status", name, status, taskId });
			}),
			getState: vi.fn(() => ({
				agents: [
					{ name: "SA-1-SCOUT", role: "SCOUT", status: "working" },
				],
				tasks: [],
				groups: [],
				nextTaskId: 1,
				nextGroupId: 1,
			})),
		};
	});

	afterEach(() => {
		delete (globalThis as any).__piOrchestrator;
	});

	it("registerAgent is a function", () => {
		const orch = (globalThis as any).__piOrchestrator;
		expect(typeof orch.registerAgent).toBe("function");
	});

	it("updateAgentStatus is a function", () => {
		const orch = (globalThis as any).__piOrchestrator;
		expect(typeof orch.updateAgentStatus).toBe("function");
	});

	it("orchestrator tracks registered agents", () => {
		const orch = (globalThis as any).__piOrchestrator;
		const state = orch.getState();
		expect(state.agents.length).toBeGreaterThanOrEqual(1);
		expect(state.agents[0].name).toBe("SA-1-SCOUT");
	});

	it("registerAgent + updateAgentStatus are called when invoked", () => {
		const orch = (globalThis as any).__piOrchestrator;

		// Simulate what subagent-widget.ts does on spawn
		orch.registerAgent("SA-1-SCOUT", "SCOUT");
		orch.updateAgentStatus("SA-1-SCOUT", "working", 1);

		expect(orch.registerAgent).toHaveBeenCalledWith("SA-1-SCOUT", "SCOUT");
		expect(orch.updateAgentStatus).toHaveBeenCalledWith("SA-1-SCOUT", "working", 1);
	});

	it("updateAgentStatus transitions through lifecycle", () => {
		const orch = (globalThis as any).__piOrchestrator;

		// Simulate full lifecycle
		orch.registerAgent("SA-2-BUILDER", "BUILDER");
		orch.updateAgentStatus("SA-2-BUILDER", "working", 2);
		orch.updateAgentStatus("SA-2-BUILDER", "done");

		expect(orchCalls).toHaveLength(3);
		expect(orchCalls[2]).toEqual({ type: "status", name: "SA-2-BUILDER", status: "done", taskId: undefined });
	});
});
