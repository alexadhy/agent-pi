// ABOUTME: Backward-compatible facade for durable SDD review coordination.

import { ReviewLedger } from "./review/sqlite.ts";
import { validateReviewReceipt } from "./review/receipts.ts";
import { applyReceipt } from "./review/state-machine.ts";
import type { ReviewReceipt, ReviewReceiptResult, ReviewState } from "./review/types.ts";

export type {
  ReceiptValidation,
  ReviewAction,
  ReviewReceipt,
  ReviewReceiptResult,
  ReviewReceiptType,
  ReviewState,
  ReviewStatus,
  ReviewVerdict,
} from "./review/types.ts";
export { ReviewLedger, reviewLedgerPath, reviewStatePath, dispatchKey } from "./review/sqlite.ts";
export { applyReceipt, createReviewState } from "./review/state-machine.ts";
export { validateReviewReceipt } from "./review/receipts.ts";

export function loadReviewState(cwd: string, change: string, maxRounds = 3): ReviewState {
  const ledger = new ReviewLedger(cwd);
  try { return ledger.load(change, maxRounds); } finally { ledger.close(); }
}

export function saveReviewState(cwd: string, state: ReviewState): void {
  const ledger = new ReviewLedger(cwd);
  try { ledger.save(state); } finally { ledger.close(); }
}

export function processReviewReceipt(cwd: string, receipt: ReviewReceipt, maxRounds = 3): ReviewReceiptResult {
  const validation = validateReviewReceipt(receipt);
  if (!validation.valid) {
    throw new Error(validation.reason || "invalid review receipt");
  }
  const ledger = new ReviewLedger(cwd);
  try { return ledger.processReceipt(receipt, maxRounds); } finally { ledger.close(); }
}

export function hasPendingReviewDispatch(cwd: string, change: string, key: string): boolean {
  const ledger = new ReviewLedger(cwd);
  try { return ledger.pendingDispatch(change, key); } finally { ledger.close(); }
}

export function markReviewDispatch(cwd: string, change: string, key: string): void {
  const ledger = new ReviewLedger(cwd);
  try { ledger.markDispatched(change, key); } finally { ledger.close(); }
}

export function hasDurableReviewPass(cwd: string, change: string): boolean {
  const state = loadReviewState(cwd, change);
  return state.status === "COMPLETE" && state.passed === true;
}
