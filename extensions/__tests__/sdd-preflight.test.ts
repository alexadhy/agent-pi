// ABOUTME: Tests for the SDD preflight state module (sdd-preflight.ts).
// ABOUTME: Verifies load/save, default state, project override wins over session, parseUserAnswers.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir, homedir } from "node:os";

import {
	loadPreflight,
	savePreflight,
	parseUserAnswers,
	isCaptured,
	DEFAULT_PREFLIGHT,
	type PreflightState,
} from "../lib/sdd-preflight.ts";

// ── Fixtures ───────────────────────────────────────────────────────────────

let tmpDir: string;
let sessionBackup: string | null = null;
let originalHome: string;

beforeEach(() => {
	tmpDir = mkdtempSync(join(tmpdir(), "sdd-preflight-test-"));
	originalHome = process.env.HOME || homedir();
	// Redirect session file to a temp location by overriding HOME
	const sessionDir = join(tmpDir, "home");
	mkdirSync(sessionDir, { recursive: true });
	process.env.HOME = sessionDir;
	// Backup any real preflight file
	const realPath = join(originalHome, ".pi", "agent", "sdd-preflight.json");
	if (existsSync(realPath)) {
		sessionBackup = realPath;
	}
});

afterEach(() => {
	if (existsSync(tmpDir)) {
		rmSync(tmpDir, { recursive: true, force: true });
	}
	process.env.HOME = originalHome;
});

// ── loadPreflight defaults ────────────────────────────────────────────────

describe("loadPreflight defaults", () => {
	it("returns DEFAULT_PREFLIGHT when no session file and no project override", () => {
		const state = loadPreflight(tmpDir);
		expect(state.executionMode).toBe("interactive");
		expect(state.artifactStore).toBe("openspec");
		expect(state.chainedPrStrategy).toBe("auto-forecast");
		expect(state.reviewBudgetLines).toBe(400);
		expect(state.captured).toBe(false);
		expect(state.source).toBe("default");
	});

	it("isCaptured returns false for default state", () => {
		expect(isCaptured(loadPreflight(tmpDir))).toBe(false);
	});
});

// ── loadPreflight from session ────────────────────────────────────────────

describe("loadPreflight from session file", () => {
	it("returns session state when ~/.pi/agent/sdd-preflight.json exists", () => {
		const sessionFile = join(originalHome, ".pi", "agent", "sdd-preflight.json");
		// Save via the public API (HOME is redirected to tmpDir, so the file
		// goes to tmpDir/home/.pi/agent/sdd-preflight.json)
		savePreflight({
			executionMode: "auto",
			artifactStore: "engram",
			chainedPrStrategy: "force-chained",
			reviewBudgetLines: 600,
			captured: true,
			source: "session",
		});

		const state = loadPreflight(tmpDir);
		expect(state.executionMode).toBe("auto");
		expect(state.artifactStore).toBe("engram");
		expect(state.chainedPrStrategy).toBe("force-chained");
		expect(state.reviewBudgetLines).toBe(600);
		expect(state.captured).toBe(true);
		expect(state.source).toBe("session");
		expect(state.capturedAt).toBeDefined();
	});
});

// ── loadPreflight from project override ──────────────────────────────────

describe("loadPreflight from project override", () => {
	function makeProject(yml: string) {
		mkdirSync(join(tmpDir, "openspec"), { recursive: true });
		writeFileSync(join(tmpDir, "openspec", "config.yaml"), yml, "utf-8");
	}

	it("returns project state when openspec/config.yaml has preflight block", () => {
		makeProject([
			"schema: spec-driven",
			"",
			"preflight:",
			"  executionMode: auto",
			"  artifactStore: both",
			"  chainedPrStrategy: single-pr-default",
			"  reviewBudgetLines: 250",
		].join("\n"));

		const state = loadPreflight(tmpDir);
		expect(state.executionMode).toBe("auto");
		expect(state.artifactStore).toBe("both");
		expect(state.chainedPrStrategy).toBe("single-pr-default");
		expect(state.reviewBudgetLines).toBe(250);
		expect(state.captured).toBe(true);
		expect(state.source).toBe("project");
	});

	it("project override wins over session", () => {
		// Save session state (auto, openspec, ...)
		savePreflight({
			...DEFAULT_PREFLIGHT,
			executionMode: "auto",
			artifactStore: "engram",
		});
		// Project says interactive + openspec
		makeProject([
			"preflight:",
			"  executionMode: interactive",
			"  artifactStore: openspec",
			"  chainedPrStrategy: auto-forecast",
			"  reviewBudgetLines: 100",
		].join("\n"));

		const state = loadPreflight(tmpDir);
		// Project wins
		expect(state.executionMode).toBe("interactive");
		expect(state.artifactStore).toBe("openspec");
		expect(state.reviewBudgetLines).toBe(100);
		expect(state.source).toBe("project");
	});

	it("ignores invalid values in preflight block", () => {
		makeProject([
			"preflight:",
			"  executionMode: invalid-mode",
			"  artifactStore: openspec",
			"  chainedPrStrategy: auto-forecast",
			"  reviewBudgetLines: 200",
		].join("\n"));

		const state = loadPreflight(tmpDir);
		// Should fall through to session/default
		expect(state.captured).toBe(false);
	});

	it("ignores incomplete preflight blocks", () => {
		makeProject([
			"preflight:",
			"  executionMode: auto",
			"  artifactStore: openspec",
		].join("\n"));

		const state = loadPreflight(tmpDir);
		expect(state.captured).toBe(false);
	});
});

// ── savePreflight ─────────────────────────────────────────────────────────

describe("savePreflight", () => {
	it("writes valid JSON to ~/.pi/agent/sdd-preflight.json", () => {
		savePreflight({
			...DEFAULT_PREFLIGHT,
			executionMode: "auto",
		});

		const path = join(originalHome, ".pi", "agent", "sdd-preflight.json");
		// Since HOME is redirected, check there
		const redirectedPath = join(tmpDir, "home", ".pi", "agent", "sdd-preflight.json");
		expect(existsSync(redirectedPath)).toBe(true);

		const raw = JSON.parse(readFileSync(redirectedPath, "utf-8"));
		expect(raw.executionMode).toBe("auto");
		expect(raw.captured).toBe(true);
		expect(raw.capturedAt).toBeDefined();
	});

	it("forces captured: true and source: session even if input disagrees", () => {
		savePreflight({
			...DEFAULT_PREFLIGHT,
			captured: false,
			source: "default",
		});

		const state = loadPreflight(tmpDir);
		expect(state.captured).toBe(true);
		expect(state.source).toBe("session");
	});
});

// ── parseUserAnswers ──────────────────────────────────────────────────────

describe("parseUserAnswers", () => {
	it("returns empty object for empty input", () => {
		expect(parseUserAnswers("")).toEqual({});
	});

	it("parses positional arguments", () => {
		const out = parseUserAnswers("interactive openspec auto-forecast 400");
		expect(out).toEqual({
			executionMode: "interactive",
			artifactStore: "openspec",
			chainedPrStrategy: "auto-forecast",
			reviewBudgetLines: 400,
		});
	});

	it("parses flag-style arguments", () => {
		const out = parseUserAnswers("--mode auto --store engram --pr force-chained --budget 800");
		expect(out).toEqual({
			executionMode: "auto",
			artifactStore: "engram",
			chainedPrStrategy: "force-chained",
			reviewBudgetLines: 800,
		});
	});

	it("ignores invalid values", () => {
		const out = parseUserAnswers("invalid-mode openspec bad-strategy 100");
		expect(out).toEqual({
			artifactStore: "openspec",
			reviewBudgetLines: 100,
		});
	});

	it("parses partial input — only fills fields it can identify", () => {
		const out = parseUserAnswers("auto");
		expect(out).toEqual({ executionMode: "auto" });
	});

	it("handles mixed positional and flag", () => {
		const out = parseUserAnswers("auto --budget 200");
		expect(out).toEqual({
			executionMode: "auto",
			reviewBudgetLines: 200,
		});
	});

	it("rejects non-numeric budget", () => {
		const out = parseUserAnswers("auto openspec auto-forecast abc");
		expect(out).not.toHaveProperty("reviewBudgetLines");
	});
});
