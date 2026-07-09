// ABOUTME: YAML-based workflow template system — replaces commander_workflow.
// ABOUTME: Templates stored as .yaml files in ~/.pi/workflows/.

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import { readFileSync, readdirSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

// ── Types ────────────────────────────────────────────────────────────

interface WorkflowStep {
  phase: string;
  actions: string[];
}

interface WorkflowTemplate {
  name: string;
  description: string;
  steps: WorkflowStep[];
}

// ── Paths ────────────────────────────────────────────────────────────

function getWorkflowsDir(): string {
  return join(homedir(), ".pi", "workflows");
}

function ensureWorkflowsDir(): void {
  const dir = getWorkflowsDir();
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

// ── Built-in templates ───────────────────────────────────────────────

const BUILTIN_TEMPLATES: Record<string, WorkflowTemplate> = {
  "contextos": {
    name: "context-os spec workflow",
    description: "Full spec-driven feature workflow: requirements → spec → implement",
    steps: [
      { phase: "Initialize Spec", actions: ["Create dated spec folder: context-os/specs/YYYY-MM-DD-feature-name/", "Save user's raw idea to planning/initialization.md"] },
      { phase: "Shape Requirements", actions: ["Write follow-up questions to planning/questions.md", "Call show_plan in questions mode to collect answers", "Save answers to planning/requirements.md"] },
      { phase: "Write Spec", actions: ["Create spec.md with: Goal, User Stories, Requirements, Visual Design", "Include Out of Scope section"] },
      { phase: "Present & Open", actions: ["Call show_spec to open the multi-page spec viewer", "Review inline comments, iterate if needed"] },
      { phase: "Implement", actions: ["Proceed with implementation once spec is approved"] },
    ],
  },
  "plan-first": {
    name: "Plan-first workflow",
    description: "Standard plan-first workflow: analyze → plan → approve → implement",
    steps: [
      { phase: "Analyze", actions: ["Gather context via scouts or direct reading", "Understand the codebase and requirements"] },
      { phase: "Plan", actions: ["Write structured plan to .context/todo.md", "Include phases, files, and verification steps"] },
      { phase: "Present & Approve", actions: ["Call show_plan to open the plan viewer", "Get user approval before coding"] },
      { phase: "Implement", actions: ["Follow the plan phase by phase", "Commit frequently"] },
    ],
  },
  "bug-fix": {
    name: "Bug fix workflow",
    description: "Structured bug investigation and fix workflow",
    steps: [
      { phase: "Reproduce", actions: ["Understand the bug report", "Create a minimal reproduction"] },
      { phase: "Root Cause", actions: ["Trace the code path", "Identify the root cause"] },
      { phase: "Fix", actions: ["Write the fix", "Add tests to prevent regression"] },
      { phase: "Verify", actions: ["Run tests", "Verify the fix resolves the original issue"] },
    ],
  },
};

// ── Template operations ──────────────────────────────────────────────

function parseYamlSimple(content: string): any {
  // Simple YAML parser for flat workflow templates
  const result: any = { steps: [] };
  let currentStep: WorkflowStep | null = null;

  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    const nameMatch = trimmed.match(/^name:\s*(.+)$/);
    if (nameMatch) { result.name = nameMatch[1]; continue; }

    const descMatch = trimmed.match(/^description:\s*(.+)$/);
    if (descMatch) { result.description = descMatch[1]; continue; }

    const phaseMatch = trimmed.match(/^  -\s*phase:\s*(.+)$/);
    if (phaseMatch) {
      if (currentStep) result.steps.push(currentStep);
      currentStep = { phase: phaseMatch[1], actions: [] };
      continue;
    }

    const actionMatch = trimmed.match(/^\s+- "(.+)"$/);
    if (actionMatch && currentStep) {
      currentStep.actions.push(actionMatch[1]);
      continue;
    }
  }

  if (currentStep) result.steps.push(currentStep);
  return result;
}

function listTemplates(): WorkflowTemplate[] {
  const templates: WorkflowTemplate[] = Object.values(BUILTIN_TEMPLATES);
  const dir = getWorkflowsDir();
  if (existsSync(dir)) {
    for (const file of readdirSync(dir).filter(f => f.endsWith(".yaml") || f.endsWith(".yml"))) {
      try {
        const content = readFileSync(join(dir, file), "utf-8");
        const parsed = parseYamlSimple(content);
        if (parsed.name && parsed.steps) {
          templates.push({ name: parsed.name, description: parsed.description || "", steps: parsed.steps });
        }
      } catch {}
    }
  }
  return templates;
}

function getTemplate(name: string): WorkflowTemplate | undefined {
  // Check built-ins first
  if (BUILTIN_TEMPLATES[name]) return BUILTIN_TEMPLATES[name];

  // Check file system
  const dir = getWorkflowsDir();
  if (existsSync(dir)) {
    for (const file of readdirSync(dir).filter(f => f.endsWith(".yaml") || f.endsWith(".yml"))) {
      try {
        const content = readFileSync(join(dir, file), "utf-8");
        const parsed = parseYamlSimple(content);
        if (parsed.name === name) return { name: parsed.name, description: parsed.description || "", steps: parsed.steps };
      } catch {}
    }
  }

  return undefined;
}

// ── Tool Registration ────────────────────────────────────────────────

export default function (pi: ExtensionAPI) {
  pi.registerTool({
    name: "workflow_list",
    label: "Workflow: List Templates",
    description: "List all available workflow templates (built-in + user-defined).",
    parameters: Type.Object({}),
    execute: async () => {
      const templates = listTemplates();
      if (templates.length === 0) {
        return { content: [{ type: "text" as const, text: "No workflow templates found." }] };
      }

      const lines = templates.map(t => {
        const stepCount = t.steps.length;
        return `"${t.name}" — ${stepCount} steps${t.description ? ` (${t.description})` : ""}`;
      });

      return { content: [{ type: "text" as const, text: `Available workflows:\n${lines.join("\n")}` }] };
    },
  });

  pi.registerTool({
    name: "workflow_get",
    label: "Workflow: Get Template",
    description: "Get a specific workflow template by name. Returns the structured steps.",
    parameters: Type.Object({
      name: Type.String({ description: "Workflow template name (e.g. 'contextos', 'plan-first', 'bug-fix')" }),
    }),
    execute: async (_id, params) => {
      const name = String(params.name);
      const template = getTemplate(name);

      if (!template) {
        const available = listTemplates().map(t => `"${t.name}"`).join(", ");
        return {
          content: [{ type: "text" as const, text: `Workflow "${name}" not found. Available: ${available}` }],
        };
      }

      const steps = template.steps.map((s, i) => {
        const actions = s.actions.map(a => `    - ${a}`).join("\n");
        return `  Phase ${i + 1}: ${s.phase}\n${actions}`;
      }).join("\n\n");

      return {
        content: [{ type: "text" as const, text: `Workflow: "${template.name}"\n${template.description ? `Description: ${template.description}\n` : ""}\n${steps}` }],
      };
    },
  });

  pi.registerTool({
    name: "workflow_create",
    label: "Workflow: Create Template",
    description: "Create a new workflow template from YAML content. Saved to ~/.pi/workflows/.",
    parameters: Type.Object({
      name: Type.String({ description: "Workflow name" }),
      content: Type.String({ description: "YAML content defining the workflow steps" }),
    }),
    execute: async (_id, params) => {
      ensureWorkflowsDir();
      const fileName = String(params.name).toLowerCase().replace(/\s+/g, "-") + ".yaml";
      const filePath = join(getWorkflowsDir(), fileName);

      try {
        writeFileSync(filePath, String(params.content), "utf-8");

        // Verify it parses
        const parsed = parseYamlSimple(String(params.content));
        if (!parsed.name || !parsed.steps || parsed.steps.length === 0) {
          return {
            content: [{ type: "text" as const, text: `File saved but YAML parsing failed. Check format: name and steps required.` }],
          };
        }

        return {
          content: [{ type: "text" as const, text: `Workflow "${parsed.name}" created (${parsed.steps.length} steps). Use workflow_get to view it.` }],
        };
      } catch (err: any) {
        return {
          content: [{ type: "text" as const, text: `Failed to create workflow: ${err.message}` }],
        };
      }
    },
  });
}
