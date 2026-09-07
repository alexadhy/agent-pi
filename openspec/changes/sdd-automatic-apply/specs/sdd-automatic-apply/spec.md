# Specification: Automatic SDD Apply Review Dispatch

## ADDED Requirements

### Requirement: Apply dispatch

When the active OpenSpec phase is `apply` and the subagent runtime is available, `/sdd-continue` MUST dispatch an `sdd-apply` worker automatically. When unavailable, it MUST print an explicit fallback prompt.

#### Scenario: Runtime available

- **WHEN** `/sdd-continue` resolves the active phase as apply and `__piSubagentRuntime.spawn` exists
- **THEN** it starts exactly one `sdd-apply` worker

#### Scenario: Runtime unavailable

- **WHEN** apply is ready but the runtime seam is unavailable
- **THEN** the command prints a usable manual dispatch fallback

### Requirement: Implementation receipt

The `sdd-apply` worker MUST send exactly one structured `IMPLEMENTATION_RECEIPT` containing the active change, correlation ID, changed files, and exact test evidence.

#### Scenario: Apply completes

- **WHEN** the worker finishes implementation and verification
- **THEN** it sends one receipt and does not claim review completion

### Requirement: Coordinator-owned review

The implementor MUST NOT manually dispatch judges, consolidators, or fix agents. The durable coordinator MUST dispatch those workers after validated receipts.

#### Scenario: Valid implementation receipt

- **WHEN** the coordinator receives a valid implementation receipt
- **THEN** it dispatches both independent judges through the shared runtime seam

### Requirement: Receipt recovery and isolation

The orchestrator MUST ingest valid subprocess receipts written to the shared sent mailbox during reconciliation, deduplicate live and recovered messages, and ignore receipts whose change is not present in the current project's OpenSpec tree.

#### Scenario: Subprocess receipt

- **WHEN** a subprocess writes a valid receipt to the sent mailbox
- **THEN** reconciliation routes it through the durable coordinator

#### Scenario: Foreign project receipt

- **WHEN** a sent mailbox receipt names a change absent from the current project's OpenSpec tree
- **THEN** the orchestrator ignores it

### Requirement: Completion gate

Apply completion MUST remain blocked until a durable `REVIEW_FINAL` receipt has verdict `PASS` with zero blocking findings.

#### Scenario: Blocking review

- **WHEN** a final review contains blocking findings or a non-PASS verdict
- **THEN** the change remains incomplete
