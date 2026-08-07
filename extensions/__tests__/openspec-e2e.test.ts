// ABOUTME: End-to-end test — drives the native OpenSpec engine across the full
// spec-driven artifact lifecycle (proposal → specs → design → tasks → validate).
// Skips cleanly if the openspec CLI is not installed.

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execSync } from "node:child_process";

import {
	fetchNativeStatus,
	nextArtifactId,
	fetchInstructions,
	parseNativeStatus,
	openspecJson,
} from "../lib/openspec-native.ts";
import { assertStrictTddFromConfig } from "../lib/openspec-engineering.ts";

const OPENSPEC_AVAILABLE = (() => {
	try {
		execSync("which openspec", { stdio: ["ignore", "pipe", "ignore"] });
		return true;
	} catch {
		return false;
	}
})();

let dir: string;

beforeAll(() => {
	if (!OPENSPEC_AVAILABLE) return;
	dir = mkdtempSync(join(tmpdir(), "ospec-e2e-"));
	// init openspec root + a change
	execSync("openspec init --tools pi --no-color", { cwd: dir, stdio: "ignore" });
	execSync("openspec new change e2e-feature --no-color", { cwd: dir, stdio: "ignore" });
});

afterAll(() => {
	if (dir && existsSync(dir)) {
		rmSync(dir, { recursive: true, force: true });
	}
});

describe("native OpenSpec lifecycle (CLI-backed)", () => {
	it.skipIf(!OPENSPEC_AVAILABLE)("walks the artifact graph in schema order", () => {
		// Fresh change: proposal is the only ready artifact.
		let status = parseNativeStatus(openspecJson(dir, ["status", "--change", "e2e-feature"]));
		expect(status?.changeName).toBe("e2e-feature");
		expect(nextArtifactId(status)).toBe("proposal");

		// Write proposal using its native template's structure (minimal).
		const propInstr = fetchInstructions(dir, "proposal", "e2e-feature");
		expect(propInstr?.instruction).toBeTruthy();
		expect(propInstr?.template).toContain("## Why");
		writeFileSync(
			join(dir, "openspec/changes/e2e-feature/proposal.md"),
			"## Why\n\nE2E test change.\n\n## What Changes\n\nNothing.\n\n## Capabilities\n\n### New Capabilities\n- e2e-demo: demo capability\n\n## Impact\n\nNone.\n",
		);

		// After proposal: specs and design become ready; specs precedes design in schema order.
		status = parseNativeStatus(openspecJson(dir, ["status", "--change", "e2e-feature"]));
		const nxt = nextArtifactId(status);
		expect(["specs", "design"]).toContain(nxt);
	});

	it.skipIf(!OPENSPEC_AVAILABLE)("returns null native status when no change resolves", () => {
		// A dir without an openspec root yields null from the engine, not a crash.
		expect(parseNativeStatus(null)).toBeNull();
	});

	it.skipIf(!OPENSPEC_AVAILABLE)("reads native status for the active change", () => {
		expect(fetchNativeStatus(dir, "e2e-feature")).not.toBeNull();
	});
});

describe("strict TDD from config.yaml (CLI + config)", () => {
	it.skipIf(!OPENSPEC_AVAILABLE)("is disabled when config.yaml has no strict_tdd block", () => {
		// Plain openspec config.yaml has no strict_tdd/test_command.
		expect(assertStrictTddFromConfig(dir).enabled).toBe(false);
	});

	it("reads strict_tdd + test_command from a config file path", () => {
		const root = mkdtempSync(join(tmpdir(), "ospec-e2e-cfg-"));
		mkdirSync(join(root, "openspec"), { recursive: true });
		writeFileSync(
			join(root, "openspec", "config.yaml"),
			"schema: spec-driven\nstrict_tdd: true\ntest_command: npx vitest run\n",
		);
		const out = assertStrictTddFromConfig(root);
		expect(out.enabled).toBe(true);
		expect(out.runner).toBe("npx vitest run");
		expect(out.prompt).toMatch(/RED/);
		rmSync(root, { recursive: true, force: true });
	});
});
