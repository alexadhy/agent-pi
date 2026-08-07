// ABOUTME: Native OpenSpec CLI wrapper — typed parsing of `openspec status/instructions/context`
// ABOUTME: plus pure next-phase derivation. This is the state authority for spec-driven SDD,
// ABOUTME: replacing gentle-ai's file-based sdd-status heuristics.
//
// BYPASSES: v1.6.0 native `openspec status --json`, `openspec instructions <artifact> --json`,
// `openspec context --json`, `openspec list --json`.
//
// THE ONLY dependency is the openspec CLI. No gentle-pi, no hand-rolled file-presence heuristics.

import { execSync } from "node:child_process";

// ── Types (v1.6.0 spec-driven schema) ─────────────────────────────────────────

export interface NativeArtifact {
	id: string;
	outputPath: string;
	status: "ready" | "blocked" | "done";
	missingDeps?: string[];
}

export interface NativeStatus {
	changeName: string;
	schemaName: string;
	changeRoot: string;
	applyRequires: string[];
	isComplete: boolean;
	artifacts: NativeArtifact[];
	nextSteps?: string[];
	planningHome?: unknown;
	artifactPaths?: Record<string, unknown>;
	actionContext?: {
		mode?: string;
		allowedEditRoots?: string[];
		constraints?: string[];
	};
}

export interface NativeInstructions {
	changeName?: string;
	artifactId?: string;
	description?: string;
	instruction?: string;
	template?: string;
	dependencies?: string[];
	unlocks?: string[];
	outputPath?: string;
	resolvedOutputPath?: string;
	existingOutputPaths?: string[];
	// `openspec instructions apply` (special case) returns these apply-phase fields:
	contextFiles?: Record<string, string[]>;
	progress?: { total?: number; complete?: number; remaining?: number };
	tasks?: Array<{ id?: string; text?: string; done?: boolean }>;
	state?: "blocked" | "all_done" | "ready" | "in-progress";
}

// ── Detection / parsing ──────────────────────────────────────────────────────

function isNativeStatus(v: unknown): v is NativeStatus {
	return (
		typeof v === "object" &&
		v !== null &&
		typeof (v as NativeStatus).changeName === "string" &&
		Array.isArray((v as NativeStatus).artifacts)
	);
}

/** Accepts a raw parsed JSON object; returns null if it is not a native status shape. */
export function parseNativeStatus(raw: unknown): NativeStatus | null {
	return isNativeStatus(raw) ? raw : null;
}

// ── Schema-ordered next ready artifact ────────────────────────────────────────

/** Preferred spec-driven build order. Unknown artifact ids trail at the end. */
const SCHEMA_ORDER = ["proposal", "specs", "design", "tasks"];

/**
 * Derive the next phase from native readiness.
 * Returns an artifact id ("proposal" | "specs" | "design" | "tasks"), or
 * "apply"/"archive" for the terminal phases, or null when nothing is actionable.
 */
export function nextArtifactId(status: NativeStatus | null): string | null {
	if (!status) return null;
	if (status.isComplete) return "archive";

	// A ready artifact whose dependencies are satisfied is the next to write.
	const ready = status.artifacts
		.filter((a) => a.status === "ready")
		.sort((a, b) => orderOf(a.id) - orderOf(b.id));
	if (ready.length > 0) return ready[0].id;

	// No ready artifact: if all planning artifacts are done, implementation is next.
	const planningIds = status.artifacts.map((a) => a.id);
	const allDone =
		planningIds.length > 0 &&
		status.artifacts.every((a) => a.status === "done");
	if (allDone) return "apply";

	// Some artifact is blocked on a missing dep → the dep is the next step.
	const missing = status.artifacts
		.filter((a) => a.status === "blocked" && a.missingDeps?.length)
		.flatMap((a) => a.missingDeps!);
	if (missing.length > 0) return missing[0];

	return null;
}

function orderOf(id: string): number {
	const i = SCHEMA_ORDER.indexOf(id);
	return i === -1 ? SCHEMA_ORDER.length : i;
}

// ── Active change selection ──────────────────────────────────────────────────

/**
 * Pick the active change. Prefer the explicit name; else the only change;
 * else null when ambiguous (caller must ask).
 */
export function pickActiveChange(
	changes: Array<{ name: string }>,
	named?: string,
): string | null {
	const names = changes.map((c) => c.name);
	if (named) return names.includes(named) ? named : null;
	if (names.length === 1) return names[0];
	return null;
}

// ── CLI execution (synchronous, JSON) ─────────────────────────────────────────

function openspecAvailable(): boolean {
	try {
		execSync("which openspec", { stdio: ["ignore", "pipe", "ignore"] });
		return true;
	} catch {
		return false;
	}
}

/** Run `openspec <args> --json` and return the parsed object, or null on any failure. */
export function openspecJson<T = unknown>(cwd: string, args: string[]): T | null {
	if (!openspecAvailable()) return null;
	try {
		const out = execSync(`openspec ${args.join(" ")} --json 2>/dev/null`, {
			cwd,
			encoding: "utf-8",
			stdio: ["ignore", "pipe", "ignore"],
			timeout: 15000,
		});
		return JSON.parse(out) as T;
	} catch {
		return null;
	}
}

/** Fetch native status for a change (or the nearest active change). */
export function fetchNativeStatus(cwd: string, changeName?: string): NativeStatus | null {
	const args = changeName
		? ["status", "--change", changeName]
		: ["status"];
	const raw = openspecJson(cwd, args);
	return parseNativeStatus(raw as unknown);
}

/** Fetch per-artifact instructions for a change. */
export function fetchInstructions(
	cwd: string,
	artifactId: string,
	changeName: string,
): NativeInstructions | null {
	const raw = openspecJson<NativeInstructions>(cwd, [
		"instructions",
		artifactId,
		"--change",
		changeName,
	]);
	return raw;
}

/** List active changes. */
export function listChangesNames(cwd: string): Array<{ name: string }> {
	const raw = openspecJson<Array<{ name: string }>>(cwd, ["list"]);
	return Array.isArray(raw) ? raw : [];
}
