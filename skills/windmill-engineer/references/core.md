# Windmill Core Concepts Reference

## Source

- Primary docs: <https://www.windmill.dev/docs/core_concepts>

## Platform Model

- `Workspace`: top-level boundary for users, groups, assets, and automation.
- `Runnable`: executable unit (`Script` or `Flow`) that produces jobs.
- `Job`: concrete execution record with status, logs, timings, and result metadata.
- `Worker`: process/compute runtime that pulls and executes queued jobs.

## Scripts And Flows

- Use a script for a focused, testable task with clear input/output.
- Use a flow for orchestration, branching, retries, and multi-step control.
- Keep each flow step small and deterministic to improve restart behavior.
- Push side effects to explicit steps so failure analysis is local and obvious.

## Jobs, Run Types, And Observability

- Distinguish `preview` runs from deployed runs during debugging.
- Track run outcome using status, logs, duration, and queue wait time.
- Treat repeated timeouts/retries as capacity or dependency symptoms, not only code bugs.

## Triggers And Schedules

- Trigger choices: schedule (cron), webhook/API-driven, event-based integrations.
- Always review timezone and next execution before enabling schedules.
- Add failure handlers for scheduled jobs to prevent silent degradation.

## Workers And Routing

- Use worker groups/tags to isolate workloads by runtime, security, or capacity.
- Route heavy jobs to dedicated tags; avoid contention with latency-sensitive jobs.
- Validate worker availability before rollout of new schedule-heavy workloads.

## Permissions And Identity

- `created_by` indicates ownership provenance, not full runtime authorization.
- `permissioned_as` determines effective runtime access and is security-critical.
- Apply least privilege by folder/group and resource visibility.

## Resources, Variables, And Secrets

- Use `Resource Types` and `Resources` for typed external connectors.
- Use variables/secrets for sensitive or environment-specific values.
- Do not hardcode credentials in scripts, flow step arguments, or defaults.

## Production Hardening Checklist

1. Define retry policy per failure mode; avoid unbounded retries.
2. Ensure idempotency for any step that can retry.
3. Isolate external side effects (notifications, writes, payments) behind guards.
4. Capture structured logs for critical path steps.
5. Route failures to alerting and include run links/context.
6. Validate worker tags, permissions, and schedule timezone before enabling.
7. Verify rollback path (disable schedule, revert flow/script version, or reroute workers).

## Common Failure Patterns

- Permission denied to resource/secret due to `permissioned_as` mismatch.
- Schedule exists but does not run because it is disabled, mis-timed, or worker-starved.
- Flow step contracts drift (input/output shape mismatch between steps).
- Worker tag mismatch causes queued jobs with no eligible workers.
- Oversized payloads/logs create runtime/storage issues; move bulk data out of job result.
