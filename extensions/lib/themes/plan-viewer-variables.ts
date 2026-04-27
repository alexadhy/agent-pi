// ABOUTME: Maps Catppuccin palette colors to plan viewer CSS custom properties.
// ABOUTME: Provides generators for both light (Latte) and dark (Mocha) theme CSS.

import type { CatppuccinPalette } from "./catppuccin-palette.js";
import { LATTE, MOCHA } from "./catppuccin-palette.js";

/** Semantic CSS variable names used across plan viewer HTML. */
export interface PlanViewerVars {
	bg: string;
	surface: string;
	surface2: string;
	border: string;
	text: string;
	"text-muted": string;
	"text-dim": string;
	accent: string;
	"accent-hover": string;
	"accent-dim": string;
	success: string;
	"success-bg": string;
	warning: string;
	error: string;
	"answer-bg": string;
	"cursor-bg": string;
}

function rgba(hex: string, alpha: number): string {
	const r = parseInt(hex.slice(1, 3), 16);
	const g = parseInt(hex.slice(3, 5), 16);
	const b = parseInt(hex.slice(5, 7), 16);
	return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function mapPaletteToVars(p: CatppuccinPalette): PlanViewerVars {
	return {
		bg: p.base.hex,
		surface: p.mantle.hex,
		surface2: p.surface0.hex,
		border: p.surface1.hex,
		text: p.text.hex,
		"text-muted": p.subtext1.hex,
		"text-dim": p.subtext0.hex,
		accent: p.blue.hex,
		"accent-hover": p.sapphire.hex,
		"accent-dim": rgba(p.blue.hex, 0.1),
		success: p.green.hex,
		"success-bg": rgba(p.green.hex, 0.08),
		warning: p.peach.hex,
		error: p.red.hex,
		"answer-bg": rgba(p.teal.hex, 0.06),
		"cursor-bg": rgba(p.teal.hex, 0.06),
	};
}

/** Generate CSS variable declarations for the Catppuccin Latte (light) theme. */
export function toLatteVars(): PlanViewerVars {
	return mapPaletteToVars(LATTE);
}

/** Generate CSS variable declarations for the Catppuccin Mocha (dark) theme. */
export function toMochaVars(): PlanViewerVars {
	return mapPaletteToVars(MOCHA);
}

/**
 * Render a CSS variable block as a string for embedding in `<style>`.
 * Output format: `  --bg: #eff1f5;\n  --surface: #e6e9ef;\n  ...`
 */
export function renderVarsBlock(vars: PlanViewerVars): string {
	return Object.entries(vars)
		.map(([key, value]) => `    --${key}: ${value};`)
		.join("\n");
}
