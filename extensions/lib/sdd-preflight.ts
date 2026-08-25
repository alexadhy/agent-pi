// ABOUTME: Preflight state for SDD — delegates to gentle-pi's sdd-preflight.ts
// via file-based read. gentle-pi writes state to ~/.pi/agent/sdd-preflight.json.

import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { homedir } from "node:os";
import { parse as parseYaml } from "yaml";

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

function getPreflightFile(): string {
	return join(process.env.HOME || homedir(), ".pi", "agent", "sdd-preflight.json");
}

function ensureDir(filePath: string): void {
	try {
		mkdirSync(dirname(filePath), { recursive: true });
	} catch {
		// Best-effort
	}
}

// ── State operations ──────────────────────────────────────────────────────────

export function loadPreflight(cwd?: string): PreflightState {
	if (cwd) {
		try {
			const config = parseYaml(readFileSync(join(cwd, "openspec", "config.yaml"), "utf-8"))?.preflight;
			if (config && EXECUTION_MODES.includes(config.executionMode) && ARTIFACT_STORES.includes(config.artifactStore) && CHAINED_PR_STRATEGIES.includes(config.chainedPrStrategy) && Number.isFinite(config.reviewBudgetLines)) {
				return { ...DEFAULT_PREFLIGHT, ...config, captured: true, capturedAt: new Date().toISOString(), source: "project" };
			}
		} catch {}
	}
	try {
		const preflightFile = getPreflightFile();
		if (existsSync(preflightFile)) {
			const raw = readFileSync(preflightFile, "utf-8");
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

export function savePreflight(stateOrCwd: PreflightState | string, maybeState?: PreflightState): void {
	try {
		const state = typeof stateOrCwd === "string" ? maybeState! : stateOrCwd;
		const preflightFile = getPreflightFile();
		ensureDir(preflightFile);
		writeFileSync(preflightFile, JSON.stringify({ ...state, captured: true, capturedAt: new Date().toISOString(), source: "session" }, null, 2), "utf-8");
	} catch {
		// Best-effort
	}
}

export function parseUserAnswers(
	_answers: Record<string, string> | string,
): Partial<PreflightState> {
	// Accept both structured answers and the legacy positional string form.
	const answers = typeof _answers === "string"
		? (() => {
			const tokens = _answers.split(/\s+/).filter(Boolean);
			const result: Record<string, string> = {};
			for (let i = 0; i < tokens.length; i++) {
				const token = tokens[i];
				if (token === "--mode") result.executionMode = tokens[++i] || "";
				else if (token === "--store") result.artifactStore = tokens[++i] || "";
				else if (token === "--pr") result.chainedPrStrategy = tokens[++i] || "";
				else if (token === "--budget") result.reviewBudgetLines = tokens[++i] || "";
				else if (!token.startsWith("-")) {
					const key = ["executionMode", "artifactStore", "chainedPrStrategy", "reviewBudgetLines"][Object.keys(result).length];
					if (key) result[key] = token;
				}
			}
			return result;
		})()
		: _answers;
	const result: Partial<PreflightState> = {};
	if (answers.executionMode && EXECUTION_MODES.includes(answers.executionMode as ExecutionMode)) result.executionMode = answers.executionMode as ExecutionMode;
	if (answers.artifactStore && ARTIFACT_STORES.includes(answers.artifactStore as ArtifactStore)) result.artifactStore = answers.artifactStore as ArtifactStore;
	if (answers.chainedPrStrategy && CHAINED_PR_STRATEGIES.includes(answers.chainedPrStrategy as ChainedPrStrategy)) result.chainedPrStrategy = answers.chainedPrStrategy as ChainedPrStrategy;
	if (answers.reviewBudgetLines && Number.isFinite(Number(answers.reviewBudgetLines))) result.reviewBudgetLines = parseInt(answers.reviewBudgetLines, 10);
	return result;
}

export function isCaptured(state: PreflightState): boolean {
	return state.captured === true;
}
