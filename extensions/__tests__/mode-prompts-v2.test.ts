// ABOUTME: Tests that SDD/SPEC mode prompts are decoupled from gentle-ai and
// ABOUTME: route through the native OpenSpec engine (sdd_status, openspec_run).

import { describe, it, expect } from "vitest";
import { SPEC_PROMPT, SDD_PROMPT, PLAN_PROMPT } from "../lib/mode-prompts.ts";

describe("SDD_PROMPT — decoupled from gentle-ai", () => {
	it("no longer references gentle-pi globals or gate", () => {
		expect(SDD_PROMPT).not.toContain("__gentlePiAvailable");
		expect(SDD_PROMPT).not.toContain("gentle_status");
		expect(SDD_PROMPT).not.toContain("gentle-pi");
	});

	it("no longer delegates to gentle-pi sdd-* agents", () => {
		expect(SDD_PROMPT).not.toContain('name: "sdd-proposal"');
		expect(SDD_PROMPT).not.toContain("sdd-proposal agent");
	});

	it("references native OpenSpec tools", () => {
		expect(SDD_PROMPT).toContain("sdd_status");
		expect(SDD_PROMPT).toContain("openspec_run");
	});

	it("references the native status/instructions/validate engine", () => {
		expect(SDD_PROMPT.toLowerCase()).toContain("openspec status");
		expect(SDD_PROMPT.toLowerCase()).toContain("openspec instructions");
		expect(SDD_PROMPT.toLowerCase()).toContain("openspec validate");
	});

	it("keeps the artifact lifecycle terms", () => {
		expect(SDD_PROMPT).toContain("proposal");
		expect(SDD_PROMPT).toContain("design");
		expect(SDD_PROMPT).toContain("tasks");
	});

	it("keeps the OpenSpec change-store reference", () => {
		expect(SDD_PROMPT).toContain("openspec/changes/");
	});
});

describe("SPEC_PROMPT — picks native OpenSpec when available", () => {
	it("no longer branches on gentle-pi availability", () => {
		expect(SPEC_PROMPT).not.toContain("__gentlePiAvailable");
		expect(SPEC_PROMPT).not.toContain("gentle_status");
		expect(SPEC_PROMPT).not.toContain("gentle-pi SDD");
	});

	it("routes to native OpenSpec as the default", () => {
		expect(SPEC_PROMPT.toLowerCase()).toContain("openspec");
		expect(SPEC_PROMPT).toContain("sdd_status");
	});

	it("keeps the context-os fallback for non-SDD spec work", () => {
		expect(SPEC_PROMPT.toLowerCase()).toContain("context-os");
	});
});

describe("PLAN_PROMPT — opens a path to durable OpenSpec tracking", () => {
	it("remains plan-first", () => {
		expect(typeof PLAN_PROMPT).toBe("string");
		expect(PLAN_PROMPT.length).toBeGreaterThan(0);
	});
});
