/**
 * Tests for extensions/lib/mailbox-types.ts — receipt validation.
 *
 * Covers the blockingFindings coercion: the field is conceptually a count
 * (number), but multiple agent types have historically sent an array of
 * finding descriptions. The validator accepts both shapes for forward
 * compatibility while still rejecting genuinely invalid types.
 */

import { describe, it, expect } from "vitest";
import { validateMailboxReceipt } from "../lib/mailbox-types.ts";

const base = {
	type: "IMPLEMENTATION_RECEIPT",
	change: "demo",
	receiptId: "r1",
	correlationId: "c1",
	verdict: "PASS",
};

describe("validateMailboxReceipt — blockingFindings coercion", () => {
	it("accepts a finite number", () => {
		const r = validateMailboxReceipt({ ...base, blockingFindings: 0 });
		expect(r.valid).toBe(true);
		const r2 = validateMailboxReceipt({ ...base, blockingFindings: 3 });
		expect(r2.valid).toBe(true);
	});

	it("accepts an empty array and coerces to 0", () => {
		const value = { ...base, blockingFindings: [] };
		const r = validateMailboxReceipt(value);
		expect(r.valid).toBe(true);
		expect((value as any).blockingFindings).toBe(0);
	});

	it("accepts an array of finding descriptions and coerces to its length", () => {
		const findings = ["gap A", "gap B", "gap C"];
		const value = { ...base, blockingFindings: findings };
		const r = validateMailboxReceipt(value);
		expect(r.valid).toBe(true);
		expect((value as any).blockingFindings).toBe(3);
	});

	it("rejects a string", () => {
		const r = validateMailboxReceipt({ ...base, blockingFindings: "two" });
		expect(r.valid).toBe(false);
		expect(r.reason).toMatch(/finite number or array/i);
	});

	it("rejects an object", () => {
		const r = validateMailboxReceipt({ ...base, blockingFindings: { count: 2 } });
		expect(r.valid).toBe(false);
	});

	it("rejects NaN and Infinity", () => {
		expect(validateMailboxReceipt({ ...base, blockingFindings: NaN }).valid).toBe(false);
		expect(validateMailboxReceipt({ ...base, blockingFindings: Infinity }).valid).toBe(false);
	});

	it("allows blockingFindings to be omitted entirely", () => {
		const r = validateMailboxReceipt({ ...base });
		expect(r.valid).toBe(true);
	});
});
