// ABOUTME: Typed contract for runtime globals shared by agent-pi extensions.
// ABOUTME: Keep this contract backward-compatible: extensions load independently and may be absent.

import type { MailboxNotification } from "./mailbox-types.ts";

export interface TaskListRuntime {
  listTitle?: string;
  tasks: Array<{ text: string; status?: string; [key: string]: unknown }>;
}

export interface SubagentRuntime {
  spawn(request: { name: string; task: string }): string | Promise<string>;
}

export type OrchestratorTaskStatus = "pending" | "working" | "completed" | "failed";

export interface OrchestratorRuntime {
  addTask(text: string, groupId?: number): void;
  updateTaskStatus(taskId: number, status: OrchestratorTaskStatus): void;
  registerAgent(name: string, role: string): void;
  updateAgentStatus(name: string, status: string, taskId?: number): void;
  notifyMailbox(message: MailboxNotification): string;
  recoverReviews(): void;
  getReviewState(change: string): unknown;
  getState(): unknown;
}

declare global {
  // These globals are optional because Pi extensions are registered independently.
  var __piOrchestrator: OrchestratorRuntime | undefined;
  var __piSubagentRuntime: SubagentRuntime | undefined;
  var __piTaskList: TaskListRuntime | undefined;
}

export {};
