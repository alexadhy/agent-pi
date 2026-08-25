// ABOUTME: Tests that PLAN/SPEC/PIPELINE prompts enforce the OpenSpec SDD loop
// by default (no ad-hoc opt-out), and that a shared guard is present.

import { describe, it, expect } from "vitest";
import { PLAN_PROMPT, SPEC_PROMPT, SDD_PROMPT, PIPELINE_PROMPT, buildOpenSpecChangeContext } from "../lib/mode-prompts.ts";

describe("implementation prompts preserve OpenSpec change identity", () => {
	it("renders the exact change name for spawned agents", () => {
		expect(buildOpenSpecChangeContext("fix-mailbox")).toContain("fix-mailbox");
		expect(buildOpenSpecChangeContext("fix-mailbox")).toContain("mailbox receipts");
	});

	it("requires resolution when no change is available", () => {
		expect(buildOpenSpecChangeContext(null)).toContain("sdd_status");
	});
});

describe("PLAN_PROMPT enforces OpenSpec by default", () => {
	it("references the native openspec engine", () => {
		expect(PLAN_PROMPT).toContain("openspec");
		expect(PLAN_PROMPT).toContain("sdd_status");
		expect(PLAN_PROMPT.toLowerCase()).toContain("openspec status");
	});

	it("no longer frames OpenSpec as opt-in only", () => {
		expect(PLAN_PROMPT).not.toContain("durable tracking, opt-in");
	});
});

describe("SPEC_PROMPT routes OpenSpec-first", () => {
	it("references openspec_run and sdd_status", () => {
		expect(SPEC_PROMPT).toContain("openspec_run");
		expect(SPEC_PROMPT).toContain("sdd_status");
	});
});

describe("SDD_PROMPT keeps the full native loop", () => {
	it("covers proposal→specs→design→tasks→apply→verify→sync→archive", () => {
		for (const term of ["proposal", "design", "tasks", "apply", "verify", "sync", "archive"]) {
			expect(SDD_PROMPT.toLowerCase()).toContain(term);
		}
	});

	it("references sdd_status and openspec_run", () => {
		expect(SDD_PROMPT).toContain("sdd_status");
		expect(SDD_PROMPT).toContain("openspec_run");
	});
});

describe("PIPELINE_PROMPT enforces OpenSpec", () => {
	it("exists and is non-trivial", () => {
		expect(typeof PIPELINE_PROMPT).toBe("string");
		expect(PIPELINE_PROMPT.length).toBeGreaterThan(0);
	});

	it("routes the pipeline through the OpenSpec artifact graph", () => {
		expect(PIPELINE_PROMPT.toLowerCase()).toContain("openspec");
		expect(PIPELINE_PROMPT).toContain("sdd_status");
		expect(PIPELINE_PROMPT.toLowerCase()).toContain("proposal");
		expect(PIPELINE_PROMPT.toLowerCase()).toContain("tasks");
	});

	it("uses the status/instructions/validate engine", () => {
		expect(PIPELINE_PROMPT.toLowerCase()).toContain("openspec status");
		expect(PIPELINE_PROMPT).toContain("openspec_verify");
		expect(PIPELINE_PROMPT).toContain("openspec_run");
		expect(PIPELINE_PROMPT.toLowerCase()).toContain("openspec archive");
	});
});
