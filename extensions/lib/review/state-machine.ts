// ABOUTME: Pure review state transitions with no filesystem or database access.

import { correlationKey, receiptId, validateReviewReceipt } from "./receipts.ts";
import type { ReviewAction, ReviewReceipt, ReviewState } from "./types.ts";

export function createReviewState(change: string, maxRounds = 3): ReviewState {
  return {
    change, round: 0, maxRounds: Math.max(1, maxRounds), status: "PENDING",
    judgeA: false, judgeB: false, passed: false, blocked: false,
    receiptIds: [], correlationIds: [], dispatchIds: [], updatedAt: new Date().toISOString(),
  };
}

export function applyReceipt(state: ReviewState, receipt: ReviewReceipt): ReviewAction {
  if (!validateReviewReceipt(receipt).valid || receipt.change !== state.change) return "ignore";
  const id = receiptId(receipt, state.round);
  const correlation = correlationKey(receipt);
  if (state.receiptIds.includes(id) || (correlation && state.correlationIds.includes(correlation))) return "ignore";
  state.receiptIds.push(id);
  if (correlation) state.correlationIds.push(correlation);
  state.updatedAt = new Date().toISOString();
  if (state.status === "COMPLETE") return "ignore";
  switch (receipt.type) {
    case "IMPLEMENTATION_RECEIPT":
      if (state.round >= state.maxRounds) { state.status = "BLOCKED"; state.blocked = true; return "stop"; }
      state.round++; state.judgeA = false; state.judgeB = false; state.passed = false; state.blocked = false; state.status = "RUNNING"; return "dispatch-judges";
    case "REVIEW_A":
      if (state.judgeA) return "ignore";
      state.judgeA = true;
      return state.judgeB ? "consolidate" : "ignore";
    case "REVIEW_B":
      if (state.judgeB) return "ignore";
      state.judgeB = true;
      return state.judgeA ? "consolidate" : "ignore";
    case "REVIEW_CONSOLIDATED":
      state.blocked = (receipt.blockingFindings || 0) > 0 || receipt.verdict === "FAIL";
      state.status = state.blocked ? "BLOCKED" : "RUNNING"; state.passed = false;
      return state.blocked ? (state.round >= state.maxRounds ? "stop" : "dispatch-fix") : "ignore";
    case "FIX_RECEIPT":
      if (state.round >= state.maxRounds) { state.status = "BLOCKED"; state.blocked = true; return "stop"; }
      state.round++; state.judgeA = false; state.judgeB = false; state.passed = false; state.blocked = false; state.status = "RUNNING"; return "dispatch-judges";
    case "REVIEW_FINAL":
      state.passed = receipt.verdict === "PASS" && !(receipt.blockingFindings || 0);
      state.blocked = !state.passed; state.status = state.passed ? "COMPLETE" : "BLOCKED";
      return state.passed ? "complete" : state.round >= state.maxRounds ? "stop" : "dispatch-fix";
    default:
      return "ignore";
  }
}
