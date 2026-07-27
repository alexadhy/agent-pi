// ABOUTME: Reads and resolves skills from gentle-pi's .atl/skill-registry.md.
// Gentle-pi generates this file on session_start. This module parses it,
// matches task context + target files against skill triggers, and returns
// matching skill paths for injection into scout subagent prompts.

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const REGISTRY_NAME = ".atl/skill-registry.md";

export interface SkillEntry {
	name: string;
	trigger: string;
	scope: string;
	path: string;
}

export interface SkillResolution {
	skills: SkillEntry[];
	resolved: boolean;
	registryPath: string | null;
	skill_resolution: "matched" | "none" | "no_registry";
}

/** Parse the skill registry markdown table. Returns skill entries in document order. */
function parseSkillTable(markdown: string): SkillEntry[] {
	const lines = markdown.split("\n");
	const entries: SkillEntry[] = [];
	let inTable = false;

	for (const line of lines) {
		const trimmed = line.trim();
		// Start of table
		if (trimmed.startsWith("| Skill |")) {
			inTable = true;
			continue;
		}
		// End of table (blank line or non-| line after table started)
		if (inTable && !trimmed.startsWith("|")) {
			break;
		}
		if (!inTable || !trimmed || trimmed === "| --- | --- | --- | --- |") continue;

		// Skip separator row
		if (trimmed.match(/^\|\s*[-:\s]+\|\s*[-:\s]+\|\s*[-:\s]+\|\s*[-:\s]+\|/)) continue;

		const cols = trimmed
			.split("|")
			.map((c) => c.trim())
			.filter(Boolean);

		if (cols.length < 4) continue;

		// columns: Skill, Trigger / description, Scope, Path
		const name = cols[0];
		const trigger = cols[1];
		const scope = cols[2];
		const path = cols[3];

		// Extract first URL-like path (may be in <> or bare)
		const pathMatch = path.match(/<([^>]+)>|(\/[^\s,]+)/);
		const resolvedPath = pathMatch ? (pathMatch[1] ?? pathMatch[2]) : "";

		if (name && trigger && resolvedPath) {
			entries.push({ name, trigger, scope, resolvedPath });
		}
	}

	return entries;
}

/**
 * Resolve skills for a task by matching task description and target files
 * against skill triggers in the registry.
 */
export function resolveSkillsForTask(
	task: string,
	targetFiles: string[],
	registryPath: string,
): SkillResolution {
	if (!existsSync(registryPath)) {
		return {
			skills: [],
			resolved: false,
			registryPath,
			skill_resolution: "no_registry",
		};
	}

	const markdown = readFileSync(registryPath, "utf-8");
	const entries = parseSkillTable(markdown);

	const taskLower = task.toLowerCase();
	const filesLower = targetFiles.map((f) => f.toLowerCase());

	// ponytail: naive keyword matching — upgrade to embedding similarity if FP rate rises
	const matched = entries.filter((entry) => {
		const triggerLower = entry.trigger.toLowerCase();

		// Check task description keywords
		const taskWords = taskLower.split(/\s+/);
		const triggerWords = triggerLower.split(/\s+/);
		const shared = taskWords.filter((w) => w.length > 3 && triggerWords.includes(w));
		if (shared.length >= 2) return true;

		// Check file extension / path matches
		for (const file of targetFiles) {
			const ext = file.split(".").pop()?.toLowerCase() ?? "";
			const basename = file.split("/").pop()?.toLowerCase() ?? "";
			if (
				triggerLower.includes(ext) ||
				triggerLower.includes(basename.replace(/\.[^.]+$/, ""))
			) {
				return true;
			}
		}

		return false;
	});

	return {
		skills: matched,
		resolved: matched.length > 0,
		registryPath,
		skill_resolution: matched.length > 0 ? "matched" : "none",
	};
}

/** Load the content of one or more SKILL.md files. */
export function loadSkillContent(skillPaths: string[]): Record<string, string> {
	const content: Record<string, string> = {};
	for (const p of skillPaths) {
		if (existsSync(p)) {
			try {
				content[p] = readFileSync(p, "utf-8");
			} catch {
				content[p] = `[Could not read skill file: ${p}]`;
			}
		} else {
			content[p] = `[Skill file not found: ${p}]`;
		}
	}
	return content;
}

/** Build the ## Skills to load section for a scout prompt. */
export function buildSkillSection(
	task: string,
	targetFiles: string[],
	registryPath: string,
): string {
	const resolution = resolveSkillsForTask(task, targetFiles, registryPath);

	if (resolution.skill_resolution === "no_registry") {
		return `## Skills to load before work\n\nNo skill registry found at \`${registryPath}\`. Run \`/skill-registry:refresh\` first.\n`;
	}

	if (resolution.skill_resolution === "none") {
		return `## Skills to load before work\n\nNo matching skills found for this task.\n`;
	}

	const paths = resolution.skills.map((s) => s.path);
	const content = loadSkillContent(paths);

	const lines: string[] = ["## Skills to load before work", ""];
	for (const skill of resolution.skills) {
		lines.push(`### ${skill.name} (\`${skill.path}\`)`);
		lines.push(`Trigger: ${skill.trigger}`);
		lines.push("");
		const fileContent = content[skill.path] ?? `[Could not load: ${skill.path}]`;
		lines.push("```");
		lines.push(fileContent);
		lines.push("```");
		lines.push("");
	}

	return lines.join("\n");
}
