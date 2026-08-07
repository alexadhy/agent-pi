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
import {
	openspecJson,
	nextArtifactId,
	parseNativeStatus,
	fetchInstructions,
	type NativeStatus,
} from "./lib/openspec-native.ts";
import { assertStrictTddFromConfig } from "./lib/openspec-engineering.ts";

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
  gentlePiAvailable: boolean;
  message: string;
  // Native openspec status when the CLI could resolve it (state authority).
  native?: NativeStatus | null;
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

function nativePhaseToLabel(phase: string): string {
  if (phase === "archive") return "sdd-archive";
  if (phase === "apply") return "sdd-apply";
  // proposal | specs | design | tasks → sdd-proposal | sdd-spec | sdd-design | sdd-tasks
  const singular = phase === "specs" ? "spec" : phase;
  return `sdd-${singular}`;
}

function isGentlePiAvailable(): boolean {
  try {
    require.resolve("gentle-pi/package.json");
    return true;
  } catch {
    return false;
  }
}

function buildSddStatus(cwd: string): SddStatus {
  const preflight = loadPreflight(cwd);
  const gentleAvailable = isGentlePiAvailable();
  const base = { preflight, gentlePiAvailable: gentleAvailable };

  // 1. No openspec/ root → bootstrap needed.
  if (!existsSync(join(cwd, "openspec"))) {
    return {
      ...base,
      activeChange: null,
      changes: [],
      artifactPaths: null,
      taskProgress: null,
      nextRecommended: "sdd-init",
      message: "openspec/ directory not found. Run openspec init (or /sdd-init) to bootstrap.",
    };
  }

  // 2. Native engine: resolve the active change and its readiness graph.
  const changes = listChanges(cwd);
  const native = openspecJson<NativeStatus>(cwd, ["status"]);
  const nativeStatus = parseNativeStatus(native);
  const activeName = (() => {
    const inNative = nativeStatus ? nativeStatus.changeName : null;
    if (inNative) return inNative;
    // Native unavailable → fall back to the first incomplete change, then the last.
    const incomplete = changes.find(
      (c) => !(c.hasProposal && c.hasSpec && c.hasDesign && c.hasTasks),
    );
    if (incomplete) return incomplete.name;
    return changes.length > 0 ? changes[changes.length - 1].name : null;
  })();

  // 3. No active change → prompt to create one.
  if (!activeName && changes.length === 0) {
    return {
      ...base,
      activeChange: null,
      changes,
      artifactPaths: null,
      taskProgress: null,
      nextRecommended: "sdd-proposal",
      message: "No active changes. Create one with `openspec new <change-name>`.",
    };
  }

  // 4. Derive next phase from native readiness when available.
  const nextNative = nextArtifactId(nativeStatus);
  const nextRecommended = nextNative ? nativePhaseToLabel(nextNative) : "sdd-apply";

  const changeDir = join(cwd, "openspec", "changes", activeName ?? "");
  const artifactPaths = {
    proposal: join(changeDir, "proposal.md"),
    spec: join(changeDir, "spec.md"),
    design: join(changeDir, "design.md"),
    tasks: join(changeDir, "tasks.md"),
  };
  const taskProgress = parseTaskProgress(artifactPaths.tasks);

  return {
    ...base,
    activeChange: activeName,
    changes,
    artifactPaths,
    taskProgress,
    nextRecommended,
    native: nativeStatus,
    message: activeName
      ? `Active change: ${activeName} | Next phase: ${nextRecommended} | Mode: ${preflight.executionMode}`
      : "No active change. Create one with `openspec new <change-name>`.",
  };
}

// ── Exports (for tests) ─────────────────────────────

export { buildSddStatus, parseTaskProgress, nativePhaseToLabel };
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
        let status: SddStatus = buildSddStatus(ctx.cwd);

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
  result.stderr ? "\n[stderr]\n" + result.stderr : "",
  result.code !== 0 ? "\n[exit code: " + result.code + "]" : "",
].join("\n");

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

  pi.registerTool({
  name: "openspec_change",
  label: "OpenSpec Change",
  description: [
    "Open or create an OpenSpec change and return its native status.",
    "Use from any mode to bind work to the spec-driven artifact graph.",
  ].join("\n"),
  parameters: Type.Object({
    name: Type.Optional(Type.String({ description: "Change name to open/create. If omitted, the active change is used." })),
  }),
  async execute(_toolCallId, params, _signal, onUpdate, ctx) {
    const { name } = (params || {}) as { name?: string };
    if (name && openspecAvailable()) {
      const created = runOpenspec(ctx.cwd, ["new", "change", name]);
      if (created.code !== 0 && !/exists|already/i.test(created.stderr)) {
        return { content: [{ type: "text" as const, text: `OpenSpec CLI failed: ${created.stderr}` }], details: { status: "error", args: ["new", "change", name] } };
      }
    }
    const status = buildSddStatus(ctx.cwd);
    const selected = (name && status.changes.some((c) => c.name === name)) ? name : status.activeChange;
    const s = { ...status, activeChange: selected };
    return { content: [{ type: "text" as const, text: JSON.stringify(s, null, 2) }], details: { status: "done", activeChange: selected, nextRecommended: s.nextRecommended } };
  },
});

pi.registerTool({
  name: "openspec_next",
  label: "OpenSpec Next Artifact",
  description: [
    "Return the next ready artifact for a change plus its native instructions",
    "(template, instruction, dependencies) so the agent can write it directly.",
  ].join("\n"),
  parameters: Type.Object({
    change: Type.String({ description: "Change name." }),
    artifact: Type.Optional(Type.String({ description: "Optional artifact id override (proposal|specs|design|tasks)." })),
  }),
  async execute(_toolCallId, params, _signal, onUpdate, ctx) {
    const { change, artifact } = (params || {}) as { change: string; artifact?: string };
    const nativeStatus = parseNativeStatus(openspecJson<NativeStatus>(ctx.cwd, ["status", "--change", change]));
    const artifactId = artifact || nextArtifactId(nativeStatus) || "proposal";
    const inst = fetchInstructions(ctx.cwd, artifactId, change);
    const result = { change, artifactId, phase: nativePhaseToLabel(artifactId), nativeStatus, instructions: inst };
    return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }], details: { status: "done", change, artifactId } };
  },
});

pi.registerTool({
  name: "openspec_verify",
  label: "OpenSpec Verify",
  description: [
    "Validate an OpenSpec change's artifacts via `openspec validate --json`.",
    "Use before apply/archive to confirm well-formed artifacts.",
  ].join("\n"),
  parameters: Type.Object({
    change: Type.String({ description: "Change name to validate." }),
  }),
  async execute(_toolCallId, params, _signal, onUpdate, ctx) {
    const { change } = (params || {}) as { change: string };
    const result = runOpenspec(ctx.cwd, ["validate", "--change", change, "--json", "--no-interactive"]);
    const output = [
      result.stdout,
      result.stderr ? "\n[stderr]\n" + result.stderr : "",
      result.code !== 0 ? "\n[exit code: " + result.code + "]" : "",
    ].join("\n");
    return {
      content: [{ type: "text" as const, text: output || "(validation passed)" }],
      details: { status: result.code === 0 ? "done" : "error", change, code: result.code },
    };
  },
});

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
          "Native SDD dispatcher. Reads native openspec status, decides next ready phase, prints the dispatch prompt.",
        handler: async (_args, ctx) => {
          const status = buildSddStatus(ctx.cwd);

          if (status.nextRecommended === "sdd-init") {
            return `SDD not initialized. Run openspec init (or /sdd-init) to bootstrap.` + "\n" + `  openspec init` + "\n" + "\n" + status.message;
          }

          if (!status.activeChange) {
            return status.message + "\n" + "\n" + `Suggested command:` + "\n" + `  openspec new <change-name>`;
          }

          const next = status.nextRecommended;
          const artifactId = next.replace("sdd-", "");

          let instructionsBlock = "";
          const isArtifactPhase = ["proposal", "specs", "design", "tasks"].includes(artifactId);
          if (isArtifactPhase) {
            const inst = fetchInstructions(ctx.cwd, artifactId, status.activeChange);
            if (inst && (inst.template || inst.instruction)) {
              instructionsBlock = [
                "",
                `Native instructions for \`${artifactId}\` artifact:`,
                inst.instruction ? "\n" + inst.instruction : "",
                inst.template ? "\n" + `Template (fill this structure):` + "\n" + "```markdown" + "\n" + inst.template + "\n" + "```" : "",
                inst.dependencies?.length ? "\n" + `Dependencies to read first: ${inst.dependencies.join(", ")}` : "",
              ]
                .filter(Boolean)
                .join("\n");
            }
          }

          // Strict TDD: forward the runner for apply/verify when the config enables it.
          let tddBlock = "";
          if (artifactId === "apply" || artifactId === "verify") {
            const tdd = assertStrictTddFromConfig(ctx.cwd);
            if (tdd.enabled) tddBlock = "\n" + tdd.prompt;
          }

          return [
            `Active change: ${status.activeChange}`,
            `Next phase: ${next}`,
            `Artifact paths:`,
            ...Object.entries(status.artifactPaths || {}).map(([k, v]) => `  - ${k}: ${v}`),
            status.taskProgress ? `Tasks: ${status.taskProgress.done}/${status.taskProgress.total} done` : "",
            "",
            `Dispatch prompt:`,
            `  subagent_create({ name: "${next}", task: "Continue the SDD ${artifactId} phase for change '${status.activeChange}'. Read the change\'s existing artifacts and the native guidance below, then produce the next artifact. Follow the Result Contract: status, executive_summary, artifacts, next_recommended, risks, skill_resolution.${instructionsBlock}${tddBlock}" })`,
          ]
            .filter(Boolean)
            .join("\n");
        },
      });
  }
