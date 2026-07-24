// ABOUTME: Tests for the SDD bridge extension (sdd-bridge.ts).
// ABOUTME: Verifies sdd_status JSON shape, openspec_run exit code handling, and command routing.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir, homedir } from "node:os";

import {
	buildSddStatus,
	determineNextPhase,
	parseTaskProgress,
	type OpenSpecChange,
} from "../sdd-bridge.ts";
import { savePreflight } from "../lib/sdd-preflight.ts";

// ── Fixtures ───────────────────────────────────────────────────────────────

let tmpDir: string;
let originalHome: string;

beforeEach(() => {
	tmpDir = mkdtempSync(join(tmpdir(), "sdd-test-"));
	originalHome = process.env.HOME || homedir();
	// Redirect HOME so preflight session file lives in tmpDir
	process.env.HOME = tmpDir;
});

afterEach(() => {
	if (existsSync(tmpDir)) {
		rmSync(tmpDir, { recursive: true, force: true });
	}
	process.env.HOME = originalHome;
});

function setupProject() {
	mkdirSync(join(tmpDir, "openspec", "specs"), { recursive: true });
	mkdirSync(join(tmpDir, "openspec", "changes", "archive"), { recursive: true });
}

function setupPreflight() {
	// Default-preflight-captured state for tests that don't care about preflight
	savePreflight({
		executionMode: "interactive",
		artifactStore: "openspec",
		chainedPrStrategy: "auto-forecast",
		reviewBudgetLines: 400,
		captured: true,
		source: "session",
	});
}

function makeChange(name: string, opts: {
	proposal?: boolean;
	spec?: boolean;
	design?: boolean;
	tasks?: string[];
} = {}) {
	const changeDir = join(tmpDir, "openspec", "changes", name);
	mkdirSync(changeDir, { recursive: true });

	if (opts.proposal) {
		writeFileSync(join(changeDir, "proposal.md"), "# Proposal\n");
	}
	if (opts.spec) {
		writeFileSync(join(changeDir, "spec.md"), "# Spec\n");
	}
	if (opts.design) {
		writeFileSync(join(changeDir, "design.md"), "# Design\n");
	}
	if (opts.tasks) {
		const body = opts.tasks.map((t) => `- [ ] ${t}`).join("\n");
		writeFileSync(join(changeDir, "tasks.md"), `# Tasks\n\n${body}\n`);
	}
}

// ── buildSddStatus ─────────────────────────────────────────────────────────

describe("buildSddStatus", () => {
	it("returns sdd-init when openspec/ doesn't exist", () => {
		setupPreflight();
		const status = buildSddStatus(tmpDir);
		expect(status.nextRecommended).toBe("sdd-init");
		expect(status.activeChange).toBeNull();
		expect(status.changes).toEqual([]);
	});

	it("returns sdd-proposal when no changes exist", () => {
		setupPreflight();
		setupProject();
		const status = buildSddStatus(tmpDir);
		expect(status.nextRecommended).toBe("sdd-proposal");
		expect(status.activeChange).toBeNull();
		expect(status.changes).toEqual([]);
	});

	it("returns the first incomplete change as active", () => {
		setupPreflight();
		setupProject();
		makeChange("feature-a", { proposal: true });
		makeChange("feature-b", { proposal: true, spec: true });

		const status = buildSddStatus(tmpDir);
		expect(status.activeChange).toBe("feature-a");
		expect(status.nextRecommended).toBe("sdd-spec");
		expect(status.changes).toHaveLength(2);
	});

	it("returns sdd-apply when all artifacts are present", () => {
		setupPreflight();
		setupProject();
		makeChange("full-change", {
			proposal: true,
			spec: true,
			design: true,
			tasks: ["task 1", "task 2"],
		});

		const status = buildSddStatus(tmpDir);
		expect(status.activeChange).toBe("full-change");
		expect(status.nextRecommended).toBe("sdd-apply");
		expect(status.taskProgress).toEqual({ total: 2, done: 0 });
	});

	it("exposes artifact paths", () => {
		setupPreflight();
		setupProject();
		makeChange("with-proposal", { proposal: true });

		const status = buildSddStatus(tmpDir);
		expect(status.artifactPaths).toEqual({
			proposal: join(tmpDir, "openspec", "changes", "with-proposal", "proposal.md"),
			spec: join(tmpDir, "openspec", "changes", "with-proposal", "spec.md"),
			design: join(tmpDir, "openspec", "changes", "with-proposal", "design.md"),
			tasks: join(tmpDir, "openspec", "changes", "with-proposal", "tasks.md"),
		});
	});

	it("ignores the archive directory when listing changes", () => {
		setupPreflight();
		setupProject();
		makeChange("active", { proposal: true });
		mkdirSync(join(tmpDir, "openspec", "changes", "archive", "old-thing"), {
			recursive: true,
		});

		const status = buildSddStatus(tmpDir);
		expect(status.changes).toHaveLength(1);
		expect(status.changes[0].name).toBe("active");
	});
});

// ── determineNextPhase ─────────────────────────────────────────────────────

describe("determineNextPhase", () => {
	const baseChange: OpenSpecChange = {
		name: "x",
		path: "/tmp/x",
		hasProposal: false,
		hasSpec: false,
		hasDesign: false,
		hasTasks: false,
	};

	it("routes to sdd-proposal when no artifacts", () => {
		expect(determineNextPhase({ ...baseChange })).toBe("sdd-proposal");
	});

	it("routes to sdd-spec when proposal exists", () => {
		expect(determineNextPhase({ ...baseChange, hasProposal: true })).toBe("sdd-spec");
	});

	it("routes to sdd-design when proposal + spec exist", () => {
		expect(
			determineNextPhase({ ...baseChange, hasProposal: true, hasSpec: true }),
		).toBe("sdd-design");
	});

	it("routes to sdd-tasks when proposal + spec + design exist", () => {
		expect(
			determineNextPhase({
				...baseChange,
				hasProposal: true,
				hasSpec: true,
				hasDesign: true,
			}),
		).toBe("sdd-tasks");
	});

	it("routes to sdd-apply when all artifacts exist", () => {
		expect(
			determineNextPhase({
				...baseChange,
				hasProposal: true,
				hasSpec: true,
				hasDesign: true,
				hasTasks: true,
			}),
		).toBe("sdd-apply");
	});
});

// ── parseTaskProgress ──────────────────────────────────────────────────────

describe("parseTaskProgress", () => {
	it("returns null for missing file", () => {
		expect(parseTaskProgress("/nonexistent/path.md")).toBeNull();
	});

	it("counts unchecked and checked tasks", () => {
		const tasksFile = join(tmpDir, "tasks.md");
		writeFileSync(
			tasksFile,
			"# Tasks\n\n- [ ] Task 1\n- [x] Task 2\n- [ ] Task 3\n- [X] Task 4\n",
		);
		expect(parseTaskProgress(tasksFile)).toEqual({ total: 4, done: 2 });
	});

	it("ignores non-task lines", () => {
		const tasksFile = join(tmpDir, "tasks.md");
		writeFileSync(tasksFile, "# Tasks\n\nSome prose here.\n\n- [ ] Task 1\n");
		expect(parseTaskProgress(tasksFile)).toEqual({ total: 1, done: 0 });
	});

	it("returns zero counts for tasks file with no checkboxes", () => {
		const tasksFile = join(tmpDir, "tasks.md");
		writeFileSync(tasksFile, "# Tasks\n\nJust prose, no checkboxes.\n");
		expect(parseTaskProgress(tasksFile)).toEqual({ total: 0, done: 0 });
	});
});

// ── buildSddStatus with preflight gate ────────────────────────────

describe("buildSddStatus with preflight gate", () => {
	it("returns nextRecommended='sdd-preflight' when preflight not captured", () => {
		// No savePreflight call — fresh tmpDir, no session file
		const status = buildSddStatus(tmpDir);
		expect(status.preflight.captured).toBe(false);
		expect(status.nextRecommended).toBe("sdd-preflight");
		expect(status.message).toMatch(/preflight not captured/i);
	});

	it("preflight takes precedence over openspec/ missing", () => {
		// Even with no openspec/ dir, preflight gate fires first
		const status = buildSddStatus(tmpDir);
		expect(status.nextRecommended).toBe("sdd-preflight");
	});

	it("returns preflight in status once captured", () => {
		savePreflight({
			executionMode: "auto",
			artifactStore: "openspec",
			chainedPrStrategy: "auto-forecast",
			reviewBudgetLines: 400,
			captured: true,
			source: "session",
		});

		const status = buildSddStatus(tmpDir);
		expect(status.preflight.captured).toBe(true);
		expect(status.preflight.executionMode).toBe("auto");
	});

	it("nextRecommended is normal SDD phase after preflight + openspec/ exist", () => {
		savePreflight({
			executionMode: "interactive",
			artifactStore: "openspec",
			chainedPrStrategy: "auto-forecast",
			reviewBudgetLines: 400,
			captured: true,
			source: "session",
		});
		setupProject();
		makeChange("with-proposal", { proposal: true });

		const status = buildSddStatus(tmpDir);
		expect(status.preflight.captured).toBe(true);
		expect(status.nextRecommended).toBe("sdd-spec");
		expect(status.activeChange).toBe("with-proposal");
	});

	it("nextRecommended='sdd-init' when preflight captured but openspec/ missing", () => {
		savePreflight({
			executionMode: "interactive",
			artifactStore: "openspec",
			chainedPrStrategy: "auto-forecast",
			reviewBudgetLines: 400,
			captured: true,
			source: "session",
		});

		const status = buildSddStatus(tmpDir);
		expect(status.preflight.captured).toBe(true);
		expect(status.nextRecommended).toBe("sdd-init");
	});
});
