// ABOUTME: Tests for the native engineering layer (lib/openspec-engineering.ts).
// ABOUTME: Verifies strict TDD assertion from config.yaml and the 4R review-lens classifier.

import { describe, it, expect } from "vitest";
import {
	assertStrictTdd,
	assertStrictTddFromConfig,
	buildReviewLenses,
	reviewWorkloadGuard,
	type ReviewLensResult,
} from "../lib/openspec-engineering.ts";

describe("assertStrictTdd", () => {
	it("returns disabled when config.yaml is absent", () => {
		expect(assertStrictTddFromConfig("/nonexistent/project-dir")).toEqual(
			expect.objectContaining({ enabled: false }),
		);
	});

	it("returns enabled with the runner when strict_tdd + test_command are set", () => {
		// Config contains the keys (this simulates the presence of a config block;
		// file reads are exercised in the e2e test).
		const out = assertStrictTdd({ strict_tdd: true, test_command: "npm test" }, "/tmp/config.yaml");
		expect(out.enabled).toBe(true);
		expect(out.runner).toBe("npm test");
	});

	it("returns a non-negotiable RED/GREEN/TRIANGULATE/REFACTOR prompt fragment when enabled", () => {
		const out = assertStrictTdd({ strict_tdd: true, test_command: "pytest" }, "/tmp/config.yaml");
		expect(out.enabled).toBe(true);
		expect(out.prompt).toMatch(/RED/);
		expect(out.prompt).toMatch(/GREEN/);
		expect(out.prompt).toMatch(/TRIANGULATE/);
		expect(out.prompt).toMatch(/REFACTOR/);
		expect(out.prompt).toContain("pytest");
	});

	it("returns disabled when strict_tdd is falsy", () => {
		const out = assertStrictTdd({ strict_tdd: false, test_command: "npm test" }, "/tmp/config.yaml");
		expect(out.enabled).toBe(false);
	});

	it("returns disabled when test_command is missing", () => {
		const out = assertStrictTdd({ strict_tdd: true }, "/tmp/config.yaml");
		expect(out.enabled).toBe(false);
	});
});

describe("buildReviewLenses", () => {
	it("returns zero lenses for a trivial diff", () => {
		const out = buildReviewLenses({ changedLines: 5, changedPaths: ["a.ts"] });
		expect(out.lenses).toEqual([]);
		expect(out.route).toBe("trivial");
	});

	it("returns a dominant lens for an ordinary diff", () => {
		const out = buildReviewLenses({ changedLines: 120, changedPaths: ["src/*.ts"] });
		expect(out.route).toBe("standard");
		expect(out.lenses.length).toBeGreaterThan(0);
		expect(out.lenses.length).toBeLessThanOrEqual(1);
	});

	it("returns the full 4R set above the workload threshold", () => {
		const out = buildReviewLenses({ changedLines: 450, changedPaths: ["src/*.ts"] });
		expect(out.route).toBe("full-4R");
		expect(out.lenses).toEqual([
			"review-risk",
			"review-resilience",
			"review-readability",
			"review-reliability",
		]);
	});

	it("detects a risky hot path (auth/security) in an ordinary-size diff", () => {
		const out = buildReviewLenses({ changedLines: 100, changedPaths: ["src/auth.ts"] });
		expect(out.route).toBe("standard");
		expect(out.lenses).toContain("review-risk");
	});
});

describe("reviewWorkloadGuard", () => {
	it("does not pause under the threshold", () => {
		expect(reviewWorkloadGuard({ changedLines: 100, changedPaths: [] }, 400)).toBe(false);
	});

	it("pauses above the threshold", () => {
		expect(reviewWorkloadGuard({ changedLines: 420, changedPaths: [] }, 400)).toBe(true);
	});

	it("respects a custom budget", () => {
		expect(reviewWorkloadGuard({ changedLines: 250, changedPaths: [] }, 200)).toBe(true);
	});
});
