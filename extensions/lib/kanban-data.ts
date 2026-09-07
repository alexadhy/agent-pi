// ABOUTME: Normalizes orchestrator and local task state for the Kanban viewer.
// ABOUTME: Keeps the browser contract independent from either task extension.

export type KanbanStatus = "pending" | "working" | "completed" | "failed";

export interface KanbanTask {
  id: string;
  text: string;
  status: KanbanStatus;
  owner?: string;
  group?: string;
  wave?: number;
  source: "orchestrator" | "tasks";
}

export interface KanbanData {
  tasks: KanbanTask[];
  counts: Record<KanbanStatus, number>;
  updatedAt: string;
}

const STATUS_ORDER: KanbanStatus[] = ["pending", "working", "completed", "failed"];

function emptyCounts(): Record<KanbanStatus, number> {
  return { pending: 0, working: 0, completed: 0, failed: 0 };
}

function ownerForTask(task: any, agents: any[]): string | undefined {
  if (typeof task.agentName === "string" && task.agentName) return task.agentName;
  const agent = agents.find((candidate) => candidate.currentTaskId === task.id);
  return typeof agent?.name === "string" ? agent.name : undefined;
}

export function buildKanbanData(orchestrator: any, localTaskList: any): KanbanData {
  const tasks: KanbanTask[] = [];
  const counts = emptyCounts();
  const state = orchestrator?.getState?.() ?? orchestrator?.state;
  const groups = Array.isArray(state?.groups) ? state.groups : [];
  const agents = Array.isArray(state?.agents) ? state.agents : [];

  for (const task of Array.isArray(state?.tasks) ? state.tasks : []) {
    if (!STATUS_ORDER.includes(task.status)) continue;
    const group = groups.find((candidate: any) => candidate.id === task.groupId);
    const normalized: KanbanTask = {
      id: `orch-${task.id}`,
      text: String(task.text ?? ""),
      status: task.status,
      owner: ownerForTask(task, agents),
      group: typeof group?.name === "string" ? group.name : undefined,
      wave: typeof task.wave === "number" ? task.wave : undefined,
      source: "orchestrator",
    };
    tasks.push(normalized);
    counts[normalized.status]++;
  }

  for (const task of Array.isArray(localTaskList?.tasks) ? localTaskList.tasks : []) {
    const status: KanbanStatus = task.status === "inprogress"
      ? "working"
      : task.status === "done"
        ? "completed"
        : "pending";
    const normalized: KanbanTask = {
      id: `local-${task.id}`,
      text: String(task.text ?? ""),
      status,
      source: "tasks",
    };
    tasks.push(normalized);
    counts[status]++;
  }

  return { tasks, counts, updatedAt: new Date().toISOString() };
}
