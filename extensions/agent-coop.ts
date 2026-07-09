// ABOUTME: /co-op command — cooperative multi-agent team mode
// ABOUTME: Spawns up to 10 cooperative agents that share discoveries and help each other

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export default function (pi: ExtensionAPI) {
  pi.registerCommand("co-op", {
    description: "Cooperative multi-agent mode — spawn up to 10 agents that share discoveries and help each other",
    handler: async (args, ctx) => {
      const task = args?.trim() || "No task specified";
      
      if (ctx.hasUI) {
        ctx.ui.notify(`Starting /co-op with task: ${task.slice(0, 80)}...`, "info");
        ctx.ui.notify("Create a task group with orch_group_create, then spawn agents with dispatch_agent", "info");
        ctx.ui.notify("See commands/co-op/README.md for the full cooperative protocol", "info");
      }

      return `/co-op initialized for: ${task}\n\nSteps:\n1. orch_group_create name="co-op: ..." description="..." totalWaves=1\n2. orch_task_add groupId=[id] text="subtask 1"\n3. dispatch_agent for each subtask with cooperative protocol\n4. Monitor via mailbox_inbox and orch_dashboard\n\nSee commands/co-op/README.md for the full cooperative protocol.`;
    },
  });
}
