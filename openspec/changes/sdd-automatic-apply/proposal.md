# Proposal: Automatic SDD Apply Review Dispatch

## Why

SDD previously printed an apply prompt and relied on manual execution. That made implementation receipts and judge dispatch dependent on human or model follow-through.

## What changes

- Define a real `sdd-apply` agent contract.
- Automatically dispatch `sdd-apply` when `/sdd-continue` reaches the apply phase and the runtime seam is available.
- Require one structured implementation receipt.
- Let the durable coordinator own judge, consolidation, and fix dispatch.
- Reconcile subprocess mailbox receipts without mixing projects.

## Non-goals

- No new hosted coordinator service.
- No change to the durable review state machine or receipt vocabulary.
