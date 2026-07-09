// ABOUTME: Tests for buildNormalPrompt — the NORMAL mode system prompt that teaches autonomous mode selection.
// ABOUTME: Validates mode classification guidance, Commander integration, and chain/pipeline status reporting.

import { describe, it, expect } from "vitest";
import { buildNormalPrompt, buildCommanderSection } from "../lib/mode-prompts.ts";

describe("buildNormalPrompt", () => {
	it("is a non-empty string", () => {
		const result = buildNormalPrompt({ commanderAvailable: false, activeChain: null, activePipeline: null });
		expect(typeof result).toBe("string");
		expect(result.length).toBeGreaterThan(0);
	});

	it("contains 'set_mode'", () => {
		const result = buildNormalPrompt({ commanderAvailable: false, activeChain: null, activePipeline: null });
		expect(result).toContain("set_mode");
	});

	it("contains all 6 mode names", () => {
		const result = buildNormalPrompt({ commanderAvailable: false, activeChain: null, activePipeline: null });
		for (const mode of ["NORMAL", "PLAN", "SPEC", "TEAM", "CHAIN", "PIPELINE"]) {
			expect(result).toContain(mode);
		}
	});

	it("with commanderAvailable: true, contains orch_task_add", () => {
		const result = buildNormalPrompt({ commanderAvailable: true, activeChain: null, activePipeline: null });
		expect(result).toContain("orch_task_add");
	});

	it("with commanderAvailable: false, still mentions orch_task_add", () => {
		const result = buildNormalPrompt({ commanderAvailable: false, activeChain: null, activePipeline: null });
		expect(result).toContain("orch_task");
	});

	it("with activeChain set, contains chain name", () => {
		const result = buildNormalPrompt({ commanderAvailable: false, activeChain: "plan-build-review", activePipeline: null });
		expect(result).toContain("plan-build-review");
	});

	it("with activeChain: null, contains guidance about /chain", () => {
		const result = buildNormalPrompt({ commanderAvailable: false, activeChain: null, activePipeline: null });
		expect(result).toContain("/chain");
	});

	it("with activePipeline set, contains pipeline name", () => {
		const result = buildNormalPrompt({ commanderAvailable: false, activeChain: null, activePipeline: "full-feature" });
		expect(result).toContain("full-feature");
	});

	it("with activePipeline: null, contains guidance about /pipeline", () => {
		const result = buildNormalPrompt({ commanderAvailable: false, activeChain: null, activePipeline: null });
		expect(result).toContain("/pipeline");
	});

	it("contains task classification guidance (SIMPLE vs structured)", () => {
		const result = buildNormalPrompt({ commanderAvailable: false, activeChain: null, activePipeline: null });
		expect(result.toLowerCase()).toContain("simple");
	});
});

describe("buildCommanderSection — Orchestrator references", () => {
	it("contains 'orch_task_add/list/update' references", () => {
		expect(buildCommanderSection()).toContain("orch_task_add");
	});

	it("contains 'mailbox_send' references", () => {
		expect(buildCommanderSection()).toContain("mailbox_send");
	});
});

describe("buildNormalPrompt — Orchestrator task guidance", () => {
	it("with commanderAvailable: true, mentions mailbox_send in task guidance", () => {
		const result = buildNormalPrompt({ commanderAvailable: true, activeChain: null, activePipeline: null });
		expect(result).toContain("mailbox_send");
	});

	it("with commanderAvailable: false, includes orchestrator note", () => {
		const result = buildNormalPrompt({ commanderAvailable: false, activeChain: null, activePipeline: null });
		expect(result).toContain("orch_task");
	});
});

describe("buildCommanderSection", () => {
	it("returns a non-empty string", () => {
		const result = buildCommanderSection();
		expect(typeof result).toBe("string");
		expect(result.length).toBeGreaterThan(0);
	});

	it("contains orch_task_add instead of commander_task", () => {
		expect(buildCommanderSection()).toContain("orch_task_add");
	});

	it("contains mailbox_send instead of commander_mailbox", () => {
		expect(buildCommanderSection()).toContain("mailbox_send");
	});

	it("contains mailbox_inbox instead of commander_mailbox inbox", () => {
		expect(buildCommanderSection()).toContain("mailbox_inbox");
	});
});

describe("buildNormalPrompt — Scout delegation", () => {
	it("without scoutId, does not contain scout instructions", () => {
		const result = buildNormalPrompt({ commanderAvailable: false, activeChain: null, activePipeline: null });
		expect(result).not.toContain("Scout Agent");
		expect(result).not.toContain("subagent_continue");
	});

	it("with scoutId: null, does not contain scout instructions", () => {
		const result = buildNormalPrompt({ commanderAvailable: false, activeChain: null, activePipeline: null, scoutId: null });
		expect(result).not.toContain("Scout Agent");
		expect(result).not.toContain("subagent_continue");
	});

	it("with scoutId set, contains scout delegation section", () => {
		const result = buildNormalPrompt({ commanderAvailable: false, activeChain: null, activePipeline: null, scoutId: 1 });
		expect(result).toContain("Scout Agent");
		expect(result).toContain("subagent_continue");
	});

	it("with scoutId set, references the correct SA ID", () => {
		const result = buildNormalPrompt({ commanderAvailable: false, activeChain: null, activePipeline: null, scoutId: 42 });
		expect(result).toContain("SA42");
		expect(result).toContain("id: 42");
	});

	it("with scoutId set, instructs agent to delegate reads to scout", () => {
		const result = buildNormalPrompt({ commanderAvailable: false, activeChain: null, activePipeline: null, scoutId: 1 });
		expect(result).toContain("delegate");
		expect(result.toLowerCase()).toContain("read");
	});

	it("with scoutId set, instructs agent to still handle edits directly", () => {
		const result = buildNormalPrompt({ commanderAvailable: false, activeChain: null, activePipeline: null, scoutId: 1 });
		expect(result.toLowerCase()).toContain("edit");
		expect(result).toContain("YOU still do directly");
	});

	it("with scoutId set, mentions fallback if scout errors", () => {
		const result = buildNormalPrompt({ commanderAvailable: false, activeChain: null, activePipeline: null, scoutId: 1 });
		expect(result.toLowerCase()).toContain("fall back");
	});
});
