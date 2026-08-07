// ABOUTME: Tests that the spec viewer's OpenSpec change layout discovery surfaces
// proposal, spec, design, and tasks as wizard steps.

import { describe, it, expect } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { discoverSpecDocuments } from "../spec-viewer.ts";

let dir: string;

beforeEach(() => {
	dir = mkdtempSync(join(tmpdir(), "ospec-board-"));
});

afterEach(() => {
	if (dir && existsSync(dir)) rmSync(dir, { recursive: true, force: true });
});

function write(p: string, content = "# x") {
	mkdirSync(join(dir, dirname(p)), { recursive: true });
	writeFileSync(join(dir, p), content, "utf-8");
}

describe("show_spec OpenSpec change discovery", () => {
	it("detects an OpenSpec change root and surfaces proposal/design/tasks/spec", () => {
		write("proposal.md", "# Proposal\n\nWhy\n");
		write("design.md", "# Design\n");
		write("tasks.md", "# Tasks\n\n- [ ] t1\n");
		write("specs/user-auth/spec.md", "# Requirement\nSHALL do x.\n");

		const docs = discoverSpecDocuments(dir);
		const keys = docs.map((d) => d.key);
		expect(keys).toContain("proposal");
		expect(keys).toContain("design");
		expect(keys).toContain("tasks");
		expect(keys.some((k) => k.startsWith("spec-"))).toBe(true);
	});

	it("orders proposal → spec → design → tasks", () => {
		write("proposal.md", "P");
		write("design.md", "D");
		write("tasks.md", "T");
		write("specs/one/spec.md", "S1");

		const docs = discoverSpecDocuments(dir);
		const labels = docs.map((d) => d.label);
		expect(labels[0]).toBe("Proposal");
		expect(labels[labels.length - 1]).toBe("Tasks");
		expect(labels[labels.length - 2]).toBe("Design");
		expect(labels.some((l) => l.startsWith("Spec"))).toBe(true);
	});

	it("does not crash for a non-OpenSpec folder", () => {
		write("note.md", "just a note");
		expect(Array.isArray(discoverSpecDocuments(dir))).toBe(true);
	});
});
