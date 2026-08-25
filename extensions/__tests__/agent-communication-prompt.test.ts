import { describe, expect, it } from "vitest";
import {
  SHARED_AGENT_COMMUNICATION_PROMPT,
  buildAgentSystemPromptArgs,
  ensureReviewMailboxTool,
} from "../subagent-widget.ts";

const modes = ["TEAM", "CHAIN"] as const;
const roles = ["SCOUT", "BUILDER", "REVIEWER", "JUDGE", "FIX"] as const;

describe("shared agent communication prompt", () => {
  it("is always the first appended system prompt", () => {
    expect(buildAgentSystemPromptArgs()).toEqual([
      "--append-system-prompt",
      SHARED_AGENT_COMMUNICATION_PROMPT,
    ]);
  });

  it("preserves role-specific prompts after the shared policy", () => {
    const rolePrompt = "You are the TEAM builder.";
    expect(buildAgentSystemPromptArgs(rolePrompt)).toEqual([
      "--append-system-prompt",
      SHARED_AGENT_COMMUNICATION_PROMPT,
      "--append-system-prompt",
      rolePrompt,
    ]);
  });

  it.each(modes)("injects the policy for every %s agent role", (mode) => {
    for (const role of roles) {
      const args = buildAgentSystemPromptArgs(`${mode} ${role} instructions`);
      expect(args[0]).toBe("--append-system-prompt");
      expect(args[1]).toBe(SHARED_AGENT_COMMUNICATION_PROMPT);
      expect(args).toContain(`${mode} ${role} instructions`);
    }
  });

  it("adds mailbox_send to review agents when their definition omits it", () => {
    expect(ensureReviewMailboxTool("jd-judge-a", "read,grep,bash")).toBe("read,grep,bash,mailbox_send");
    expect(ensureReviewMailboxTool("jd-consolidator", "read,mailbox_send")).toBe("read,mailbox_send");
    expect(ensureReviewMailboxTool("builder", "read,write")).toBe("read,write");
  });

  it("contains actionable communication requirements", () => {
    expect(SHARED_AGENT_COMMUNICATION_PROMPT).toContain("State results first");
    expect(SHARED_AGENT_COMMUNICATION_PROMPT).toContain("Report concrete files, commands, tests, and blockers");
    expect(SHARED_AGENT_COMMUNICATION_PROMPT).toContain("Do not claim success without verification");
    expect(SHARED_AGENT_COMMUNICATION_PROMPT).toContain("next action");
  });
});
