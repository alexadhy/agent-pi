/**
 * Tests for agent-workflows.ts — YAML workflow templates
 *
 * Tests the workflow_list, workflow_get, and workflow_create tools.
 * Verifies built-in templates and custom template creation.
 */

import { describe, it, expect, beforeEach } from "vitest";

// ── Test Helpers ─────────────────────────────────────────────────────

function createPiMock() {
	const tools: any[] = [];
	return {
		registerTool(def: any) {
			tools.push(def);
		},
		getTools() {
			return tools;
		},
	};
}

describe("agent-workflows", () => {
	let pi: ReturnType<typeof createPiMock>;

	beforeEach(async () => {
		pi = createPiMock();
		const workflowsExt = await import("../agent-workflows");
		workflowsExt.default(pi as any);
	});

	describe("tool registration", () => {
		it("registers workflow_list, workflow_get, workflow_create", () => {
			const toolNames = pi.getTools().map((t: any) => t.name);
			expect(toolNames).toContain("workflow_list");
			expect(toolNames).toContain("workflow_get");
			expect(toolNames).toContain("workflow_create");
		});
	});

	describe("workflow_list", () => {
		it("returns built-in templates", async () => {
			const tool = pi.getTools().find((t: any) => t.name === "workflow_list");
			const result = await tool.execute("1", {});

			const text = result.content[0].text;
			expect(text).toContain("context-os spec workflow");
			expect(text).toContain("Plan-first workflow");
			expect(text).toContain("Bug fix workflow");
		});
	});

	describe("workflow_get", () => {
		it("returns contextos template with 5 phases", async () => {
			const tool = pi.getTools().find((t: any) => t.name === "workflow_get");
			const result = await tool.execute("1", { name: "contextos" });

			const text = result.content[0].text;
			expect(text).toContain("context-os spec workflow");
			expect(text).toContain("Phase 1");
			expect(text).toContain("Phase 5");
		});

		it("returns plan-first template", async () => {
			const tool = pi.getTools().find((t: any) => t.name === "workflow_get");
			const result = await tool.execute("1", { name: "plan-first" });

			const text = result.content[0].text;
			expect(text).toContain("Plan-first workflow");
			expect(text).toContain("Analyze");
			expect(text).toContain("Implement");
		});

		it("returns error for unknown template", async () => {
			const tool = pi.getTools().find((t: any) => t.name === "workflow_get");
			const result = await tool.execute("1", { name: "nonexistent" });

			const text = result.content[0].text;
			expect(text).toContain("not found");
		});
	});

	describe("workflow_create", () => {
		it("creates a custom workflow from simple YAML", async () => {
			const tool = pi.getTools().find((t: any) => t.name === "workflow_create");
			const yaml = "name: Simple Workflow\nsteps:\n  - phase: \"Step 1\"\n    actions:\n      - \"Do it\"";
			const result = await tool.execute("1", { name: "simple", content: yaml });
			expect(result.content[0].text).toContain("Simple Workflow");
		});
	});
});
