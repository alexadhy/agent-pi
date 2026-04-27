---
name: windmill-engineer
description: Senior engineering guidance for Windmill scripts, flows, jobs, schedules, triggers, workers, permissions, resources, variables, and production operations. Use when tasks involve building new Windmill automation, debugging failed runs, designing worker-group strategy, hardening security/permissions, migrating cron workflows, or reviewing Windmill architecture and reliability tradeoffs.
---

# Windmill Engineer

Deliver production-grade Windmill solutions with a defensive engineering mindset: minimize privilege, preserve debuggability, keep workflows observable, and avoid operational surprises.

Read [core-concepts.md](references/core-concepts.md) when you need detailed semantics and checklists for jobs, permissions, schedules, workers, resources, and secrets.

## Workflow

1. Clarify the runtime target and constraints.
- Identify edition (`Community`, `Cloud`, or `Self-hosted Enterprise`) and environment (`dev`, `staging`, `prod`).
- Confirm latency, throughput, retry behavior, and blast-radius requirements.
- Confirm whether the request is script-only, flow orchestration, trigger-driven, or hybrid.

2. Model permissions and identity first.
- Treat `permissioned_as` as a primary design decision, not an afterthought.
- Ensure each runnable has the minimum visibility to resources and variables required.
- Separate `created_by` from effective runtime permission in design reviews.

3. Choose the correct execution shape.
- Use a script for single-purpose, idempotent units.
- Use a flow when you need branching, retries, error handlers, or multi-step orchestration.
- Use schedules, webhooks, or event triggers based on ownership of the source event and required timing guarantees.

4. Design for operations before coding details.
- Select worker groups/tags intentionally (CPU, memory, GPU, isolation).
- Define log and result size strategy early; store large payloads in object storage.
- Define failure routing (step errors, schedule errors, workspace-level fallbacks).

5. Implement and verify.
- Prefer narrow, typed inputs and explicit defaults.
- Validate run behavior from job logs and run metadata, not assumptions.
- Verify schedule next-run previews and timezone semantics before enabling in production.

## Build Rules

- Prefer idempotent scripts and explicit retry boundaries.
- Keep job inputs flat JSON where possible; avoid over-nested payload contracts.
- Keep return objects small; offload large binary/object outputs.
- Use resource types and variables/secrets instead of hardcoded credentials.
- Use path-based ownership and groups/folders for permission management.
- Route heavy or specialized workloads through explicit worker tags/groups.

## Debug Rules

- Start from run type and job kind (`script`, `preview`, `flow`, `preview flow`, dependency jobs).
- Compare `permissioned_as` against expected resource/secret visibility first.
- Check worker assignment/tag mismatches before changing code.
- Separate code failure from scheduling/triggering failure:
  - Code failure: stack trace, input mismatch, dependency/runtime issues.
  - Trigger/schedule failure: cron expression, disabled schedule, handler misconfiguration, worker availability.
- For recurring incidents, add runbook notes and deterministic guard steps in the flow.

## Windmill MCP Usage

When Windmill MCP tools are available, prefer direct inspection over guessing:

- Inspect existing flows/scripts/schedules/resources first.
- Use list/get APIs to confirm current configuration and schema before editing.
- Apply minimal updates; avoid broad rewrites when one path-level fix is sufficient.
- After updates, run/trigger safely in `dev` first and inspect resulting jobs.

## Output Expectations

For any substantial Windmill task, provide:

1. Problem framing and constraints.
2. Recommended architecture and why it fits.
3. Security and permission implications.
4. Failure modes and monitoring hooks.
5. Concrete implementation or patch steps.
6. Validation checklist with exact verification commands/actions.
