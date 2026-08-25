// ABOUTME: Durable, idempotent state machine for bounded SDD review loops.

import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

const require = createRequire(import.meta.url);
const { DatabaseSync } = require("node:sqlite") as {
  DatabaseSync: new (path: string) => any;
};

export type ReviewReceiptType =
  | "IMPLEMENTATION_RECEIPT" | "REVIEW_A" | "REVIEW_B"
  | "REVIEW_CONSOLIDATED" | "FIX_RECEIPT" | "REVIEW_FINAL";
export type ReviewVerdict = "PASS" | "FAIL" | "CONCERNS";
export type ReviewStatus = "PENDING" | "RUNNING" | "BLOCKED" | "COMPLETE";
export type ReviewAction = "dispatch-judges" | "consolidate" | "dispatch-fix" | "complete" | "stop" | "ignore";

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

export function createReviewState(change: string, maxRounds = 3): ReviewState {
  return {
    change, round: 0, maxRounds: Math.max(1, maxRounds), status: "PENDING",
    judgeA: false, judgeB: false, passed: false, blocked: false,
    receiptIds: [], correlationIds: [], dispatchIds: [], updatedAt: new Date().toISOString(),
  };
}

export function reviewStatePath(cwd: string, change: string): string {
  return join(cwd, "openspec", "changes", change, "review-state.json");
}

export function reviewLedgerPath(cwd: string): string {
  return join(cwd, "openspec", ".review-ledger.sqlite");
}

function stateFromRow(row: any, change: string): ReviewState {
  return {
    change,
    round: Number(row.round),
    maxRounds: Number(row.max_rounds),
    status: row.status,
    judgeA: Boolean(row.judge_a),
    judgeB: Boolean(row.judge_b),
    passed: Boolean(row.passed),
    blocked: Boolean(row.blocked),
    receiptIds: [],
    correlationIds: [],
    dispatchIds: [],
    updatedAt: row.updated_at,
  };
}

function receiptId(receipt: ReviewReceipt, round: number): string {
  return receipt.receiptId || receipt.id || `${receipt.type}:${receipt.correlationId || round}`;
}

function correlationKey(receipt: ReviewReceipt): string {
  return receipt.correlationId ? `${receipt.type}:${receipt.correlationId}` : "";
}

export class ReviewLedger {
  readonly db: any;
  readonly cwd: string;

  constructor(cwd: string) {
    this.cwd = cwd;
    mkdirSync(dirname(reviewLedgerPath(cwd)), { recursive: true });
    this.db = new DatabaseSync(reviewLedgerPath(cwd));
    this.db.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;");
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS review_changes (
        change_id TEXT PRIMARY KEY,
        round INTEGER NOT NULL,
        max_rounds INTEGER NOT NULL,
        status TEXT NOT NULL,
        judge_a INTEGER NOT NULL,
        judge_b INTEGER NOT NULL,
        passed INTEGER NOT NULL,
        blocked INTEGER NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS review_receipts (
        receipt_id TEXT PRIMARY KEY,
        change_id TEXT NOT NULL REFERENCES review_changes(change_id) ON DELETE CASCADE,
        type TEXT NOT NULL,
        correlation_id TEXT,
        verdict TEXT,
        blocking_findings INTEGER,
        body TEXT,
        created_at TEXT NOT NULL,
        UNIQUE(change_id, type, correlation_id)
      );
      CREATE TABLE IF NOT EXISTS review_dispatches (
        change_id TEXT NOT NULL REFERENCES review_changes(change_id) ON DELETE CASCADE,
        round INTEGER NOT NULL,
        kind TEXT NOT NULL,
        dispatch_id TEXT NOT NULL,
        created_at TEXT NOT NULL,
        dispatched_at TEXT,
        PRIMARY KEY(change_id, round, kind),
        UNIQUE(dispatch_id)
      );
    `);
  }

  close(): void { this.db.close(); }

  private transaction<T>(fn: () => T): T {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const result = fn();
      this.db.exec("COMMIT");
      return result;
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  private ensureState(change: string, maxRounds: number, legacyPath?: string): ReviewState {
    const row = this.db.prepare("SELECT * FROM review_changes WHERE change_id = ?").get(change);
    if (row) return stateFromRow(row, change);
    const path = legacyPath || reviewStatePath(this.cwd, change);
    this.writeState(createReviewState(change, maxRounds));
    const state = importLegacyState(this.db, path, change, maxRounds);
    this.writeState(state);
    return state;
  }

  private writeState(state: ReviewState): void {
    this.db.prepare(`INSERT INTO review_changes
      (change_id, round, max_rounds, status, judge_a, judge_b, passed, blocked, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(change_id) DO UPDATE SET round=excluded.round, max_rounds=excluded.max_rounds,
      status=excluded.status, judge_a=excluded.judge_a, judge_b=excluded.judge_b,
      passed=excluded.passed, blocked=excluded.blocked, updated_at=excluded.updated_at`).run(
      state.change, state.round, state.maxRounds, state.status, Number(state.judgeA), Number(state.judgeB),
      Number(state.passed), Number(state.blocked), state.updatedAt,
    );
  }

  load(change: string, maxRounds = 3): ReviewState {
    return this.transaction(() => {
      const state = this.ensureState(change, maxRounds, reviewStatePath(this.cwd, change));
      this.populateCollections(state);
      return state;
    });
  }

  save(state: ReviewState): void {
    this.transaction(() => {
      state.updatedAt = new Date().toISOString();
      this.writeState(state);
      for (const id of state.receiptIds) {
        this.db.prepare(`INSERT OR IGNORE INTO review_receipts
          (receipt_id, change_id, type, created_at) VALUES (?, ?, 'LEGACY', ?)`)
          .run(id, state.change, state.updatedAt);
      }
      for (const id of state.dispatchIds) {
        const parts = id.split(":");
        const kind = parts.pop() || "unknown";
        const round = Number(parts.pop());
        if (Number.isFinite(round)) {
          this.db.prepare(`INSERT OR IGNORE INTO review_dispatches
            (change_id, round, kind, dispatch_id, created_at, dispatched_at) VALUES (?, ?, ?, ?, ?, ?)`)
            .run(state.change, round, kind, id, state.updatedAt, state.updatedAt);
        }
      }
    });
  }

  processReceipt(receipt: ReviewReceipt, maxRounds = 3): ReviewReceiptResult {
    return this.transaction(() => {
      const state = this.ensureState(receipt.change, maxRounds, reviewStatePath(this.cwd, receipt.change));
      this.populateCollections(state);
      const id = receiptId(receipt, state.round);
      const correlation = correlationKey(receipt);
      const duplicate = this.db.prepare(
        "SELECT 1 FROM review_receipts WHERE receipt_id = ? OR (change_id = ? AND type = ? AND correlation_id = ?) LIMIT 1",
      ).get(id, receipt.change, receipt.type, receipt.correlationId ?? null);
      if (duplicate) return { action: "ignore", state, dispatchIds: [] };

      const action = applyReceipt(state, { ...receipt, receiptId: id });
      this.db.prepare(`INSERT INTO review_receipts
        (receipt_id, change_id, type, correlation_id, verdict, blocking_findings, body, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(id, receipt.change, receipt.type, receipt.correlationId ?? null, receipt.verdict ?? null,
          receipt.blockingFindings ?? null, receipt.body ?? null, new Date().toISOString());
      state.updatedAt = new Date().toISOString();
      const dispatchIds: string[] = [];
      const kind = action === "dispatch-judges" ? "judges" : action === "consolidate" ? "consolidate" : action === "dispatch-fix" ? "fix" : "";
      if (kind) {
        const key = dispatchKey(state.change, state.round, kind);
        this.db.prepare(`INSERT OR IGNORE INTO review_dispatches
          (change_id, round, kind, dispatch_id, created_at) VALUES (?, ?, ?, ?, ?)`)
          .run(state.change, state.round, kind, key, state.updatedAt);
        state.dispatchIds.push(key);
        dispatchIds.push(key);
      }
      this.writeState(state);
      this.populateCollections(state);
      return { action, state, dispatchIds };
    });
  }

  pendingDispatch(change: string, key: string): boolean {
    return Boolean(this.db.prepare("SELECT 1 FROM review_dispatches WHERE change_id = ? AND dispatch_id = ? AND dispatched_at IS NULL").get(change, key));
  }

  markDispatched(change: string, key: string): void {
    this.db.prepare("UPDATE review_dispatches SET dispatched_at = ? WHERE change_id = ? AND dispatch_id = ? AND dispatched_at IS NULL").run(new Date().toISOString(), change, key);
  }

  private populateCollections(state: ReviewState): void {
    state.receiptIds = this.db.prepare("SELECT receipt_id FROM review_receipts WHERE change_id = ? ORDER BY rowid").all(state.change).map((r: any) => r.receipt_id);
    state.correlationIds = this.db.prepare("SELECT type || ':' || correlation_id AS value FROM review_receipts WHERE change_id = ? AND correlation_id IS NOT NULL ORDER BY rowid").all(state.change).map((r: any) => r.value);
    state.dispatchIds = this.db.prepare("SELECT dispatch_id FROM review_dispatches WHERE change_id = ? ORDER BY round, kind").all(state.change).map((r: any) => r.dispatch_id);
  }
}

function importLegacyState(db: any, file: string, change: string, maxRounds: number): ReviewState {
  const fresh = createReviewState(change, maxRounds);
  if (!existsSync(file)) return fresh;
  try {
    const legacy = JSON.parse(readFileSync(file, "utf8")) as Partial<ReviewState>;
    const state = { ...fresh, ...legacy, change, receiptIds: Array.isArray(legacy.receiptIds) ? legacy.receiptIds : [], correlationIds: Array.isArray(legacy.correlationIds) ? legacy.correlationIds : [], dispatchIds: Array.isArray(legacy.dispatchIds) ? legacy.dispatchIds : [] };
    state.round = Number.isFinite(Number(legacy.round)) ? Math.max(0, Number(legacy.round)) : fresh.round;
    state.maxRounds = Number.isFinite(Number(legacy.maxRounds)) ? Math.max(1, Number(legacy.maxRounds)) : fresh.maxRounds;
    state.status = legacy.status || (state.passed ? "COMPLETE" : state.blocked ? "BLOCKED" : "PENDING");
    for (const id of state.receiptIds) db.prepare("INSERT OR IGNORE INTO review_receipts (receipt_id, change_id, type, created_at) VALUES (?, ?, 'LEGACY', ?)").run(id, change, state.updatedAt);
    for (const id of state.dispatchIds) {
      const parts = id.split(":"); const kind = parts.pop() || "unknown"; const round = Number(parts.pop());
      if (Number.isFinite(round)) db.prepare("INSERT OR IGNORE INTO review_dispatches (change_id, round, kind, dispatch_id, created_at, dispatched_at) VALUES (?, ?, ?, ?, ?, ?)").run(change, round, kind, id, state.updatedAt, state.updatedAt);
    }
    return state;
  } catch {
    return { ...fresh, status: "BLOCKED", blocked: true };
  }
}

export function loadReviewState(cwd: string, change: string, maxRounds = 3): ReviewState {
  const ledger = new ReviewLedger(cwd);
  try { return ledger.load(change, maxRounds); } finally { ledger.close(); }
}

export function saveReviewState(cwd: string, state: ReviewState): void {
  const ledger = new ReviewLedger(cwd);
  try { ledger.save(state); } finally { ledger.close(); }
}

export function processReviewReceipt(cwd: string, receipt: ReviewReceipt, maxRounds = 3): ReviewReceiptResult {
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

export function applyReceipt(state: ReviewState, receipt: ReviewReceipt): ReviewAction {
  if (!receipt || receipt.change !== state.change) return "ignore";
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
  }
}

export function hasDurableReviewPass(cwd: string, change: string): boolean {
  const state = loadReviewState(cwd, change);
  return state.status === "COMPLETE" && state.passed === true;
}

export function dispatchKey(change: string, round: number, kind: string): string {
  return `${change}:${round}:${kind}`;
}
