import { describe, expect, it } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  applyReceipt, createReviewState, hasDurableReviewPass, loadReviewState,
  processReviewReceipt, reviewLedgerPath, reviewStatePath, saveReviewState,
} from "../lib/review-coordinator.ts";

describe("durable review coordinator", () => {
  it("creates the SQLite ledger schema and survives a restart", () => {
    const cwd = mkdtempSync(join(tmpdir(), "review-coordinator-"));
    try {
      const result = processReviewReceipt(cwd, { type: "IMPLEMENTATION_RECEIPT", change: "demo", receiptId: "r1" });
      expect(existsSync(reviewLedgerPath(cwd))).toBe(true);
      expect(result.state.round).toBe(1);
      expect(loadReviewState(cwd, "demo").dispatchIds).toEqual(["demo:1:judges"]);
    } finally { rmSync(cwd, { recursive: true, force: true }); }
  });

  it("deduplicates receipt IDs and correlation events transactionally", () => {
    const cwd = mkdtempSync(join(tmpdir(), "review-coordinator-"));
    try {
      const receipt = { type: "IMPLEMENTATION_RECEIPT" as const, change: "demo", receiptId: "r1", correlationId: "c1" };
      expect(processReviewReceipt(cwd, receipt).action).toBe("dispatch-judges");
      expect(processReviewReceipt(cwd, receipt).action).toBe("ignore");
      expect(processReviewReceipt(cwd, { ...receipt, receiptId: "r2" }).action).toBe("ignore");
      expect(loadReviewState(cwd, "demo").round).toBe(1);
    } finally { rmSync(cwd, { recursive: true, force: true }); }
  });

  it("imports legacy JSON once and leaves it as a readable backup", () => {
    const cwd = mkdtempSync(join(tmpdir(), "review-coordinator-"));
    try {
      const file = reviewStatePath(cwd, "demo");
      mkdirSync(join(cwd, "openspec", "changes", "demo"), { recursive: true });
      writeFileSync(file, JSON.stringify({ change: "demo", round: 2, status: "RUNNING", judgeA: true, receiptIds: ["old"], dispatchIds: ["demo:2:judges"] }));
      expect(loadReviewState(cwd, "demo")).toMatchObject({ round: 2, judgeA: true, receiptIds: ["old"] });
      writeFileSync(file, "not used after import");
      expect(loadReviewState(cwd, "demo").round).toBe(2);
    } finally { rmSync(cwd, { recursive: true, force: true }); }
  });

  it("recovers malformed legacy state as blocked rather than complete", () => {
    const cwd = mkdtempSync(join(tmpdir(), "review-coordinator-"));
    try {
      const file = reviewStatePath(cwd, "demo");
      mkdirSync(join(cwd, "openspec", "changes", "demo"), { recursive: true });
      writeFileSync(file, "{");
      expect(loadReviewState(cwd, "demo")).toMatchObject({ status: "BLOCKED", blocked: true, passed: false });
    } finally { rmSync(cwd, { recursive: true, force: true }); }
  });

  it("only completes after a durable REVIEW_FINAL PASS", () => {
    const cwd = mkdtempSync(join(tmpdir(), "review-coordinator-"));
    try {
      processReviewReceipt(cwd, { type: "IMPLEMENTATION_RECEIPT", change: "demo", receiptId: "impl" });
      processReviewReceipt(cwd, { type: "REVIEW_CONSOLIDATED", change: "demo", verdict: "CONCERNS", blockingFindings: 0, receiptId: "consolidated" });
      expect(hasDurableReviewPass(cwd, "demo")).toBe(false);
      processReviewReceipt(cwd, { type: "REVIEW_FINAL", change: "demo", verdict: "PASS", blockingFindings: 0, receiptId: "final" });
      expect(hasDurableReviewPass(cwd, "demo")).toBe(true);
    } finally { rmSync(cwd, { recursive: true, force: true }); }
  });

  it("blocks instead of dispatching beyond the configured maximum rounds", () => {
    const cwd = mkdtempSync(join(tmpdir(), "review-coordinator-"));
    try {
      expect(processReviewReceipt(cwd, { type: "IMPLEMENTATION_RECEIPT", change: "demo", receiptId: "impl-1" }, 3).action).toBe("dispatch-judges");
      for (let round = 1; round <= 3; round++) {
        expect(processReviewReceipt(cwd, { type: "REVIEW_CONSOLIDATED", change: "demo", verdict: "FAIL", blockingFindings: 1, receiptId: `blocked-${round}` }).action).toBe(round === 3 ? "stop" : "dispatch-fix");
        if (round < 3) processReviewReceipt(cwd, { type: "FIX_RECEIPT", change: "demo", receiptId: `fix-${round}` });
      }
      expect(loadReviewState(cwd, "demo")).toMatchObject({ status: "BLOCKED", round: 3 });
    } finally { rmSync(cwd, { recursive: true, force: true }); }
  });

  it("does not dispatch consolidation twice when a judge receipt is redelivered", () => {
    const state = createReviewState("demo");
    expect(applyReceipt(state, { type: "IMPLEMENTATION_RECEIPT", change: "demo", receiptId: "impl" })).toBe("dispatch-judges");
    expect(applyReceipt(state, { type: "REVIEW_B", change: "demo", receiptId: "b1" })).toBe("ignore");
    expect(applyReceipt(state, { type: "REVIEW_A", change: "demo", receiptId: "a1" })).toBe("consolidate");
    expect(applyReceipt(state, { type: "REVIEW_B", change: "demo", receiptId: "b2" })).toBe("ignore");
  });

  it("clears stale pass state when a fix starts a new round", () => {
    const state = createReviewState("demo");
    applyReceipt(state, { type: "IMPLEMENTATION_RECEIPT", change: "demo", receiptId: "impl" });
    applyReceipt(state, { type: "REVIEW_FINAL", change: "demo", verdict: "PASS", receiptId: "final" });
    // A completed review ignores later fixes, so assert the invariant directly on a running state.
    const running = createReviewState("demo");
    running.round = 1; running.status = "BLOCKED"; running.blocked = true; running.passed = true;
    expect(applyReceipt(running, { type: "FIX_RECEIPT", change: "demo", receiptId: "fix" })).toBe("dispatch-judges");
    expect(running.passed).toBe(false);
    expect(running.blocked).toBe(false);
  });

  it("sanitizes numeric fields imported from legacy JSON", () => {
    const cwd = mkdtempSync(join(tmpdir(), "review-coordinator-"));
    try {
      const file = reviewStatePath(cwd, "demo");
      mkdirSync(join(cwd, "openspec", "changes", "demo"), { recursive: true });
      writeFileSync(file, JSON.stringify({ round: "bad", maxRounds: "bad" }));
      expect(loadReviewState(cwd, "demo")).toMatchObject({ round: 0, maxRounds: 3, status: "PENDING" });
    } finally { rmSync(cwd, { recursive: true, force: true }); }
  });

  it("keeps the pure state-machine API compatible", () => {
    const state = createReviewState("demo");
    const receipt = { type: "IMPLEMENTATION_RECEIPT" as const, change: "demo", receiptId: "r1" };
    expect(applyReceipt(state, receipt)).toBe("dispatch-judges");
    expect(applyReceipt(state, receipt)).toBe("ignore");
    const cwd = mkdtempSync(join(tmpdir(), "review-coordinator-"));
    try { saveReviewState(cwd, state); expect(loadReviewState(cwd, "demo").round).toBe(1); }
    finally { rmSync(cwd, { recursive: true, force: true }); }
  });
});
