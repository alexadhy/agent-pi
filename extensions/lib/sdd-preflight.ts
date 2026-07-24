// ABOUTME: Preflight state for SDD — captures 4 user choices per session before any SDD work.
// ABOUTME: Storage: ~/.pi/agent/sdd-preflight.json (session) with openspec/config.yaml `preflight:` section override.

import {
	existsSync,
	mkdirSync,
	readFileSync,
	writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { homedir } from "node:os";

// ── Types ────────────────────────────────────────

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

// ── Defaults ────────────────────────────────────

export const DEFAULT_PREFLIGHT: PreflightState = {
	executionMode: "interactive",
	artifactStore: "openspec",
	chainedPrStrategy: "auto-forecast",
	reviewBudgetLines: 400,
	captured: false,
	source: "default",
};

// ── Storage Paths ───────────────────────────────

function sessionPath(): string {
	return join(homedir(), ".pi", "agent", "sdd-preflight.json");
}

function projectConfigPath(cwd: string): string {
	return join(cwd, "openspec", "config.yaml");
}

// ── Load ────────────────────────────────────────

/**
 * Load preflight state with precedence:
 *   1. Project override (openspec/config.yaml `preflight:` section)
 *   2. Session default (~/.pi/agent/sdd-preflight.json)
 *   3. Hard-coded default
 *
 * Always returns a valid PreflightState. If no source has captured values,
 * the returned state has `captured: false` and `source: "default"`.
 */
export function loadPreflight(cwd: string): PreflightState {
	// 1. Project override (parse YAML, look for preflight: block)
	const project = loadFromProject(cwd);
	if (project) {
		return { ...project, source: "project" };
	}

	// 2. Session default
	const session = loadFromSession();
	if (session) {
		return { ...session, source: "session" };
	}

	// 3. Hard default
	return { ...DEFAULT_PREFLIGHT };
}

/**
 * Check if preflight has been captured by the user (any source).
 */
export function isCaptured(state: PreflightState): boolean {
	return state.captured === true;
}

// ── Save ────────────────────────────────────────

/**
 * Save preflight state to the session file (~/.pi/agent/sdd-preflight.json).
 * Adds capturedAt timestamp and forces captured: true.
 */
export function savePreflight(state: PreflightState): void {
	const path = sessionPath();
	mkdirSync(dirname(path), { recursive: true });
	const toSave: PreflightState = {
		...state,
		captured: true,
		capturedAt: new Date().toISOString(),
		source: "session",
	};
	writeFileSync(path, JSON.stringify(toSave, null, 2), "utf-8");
}

// ── Parse User Input ────────────────────────────

/**
 * Parse a /sdd-preflight command arg list into a partial PreflightState.
 * Returns empty object if args are missing/invalid — caller should fall back
 * to ask_user for the missing values.
 *
 * Accepts any order. Recognized flags:
 *   --mode <interactive|auto>
 *   --store <openspec|engram|both>
 *   --pr <strategy>
 *   --budget <int>
 *
 * Also accepts positional args in canonical order:
 *   [executionMode] [artifactStore] [chainedPrStrategy] [reviewBudgetLines]
 */
export function parseUserAnswers(args: string): Partial<PreflightState> {
	const tokens = args.trim().split(/\s+/).filter(Boolean);
	if (tokens.length === 0) return {};

	const out: Partial<PreflightState> = {};

	// Flag-style
	for (let i = 0; i < tokens.length; i++) {
		const t = tokens[i];
		if (t === "--mode" && tokens[i + 1]) {
			if (isExecutionMode(tokens[i + 1])) {
				out.executionMode = tokens[i + 1] as ExecutionMode;
			}
			i++;
		} else if (t === "--store" && tokens[i + 1]) {
			if (isArtifactStore(tokens[i + 1])) {
				out.artifactStore = tokens[i + 1] as ArtifactStore;
			}
			i++;
		} else if (t === "--pr" && tokens[i + 1]) {
			if (isChainedPrStrategy(tokens[i + 1])) {
				out.chainedPrStrategy = tokens[i + 1] as ChainedPrStrategy;
			}
			i++;
		} else if (t === "--budget" && tokens[i + 1]) {
			const n = parseInt(tokens[i + 1], 10);
			if (Number.isFinite(n) && n > 0) {
				out.reviewBudgetLines = n;
			}
			i++;
		}
	}

	// Positional fallback (only if a positional value is a valid option)
	if (out.executionMode === undefined) {
		for (const t of tokens) {
			if (isExecutionMode(t)) {
				out.executionMode = t as ExecutionMode;
				break;
			}
		}
	}
	if (out.artifactStore === undefined) {
		for (const t of tokens) {
			if (isArtifactStore(t)) {
				out.artifactStore = t as ArtifactStore;
				break;
			}
		}
	}
	if (out.chainedPrStrategy === undefined) {
		for (const t of tokens) {
			if (isChainedPrStrategy(t)) {
				out.chainedPrStrategy = t as ChainedPrStrategy;
				break;
			}
		}
	}
	if (out.reviewBudgetLines === undefined) {
		for (const t of tokens) {
			const n = parseInt(t, 10);
			if (Number.isFinite(n) && n > 0 && /^\d+$/.test(t)) {
				out.reviewBudgetLines = n;
				break;
			}
		}
	}

	return out;
}

// ── Helpers ─────────────────────────────────────

function isExecutionMode(s: string): s is ExecutionMode {
	return EXECUTION_MODES.includes(s as ExecutionMode);
}

function isArtifactStore(s: string): s is ArtifactStore {
	return ARTIFACT_STORES.includes(s as ArtifactStore);
}

function isChainedPrStrategy(s: string): s is ChainedPrStrategy {
	return CHAINED_PR_STRATEGIES.includes(s as ChainedPrStrategy);
}

function loadFromSession(): PreflightState | null {
	const path = sessionPath();
	if (!existsSync(path)) return null;
	try {
		const raw = JSON.parse(readFileSync(path, "utf-8")) as Partial<PreflightState>;
		if (!raw || typeof raw !== "object") return null;
		if (raw.captured !== true) return null;
		// Validate required fields
		if (!isExecutionMode(raw.executionMode ?? "")) return null;
		if (!isArtifactStore(raw.artifactStore ?? "")) return null;
		if (!isChainedPrStrategy(raw.chainedPrStrategy ?? "")) return null;
		const budget = Number(raw.reviewBudgetLines);
		if (!Number.isFinite(budget) || budget <= 0) return null;
		return {
			executionMode: raw.executionMode as ExecutionMode,
			artifactStore: raw.artifactStore as ArtifactStore,
			chainedPrStrategy: raw.chainedPrStrategy as ChainedPrStrategy,
			reviewBudgetLines: budget,
			captured: true,
			capturedAt: raw.capturedAt,
			source: "session",
		};
	} catch {
		return null;
	}
}

/**
 * Minimal YAML parse for the `preflight:` block in openspec/config.yaml.
 * Handles the simple key: value pattern (no nested blocks) — sufficient for
 * the 4 flat fields we need.
 */
function loadFromProject(cwd: string): PreflightState | null {
	const path = projectConfigPath(cwd);
	if (!existsSync(path)) return null;
	try {
		const content = readFileSync(path, "utf-8");
		const lines = content.split("\n");
		let inPreflight = false;
		const out: Partial<PreflightState> = {};

		for (const line of lines) {
			// Detect the preflight: block (top-level, not nested)
			if (/^preflight:\s*$/.test(line)) {
				inPreflight = true;
				continue;
			}
			// If we hit a non-indented line while in preflight, leave the block
			if (inPreflight && /^[a-zA-Z]/.test(line) && !line.startsWith(" ")) {
				inPreflight = false;
			}
			if (!inPreflight) continue;

			const kv = line.trim().match(/^([a-zA-Z_]+):\s*(.+?)\s*$/);
			if (!kv) continue;
			const [, key, value] = kv;
			const unquoted = value.replace(/^["']|["']$/g, "");

			if (key === "executionMode" && isExecutionMode(unquoted)) {
				out.executionMode = unquoted as ExecutionMode;
			} else if (key === "artifactStore" && isArtifactStore(unquoted)) {
				out.artifactStore = unquoted as ArtifactStore;
			} else if (key === "chainedPrStrategy" && isChainedPrStrategy(unquoted)) {
				out.chainedPrStrategy = unquoted as ChainedPrStrategy;
			} else if (key === "reviewBudgetLines") {
				const n = parseInt(unquoted, 10);
				if (Number.isFinite(n) && n > 0) {
					out.reviewBudgetLines = n;
				}
			}
		}

		// All 4 fields required
		if (
			out.executionMode &&
			out.artifactStore &&
			out.chainedPrStrategy &&
			out.reviewBudgetLines
		) {
			return {
				executionMode: out.executionMode,
				artifactStore: out.artifactStore,
				chainedPrStrategy: out.chainedPrStrategy,
				reviewBudgetLines: out.reviewBudgetLines,
				captured: true,
				source: "project",
			};
		}
		return null;
	} catch {
		return null;
	}
}
