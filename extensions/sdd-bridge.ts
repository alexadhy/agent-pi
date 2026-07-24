// ABOUTME: Bridge between Pi agent and OpenSpec CLI for SDD (Spec-Driven Development).
// ABOUTME: Provides sdd_status and openspec_run tools plus /sdd-continue, /sdd-status, /sdd-archive commands.
/**
 * SDD Bridge — wires the OpenSpec CLI into the Pi agent.
 *
 * Provides:
 *   - `sdd_status` tool — read-only JSON of active change, artifacts, task progress,
 *     dependency readiness, and next recommended action.
 *   - `openspec_run` tool — runs any `openspec` subcommand and returns stdout/stderr.
 *   - `/sdd-status [change]` command — debug/status
 *   - `/sdd-continue` command — native dispatcher: read status, decide next phase,
 *     dispatch the right `sdd-*` subagent
 *   - `/sdd-archive <change>` command — wraps `openspec archive`
 *
 * Requires the OpenSpec CLI (`npm install -g @fission-ai/openspec`).
 *
 * Usage: pi -e extensions/sdd-bridge.ts
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import { Text } from "@earendil-works/pi-tui";
import { execSync, spawn } from "child_process";
import { existsSync, readFileSync, readdirSync } from "fs";
import { join } from "path";
import {
	loadPreflight,
	savePreflight,
	parseUserAnswers,
	isCaptured,
	DEFAULT_PREFLIGHT,
	EXECUTION_MODES,
	ARTIFACT_STORES,
	CHAINED_PR_STRATEGIES,
	type PreflightState,
} from "./lib/sdd-preflight.ts";

// ── Types ────────────────────────────────────────

interface OpenSpecChange {
  name: string;
  path: string;
  hasProposal: boolean;
  hasSpec: boolean;
  hasDesign: boolean;
  hasTasks: boolean;
}

interface SddStatus {
  activeChange: string | null;
  changes: OpenSpecChange[];
  artifactPaths: Record<string, string> | null;
  taskProgress: { total: number; done: number } | null;
  preflight: PreflightState;
  nextRecommended: string | null;
  message: string;
}

// ── OpenSpec Wrapper ─────────────────────────────

function openspecAvailable(): boolean {
  try {
    execSync("which openspec", { stdio: ["ignore", "pipe", "ignore"] });
    return true;
  } catch {
    return false;
  }
}

function runOpenspecJson<T = unknown>(
  cwd: string,
  args: string[],
): T | null {
  try {
    const out = execSync(`openspec ${args.join(" ")} --json 2>/dev/null`, {
      cwd,
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 10000,
    });
    return JSON.parse(out) as T;
  } catch {
    return null;
  }
}

function runOpenspec(cwd: string, args: string[]): { stdout: string; stderr: string; code: number } {
  try {
    const out = execSync(`openspec ${args.join(" ")}`, {
      cwd,
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 15000,
    });
    return { stdout: out, stderr: "", code: 0 };
  } catch (e: any) {
    return {
      stdout: e.stdout?.toString() || "",
      stderr: e.stderr?.toString() || e.message || String(e),
      code: e.status || 1,
    };
  }
}

// ── Status Engine (file-based fallback) ──────────

function listChanges(cwd: string): OpenSpecChange[] {
  const changesDir = join(cwd, "openspec", "changes");
  if (!existsSync(changesDir)) return [];

  return readdirSync(changesDir, { withFileTypes: true })
    .filter((d) => d.isDirectory() && d.name !== "archive")
    .map((d) => {
      const changePath = join(changesDir, d.name);
      return {
        name: d.name,
        path: changePath,
        hasProposal: existsSync(join(changePath, "proposal.md")),
        hasSpec: existsSync(join(changePath, "spec.md")),
        hasDesign: existsSync(join(changePath, "design.md")),
        hasTasks: existsSync(join(changePath, "tasks.md")),
      };
    });
}

function parseTaskProgress(tasksPath: string): { total: number; done: number } | null {
  if (!existsSync(tasksPath)) return null;
  const content = readFileSync(tasksPath, "utf-8");
  const lines = content.split("\n");
  let total = 0;
  let done = 0;
  for (const line of lines) {
    if (/^\s*-\s+\[[ x]\]/i.test(line)) {
      total++;
      if (/^\s*-\s+\[x\]/i.test(line)) done++;
    }
  }
  return { total, done };
}

function determineNextPhase(change: OpenSpecChange): string {
  if (!change.hasProposal) return "sdd-proposal";
  if (!change.hasSpec) return "sdd-spec";
  if (!change.hasDesign) return "sdd-design";
  if (!change.hasTasks) return "sdd-tasks";
  return "sdd-apply";
}

function buildSddStatus(cwd: string): SddStatus {
  const preflight = loadPreflight(cwd);

  // Preflight gate: if not captured, override nextRecommended
  if (!isCaptured(preflight)) {
    return {
      activeChange: null,
      changes: [],
      artifactPaths: null,
      taskProgress: null,
      preflight,
      nextRecommended: "sdd-preflight",
      message:
        "Preflight not captured. Run `/sdd-preflight` (or have the parent ask the 4 questions) before any SDD work.",
    };
  }

  if (!existsSync(join(cwd, "openspec"))) {
    return {
      activeChange: null,
      changes: [],
      artifactPaths: null,
      taskProgress: null,
      preflight,
      nextRecommended: "sdd-init",
      message: "openspec/ directory not found. Run /sdd-init to bootstrap the project.",
    };
  }

  const changes = listChanges(cwd);
  if (changes.length === 0) {
    return {
      activeChange: null,
      changes: [],
      artifactPaths: null,
      taskProgress: null,
      preflight,
      nextRecommended: "sdd-proposal",
      message: "No active changes. Create one with `openspec new <change-name>`.",
    };
  }

  // First change with incomplete artifacts is the active one
  // (simple heuristic; the real SDD engine has more sophisticated state)
  const activeChange =
    changes.find((c) => !(c.hasProposal && c.hasSpec && c.hasDesign && c.hasTasks)) ||
    changes[changes.length - 1];

  const artifactPaths = {
    proposal: join(activeChange.path, "proposal.md"),
    spec: join(activeChange.path, "spec.md"),
    design: join(activeChange.path, "design.md"),
    tasks: join(activeChange.path, "tasks.md"),
  };

  const taskProgress = parseTaskProgress(artifactPaths.tasks);
  const nextRecommended = determineNextPhase(activeChange);

  return {
    activeChange: activeChange.name,
    changes,
    artifactPaths,
    taskProgress,
    preflight,
    nextRecommended,
    message: `Active change: ${activeChange.name} | Next phase: ${nextRecommended} | Mode: ${preflight.executionMode}`,
  };
}

// ── Exports (for tests) ─────────────────────────────

export { buildSddStatus, determineNextPhase, parseTaskProgress };
export type { SddStatus, OpenSpecChange };

// ── Extension ────────────────────────────────────

export default function (pi: ExtensionAPI) {
  // ── sdd_status tool ───────────────────────────

  pi.registerTool({
    name: "sdd_status",
    label: "SDD Status",
    description: [
      "Read-only status of the SDD workflow for the current project.",
      "Returns JSON with: active change name, all changes, artifact paths,",
      "task progress, and next recommended phase (sdd-proposal|sdd-spec|sdd-design|sdd-tasks|sdd-apply).",
      "",
      "Call this first when in SDD mode to know which phase to run next.",
      "If `openspec/` doesn't exist, returns nextRecommended: 'sdd-init'.",
    ].join("\n"),
    parameters: Type.Object({}),

    async execute(_toolCallId, _params, _signal, onUpdate, ctx) {
      if (onUpdate) {
        onUpdate({
          content: [{ type: "text" as const, text: "Reading SDD status..." }],
          details: { status: "running" },
        });
      }

      // Try OpenSpec CLI first
      let status: SddStatus | null = null;
      if (openspecAvailable()) {
        const json = runOpenspecJson<unknown>(ctx.cwd, ["status"]);
        if (json && typeof json === "object" && "activeChange" in (json as any)) {
          status = json as SddStatus;
        }
      }

      // Fallback: file-based status
      if (!status) {
        status = buildSddStatus(ctx.cwd);
      }

      const output = JSON.stringify(status, null, 2);

      return {
        content: [{ type: "text" as const, text: output }],
        details: {
          status: "done",
          activeChange: status.activeChange,
          nextRecommended: status.nextRecommended,
          preflightCaptured: status.preflight.captured,
          preflightSource: status.preflight.source,
        },
      };
    },

    renderCall(_params, _theme) {
      const DIM = "\x1b[90m";
      const RST = "\x1b[0m";
      return new Text(`${DIM}sdd_status${RST}`, 0, 0);
    },

    renderResult(result, _options, _theme) {
      const details = result.details as any;
      const DIM = "\x1b[90m";
      const GREEN = "\x1b[32m";
      const YELLOW = "\x1b[33m";
      const RED = "\x1b[31m";
      const BRIGHT = "\x1b[1;97m";
      const RST = "\x1b[0m";

      if (details?.preflightCaptured === false) {
        return new Text(
          `${RED}preflight required${RST} ${DIM}→ ${details?.nextRecommended || "sdd-preflight"}${RST}`,
          0,
          0,
        );
      }
      if (details?.activeChange) {
        return new Text(
          `${GREEN}change:${RST} ${BRIGHT}${details.activeChange}${RST} ${DIM}→ next: ${details.nextRecommended}${RST}`,
          0,
          0,
        );
      }
      return new Text(
        `${YELLOW}no active change${RST} ${DIM}→ ${details?.nextRecommended || "sdd-init"}${RST}`,
        0,
        0,
      );
    },
  });

  // ── openspec_run tool ─────────────────────────

  pi.registerTool({
    name: "openspec_run",
    label: "OpenSpec CLI",
    description: [
      "Run an `openspec` subcommand and return stdout/stderr.",
      "Examples:",
      "  openspec_run { args: ['new', 'add-auth'] }",
      "  openspec_run { args: ['list'] }",
      "  openspec_run { args: ['validate', 'add-auth'] }",
      "  openspec_run { args: ['show', 'add-auth'] }",
      "  openspec_run { args: ['archive', 'add-auth', '--yes'] }",
      "",
      "Use this for direct OpenSpec operations. For status, prefer `sdd_status`.",
    ].join("\n"),
    parameters: Type.Object({
      args: Type.Array(Type.String(), {
        description: "Arguments to pass to `openspec`",
      }),
    }),

    async execute(_toolCallId, params, _signal, onUpdate, ctx) {
      const { args } = params as { args: string[] };

      if (!openspecAvailable()) {
        return {
          content: [
            {
              type: "text" as const,
              text: "OpenSpec CLI not found. Install: npm install -g @fission-ai/openspec",
            },
          ],
          details: { error: "openspec not installed" },
        };
      }

      if (onUpdate) {
        onUpdate({
          content: [
            { type: "text" as const, text: `Running: openspec ${args.join(" ")}` },
          ],
          details: { status: "running", args },
        });
      }

      const result = runOpenspec(ctx.cwd, args);
      const output = [
        result.stdout,
        result.stderr ? `\n[stderr]\n${result.stderr}` : "",
        result.code !== 0 ? `\n[exit code: ${result.code}]` : "",
      ]
        .filter(Boolean)
        .join("\n");

      return {
        content: [{ type: "text" as const, text: output || "(no output)" }],
        details: {
          status: result.code === 0 ? "done" : "error",
          args,
          code: result.code,
        },
      };
    },

    renderCall(_params, _theme) {
      const p = _params as { args: string[] };
      const DIM = "\x1b[90m";
      const BRIGHT = "\x1b[1;97m";
      const RST = "\x1b[0m";
      return new Text(
        `${DIM}openspec${RST} ${BRIGHT}${p.args.join(" ")}${RST}`,
        0,
        0,
      );
    },

    renderResult(result, _options, _theme) {
      const details = result.details as any;
      const DIM = "\x1b[90m";
      const GREEN = "\x1b[32m";
      const RED = "\x1b[91m";
      const RST = "\x1b[0m";

      if (details?.code === 0) {
        return new Text(`${GREEN}ok${RST}`, 0, 0);
      }
      return new Text(
        `${RED}exit ${details?.code}${RST}`,
        0,
        0,
      );
    },
  });

  // ── /sdd-status command ───────────────────────

  pi.registerCommand("sdd-status", {
    description: "Show SDD status for current project (active change, artifacts, next phase).",
    handler: async (_args, ctx) => {
      const status = buildSddStatus(ctx.cwd);
      return JSON.stringify(status, null, 2);
    },
  });

  // ── /sdd-preflight command ────────────────────

  pi.registerCommand("sdd-preflight", {
    description:
      "Capture SDD preflight choices. Usage: /sdd-preflight <interactive|auto> <openspec|engram|both> <auto-forecast|ask-always|single-pr-default|force-chained> <reviewBudgetLines>",
    handler: async (args, ctx) => {
      const parsed = parseUserAnswers(args ?? "");
      const missing: string[] = [];
      if (parsed.executionMode === undefined) missing.push("executionMode");
      if (parsed.artifactStore === undefined) missing.push("artifactStore");
      if (parsed.chainedPrStrategy === undefined) missing.push("chainedPrStrategy");
      if (parsed.reviewBudgetLines === undefined) missing.push("reviewBudgetLines");

      if (missing.length > 0) {
        const help = [
          `Missing preflight values: ${missing.join(", ")}`,
          "",
          "Usage: /sdd-preflight <interactive|auto> <openspec|engram|both> <auto-forecast|ask-always|single-pr-default|force-chained> <reviewBudgetLines>",
          "",
          "Examples:",
          "  /sdd-preflight interactive openspec auto-forecast 400",
          "  /sdd-preflight auto engram both 200",
          "  /sdd-preflight --mode auto --store openspec --pr force-chained --budget 600",
          "",
          `Valid executionMode: ${EXECUTION_MODES.join(", ")}`,
          `Valid artifactStore: ${ARTIFACT_STORES.join(", ")}`,
          `Valid chainedPrStrategy: ${CHAINED_PR_STRATEGIES.join(", ")}`,
        ].join("\n");
        ctx.ui.notify(help, "warning");
        return help;
      }

      const state: PreflightState = {
        ...DEFAULT_PREFLIGHT,
        ...parsed,
        captured: true,
        source: "session",
      };
      savePreflight(state);
      ctx.ui.notify(
        `Preflight captured: mode=${state.executionMode}, store=${state.artifactStore}, pr=${state.chainedPrStrategy}, budget=${state.reviewBudgetLines}`,
        "success",
      );
      return JSON.stringify(state, null, 2);
    },
  });

  // ── /sdd-archive command ──────────────────────

  pi.registerCommand("sdd-archive", {
    description: "Archive a completed OpenSpec change. Usage: /sdd-archive <change-name> [--yes]",
    handler: async (args, ctx) => {
      if (!openspecAvailable()) {
        ctx.ui.notify("OpenSpec CLI not installed. Run: npm install -g @fission-ai/openspec", "error");
        return;
      }

      const parts = (args ?? "").trim().split(/\s+/);
      const changeName = parts[0];

      if (!changeName) {
        ctx.ui.notify("Usage: /sdd-archive <change-name> [--yes]", "warning");
        return;
      }

      const yesFlag = parts.includes("--yes") || parts.includes("-y");
      const result = runOpenspec(ctx.cwd, [
        "archive",
        changeName,
        ...(yesFlag ? ["--yes"] : []),
      ]);

      if (result.code === 0) {
        ctx.ui.notify(`Archived change: ${changeName}`, "success");
      } else {
        ctx.ui.notify(`Archive failed: ${result.stderr}`, "error");
      }
      return result.stdout + (result.stderr ? `\n${result.stderr}` : "");
    },
  });

  // ── /sdd-continue command (native dispatcher) ─

  pi.registerCommand("sdd-continue", {
    description:
      "Native SDD dispatcher. Reads status, decides next ready phase, prints the subagent dispatch prompt.",
    handler: async (_args, ctx) => {
      const status = buildSddStatus(ctx.cwd);

      // Preflight gate — refuse to dispatch
      if (status.nextRecommended === "sdd-preflight") {
        ctx.ui.notify(
          "SDD preflight not captured. Ask the user the 4 questions, or run /sdd-preflight manually.",
          "warning",
        );
        return [
          status.message,
          "",
          "Required choices:",
          `  1. executionMode: ${EXECUTION_MODES.join(" | ")}`,
          `  2. artifactStore: ${ARTIFACT_STORES.join(" | ")}`,
          `  3. chainedPrStrategy: ${CHAINED_PR_STRATEGIES.join(" | ")}`,
          "  4. reviewBudgetLines: integer (default 400)",
          "",
          "Suggested: /sdd-preflight interactive openspec auto-forecast 400",
        ].join("\n");
      }

      if (status.nextRecommended === "sdd-init") {
        return `SDD not initialized. Run /sdd-init to bootstrap, or:\n  openspec init\n\n${status.message}`;
      }

      if (!status.activeChange) {
        return `${status.message}\n\nSuggested command:\n  openspec new <change-name>`;
      }

      const next = status.nextRecommended;
      return [
        `Active change: ${status.activeChange}`,
        `Next phase: ${next}`,
        `Artifact paths:`,
        ...Object.entries(status.artifactPaths || {}).map(([k, v]) => `  - ${k}: ${v}`),
        status.taskProgress ? `Tasks: ${status.taskProgress.done}/${status.taskProgress.total} done` : "",
        "",
        `Dispatch prompt:`,
        `  subagent_create({ name: "${next}", task: "Continue the SDD ${next.replace("sdd-", "")} phase for change '${status.activeChange}'. Read the previous phase's output from the artifact paths above and produce the next artifact. Follow the Result Contract: status, executive_summary, artifacts, next_recommended, risks, skill_resolution." })`,
      ]
        .filter(Boolean)
        .join("\n");
    },
  });
}
