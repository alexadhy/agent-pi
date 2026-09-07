# Design: Automatic SDD Apply Review Dispatch

`/sdd-continue` remains the SDD phase router. At apply, it builds the native task prompt and calls the shared `__piSubagentRuntime.spawn` seam with agent name `sdd-apply`. The agent definition supplies the implementation receipt contract.

`agent-orchestrator.ts` remains the review coordinator. `agent-mailbox.ts` provides live notification; the orchestrator reconciliation timer scans `~/.pi/mailbox/sent` as a subprocess recovery path. It filters receipts to change directories under the current cwd, marks live IDs as ingested, and delegates all validated receipts to the existing SQLite-backed state machine.

The coordinator remains the sole owner of judge, consolidator, and fix dispatch. Existing idempotency, timeout, bounded-round, and durable completion behavior are preserved.
