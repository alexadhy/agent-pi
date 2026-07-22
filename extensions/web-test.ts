// ABOUTME: Local web testing extension using agent-browser CLI for screenshots, content extraction, and responsive testing.
// ABOUTME: Registers /web-remote command and web_remote tool backed by the local agent-browser binary.
/**
 * Web Remote — Local browser testing via agent-browser CLI
 *
 * Uses agent-browser (https://github.com/agent-browser/cli) to provide
 * headless browser capabilities locally:
 *
 *   - Screenshot any URL at custom viewport sizes
 *   - Extract page text/HTML content (with optional CSS selector)
 *   - Capture responsive screenshots at mobile/tablet/desktop breakpoints
 *
 * Screenshots are saved to .pi/web-test-captures/ and paths are returned
 * so the agent can Read them to visually inspect pages.
 *
 * Commands:
 *   /web-remote screenshot <url>          -- capture a screenshot
 *   /web-remote content <url> [selector]  -- extract page content
 *   /web-remote responsive <url>          -- multi-viewport screenshots
 *
 * Tool:
 *   web_remote                            -- programmatic access (agent can call)
 *
 * Prerequisites:
 *   - agent-browser installed (brew or npm i -g agent-browser)
 *   - agent-browser install (downloads Chromium on first run)
 *
 * Usage: pi -e extensions/web-test.ts
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import { type AutocompleteItem } from "@earendil-works/pi-tui";
import { Text } from "@earendil-works/pi-tui";
import { execSync, spawn } from "child_process";
import { existsSync, mkdirSync, writeFileSync, readFileSync } from "fs";
import { join, dirname, basename } from "path";
import { fileURLToPath } from "url";

// ── Constants ────────────────────────────────────

const CAPTURE_DIR_NAME = "web-test-captures";

// ── Types ────────────────────────────────────────

type Action = "screenshot" | "content" | "responsive";

interface WebTestResult {
  action: Action;
  url: string;
  success: boolean;
  screenshots?: string[];
  data?: any;
  error?: string;
  elapsed: number;
}

// ── Capture Directory ────────────────────────────

function ensureCaptureDir(cwd: string): string {
  const captureDir = join(cwd, ".pi", CAPTURE_DIR_NAME);
  if (!existsSync(captureDir)) {
    mkdirSync(captureDir, { recursive: true });
  }
  return captureDir;
}

function timestamp(): string {
  const now = new Date();
  const pad = (n: number, len = 2) => String(n).padStart(len, "0");
  return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
}

// ── agent-browser Wrapper ────────────────────────

function ensureBrowserInstalled(): string | null {
  try {
    const out = execSync("which agent-browser", {
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    return out.trim();
  } catch {
    return null;
  }
}

/**
 * Run agent-browser commands sequentially in a single browser session.
 * Opens the page, runs actions, then closes the browser.
 */
async function runBrowserSession(
  url: string,
  steps: string[],
): Promise<{ stdout: string; stderr: string }> {
  // Build a single shell command that runs in one session
  const cmds: string[] = [];
  cmds.push(`agent-browser open "${url}"`);
  for (const step of steps) {
    cmds.push(`agent-browser ${step}`);
  }
  cmds.push("agent-browser close");

  const script = cmds.join(" && ");
  return new Promise((resolve, reject) => {
    const child = spawn("sh", ["-c", script], {
      stdio: ["ignore", "pipe", "pipe"],
      shell: false,
      timeout: 30000,
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    child.on("close", (code) => {
      if (code === 0) {
        resolve({ stdout, stderr });
      } else {
        reject(
          new Error(`agent-browser exited code ${code}: ${stderr || stdout}`),
        );
      }
    });
    child.on("error", reject);
  });
}

// ── Action Handlers ──────────────────────────────

async function doScreenshot(
  url: string,
  cwd: string,
  opts: { width?: number; height?: number; fullPage?: boolean },
): Promise<WebTestResult> {
  const start = Date.now();
  const captureDir = ensureCaptureDir(cwd);
  const ts = timestamp();
  const filename = `screenshot-${ts}.png`;
  const filePath = join(captureDir, filename);

  try {
    const steps: string[] = [];
    if (opts.width && opts.height) {
      steps.push(`set viewport ${opts.width} ${opts.height}`);
    }
    steps.push(`screenshot "${filePath}"`);

    await runBrowserSession(url, steps);

    if (!existsSync(filePath)) {
      return {
        action: "screenshot",
        url,
        success: false,
        error: "Screenshot file was not created",
        elapsed: Date.now() - start,
      };
    }

    const sizeBytes = readFileSync(filePath).length;

    return {
      action: "screenshot",
      url,
      success: true,
      screenshots: [filePath],
      data: {
        title: basename(filePath),
        width: opts.width ?? 1280,
        height: opts.height ?? 720,
        sizeBytes,
      },
      elapsed: Date.now() - start,
    };
  } catch (e: any) {
    return {
      action: "screenshot",
      url,
      success: false,
      error: e.message || String(e),
      elapsed: Date.now() - start,
    };
  }
}

async function doContent(
  url: string,
  opts: { selector?: string },
): Promise<WebTestResult> {
  const start = Date.now();

  try {
    // agent-browser read outputs text to stdout
    // We run it in a fresh session: open, read, close
    const cmd = `agent-browser open "${url}" && agent-browser read && agent-browser close`;
    const stdout = execSync(cmd, {
      encoding: "utf-8",
      timeout: 30000,
      stdio: ["ignore", "pipe", "pipe"],
    });

    // Try to extract title from the page content (first line is often the title)
    const lines = stdout.trim().split("\n");
    const title = lines[0]?.replace(/^#\s*/, "").trim() || url;

    return {
      action: "content",
      url,
      success: true,
      data: {
        title,
        text: stdout.trim(),
        textLength: stdout.trim().length,
        selector: opts.selector || null,
      },
      elapsed: Date.now() - start,
    };
  } catch (e: any) {
    return {
      action: "content",
      url,
      success: false,
      error: e.message || String(e),
      elapsed: Date.now() - start,
    };
  }
}

async function doResponsive(
  url: string,
  cwd: string,
  opts: { viewports?: Array<{ name: string; width: number; height: number }> },
): Promise<WebTestResult> {
  const start = Date.now();
  const captureDir = ensureCaptureDir(cwd);
  const ts = timestamp();
  const savedPaths: string[] = [];
  const viewports = opts.viewports || [
    { name: "mobile", width: 375, height: 812 },
    { name: "tablet", width: 768, height: 1024 },
    { name: "desktop", width: 1440, height: 900 },
  ];

  try {
    for (const vp of viewports) {
      const filename = `responsive-${vp.name}-${ts}.png`;
      const filePath = join(captureDir, filename);

      const steps: string[] = [];
      steps.push(`set viewport ${vp.width} ${vp.height}`);
      steps.push(`screenshot "${filePath}"`);

      await runBrowserSession(url, steps);

      if (existsSync(filePath)) {
        savedPaths.push(filePath);
      }
    }

    return {
      action: "responsive",
      url,
      success: savedPaths.length > 0,
      screenshots: savedPaths,
      data: {
        title: url,
        viewports: viewports.map((v) => ({
          name: v.name,
          width: v.width,
          height: v.height,
        })),
      },
      elapsed: Date.now() - start,
    };
  } catch (e: any) {
    return {
      action: "responsive",
      url,
      success: savedPaths.length > 0,
      screenshots: savedPaths,
      data: {
        title: url,
        viewports: viewports.map((v) => ({
          name: v.name,
          width: v.width,
          height: v.height,
        })),
      },
      error: savedPaths.length === 0 ? e.message : undefined,
      elapsed: Date.now() - start,
    };
  }
}

// ── Result Formatting ────────────────────────────

function formatResult(result: WebTestResult): string {
  const lines: string[] = [];

  if (!result.success) {
    lines.push(`Error: ${result.error}`);
    lines.push(`URL: ${result.url}`);
    lines.push(`Elapsed: ${Math.round(result.elapsed / 1000)}s`);
    return lines.join("\n");
  }

  lines.push(`Web test complete: ${result.action}`);
  lines.push(`URL: ${result.url}`);
  lines.push(`Elapsed: ${Math.round(result.elapsed / 1000)}s`);
  lines.push("");

  switch (result.action) {
    case "screenshot": {
      const d = result.data;
      lines.push(`Page title: ${d.title}`);
      lines.push(`Viewport: ${d.width}x${d.height}`);
      lines.push(`File size: ${(d.sizeBytes / 1024).toFixed(1)} KB`);
      lines.push("");
      if (result.screenshots?.length) {
        lines.push("Screenshot saved:");
        for (const p of result.screenshots) lines.push(`  ${p}`);
        lines.push("");
        lines.push("Use Read on the path above to view the captured page.");
      }
      break;
    }
    case "content": {
      const d = result.data as any;
      lines.push(`Page title: ${d.title}`);
      lines.push(`Text length: ${d.textLength} chars`);
      if (d.selector) lines.push(`CSS selector: ${d.selector}`);
      lines.push("");
      lines.push("--- Page Text ---");
      const text = d.text as string;
      lines.push(
        text.length > 2000 ? text.slice(0, 2000) + "\n...[truncated]" : text,
      );
      break;
    }
    case "responsive": {
      const d = result.data as any;
      lines.push(`Page title: ${d.title}`);
      lines.push("");

      if (d.viewports && d.viewports.length > 0) {
        lines.push("Viewports captured:");
        for (const vp of d.viewports) {
          lines.push(`  ${vp.name}: ${vp.width}x${vp.height}`);
        }
      }

      if (result.screenshots?.length) {
        lines.push("");
        lines.push("Screenshots saved:");
        for (const p of result.screenshots) lines.push(`  ${p}`);
        lines.push("");
        lines.push("Use Read on any path above to view the captured page.");
      }
      break;
    }
  }

  return lines.join("\n");
}

// ── Extension ────────────────────────────────────

export default function (pi: ExtensionAPI) {
  // ── /web-remote command ────────────────────────

  const ACTIONS = ["screenshot", "content", "responsive"];

  pi.registerCommand("web-remote", {
    description:
      "Test web pages locally using agent-browser (screenshot, content, responsive). Supports localhost URLs.",
    getArgumentCompletions: (prefix: string): AutocompleteItem[] | null => {
      const items = ACTIONS.map((a) => ({
        value: a,
        label:
          a === "screenshot"
            ? "screenshot <url> -- capture a PNG screenshot"
            : a === "content"
              ? "content <url> [selector] -- extract page text"
              : "responsive <url> -- multi-viewport screenshots",
      }));
      const filtered = items.filter((i) => i.value.startsWith(prefix));
      return filtered.length > 0 ? filtered : items;
    },
    handler: async (args, ctx) => {
      // Check agent-browser is installed
      if (!ensureBrowserInstalled()) {
        ctx.ui.notify(
          "agent-browser not found. Install: npm install -g agent-browser && agent-browser install",
          "error",
        );
        return;
      }

      const parts = (args ?? "").trim().split(/\s+/);
      const action = parts[0]?.toLowerCase();
      const url = parts[1];

      if (!action || !ACTIONS.includes(action)) {
        ctx.ui.notify(
          "Usage: /web-remote <action> <url>\n" +
            "Actions: screenshot, content, responsive\n" +
            "Supports localhost URLs.",
          "warning",
        );
        return;
      }

      if (!url) {
        ctx.ui.notify(`Usage: /web-remote ${action} <url>`, "warning");
        return;
      }

      ctx.ui.notify(`Running ${action} on ${url}...`, "info");

      let result: WebTestResult;

      switch (action) {
        case "screenshot":
          result = await doScreenshot(url, ctx.cwd, {});
          break;
        case "content":
          result = await doContent(url, { selector: parts[2] });
          break;
        case "responsive":
          result = await doResponsive(url, ctx.cwd, {});
          break;
        default:
          return;
      }

      if (result.success) {
        const msg = result.screenshots?.length
          ? `${action} complete (${Math.round(result.elapsed / 1000)}s). ${result.screenshots.length} file(s) saved.`
          : `${action} complete (${Math.round(result.elapsed / 1000)}s).`;
        ctx.ui.notify(msg, "success");
      } else {
        ctx.ui.notify(`${action} failed: ${result.error}`, "error");
      }

      return formatResult(result);
    },
  });

  // ── web_remote tool ──────────────────────────

  pi.registerTool({
    name: "web_remote",
    label: "Web Remote",
    description: [
      "Test web pages locally using agent-browser CLI.",
      "Supports localhost, 127.0.0.1, and any http/https URL.",
      "",
      "Captures screenshots, extracts page content,",
      "and tests responsive layouts at multiple viewports.",
      "",
      "Actions:",
      "  screenshot  -- capture a PNG screenshot (returns file path for Read tool)",
      "  content     -- extract page text (with optional CSS selector)",
      "  responsive  -- capture at mobile (375px), tablet (768px), desktop (1440px)",
      "",
      "Screenshot paths can be passed to the Read tool to visually inspect pages.",
    ].join("\n"),
    parameters: Type.Object({
      action: Type.String({
        description: "Action to perform: screenshot, content, responsive",
      }),
      url: Type.String({
        description: "URL to test (must be http: or https:)",
      }),
      width: Type.Optional(
        Type.Number({
          description:
            "Viewport width in pixels (default: 1280, screenshot only)",
        }),
      ),
      height: Type.Optional(
        Type.Number({
          description:
            "Viewport height in pixels (default: 720, screenshot only)",
        }),
      ),
      fullPage: Type.Optional(
        Type.Boolean({
          description:
            "Capture full page scroll (default: false, screenshot only)",
        }),
      ),
      selector: Type.Optional(
        Type.String({
          description: "CSS selector to extract (content action only)",
        }),
      ),
    }),

    async execute(_toolCallId, params, _signal, onUpdate, ctx) {
      const { action, url, width, height, fullPage, selector } = params as {
        action: string;
        url: string;
        width?: number;
        height?: number;
        fullPage?: boolean;
        selector?: string;
      };

      // Check installed
      if (!ensureBrowserInstalled()) {
        return {
          content: [
            {
              type: "text" as const,
              text: "agent-browser not found. Install: npm install -g agent-browser && agent-browser install",
            },
          ],
          details: { error: "agent-browser not installed" },
        };
      }

      // Validate action
      if (!ACTIONS.includes(action)) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Unknown action: ${action}. Available: ${ACTIONS.join(", ")}`,
            },
          ],
          details: { error: `Unknown action: ${action}` },
        };
      }

      // Validate URL
      try {
        const parsed = new URL(url);
        if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
          return {
            content: [
              {
                type: "text" as const,
                text: "Only http: and https: URLs are allowed.",
              },
            ],
            details: { error: "Invalid protocol" },
          };
        }
      } catch {
        return {
          content: [{ type: "text" as const, text: `Invalid URL: ${url}` }],
          details: { error: "Invalid URL" },
        };
      }

      if (onUpdate) {
        onUpdate({
          content: [
            { type: "text" as const, text: `Running ${action} on ${url}...` },
          ],
          details: { action, url, status: "running" },
        });
      }

      let result: WebTestResult;

      switch (action) {
        case "screenshot":
          result = await doScreenshot(url, ctx.cwd, {
            width,
            height,
            fullPage,
          });
          break;
        case "content":
          result = await doContent(url, { selector });
          break;
        case "responsive":
          result = await doResponsive(url, ctx.cwd, {});
          break;
        default:
          result = {
            action: action as Action,
            url,
            success: false,
            error: "Unknown action",
            elapsed: 0,
          };
      }

      const output = formatResult(result);

      return {
        content: [{ type: "text" as const, text: output }],
        details: {
          action,
          url,
          status: result.success ? "done" : "error",
          screenshots: result.screenshots,
          data: result.data,
          elapsed: result.elapsed,
        },
      };
    },

    renderCall(_params, _theme) {
      const p = _params as { action: string; url: string };
      const DIM = "\x1b[90m";
      const BRIGHT = "\x1b[1;97m";
      const RST = "\x1b[0m";
      return new Text(
        `${DIM}web-remote:${RST} ${BRIGHT}${p.action}${RST} ${DIM}${p.url}${RST}`,
        0,
        0,
      );
    },

    renderResult(result, _options, _theme) {
      const details = result.details as any;
      const DIM = "\x1b[90m";
      const GREEN = "\x1b[32m";
      const RED = "\x1b[91m";
      const BRIGHT = "\x1b[1;97m";
      const YELLOW = "\x1b[33m";
      const RST = "\x1b[0m";

      if (details?.status === "error") {
        return new Text(
          `${RED}failed${RST} ${DIM}${details?.action || ""}${RST}`,
          0,
          0,
        );
      }

      const elapsed = details?.elapsed ? Math.round(details.elapsed / 1000) : 0;
      const action = details?.action || "";

      switch (action) {
        case "screenshot": {
          const count = details?.screenshots?.length ?? 0;
          return new Text(
            `${GREEN}captured${RST} ${BRIGHT}${count}${RST} ${DIM}screenshot in ${elapsed}s${RST}`,
            0,
            0,
          );
        }
        case "content": {
          const len = details?.data?.textLength ?? 0;
          return new Text(
            `${GREEN}extracted${RST} ${BRIGHT}${len}${RST} ${DIM}chars in ${elapsed}s${RST}`,
            0,
            0,
          );
        }
        case "responsive": {
          const count = details?.screenshots?.length ?? 0;
          return new Text(
            `${GREEN}captured${RST} ${BRIGHT}${count}${RST} ${DIM}viewports in ${elapsed}s${RST}`,
            0,
            0,
          );
        }
        default:
          return new Text(
            `${GREEN}done${RST} ${DIM}in ${elapsed}s${RST}`,
            0,
            0,
          );
      }
    },
  });

  // ── Session start ────────────────────────────

  pi.on("session_start", async (_event, ctx) => {
    ensureCaptureDir(ctx.cwd);
  });
}
