// ABOUTME: Review receipt validation and durable identity helpers.

import type { ReceiptValidation, ReviewReceipt, ReviewReceiptType } from "./types.ts";

const REVIEW_RECEIPT_TYPES = new Set<ReviewReceiptType>([
  "IMPLEMENTATION_RECEIPT", "REVIEW_A", "REVIEW_B", "REVIEW_CONSOLIDATED", "FIX_RECEIPT", "REVIEW_FINAL",
]);

export function validateReviewReceipt(receipt: unknown): ReceiptValidation {
  if (!receipt || typeof receipt !== "object") return { valid: false, reason: "receipt must be an object" };
  const value = receipt as Partial<ReviewReceipt>;
  if (typeof value.change !== "string" || !value.change.trim()) return { valid: false, reason: "missing change" };
  if (typeof value.type !== "string" || !REVIEW_RECEIPT_TYPES.has(value.type as ReviewReceiptType)) {
    return { valid: false, reason: `unexpected receipt type: ${String(value.type)}` };
  }
  return { valid: true };
}

export function receiptId(receipt: ReviewReceipt, round: number): string {
  return receipt.receiptId || receipt.id || `${receipt.type}:${receipt.correlationId || round}`;
}

export function correlationKey(receipt: ReviewReceipt): string {
  return receipt.correlationId ? `${receipt.type}:${receipt.correlationId}` : "";
}
