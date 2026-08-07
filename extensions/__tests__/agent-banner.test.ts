// ABOUTME: Tests for the agent banner's context panel — the stats line mirrors
// gentle-pi's startup banner (GIT / PATH / VER) rendered below the ASCII art.

import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { shortDir, loadStats } from "../agent-banner.ts";

describe("shortDir", () => {
	it("returns two path components: parent/child", () => {
		expect(shortDir("/a/b/c/project")).toBe("c/project");
	});

	it("returns just the basename when the dir has no real parent", () => {
		expect(shortDir("/project")).toBe("project");
	});
});

describe("loadStats", () => {
	it("always includes GIT, PATH, and VER rows", () => {
		const cwd = mkdtempSync(join(tmpdir(), "banner-"));
		const stats = loadStats({ hasUI: true, cwd } as any);
		const labels = stats.map(([l]) => l);
		expect(labels).toContain("GIT:");
		expect(labels).toContain("PATH:");
		expect(labels).toContain("VER:");
		expect(stats.find(([l]) => l === "VER:")![1]).toMatch(/^v/);
		if (existsSync(cwd)) rmSync(cwd, { recursive: true, force: true });
	});

	it("falls back to process.cwd() when ctx has no cwd", () => {
		const stats = loadStats({ hasUI: true } as any);
		expect(stats.find(([l]) => l === "PATH:")![1]).toContain("extensions");
	});

	it("git branch falls back to an em-dash when not a git repodir", () => {
		const cwd = mkdtempSync(join(tmpdir(), "no-git-"));
		const stats = loadStats({ hasUI: true, cwd } as any);
		expect(stats.find(([l]) => l === "GIT:")![1]).toBe("\u2014");
		if (existsSync(cwd)) rmSync(cwd, { recursive: true, force: true });
	});
});
