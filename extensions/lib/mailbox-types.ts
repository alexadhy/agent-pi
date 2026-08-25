// ABOUTME: Shared mailbox message and receipt types used by mailbox and orchestration extensions.

export interface MailMessage {
  id: string;
  from: string;
  to: string;
  body: string;
  message_type: string;
  createdAt: string;
  read: boolean;
}

/** The transport shape accepted when a mailbox message is delivered to a consumer. */
export interface MailboxNotification {
  id?: string;
  body?: string;
}

/** Common receipt envelope. Individual consumers may validate receipt-specific fields. */
export interface MailboxReceipt {
  type: string;
  change: string;
  receiptId?: string;
  correlationId?: string;
  id?: string;
  verdict?: string;
  blockingFindings?: number;
  body?: string;
}

export interface ValidationResult {
  valid: boolean;
  reason?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function validateMailMessage(value: unknown): ValidationResult {
  if (!isRecord(value)) return { valid: false, reason: "message must be an object" };
  for (const field of ["id", "from", "to", "body", "message_type", "createdAt"]) {
    if (typeof value[field] !== "string" || !value[field]) {
      return { valid: false, reason: `missing message field: ${field}` };
    }
  }
  if (typeof value.read !== "boolean") return { valid: false, reason: "message read flag must be boolean" };
  if (Number.isNaN(Date.parse(value.createdAt as string))) return { valid: false, reason: "invalid message timestamp" };
  return { valid: true };
}

export function validateMailboxReceipt(value: unknown): ValidationResult {
  if (!isRecord(value)) return { valid: false, reason: "receipt must be an object" };
  if (typeof value.change !== "string" || !value.change.trim()) return { valid: false, reason: "missing change" };
  if (typeof value.type !== "string" || !value.type.trim()) return { valid: false, reason: "missing receipt type" };
  for (const field of ["receiptId", "correlationId", "id", "body", "verdict"]) {
    if (value[field] !== undefined && typeof value[field] !== "string") {
      return { valid: false, reason: `${field} must be a string` };
    }
  }
  if (value.blockingFindings !== undefined &&
      (typeof value.blockingFindings !== "number" || !Number.isFinite(value.blockingFindings))) {
    return { valid: false, reason: "blockingFindings must be a finite number" };
  }
  return { valid: true };
}

export function parseMailMessage(value: unknown): MailMessage | null {
  return validateMailMessage(value).valid ? value as MailMessage : null;
}
