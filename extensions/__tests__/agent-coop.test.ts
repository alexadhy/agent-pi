/**
 * Tests for agent-coop.ts — /co-op cooperative multi-agent mode
 *
 * Tests the command handler registration and response format.
 */

import { describe, it, expect, beforeEach } from "vitest";

// ── Test Helpers ─────────────────────────────────────────────────────

function createPiMock() {
	const commands: any[] = [];
	return {
		registerCommand(name: string, def: any) {
			commands.push({ name, ...def });
		},
		getCommands() {
			return commands;
		},
	};
}

describe("agent-coop", () => {
	let pi: ReturnType<typeof createPiMock>;

	beforeEach(async () => {
		pi = createPiMock();
		const coopExt = await import("../agent-coop");
		coopExt.default(pi as any);
	});

	describe("command registration", () => {
		it("registers /co-op command", () => {
			const cmdNames = pi.getCommands().map((c: any) => c.name);
			expect(cmdNames).toContain("co-op");
		});

		it("command has a description", () => {
			const cmd = pi.getCommands().find((c: any) => c.name === "co-op");
			expect(cmd.description).toBeDefined();
			expect(cmd.description.length).toBeGreaterThan(0);
		});

		it("handler returns orchestration steps", async () => {
			const cmd = pi.getCommands().find((c: any) => c.name === "co-op");
			const result = await cmd.handler("Refactor auth module", { hasUI: false, ui: { notify: () => {} } });

			expect(result).toContain("orch_group_create");
			expect(result).toContain("dispatch_agent");
			expect(result).toContain("mailbox_inbox");
		});
	});
});
