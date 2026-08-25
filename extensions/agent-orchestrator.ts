// ABOUTME: Agent Orchestrator — local replacement for Commander task groups, waves, and dashboard.
// ABOUTME: Persists task groups to JSON for cross-session survival. Integrates with tasks.ts and subagent-widget.ts via globalThis.

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import { createServer, type Server, type IncomingMessage, type ServerResponse } from "node:http";
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { outputLine } from "./lib/output-box.ts";
import { generateDashboardHTML } from "./lib/orchestrator-dashboard-html.ts";
import {
  registerActiveViewer,
  clearActiveViewer,
  notifyViewerOpen,
} from "./lib/viewer-session.ts";
import {
  createReviewState,
  dispatchKey,
  hasPendingReviewDispatch,
  loadReviewState,
  markReviewDispatch,
  processReviewReceipt,
  type ReviewReceipt,
  type ReviewState,
} from "./lib/review-coordinator.ts";

// ── Types ──────────────────────────────────────────────────────────

interface TaskItem {
  id: number;
  text: string;
  status: "pending" | "working" | "completed" | "failed";
  groupId?: number;
  wave?: number;
  createdAt: string;
  completedAt?: string;
  agentName?: string;
}

interface TaskGroup {
  id: number;
  name: string;
  description: string;
  totalWaves: number;
  currentWave: number;
  status: "active" | "completed" | "cancelled";
  createdAt: string;
}

interface AgentInfo {
  name: string;
  role: string;
  status: "idle" | "working" | "done" | "error";
  currentTaskId?: number;
  lastHeartbeat?: string;
}

interface OrchestratorState {
  tasks: TaskItem[];
  groups: TaskGroup[];
  nextTaskId: number;
  nextGroupId: number;
  agents: AgentInfo[];
}

// ── Config ─────────────────────────────────────────────────────────

const STATE_DIR = ".pi";
const STATE_FILE = "orchestrator-state.json";

function getStatePath(cwd: string): string {
  return join(cwd, STATE_DIR, STATE_FILE);
}

function loadState(cwd: string): OrchestratorState {
  const path = getStatePath(cwd);
  try {
    if (existsSync(path)) {
      return JSON.parse(readFileSync(path, "utf-8"));
    }
  } catch {}
  return { tasks: [], groups: [], nextTaskId: 1, nextGroupId: 1, agents: [] };
}

function saveState(cwd: string, state: OrchestratorState): void {
  const path = getStatePath(cwd);
  try {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, JSON.stringify(state, null, 2), "utf-8");
  } catch (err: any) {
    console.error(`[orch] Failed to save state: ${err.message}`);
  }
}

// ── Tool parameter schemas ─────────────────────────────────────────

const GroupCreateParams = Type.Object({
  name: Type.String({ description: "Group name" }),
  description: Type.Optional(Type.String({ description: "Group description" })),
  totalWaves: Type.Optional(Type.Number({ description: "Number of waves (default: 1)" })),
});

const GroupListParams = Type.Object({});

const GroupStatusParams = Type.Object({
  groupId: Type.Number({ description: "Group ID" }),
});

const TaskAddParams = Type.Object({
  groupId: Type.Number({ description: "Group ID to add task to" }),
  text: Type.String({ description: "Task description" }),
  wave: Type.Optional(Type.Number({ description: "Wave number (default: current wave of group)" })),
});

const TaskListParams = Type.Object({
  groupId: Type.Optional(Type.Number({ description: "Filter by group ID" })),
  status: Type.Optional(Type.String({ description: "Filter by status: pending, working, completed, failed" })),
});

const TaskUpdateParams = Type.Object({
  taskId: Type.Number({ description: "Task ID" }),
  status: Type.String({ description: "New status: working, completed, failed" }),
  agentName: Type.Optional(Type.String({ description: "Agent name claiming the task" })),
});

const AgentRegisterParams = Type.Object({
  name: Type.String({ description: "Agent name" }),
  role: Type.Optional(Type.String({ description: "Agent role" })),
});

const AgentHeartbeatParams = Type.Object({
  name: Type.String({ description: "Agent name" }),
  status: Type.Optional(Type.String({ description: "Current status" })),
  currentTaskId: Type.Optional(Type.Number({ description: "Task ID being worked on" })),
});

// ── State helpers ──────────────────────────────────────────────────

function createGroup(state: OrchestratorState, name: string, description: string, totalWaves: number): TaskGroup {
  const group: TaskGroup = {
    id: state.nextGroupId++,
    name,
    description,
    totalWaves,
    currentWave: 1,
    status: "active",
    createdAt: new Date().toISOString(),
  };
  state.groups.push(group);
  return group;
}

function addTask(state: OrchestratorState, groupId: number, text: string, wave?: number): TaskItem | null {
  const group = state.groups.find(g => g.id === groupId);
  if (!group) return null;

  const task: TaskItem = {
    id: state.nextTaskId++,
    text,
    status: "pending",
    groupId,
    wave: wave ?? group.currentWave,
    createdAt: new Date().toISOString(),
  };
  state.tasks.push(task);
  return task;
}

function updateTaskStatus(state: OrchestratorState, taskId: number, status: TaskItem["status"], agentName?: string): TaskItem | null {
  const task = state.tasks.find(t => t.id === taskId);
  if (!task) return null;

  task.status = status;
  if (agentName) task.agentName = agentName;
  if (status === "completed" || status === "failed") task.completedAt = new Date().toISOString();

  // Check if group should advance wave or complete
  if (task.groupId) {
    const group = state.groups.find(g => g.id === task.groupId);
    if (group) {
      const groupTasks = state.tasks.filter(t => t.groupId === group.id);
      const currentWaveTasks = groupTasks.filter(t => t.wave === group.currentWave);
      const allDone = currentWaveTasks.every(t => t.status === "completed");
      const allFinished = currentWaveTasks.every(t => t.status === "completed" || t.status === "failed");

      if (allFinished) {
        if (group.currentWave < group.totalWaves) {
          group.currentWave++;
        } else if (allDone) {
          group.status = "completed";
        }
      }
    }
  }

  return task;
}

function registerAgent(state: OrchestratorState, name: string, role: string): AgentInfo {
  let agent = state.agents.find(a => a.name === name);
  if (agent) return agent;

  agent = { name, role, status: "idle", lastHeartbeat: new Date().toISOString() };
  state.agents.push(agent);
  return agent;
}

// ── Dashboard server ───────────────────────────────────────────────

let dashboardServer: Server | null = null;
let dashboardPort = 0;

function getDashboardData(state: OrchestratorState) {
  // Merge with tasks extension state if available
  const g = globalThis as any;
  const taskList = g.__piTaskList;

  return {
    groups: state.groups,
    tasks: state.tasks,
    agents: state.agents,
    _localTasks: taskList ? {
      title: taskList.listTitle,
      tasks: taskList.tasks,
    } : null,
  };
}

function startDashboard(ctx: ExtensionContext, state: OrchestratorState, cwd: string): string {
  if (dashboardServer) return `http://localhost:${dashboardPort}`;

  dashboardServer = createServer((req: IncomingMessage, res: ServerResponse) => {
    if (req.url === "/api/dashboard-data") {
      res.writeHead(200, { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" });
      res.end(JSON.stringify(getDashboardData(state)));
      return;
    }

    // Serve HTML for any other path
    res.writeHead(200, { "Content-Type": "text/html" });
    res.end(generateDashboardHTML({ title: "Agent Orchestrator", port: dashboardPort }));
  });

  // Find available port
  const server = dashboardServer;
  server.listen(0, "127.0.0.1", () => {
    const addr = server.address();
    if (addr && typeof addr === "object") {
      dashboardPort = addr.port;
    }
  });

  const url = `http://127.0.0.1:${dashboardPort}`;

  registerActiveViewer({
    kind: "board",
    title: "Orchestrator Dashboard",
    url,
    server: dashboardServer,
    onClose: () => {
      dashboardServer = null;
      dashboardPort = 0;
    },
  });

  notifyViewerOpen(ctx, {
    kind: "board",
    title: "Orchestrator Dashboard",
    url,
    server: dashboardServer,
    onClose: () => {},
  });

  return url;
}

function stopDashboard(): void {
  if (dashboardServer) {
    try { dashboardServer.close(); } catch {}
    clearActiveViewer();
    dashboardServer = null;
    dashboardPort = 0;
  }
}

// ── Extension entry point ──────────────────────────────────────────

export default function (pi: ExtensionAPI) {
  let state: OrchestratorState = { tasks: [], groups: [], nextTaskId: 1, nextGroupId: 1, agents: [] };
  let cwd = process.cwd();
  let dashboardOpen = false;
  const reviewStates = new Map<string, ReviewState>();

  function dispatchReviewAction(review: ReviewState, action: string, dispatchId?: string): void {
    const runtime = (globalThis as any).__piSubagentRuntime;
    if (!runtime?.spawn) return;
    const kind = action === "dispatch-judges" ? "judges" : action === "consolidate" ? "consolidate" : action === "dispatch-fix" ? "fix" : "";
    if (!kind) return;
    const key = dispatchId || dispatchKey(review.change, review.round, kind);
    if (!hasPendingReviewDispatch(cwd, review.change, key)) return;

    const context = `OpenSpec change: ${review.change}. Review round ${review.round}/${review.maxRounds}. ` +
      "Use the mailbox receipt contract and include the exact correlationId in your receipt.";
    if (kind === "judges") {
      const task = `${context} Read the implementation and adversarially review it. Send a JSON REVIEW receipt with correlationId ${key}.`;
      runtime.spawn({ name: "jd-judge-a", task: `${task} Your receipt type is REVIEW_A.` });
      runtime.spawn({ name: "jd-judge-b", task: `${task} Your receipt type is REVIEW_B.` });
      markReviewDispatch(cwd, review.change, key);
      return;
    }
    if (kind === "consolidate") {
      runtime.spawn({ name: "jd-consolidator", task: `${context} Read both judge receipts, reconcile findings, and send REVIEW_CONSOLIDATED followed by REVIEW_FINAL. The final receipt must include verdict PASS only after verifying the current tree and tests; otherwise include blockingFindings and verdict FAIL. CorrelationId: ${key}.` });
      markReviewDispatch(cwd, review.change, key);
      return;
    }
    runtime.spawn({
      name: "jd-fix-agent",
      task: `${context} Read REVIEW_CONSOLIDATED, fix every confirmed blocking finding, run focused tests, and send a FIX_RECEIPT with correlationId ${key}.`,
    });
    markReviewDispatch(cwd, review.change, key);
  }

  // Publish orchestrator on globalThis for cross-extension integration
  const g = globalThis as any;
  g.__piOrchestrator = {
    addTask: (text: string, groupId?: number) => {
      const group = groupId
        ? state.groups.find(g => g.id === groupId)
        : state.groups[state.groups.length - 1];
      if (group) {
        addTask(state, group.id, text);
        saveState(cwd, state);
      }
    },
    updateTaskStatus: (taskId: number, status: TaskItem["status"]) => {
      updateTaskStatus(state, taskId, status);
      saveState(cwd, state);
    },
    registerAgent: (name: string, role: string) => {
      registerAgent(state, name, role);
      saveState(cwd, state);
    },
    updateAgentStatus: (name: string, status: AgentInfo["status"], taskId?: number) => {
      const agent = state.agents.find(a => a.name === name);
      if (agent) {
        agent.status = status;
        agent.lastHeartbeat = new Date().toISOString();
        if (taskId !== undefined) agent.currentTaskId = taskId;
        saveState(cwd, state);
      }
    },
    notifyMailbox: (message: { id?: string; body?: string }) => {
      try {
        const receipt = JSON.parse(message.body || "") as ReviewReceipt;
        if (!receipt.change) return "ignore";
        // Reload on every receipt: this makes a new Pi process resume the
        // durable coordinator rather than starting a second review loop.
        const result = processReviewReceipt(cwd, { ...receipt, id: receipt.receiptId || receipt.id || message.id });
        reviewStates.set(receipt.change, result.state);
        dispatchReviewAction(result.state, result.action, result.dispatchIds[0]);
        return result.action;
      } catch {
        return "ignore";
      }
    },
    recoverReviews: () => {
      const changesDir = join(cwd, "openspec", "changes");
      if (!existsSync(changesDir)) return;
      for (const entry of readdirSync(changesDir, { withFileTypes: true })) {
        if (!entry.isDirectory()) continue;
        const review = loadReviewState(cwd, entry.name);
        reviewStates.set(entry.name, review);
        for (const key of review.dispatchIds) {
          if (hasPendingReviewDispatch(cwd, review.change, key)) {
            const kind = key.split(":").pop();
            const action = kind === "judges" ? "dispatch-judges" : kind === "consolidate" ? "consolidate" : "dispatch-fix";
            dispatchReviewAction(review, action, key);
          }
        }
        if (review.status === "RUNNING" && (!review.judgeA || !review.judgeB)) dispatchReviewAction(review, "dispatch-judges");
        if (review.status === "BLOCKED" && review.round < review.maxRounds) dispatchReviewAction(review, "dispatch-fix");
      }
    },
    getReviewState: (change: string) => reviewStates.get(change),
    getState: () => state,
  };

  // ── Register tools ──────────────────────────────────────────────

  pi.registerTool({
    name: "orch_group_create",
    label: "Orchestrator: Create Group",
    description: `Create a task group with waves.

Creates a named group that organizes tasks into sequential waves.
Waves help track progress through a multi-step initiative.

Examples:
  orch_group_create name="Auth Refactor" description="Migrate JWT to OAuth" totalWaves=3
  orch_group_create name="Bug Bash" totalWaves=1

Parameters:
- name: Group name (required)
- description: Group description (optional)
- totalWaves: Number of waves (optional, default: 1)`,
    parameters: GroupCreateParams,
    execute: async (_id, params) => {
      const group = createGroup(
        state,
        String(params.name),
        String(params.description || ""),
        Number(params.totalWaves || 1),
      );
      saveState(cwd, state);
      return {
        content: [{ type: "text" as const, text: `Created group #${group.id}: "${group.name}" (${group.totalWaves} waves)` }],
      };
    },
  });

  pi.registerTool({
    name: "orch_group_list",
    label: "Orchestrator: List Groups",
    description: "List all task groups with their status and progress.",
    parameters: GroupListParams,
    execute: async () => {
      if (state.groups.length === 0) {
        return { content: [{ type: "text", text: "No task groups yet. Create one with orch_group_create." }] };
      }
      const lines = state.groups.map(g => {
        const groupTasks = state.tasks.filter(t => t.groupId === g.id);
        const done = groupTasks.filter(t => t.status === "completed").length;
        const total = groupTasks.length;
        return `#${g.id} "${g.name}" — ${g.status} — wave ${g.currentWave}/${g.totalWaves} — ${done}/${total} tasks`;
      });
      return { content: [{ type: "text", text: lines.join("\n") }] };
    },
  });

  pi.registerTool({
    name: "orch_group_status",
    label: "Orchestrator: Group Status",
    description: "Show detailed status for a specific group including all tasks.",
    parameters: GroupStatusParams,
    execute: async (_id, params) => {
      const group = state.groups.find(g => g.id === Number(params.groupId));
      if (!group) return { content: [{ type: "text", text: `Group #${params.groupId} not found` }] };

      const groupTasks = state.tasks.filter(t => t.groupId === group.id);
      const done = groupTasks.filter(t => t.status === "completed").length;
      const working = groupTasks.filter(t => t.status === "working").length;
      const failed = groupTasks.filter(t => t.status === "failed").length;
      const pending = groupTasks.filter(t => t.status === "pending").length;

      // Group tasks by wave
      const waves: Record<number, TaskItem[]> = {};
      for (const t of groupTasks) {
        const w = t.wave || 1;
        if (!waves[w]) waves[w] = [];
        waves[w].push(t);
      }

      let output = `Group #${group.id}: "${group.name}"\n`;
      output += `Status: ${group.status} · Wave ${group.currentWave}/${group.totalWaves}\n`;
      output += `Tasks: ${done} done, ${working} working, ${failed} failed, ${pending} pending\n`;

      for (const w of Object.keys(waves).sort((a, b) => Number(a) - Number(b))) {
        output += `\nWave ${w}:\n`;
        for (const t of waves[Number(w)]) {
          const agent = t.agentName ? ` [${t.agentName}]` : "";
          output += `  #${t.id} ${t.status}: ${t.text}${agent}\n`;
        }
      }

      return { content: [{ type: "text", text: output }] };
    },
  });

  pi.registerTool({
    name: "orch_task_add",
    label: "Orchestrator: Add Task",
    description: `Add a task to a group, optionally assigned to a specific wave.

If wave is not specified, the task goes to the group's current wave.

Examples:
  orch_task_add groupId=1 text="Add refresh token table" wave=1
  orch_task_add groupId=1 text="Write migration script"`,
    parameters: TaskAddParams,
    execute: async (_id, params) => {
      const task = addTask(
        state,
        Number(params.groupId),
        String(params.text),
        params.wave !== undefined ? Number(params.wave) : undefined,
      );
      if (!task) return { content: [{ type: "text", text: `Group #${params.groupId} not found` }] };
      saveState(cwd, state);
      return { content: [{ type: "text", text: `Added task #${task.id}: "${task.text}" (wave ${task.wave})` }] };
    },
  });

  pi.registerTool({
    name: "orch_task_list",
    label: "Orchestrator: List Tasks",
    description: "List tasks, optionally filtered by group ID or status.",
    parameters: TaskListParams,
    execute: async (_id, params) => {
      let filtered = [...state.tasks];
      if (params.groupId !== undefined) filtered = filtered.filter(t => t.groupId === Number(params.groupId));
      if (params.status) filtered = filtered.filter(t => t.status === String(params.status));

      if (filtered.length === 0) return { content: [{ type: "text", text: "No matching tasks found" }] };

      const lines = filtered.map(t => {
        const agent = t.agentName ? ` [${t.agentName}]` : "";
        return `#${t.id} ${t.status.padEnd(9)}: ${t.text}${agent} (group ${t.groupId}, wave ${t.wave})`;
      });
      return { content: [{ type: "text", text: lines.join("\n") }] };
    },
  });

  pi.registerTool({
    name: "orch_task_update",
    label: "Orchestrator: Update Task",
    description: `Update a task's status. Mark as working, completed, or failed.

Optionally assign an agent name when claiming a task.

Examples:
  orch_task_update taskId=1 status=working agentName="scout-1"
  orch_task_update taskId=1 status=completed
  orch_task_update taskId=3 status=failed`,
    parameters: TaskUpdateParams,
    execute: async (_id, params) => {
      const task = updateTaskStatus(
        state,
        Number(params.taskId),
        String(params.status) as TaskItem["status"],
        params.agentName !== undefined ? String(params.agentName) : undefined,
      );
      if (!task) return { content: [{ type: "text", text: `Task #${params.taskId} not found` }] };
      saveState(cwd, state);
      return { content: [{ type: "text", text: `Task #${task.id}: ${task.status}` }] };
    },
  });

  pi.registerTool({
    name: "orch_agent_register",
    label: "Orchestrator: Register Agent",
    description: "Register or update an agent in the orchestrator's agent registry. Used by subagent spawning workflows.",
    parameters: AgentRegisterParams,
    execute: async (_id, params) => {
      const agent = registerAgent(state, String(params.name), String(params.role || "worker"));
      saveState(cwd, state);
      return { content: [{ type: "text", text: `Agent registered: ${agent.name} (${agent.role})` }] };
    },
  });

  pi.registerTool({
    name: "orch_agent_heartbeat",
    label: "Orchestrator: Agent Heartbeat",
    description: "Update an agent's status and heartbeat. Used by subagents to report their state.",
    parameters: AgentHeartbeatParams,
    execute: async (_id, params) => {
      const agent = state.agents.find(a => a.name === String(params.name));
      if (!agent) return { content: [{ type: "text", text: `Agent "${params.name}" not found. Register first.` }] };

      agent.lastHeartbeat = new Date().toISOString();
      if (params.status) agent.status = String(params.status) as AgentInfo["status"];
      if (params.currentTaskId !== undefined) agent.currentTaskId = Number(params.currentTaskId);
      saveState(cwd, state);
      return { content: [{ type: "text", text: `Heartbeat: ${agent.name} = ${agent.status}` }] };
    },
  });

  pi.registerTool({
    name: "orch_dashboard",
    label: "Orchestrator: Dashboard",
    description: "Open the orchestrator browser dashboard showing groups, tasks, waves, and agents.",
    parameters: Type.Object({}),
    execute: async () => {
      const url = startDashboard(pi as any as ExtensionContext, state, cwd);
      dashboardOpen = true;
      return { content: [{ type: "text", text: `Orchestrator dashboard opened at ${url}` }] };
    },
  });

  // ── Commands ────────────────────────────────────────────────────

  pi.registerCommand("orch", {
    description: "Open the orchestrator dashboard in the browser. Alias for orch_dashboard.",
    handler: async (_args, ctx) => {
      const url = startDashboard(ctx, state, cwd);
      dashboardOpen = true;
      if (ctx.hasUI) ctx.ui.notify(`Orchestrator dashboard opened at ${url}`, "info");
    },
  });

  pi.registerCommand("orch-close", {
    description: "Close the orchestrator dashboard.",
    handler: async () => {
      stopDashboard();
      dashboardOpen = false;
      outputLine("Orchestrator dashboard closed", "info");
    },
  });

  // ── Lifecycle hooks ──────────────────────────────────────────────

  pi.on("session_start", async (_event, ctx) => {
    cwd = ctx.cwd;
    state = loadState(cwd);
    g.__piOrchestratorState = state;

    // Merge with existing tasks from tasks.ts if we have a group-less task list
    const taskList = g.__piTaskList;
    if (taskList?.tasks && state.groups.length === 0) {
      // Auto-create a default group when tasks exist but no groups
      // (handles migration from plain tasks.ts usage)
      const group = createGroup(state, "Default", "Auto-created from existing tasks", 1);
      for (const t of taskList.tasks) {
        addTask(state, group.id, t.text);
      }
      saveState(cwd, state);
    }

    if (ctx.hasUI) {
      const count = state.groups.length;
      ctx.ui.setStatus("orch", count > 0 ? `${count} groups` : undefined);
    }
  });

  pi.on("session_shutdown", async () => {
    saveState(cwd, state);
    stopDashboard();
    g.__piOrchestrator = undefined;
    g.__piOrchestratorState = undefined;
  });

  pi.on("session_before_switch", async () => {
    saveState(cwd, state);
  });

  pi.on("session_before_fork", async () => {
    saveState(cwd, state);
  });
}
