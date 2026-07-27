// ABOUTME: Preflight state for SDD — delegates to gentle-pi's sdd-preflight.ts
// via file-based read. gentle-pi writes state to ~/.pi/agent/sdd-preflight.json.

import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { homedir } from "node:os";

// ── Types ─────────────────────────────────────────────────────────────────────

export type ExecutionMode = "interactive" | "auto";
export type ArtifactStore = "openspec" | "engram" | "both";
export type ChainedPrStrategy =
	| "auto-forecast"
	| "ask-always"
	| "single-pr-default"
	| "force-chained";

export interface PreflightState {
	executionMode: ExecutionMode;
	artifactStore: ArtifactStore;
	chainedPrStrategy: ChainedPrStrategy;
	reviewBudgetLines: number;
	captured: boolean;
	capturedAt?: string;
	source: "session" | "project" | "default";
}

export const EXECUTION_MODES: ExecutionMode[] = ["interactive", "auto"];
export const ARTIFACT_STORES: ArtifactStore[] = ["openspec", "engram", "both"];
export const CHAINED_PR_STRATEGIES: ChainedPrStrategy[] = [
	"auto-forecast",
	"ask-always",
	"single-pr-default",
	"force-chained",
];

export const DEFAULT_PREFLIGHT: PreflightState = {
	executionMode: "interactive",
	artifactStore: "openspec",
	chainedPrStrategy: "auto-forecast",
	reviewBudgetLines: 400,
	captured: false,
	source: "default",
};

// ── File paths ────────────────────────────────────────────────────────────────

const PREFLIGHT_FILE = join(homedir(), ".pi", "agent", "sdd-preflight.json");

function ensureDir(filePath: string): void {
	try {
		mkdirSync(dirname(filePath), { recursive: true });
	} catch {
		// Best-effort
	}
}

// ── State operations ──────────────────────────────────────────────────────────

export function loadPreflight(_cwd?: string): PreflightState {
	try {
		if (existsSync(PREFLIGHT_FILE)) {
			const raw = readFileSync(PREFLIGHT_FILE, "utf-8");
			const parsed = JSON.parse(raw) as PreflightState;
			// Validate shape
			if (
				typeof parsed.executionMode === "string" &&
				typeof parsed.captured === "boolean"
			) {
				return parsed;
			}
		}
	} catch {
		// Fall through to default
	}
	return { ...DEFAULT_PREFLIGHT };
}

export function savePreflight(_cwd: string, state: PreflightState): void {
	try {
		ensureDir(PREFLIGHT_FILE);
		writeFileSync(PREFLIGHT_FILE, JSON.stringify(state, null, 2), "utf-8");
	} catch {
		// Best-effort
	}
}

export function parseUserAnswers(
	_answers: Record<string, string>,
): Partial<PreflightState> {
	// Map ask_user answers to preflight fields
	const result: Partial<PreflightState> = {};
	if (_answers.executionMode) {
		result.executionMode = _answers.executionMode as ExecutionMode;
	}
	if (_answers.artifactStore) {
		result.artifactStore = _answers.artifactStore as ArtifactStore;
	}
	if (_answers.chainedPrStrategy) {
		result.chainedPrStrategy = _answers.chainedPrStrategy as ChainedPrStrategy;
	}
	if (_answers.reviewBudgetLines) {
		result.reviewBudgetLines = parseInt(_answers.reviewBudgetLines, 10);
	}
	return result;
}

export function isCaptured(state: PreflightState): boolean {
	return state.captured === true;
}
