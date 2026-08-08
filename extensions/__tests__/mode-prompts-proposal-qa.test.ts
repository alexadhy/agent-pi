// ABOUTME: Tests that SDD_PROMPT routes the proposal through an interactive web
// Q&A flow (proposal-shaping questions → answers → final proposal → refine-or-not),
// and that PLAN_PROMPT references the same flow for durable OpenSpec changes.

import { describe, it, expect } from "vitest";
import { SDD_PROMPT, PLAN_PROMPT } from "../lib/mode-prompts.ts";

describe("SDD_PROMPT interactive proposal Q&A web flow", () => {
	it("routes the proposal through show_plan questions mode", () => {
		expect(SDD_PROMPT).toContain("show_plan");
		expect(SDD_PROMPT).toContain('mode: "questions"');
	});

	it("instructs writing proposal-shaping questions to a markdown file", () => {
		expect(SDD_PROMPT.toLowerCase()).toContain("proposal questions");
		expect(SDD_PROMPT).toContain("proposal-questions.md");
	});

	it("incorporates the returned answers into the final proposal", () => {
		expect(SDD_PROMPT.toLowerCase()).toContain("final proposal");
		expect(SDD_PROMPT).toContain("proposal.md");
	});

	it("asks whether to refine or approve after the final proposal", () => {
		expect(SDD_PROMPT.toLowerCase()).toContain("refine");
	});
});

describe("PLAN_PROMPT references the proposal Q&A web flow", () => {
	it("references show_plan questions mode for durable changes", () => {
		expect(PLAN_PROMPT).toContain("show_plan");
		expect(PLAN_PROMPT).toContain('mode: "questions"');
	});
});
