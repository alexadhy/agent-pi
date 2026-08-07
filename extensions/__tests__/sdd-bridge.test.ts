// ABOUTME: Tests for the SDD bridge extension (sdd-bridge.ts).
// ABOUTME: Verifies native-first buildSddStatus (openspec status JSON when CLI resolves it;
// ABOUTME: deterministic fallback when the CLI is unavailable) and parseTaskProgress.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir, homedir } from "node:os";

import {
	buildSddStatus,
	parseTaskProgress,
	nativePhaseToLabel,
} from "../sdd-bridge.ts";

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

// ── buildSddStatus (native-first) ──────────────────────────────────────────

describe("buildSddStatus", () => {
	it("returns sdd-init when openspec/ doesn't exist", () => {
		const status = buildSddStatus(tmpDir);
		expect(status.nextRecommended).toBe("sdd-init");
		expect(status.activeChange).toBeNull();
		expect(status.changes).toEqual([]);
	});

	it("returns sdd-proposal when no changes exist", () => {
		setupProject();
		const status = buildSddStatus(tmpDir);
		expect(status.nextRecommended).toBe("sdd-proposal");
		expect(status.activeChange).toBeNull();
		expect(status.changes).toEqual([]);
	});

	it("returns the first incomplete change as active (fallback when CLI unavailable)", () => {
		setupProject();
		makeChange("feature-a", { proposal: true });
		makeChange("feature-b", { proposal: true, spec: true });

		const status = buildSddStatus(tmpDir);
		expect(status.activeChange).toBe("feature-a");
		expect(status.changes).toHaveLength(2);
		// Without a resolved native status, derivation is conservative: apply is the
		// terminal fallback. Native readiness drives the real phase via nextArtifactId.
		expect(status.nextRecommended).toBe("sdd-apply");
	});

	it("returns sdd-apply when all artifacts are present", () => {
		setupProject();
		makeChange("full-change", {
			proposal: true,
			spec: true,
			design: true,
			tasks: ["task 1", "task 2"],
		});

		const status = buildSddStatus(tmpDir);
		expect(status.activeChange).toBe("full-change");
		expect(status.taskProgress).toEqual({ total: 2, done: 0 });
	});

	it("exposes artifact paths for the active change", () => {
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
		setupProject();
		makeChange("active", { proposal: true });
		mkdirSync(join(tmpDir, "openspec", "changes", "archive", "old-thing"), {
			recursive: true,
		});

		const status = buildSddStatus(tmpDir);
		expect(status.changes).toHaveLength(1);
		expect(status.changes[0].name).toBe("active");
	});

	it("no longer gates on preflight — preflight state never blocks status", () => {
		// Whether or not a preflight file exists, nextRecommended must never be the
		// preflight gate; the native status engine is authoritative.
		setupProject();
		makeChange("c", { proposal: true });
		const status = buildSddStatus(tmpDir);
		expect(status.nextRecommended).not.toBe("sdd-preflight");
		expect(status.activeChange).toBe("c");
		expect(status.message).not.toMatch(/preflight not captured/i);
	});
});

// ── nativePhaseToLabel ─────────────────────────────────────────────────────

describe("nativePhaseToLabel", () => {
	it("maps artifact phases to sdd-* labels", () => {
		expect(nativePhaseToLabel("proposal")).toBe("sdd-proposal");
		expect(nativePhaseToLabel("specs")).toBe("sdd-spec");
		expect(nativePhaseToLabel("design")).toBe("sdd-design");
		expect(nativePhaseToLabel("tasks")).toBe("sdd-tasks");
	});

	it("maps terminal phases without 'sdd-' prefix", () => {
		expect(nativePhaseToLabel("apply")).toBe("sdd-apply");
		expect(nativePhaseToLabel("archive")).toBe("sdd-archive");
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
