// ABOUTME: Native engineering layer for OpenSpec SDD — strict TDD assertion from
// openspec/config.yaml plus a lightweight 4R code-review classifier and workload guard.
//
// OpenSpec CLI provides the artifact graph (status/instructions/validate) but NOT
// test-runner-driven strict TDD enforcement or code-review lenses. This module fills
// that gap natively, replacing the gentle-ai strict-tdd / review-triggers support
// without depending on the gentle-pi package.

import { readFileSync, existsSync } from "node:fs";

// ── Strict TDD ───────────────────────────────────────────────────────────────

export interface StrictTddConfig {
	strict_tdd?: boolean;
	test_command?: string;
}

export interface StrictTddResult {
	enabled: boolean;
	runner: string | null;
	prompt: string;
}

const STRICT_TDD_PROMPT = (runner: string): string =>
	[
		"STRICT TDD MODE IS ACTIVE.",
		`Test runner: ${runner}.`,
		"Follow RED, GREEN, TRIANGULATE, REFACTOR. Record evidence.",
		"RED: write a failing test first; GREEN: minimal code to pass; TRIANGULATE: add a distinct case; REFACTOR: clean without changing behavior.",
	].join(" ");

/**
 * Returns a strict-TDD prompt fragment when the config enables it, else disabled.
 * The config object is passed in for deterministic testing; the file read happens
 * through the e2e path (readStrictTddFromConfig).
 */
export function assertStrictTdd(
	config: StrictTddConfig,
	_configPath: string,
): StrictTddResult {
	if (config.strict_tdd === true && typeof config.test_command === "string" && config.test_command.length > 0) {
		return { enabled: true, runner: config.test_command, prompt: STRICT_TDD_PROMPT(config.test_command) };
	}
	return { enabled: false, runner: null, prompt: "" };
}

/** Read and parse the strict-TDD block from an openspec/config.yaml (best-effort). */
export function assertStrictTddFromConfig(cwd: string): StrictTddResult {
	const p = existsSync(cwd) ? cwd + "/openspec/config.yaml" : cwd;
	if (!existsSync(p)) return { enabled: false, runner: null, prompt: "" };
	try {
		const raw = readFileSync(p, "utf-8");
		const config: StrictTddConfig = parseConfigYaml(raw);
		return assertStrictTdd(config, p);
	} catch {
		return { enabled: false, runner: null, prompt: "" };
	}
}

/** Minimal YAML parser for the strict_tdd / test_command keys (no deps). */
function parseConfigYaml(raw: string): StrictTddConfig {
	const out: StrictTddConfig = {};
	for (const line of raw.split("\n")) {
		const m = /^\s*(\w+)\s*:\s*(.+?)\s*$/.exec(line);
		if (!m) continue;
		const key = m[1];
		const value = m[2].replace(/^["']|["']$/g, "");
		if (key === "strict_tdd") {
			out.strict_tdd = value === "true";
		} else if (key === "test_command") {
			out.test_command = value;
		}
	}
	return out;
}

// ── Review lenses ────────────────────────────────────────────────────────────

export const REVIEW_LENS = {
	RISK: "review-risk",
	RESILIENCE: "review-resilience",
	READABILITY: "review-readability",
	RELIABILITY: "review-reliability",
} as const;

export type ReviewLens = (typeof REVIEW_LENS)[keyof typeof REVIEW_LENS];

export const REVIEW_ROUTE = {
	TRIVIAL: "trivial",
	STANDARD: "standard",
	FULL_4R: "full-4R",
} as const;

export type ReviewRoute = (typeof REVIEW_ROUTE)[keyof typeof REVIEW_ROUTE];

export interface DiffEvidence {
	changedLines: number;
	changedPaths: string[];
}

export interface ReviewLensResult {
	route: ReviewRoute;
	lenses: ReviewLens[];
	dominant: ReviewLens | null;
}

const FULL_4R: readonly ReviewLens[] = [
	REVIEW_LENS.RISK,
	REVIEW_LENS.RESILIENCE,
	REVIEW_LENS.READABILITY,
	REVIEW_LENS.RELIABILITY,
];

const HOT_PATH_RE = /(auth|security|billing|payment|balance|wallet|permission|secret|token)/i;

/**
 * Classify a diff into a review route and lens set.
 *  - Trivial (<= 30 lines, not a hot path) → no lens.
 *  - Standard → exactly one dominant lens (risk if the diff touches a hot path, else readability).
 *  - >= 400 changed lines → full 4R.
 */
export function buildReviewLenses(diff: DiffEvidence): ReviewLensResult {
	const { changedLines, changedPaths } = diff;
	const hotPath = changedPaths.some((p) => HOT_PATH_RE.test(p));

	if (changedLines >= 400) {
		return { route: REVIEW_ROUTE.FULL_4R, lenses: [...FULL_4R], dominant: REVIEW_LENS.RISK };
	}
	if (changedLines <= 30 && !hotPath) {
		return { route: REVIEW_ROUTE.TRIVIAL, lenses: [], dominant: null };
	}
	const dominant: ReviewLens = hotPath ? REVIEW_LENS.RISK : REVIEW_LENS.READABILITY;
	return { route: REVIEW_ROUTE.STANDARD, lenses: [dominant], dominant };
}

/** Workload-guard: true when a change exceeds the allowed review budget in changed lines. */
export function reviewWorkloadGuard(diff: DiffEvidence, budgetLines: number): boolean {
	return diff.changedLines > budgetLines;
}
