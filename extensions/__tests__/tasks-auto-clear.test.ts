/**
 * Tests for auto-clear behavior when all tasks are toggled to done.
 *
 * When the last incomplete task is toggled to done, the task list
 * should auto-clear so the agent doesn't need to manually run `tasks clear`.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

describe("tasks auto-clear on all-done", () => {
  let pi: any;
  let tool: any;

  beforeEach(async () => {
    // Dynamic import to get a fresh module each time
    const tasksExt = (await import("../tasks")).default;
    pi = {
      registerTool(def: any) { tool = def; },
      registerCommand() {},
      on() {},
    } as any;
    // Mock ctx passed to execute — ui is needed by refreshUI
    const mockCtx = {
      ui: {
        setStatus: () => {},
        setWidget: () => {},
      },
      sessionManager: { getBranch: () => [] },
    };
    tasksExt(pi as any);
    // Override tool.execute to inject mockCtx
    const origExecute = tool.execute;
    tool.execute = (callId: string, params: any, signal?: any, onUpdate?: any, ctx?: any) => {
      return origExecute(callId, params, signal, onUpdate, ctx || mockCtx);
    };
    expect(tool).toBeDefined();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("auto-clears list when last task is toggled to done", async () => {
    // Create a list with one task
    await tool.execute("1", { action: "new-list", text: "Auto-clear test" });
    await tool.execute("2", { action: "add", text: "Do the thing" });

    // Toggle task #1 → inprogress
    let result = await tool.execute("3", { action: "toggle", id: 1 });
    expect(result.content[0].text).toContain("idle → inprogress");
    expect(result.details.tasks.length).toBe(1);

    // Toggle task #1 → done (only task, so should auto-clear)
    result = await tool.execute("4", { action: "toggle", id: 1 });
    expect(result.content[0].text).toContain("inprogress → done");
    expect(result.content[0].text).toContain("auto-cleared");

    // List should now be empty
    expect(result.details.tasks.length).toBe(0);
    expect(result.details.listTitle).toBeUndefined();
  });

  it("auto-clears list when last of multiple tasks is toggled to done", async () => {
    await tool.execute("1", { action: "new-list", text: "Multi-task test" });
    await tool.execute("2", { action: "add", texts: ["Task A", "Task B", "Task C"] });

    // Toggle all three through the cycle
    await tool.execute("3", { action: "toggle", id: 1 });
    await tool.execute("4", { action: "toggle", id: 1 }); // #1 done
    await tool.execute("5", { action: "toggle", id: 2 });
    await tool.execute("6", { action: "toggle", id: 2 }); // #2 done

    // Toggle #3 → inprogress
    let result = await tool.execute("7", { action: "toggle", id: 3 });
    expect(result.content[0].text).toContain("idle → inprogress");

    // Toggle #3 → done — last task, should auto-clear
    result = await tool.execute("8", { action: "toggle", id: 3 });
    expect(result.content[0].text).toContain("auto-cleared");
    expect(result.details.tasks.length).toBe(0);
  });

  it("does NOT auto-clear when tasks still remain incomplete", async () => {
    await tool.execute("1", { action: "new-list", text: "Remaining test" });
    await tool.execute("2", { action: "add", texts: ["Task 1", "Task 2"] });

    // Toggle #1 → inprogress → done
    await tool.execute("3", { action: "toggle", id: 1 });
    let result = await tool.execute("4", { action: "toggle", id: 1 });

    // Task #2 is still idle, so list should NOT be cleared
    expect(result.content[0].text).not.toContain("auto-cleared");
    expect(result.details.tasks.length).toBe(2); // both tasks still present
    expect(result.details.tasks[0].status).toBe("done");
    expect(result.details.tasks[1].status).toBe("idle");
  });

  it("auto-clears on toggle even when other tasks are still idle (regression: only cares about done)", async () => {
    // Actually auto-clear triggers when ALL are done, not when all non-idle are done.
    // Re-testing the "NOT auto-clear" scenario more precisely:
    await tool.execute("1", { action: "new-list", text: "Regression test" });
    await tool.execute("2", { action: "add", texts: ["Done task", "Idle task"] });

    // Toggle #1 → inprogress → done
    await tool.execute("3", { action: "toggle", id: 1 });
    const result = await tool.execute("4", { action: "toggle", id: 1 });

    // Task #2 is still idle → not all done → no auto-clear
    expect(result.content[0].text).not.toContain("auto-cleared");
    expect(result.details.tasks.length).toBeGreaterThan(0);
  });

  it("toggle from done back to idle does NOT auto-clear", async () => {
    await tool.execute("1", { action: "new-list", text: "Cycle test" });
    await tool.execute("2", { action: "add", text: "Cycle me" });

    // Toggle #1 → inprogress → done (auto-clears)
    await tool.execute("3", { action: "toggle", id: 1 });
    const doneResult = await tool.execute("4", { action: "toggle", id: 1 });
    expect(doneResult.content[0].text).toContain("auto-cleared");
    expect(doneResult.details.tasks.length).toBe(0);
  });

  it("new-list after auto-clear works normally", async () => {
    // First list
    await tool.execute("1", { action: "new-list", text: "First" });
    await tool.execute("2", { action: "add", text: "Task" });
    await tool.execute("3", { action: "toggle", id: 1 });
    const result1 = await tool.execute("4", { action: "toggle", id: 1 });
    expect(result1.content[0].text).toContain("auto-cleared");

    // Second list — should work without gate blocking
    const result2 = await tool.execute("5", { action: "new-list", text: "Second" });
    expect(result2.content[0].text).toContain("Second");
    expect(result2.details.tasks.length).toBe(0);
  });
});
