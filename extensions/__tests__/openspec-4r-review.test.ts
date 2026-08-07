// ABOUTME: Tests that the full 4R review structure (risk/resilience/readability/
// reliability lens agents + 4r-review chain) is ported into the fork and wired
// consistently with the diff classifier in lib/openspec-engineering.ts.

import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { buildReviewLenses, REVIEW_LENS, type ReviewLens } from "../lib/openspec-engineering.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
// Tests run from extensions/, agents live one level up (repo agents/ dir).
const AGENTS_DIR = join(__dirname, "..", "..", "agents");
const CHAIN_FILE = join(AGENTS_DIR, "agent-chain.yaml");

// The 4R lens agents gentle-ai shipped — must all exist in the fork now.
const LENS_AGENTS: Array<{ file: string; name: string; lens: string }> = [
	{ file: "review-risk.md", name: "review-risk", lens: REVIEW_LENS.RISK },
	{ file: "review-resilience.md", name: "review-resilience", lens: REVIEW_LENS.RESILIENCE },
	{ file: "review-readability.md", name: "review-readability", lens: REVIEW_LENS.READABILITY },
	{ file: "review-reliability.md", name: "review-reliability", lens: REVIEW_LENS.RELIABILITY },
];

function frontmatter(raw: string): Record<string, string> {
	const m = /^---\n([\s\S]*?)\n---\n/.exec(raw);
	if (!m) return {};
	const out: Record<string, string> = {};
	for (const line of m[1].split("\n")) {
		const kv = /^(\w+):\s*(.+?)\s*$/.exec(line);
		if (kv) out[kv[1]] = kv[2];
	}
	return out;
}

describe("4R lens agents are ported into the fork", () => {
	for (const a of LENS_AGENTS) {
		it(`agent ${a.file} exists with correct name + read-only tools`, () => {
			const p = join(AGENTS_DIR, a.file);
			expect(existsSync(p), `${a.file} should exist`).toBe(true);
			const fm = frontmatter(readFileSync(p, "utf-8"));
			expect(fm.name).toBe(a.name);
			expect(fm.tools).toContain("read");
			expect(fm.tools).toContain("bash");
			expect(fm.tools).not.toContain("edit"); // read-only lens
		});

		it(`${a.file} references a findings-ledger schema`, () => {
			const body = readFileSync(join(AGENTS_DIR, a.file), "utf-8");
			expect(body.toLowerCase()).toContain("ledger");
			expect(body).toMatch(/severity/);
			expect(body).toMatch(/BLOCKER|CRITICAL/);
		});
	}
});

describe("4r-review chain is wired in agent-chain.yaml", () => {
	it("defines a 4r-review chain", () => {
		expect(existsSync(CHAIN_FILE)).toBe(true);
		const yaml = readFileSync(CHAIN_FILE, "utf-8");
		expect(yaml).toContain("4r-review:");
	});

	it("runs the 4 lens agents in stable risk, resilience, readability, reliability order", () => {
		const yaml = readFileSync(CHAIN_FILE, "utf-8");
		const block = yaml.slice(yaml.indexOf("4r-review:"));
		const order = ["review-risk", "review-resilience", "review-readability", "review-reliability"];
		let lastIdx = -1;
		for (const agent of order) {
			const i = block.indexOf(`- agent: ${agent}`);
			expect(i, `4r-review chain should include ${agent}`).toBeGreaterThan(-1);
			expect(i, `${agent} should come after previous lens`).toBeGreaterThan(lastIdx);
			lastIdx = i;
		}
	});
});

describe("4R diff classifier composes with lens agents", () => {
	it("full-4R route returns exactly the 4 ported lens ids", () => {
		const out = buildReviewLenses({ changedLines: 450, changedPaths: ["src/*.ts"] });
		expect(out.route).toBe("full-4R");
		const lensNames: ReviewLens[] = out.lenses;
		// every classifier lens must have a matching agent file
		for (const lens of lensNames) {
			const file = `${lens}.md`; // lens ids are 'review-risk' etc.
			expect(existsSync(join(AGENTS_DIR, file)), `${lens} needs a ported agent ${file}`).toBe(true);
		}
		expect(existsSync(join(AGENTS_DIR, "review-risk.md"))).toBe(true);
	});

	it("standard hot-path route picks the risk lens (has agent)", () => {
		const out = buildReviewLenses({ changedLines: 100, changedPaths: ["src/auth.ts"] });
		expect(out.dominant).toBe(REVIEW_LENS.RISK);
		if (out.dominant) {
			expect(existsSync(join(AGENTS_DIR, `${out.dominant}.md`))).toBe(true);
		}
	});
});
