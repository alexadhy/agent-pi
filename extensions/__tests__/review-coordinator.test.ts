import { describe, expect, it } from "vitest";
import { applyReceipt, createReviewState } from "../lib/review-coordinator.ts";

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

  it("stops after the review budget", () => {
    const state = createReviewState("change", 1);
    expect(applyReceipt(state, { type: "IMPLEMENTATION_RECEIPT", change: "change" })).toBe("dispatch-judges");
    expect(applyReceipt(state, { type: "IMPLEMENTATION_RECEIPT", change: "change" })).toBe("stop");
  });
});
