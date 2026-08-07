// ABOUTME: Displays ASCII art banner above the editor on session start.
// ABOUTME: Reads art from ~/Desktop/agent.txt or uses embedded default; hides on first input.
/**
 * Agent Banner — ASCII art at the top of the pi app on startup
 *
 * Displays the agent logo/banner above the editor when a session starts or when
 * switching to a new session (/new). Hides automatically on first user input.
 * Art is read from ~/Desktop/agent.txt, or falls back to embedded default.
 * Footer is handled by footer.ts (model widget + status bar).
 *
 * Usage: Add to packages in settings.json
 */

import type {
  ExtensionAPI,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { VERSION } from "@earendil-works/pi-coding-agent";
import { execSync } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
import { join, basename, dirname } from "node:path";
import { homedir } from "node:os";
import { applyExtensionDefaults } from "./lib/themeMap.ts";

const DEFAULT_ART = `                                                                           ,aa,       ,aa
                                                                    d"  "b    ,d",\`b
                                                                  ,dP a  "b,ad8' 8 8
                                                                  d8' 8  ,88888a 8 8
                                                                 d8baa8ba888888888a8
                                                              ,ad888888888YYYY888YYY,
                                                           ,a888888888888"   "8P"  "b
                                                       ,aad8888tt,8888888b (0 \`8, 0 8
                  ____________________________,,aadd888ttt8888ttt"8"I  "Yb,   \`Ya  8
            ,aad8888b888888aab8888888888b,     ,aatPt888ttt8888tt 8,\`b,   "Ya,. \`"aP
        ,ad88tttt8888888888888888888888ttttt888ttd88888ttt8888tt,t "ba,.  \`"\`d888
     ,d888tttttttttttttt888888888888888888888888ttt8888888888ttt888ttt,   "a,   \`88'
    a888tttttttttttttttttttttttttt8888888888888ttttt88888ttt888888888tt,    \`""8"'
   d8P"' ,tttttttttttttttttttttttttttttttttt88tttttt888tttttttt8a"8888ttt,   ,8'
  d8tb  " ,tt"  ""tttttttttttttttttttttttttttttttttt88ttttttttttt, Y888tt"  ,8'
  88tt)              "t" ttttt" """  """    "" tttttYttttttttttttt, " 8ttb,a8'
  88tt                    \`"b'                  ""t'ttttttttttt"t"t   t taP"
  8tP                       \`b                       ,tttttt' " " "tt, ,8"
 (8tb  b,                    \`b,                 a,  tttttt'        ""dP'
 I88tb \`8,                    \`b                d'   tttttt        ,aP"
 8888tb \`8,                   ,P               d'    "tt "t'    ,a8P"
I888ttt, "b                  ,8'              ,8       "tt"  ,d"d"'
,888tttt'  8b               ,dP""""""""""""""""Y8        tt ,d",d'
,d888ttttP  d"8b            ,dP'                  "b,      "ttP' d'
,d888ttttPY ,d' dPb,        ,dP'                  "b,     t8'  8
d888tttt8" ,d" ,d"  8      ,d"'                      \`b     "P   8
d888tt88888d" ,d"  ,d"    ,d"                         8      I   8
d888888888P' ,d"  ,d"    ,d"                           8      I   8
88888888P' ,d"   (P'    d"                             8      8   8
"8P"'"8   ,8'    Ib    d"                               Y      8   8
      8   d"     \`8    8                                \`b     8   Y
      8   8       8,   8,                                 8     Y   \`b
      8   Y,      \`b   \`b                                 Y     \`b   \`b
      Y,   "ba,    \`b   \`b,                               \`b     8,   \`"ba,
       "b,   "8     \`b    \`""b                             \`b     \`Yaa,adP'
         """""'      \`baaaaaaP                              \`YaaaadP"'`;



// ── Context panel (mirrors gentle-pi's banner): GIT / PATH / VER ──

function loadArt(): string {
  const path = join(homedir(), "Desktop", "agent.txt");
  if (existsSync(path)) {
    try {
      return readFileSync(path, "utf-8").trimEnd();
    } catch {
      // fall through to default
    }
  }
  return DEFAULT_ART;
}

function gitBranch(cwd: string): string {
  try {
    return execSync("git rev-parse --abbrev-ref HEAD", {
      cwd,
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return "\u2014";
  }
}

export function shortDir(cwd: string): string {
  const child = basename(cwd);
  const parent = basename(dirname(cwd));
  return parent && parent !== child ? `${parent}/${child}` : child;
}

export function loadStats(ctx: ExtensionContext): Array<[string, string]> {
  const cwd = ctx.cwd ?? process.cwd();
  return [
    ["GIT:", gitBranch(cwd)],
    ["PATH:", shortDir(cwd)],
    ["VER:", `v${VERSION}`],
  ];
}

export function showBanner(ctx: ExtensionContext) {
  if (!ctx.hasUI) return;

  const art = loadArt();
  const split = art.split("\n");
  const firstNonEmpty = split.findIndex((l) => l.trim() !== "");
  const lines = firstNonEmpty >= 0 ? split.slice(firstNonEmpty) : split;
  const stats = loadStats(ctx);
  const labelW = Math.max(...stats.map(([l]) => l.length));

  ctx.ui.setWidget(
    "agent-banner",
    (_tui, theme) => ({
      invalidate() {},
      render(width: number): string[] {
        const rendered = lines.map((line) => theme.fg("accent", line));
        rendered.push("");
        for (const [label, value] of stats) {
          rendered.push(
            theme.fg("dim", label.padEnd(labelW)) +
              theme.fg("dim", "  ") +
              theme.fg("accent", value),
          );
        }
        rendered.push("");
        return rendered;
      },
    }),
    { placement: "aboveEditor" },
  );
}

let bannerCtx: ExtensionContext | null = null;
let bannerVisible = false;

export function isBannerVisible(): boolean {
  return bannerVisible;
}

export default function (pi: ExtensionAPI) {
  pi.on("session_start", async (_event, ctx: ExtensionContext) => {
    applyExtensionDefaults(import.meta.url, ctx);
    bannerCtx = ctx;
    bannerVisible = true;
    showBanner(ctx);
  });

  // Show banner when switching to a new session (/new)
  pi.on("session_switch", async (_event, ctx: ExtensionContext) => {
    bannerCtx = ctx;
    bannerVisible = true;
    showBanner(ctx);
  });

  // Hide banner on first user input — art shows only until you start typing
  pi.on("input", async () => {
    if (bannerCtx?.hasUI) {
      bannerCtx.ui.setWidget("agent-banner", undefined);
      bannerVisible = false;
    }
  });
}
