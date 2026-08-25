// ABOUTME: Shared types for durable SDD review coordination.

export type ReviewReceiptType =
  | "IMPLEMENTATION_RECEIPT" | "REVIEW_A" | "REVIEW_B"
  | "REVIEW_CONSOLIDATED" | "FIX_RECEIPT" | "REVIEW_FINAL";
export type ReviewVerdict = "PASS" | "FAIL" | "CONCERNS";
export type ReviewStatus = "PENDING" | "RUNNING" | "BLOCKED" | "COMPLETE";
export type ReviewAction = "dispatch-judges" | "consolidate" | "dispatch-fix" | "complete" | "stop" | "ignore";

export interface ReceiptValidation {
  valid: boolean;
  reason?: string;
}

export interface ReviewReceipt {
  type: ReviewReceiptType;
  change: string;
  verdict?: ReviewVerdict;
  blockingFindings?: number;
  body?: string;
  receiptId?: string;
  correlationId?: string;
  id?: string;
}

export interface ReviewState {
  change: string;
  round: number;
  maxRounds: number;
  status: ReviewStatus;
  judgeA: boolean;
  judgeB: boolean;
  passed: boolean;
  blocked: boolean;
  receiptIds: string[];
  correlationIds: string[];
  dispatchIds: string[];
  updatedAt: string;
}

export interface ReviewReceiptResult {
  action: ReviewAction;
  state: ReviewState;
  dispatchIds: string[];
}
