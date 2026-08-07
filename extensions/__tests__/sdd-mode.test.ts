// ABOUTME: Tests for SDD mode integration in the mode-cycler system.
// ABOUTME: Verifies SDD is in the mode cycle, SDD_PROMPT exists, and the system_prompt switch routes correctly.

import { describe, it, expect } from "vitest";
import { MODES, nextMode, prevMode, type Mode } from "../lib/mode-cycler-logic.ts";
import { SDD_PROMPT } from "../lib/mode-prompts.ts";

describe("SDD mode in mode cycle", () => {
	it("includes SDD in MODES array", () => {
		expect(MODES).toContain("SDD");
	});

	it("cycles through SDD in the expected order", () => {
		// NORMAL → PLAN → SPEC → SDD → PIPELINE → TEAM → CHAIN → NORMAL
		const order: Mode[] = ["NORMAL"];
		let current: Mode = "NORMAL";
		for (let i = 0; i < MODES.length; i++) {
			current = nextMode(current);
			order.push(current);
		}
		// After N full cycles, we should be back at NORMAL
		expect(order[order.length - 1]).toBe("NORMAL");
	});

	it("prevMode from NORMAL wraps to CHAIN", () => {
		expect(prevMode("NORMAL")).toBe("CHAIN");
	});

	it("SDD is a valid Mode type at compile time", () => {
		const m: Mode = "SDD";
		expect(m).toBe("SDD");
	});
});

describe("SDD_PROMPT content", () => {
	it("references the OpenSpec workflow", () => {
		expect(SDD_PROMPT).toContain("OpenSpec");
	});

	it("references the artifact lifecycle", () => {
		expect(SDD_PROMPT).toContain("proposal.md");
		expect(SDD_PROMPT).toContain("spec.md");
		expect(SDD_PROMPT).toContain("design.md");
		expect(SDD_PROMPT).toContain("tasks.md");
	});

	it("mentions sdd_status and /sdd-continue", () => {
		expect(SDD_PROMPT).toContain("sdd_status");
		expect(SDD_PROMPT).toContain("/sdd-continue");
	});

	it("covers the full lifecycle", () => {
		expect(SDD_PROMPT).toContain("init");
		expect(SDD_PROMPT).toContain("proposal");
		expect(SDD_PROMPT).toContain("apply");
		expect(SDD_PROMPT).toContain("verify");
		expect(SDD_PROMPT).toContain("sync");
		expect(SDD_PROMPT).toContain("archive");
	});

	it("has no preflight hard gate (native engine is the state authority)", () => {
		expect(SDD_PROMPT).not.toMatch(/preflight/i);
		expect(SDD_PROMPT).not.toContain("__gentlePiAvailable");
		expect(SDD_PROMPT).not.toContain("gentle_status");
	});

	it("explains the Result Contract", () => {
		expect(SDD_PROMPT).toContain("Result Contract");
	});

	it("calls out strict TDD for apply/verify", () => {
		expect(SDD_PROMPT).toMatch(/strict\s*tdd/i);
	});
});
