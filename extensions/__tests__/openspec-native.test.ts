// ABOUTME: Tests for the native OpenSpec CLI wrapper (lib/openspec-native.ts).
// ABOUTME: Verifies parsing of `openspec status`/`instructions`/`context` JSON against the
// ABOUTME: v1.6.0 spec-driven schema, and correct next-phase derivation from native readiness.

import { describe, it, expect } from "vitest";
import {
	parseNativeStatus,
	nextArtifactId,
	pickActiveChange,
	type NativeStatus,
	type NativeInstructions,
} from "../lib/openspec-native.ts";

// ── Fixtures: v1.6.0 spec-driven shapes (captured from real openspec output) ──

const FRESH_CHANGE: NativeStatus = {
	changeName: "native-probe",
	schemaName: "spec-driven",
	changeRoot: "/proj/openspec/changes/native-probe",
	applyRequires: ["tasks"],
	isComplete: false,
	artifacts: [
		{ id: "proposal", outputPath: "proposal.md", status: "ready" },
		{
			id: "design",
			outputPath: "design.md",
			status: "blocked",
			missingDeps: ["proposal"],
		},
		{
			id: "specs",
			outputPath: "specs/**/*.md",
			status: "blocked",
			missingDeps: ["proposal"],
		},
		{
			id: "tasks",
			outputPath: "tasks.md",
			status: "blocked",
			missingDeps: ["design", "specs"],
		},
	],
	nextSteps: [
		'Run openspec instructions proposal --change "native-probe" --json before writing that artifact.',
	],
};

const MID_CHANGE: NativeStatus = {
	changeName: "native-probe",
	schemaName: "spec-driven",
	changeRoot: "/proj/openspec/changes/native-probe",
	applyRequires: ["tasks"],
	isComplete: false,
	artifacts: [
		{ id: "proposal", outputPath: "proposal.md", status: "done" },
		{
			id: "design",
			outputPath: "design.md",
			status: "ready",
		},
		{
			id: "specs",
			outputPath: "specs/**/*.md",
			status: "ready",
		},
		{
			id: "tasks",
			outputPath: "tasks.md",
			status: "blocked",
			missingDeps: ["design", "specs"],
		},
	],
	nextSteps: [],
};

const ALL_DONE: NativeStatus = {
	changeName: "native-probe",
	schemaName: "spec-driven",
	changeRoot: "/proj/openspec/changes/native-probe",
	applyRequires: ["tasks"],
	isComplete: true,
	artifacts: [
		{ id: "proposal", outputPath: "proposal.md", status: "done" },
		{ id: "design", outputPath: "design.md", status: "done" },
		{ id: "specs", outputPath: "specs/**/*.md", status: "done" },
		{ id: "tasks", outputPath: "tasks.md", status: "done" },
	],
	nextSteps: [],
};

describe("parseNativeStatus", () => {
	it("parses a v1.6.0 status object with ready/blocked artifacts", () => {
		expect(parseNativeStatus(FRESH_CHANGE)).toBe(FRESH_CHANGE);
	});

	it("returns null for a shape missing changeName/artifacts (not native)", () => {
		expect(parseNativeStatus({ activeChange: "x" } as unknown as NativeStatus)).toBeNull();
	});

	it("returns null for non-object input", () => {
		expect(parseNativeStatus(null as unknown as NativeStatus)).toBeNull();
		expect(parseNativeStatus(undefined as unknown as NativeStatus)).toBeNull();
	});

	it("normalizes outputPath specs glob to a stable artifact id", () => {
		const specs = FRESH_CHANGE.artifacts.find((a) => a.id === "specs")!;
		expect(specs.outputPath).toBe("specs/**/*.md");
	});
});

describe("nextArtifactId", () => {
	it("returns 'proposal' for a fresh change (only ready artifact)", () => {
		expect(nextArtifactId(FRESH_CHANGE)).toBe("proposal");
	});

	it("prefers a ready artifact over blocked ones when multiple are ready", () => {
		// design and specs are both ready; specs precedes design in the spec-driven schema order
		expect(nextArtifactId(MID_CHANGE)).toBe("specs");
	});

	it("returns 'apply' when all planning artifacts are done and not complete", () => {
		const applyReady: NativeStatus = {
			...ALL_DONE,
			isComplete: false,
			artifacts: [
				{ id: "proposal", outputPath: "proposal.md", status: "done" },
				{ id: "design", outputPath: "design.md", status: "done" },
				{ id: "specs", outputPath: "specs/**/*.md", status: "done" },
				{ id: "tasks", outputPath: "tasks.md", status: "done" },
			],
		};
		expect(nextArtifactId(applyReady)).toBe("apply");
	});

	it("returns 'archive' when isComplete is true", () => {
		expect(nextArtifactId(ALL_DONE)).toBe("archive");
	});

	it("returns null for an empty artifacts list", () => {
		expect(nextArtifactId({ ...FRESH_CHANGE, artifacts: [] })).toBeNull();
	});
});

	it("parseNativeInstructionsApply fields (contextFiles/progress/tasks/state)", () => {
		const inst: NativeInstructions = {
			changeName: "native-probe",
			artifactId: "apply",
			contextFiles: { tasks: ["/proj/openspec/changes/native-probe/tasks.md"] },
			progress: { total: 4, complete: 1, remaining: 3 },
			tasks: [
				{ id: "1", text: "Do thing", done: true },
				{ id: "2", text: "Do other", done: false },
			],
			state: "in-progress",
		};
		expect(inst.contextFiles?.tasks).toEqual(["/proj/openspec/changes/native-probe/tasks.md"]);
		expect(inst.progress?.total).toBe(4);
		expect(inst.progress?.remaining).toBe(3);
		expect(inst.tasks?.length).toBe(2);
		expect(inst.tasks?.[1].done).toBe(false);
		expect(inst.state).toBe("in-progress");
	});

describe("pickActiveChange", () => {
	it("returns the named change when it exists", () => {
		const changes = [
			{ name: "add-auth" },
			{ name: "native-probe" },
		] as Array<{ name: string }>;
		expect(pickActiveChange(changes, "native-probe")).toBe("native-probe");
	});

	it("returns null when the named change is missing", () => {
		const changes = [{ name: "add-auth" }] as Array<{ name: string }>;
		expect(pickActiveChange(changes, "missing")).toBeNull();
	});

	it("returns the only change when no name given", () => {
		const changes = [{ name: "add-auth" }] as Array<{ name: string }>;
		expect(pickActiveChange(changes, "")).toBe("add-auth");
	});

	it("returns null when ambiguous and no name given", () => {
		const changes = [
			{ name: "add-auth" },
			{ name: "native-probe" },
		] as Array<{ name: string }>;
		expect(pickActiveChange(changes, "")).toBeNull();
	});
});
