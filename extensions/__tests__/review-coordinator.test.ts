import { describe, expect, it } from "vitest";
import { applyReceipt, createReviewState, validateReviewReceipt } from "../lib/review-coordinator.ts";

describe("review receipt diagnostics", () => {
  it("rejects malformed and unexpected receipts without applying them", () => {
    expect(validateReviewReceipt("not-json").valid).toBe(false);
    expect(validateReviewReceipt({ change: "demo", type: "UNKNOWN" }).reason).toContain("unexpected receipt type");
    expect(applyReceipt(createReviewState("demo"), { change: "demo", type: "UNKNOWN" } as any)).toBe("ignore");
  });
});

describe("review coordinator", () => {
  it("dispatches judges after implementation and consolidates both receipts", () => {
    const state = createReviewState("change");
    expect(applyReceipt(state, { type: "IMPLEMENTATION_RECEIPT", change: "change" })).toBe("dispatch-judges");
    expect(applyReceipt(state, { type: "REVIEW_A", change: "change" })).toBe("ignore");
    expect(applyReceipt(state, { type: "REVIEW_B", change: "change" })).toBe("consolidate");
  });

  it("dispatches fixes for blocking findings and completes on pass", () => {
    const state = createReviewState("change");
    applyReceipt(state, { type: "IMPLEMENTATION_RECEIPT", change: "change" });
    expect(applyReceipt(state, { type: "REVIEW_CONSOLIDATED", change: "change", verdict: "FAIL", blockingFindings: 1 })).toBe("dispatch-fix");
    expect(applyReceipt(state, { type: "REVIEW_FINAL", change: "change", verdict: "PASS", blockingFindings: 0 })).toBe("complete");
  });

  it("runs the complete fix and re-review loop", () => {
    const state = createReviewState("change", 3);
    expect(applyReceipt(state, { type: "IMPLEMENTATION_RECEIPT", change: "change", receiptId: "impl-1" })).toBe("dispatch-judges");
    expect(applyReceipt(state, { type: "REVIEW_A", change: "change", receiptId: "a-1" })).toBe("ignore");
    expect(applyReceipt(state, { type: "REVIEW_B", change: "change", receiptId: "b-1" })).toBe("consolidate");
    expect(applyReceipt(state, { type: "REVIEW_CONSOLIDATED", change: "change", verdict: "FAIL", blockingFindings: 1, receiptId: "c-1" })).toBe("dispatch-fix");
    expect(applyReceipt(state, { type: "FIX_RECEIPT", change: "change", receiptId: "fix-1" })).toBe("dispatch-judges");
    expect(applyReceipt(state, { type: "REVIEW_A", change: "change", receiptId: "a-2" })).toBe("ignore");
    expect(applyReceipt(state, { type: "REVIEW_B", change: "change", receiptId: "b-2" })).toBe("consolidate");
    expect(applyReceipt(state, { type: "REVIEW_CONSOLIDATED", change: "change", verdict: "PASS", blockingFindings: 0, receiptId: "c-2" })).toBe("ignore");
    expect(applyReceipt(state, { type: "REVIEW_FINAL", change: "change", verdict: "PASS", blockingFindings: 0, receiptId: "final-2" })).toBe("complete");
    expect(state.status).toBe("COMPLETE");
  });

  it("stops after the review budget", () => {
    const state = createReviewState("change", 1);
    expect(applyReceipt(state, { type: "IMPLEMENTATION_RECEIPT", change: "change" })).toBe("dispatch-judges");
    expect(applyReceipt(state, { type: "IMPLEMENTATION_RECEIPT", change: "change" })).toBe("stop");
  });
});
