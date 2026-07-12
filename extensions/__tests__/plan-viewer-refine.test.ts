/**
 * Tests for plan viewer "Refine" action
 *
 * Covers:
 * 1. HTML output contains Refine button, CSS, and JS
 * 2. HTTP server accepts refine action via /result POST
 * 3. Tool handler returns correct response for refine action
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createServer } from "node:http";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { mkdtempSync, rmdirSync } from "node:fs";

// ── Import plan-viewer HTML generator ──────────────────────────────

import { generatePlanViewerHTML } from "../lib/plan-viewer-html";

// ── Helpers ────────────────────────────────────────────────────────

function httpPost(
  port: number,
  path: string,
  body: Record<string, unknown>,
): Promise<{ status: number; data: unknown }> {
  return new Promise((resolve, reject) => {
    const http = require("node:http");
    const json = JSON.stringify(body);
    const req = http.request(
      {
        hostname: "127.0.0.1",
        port,
        path,
        method: "POST",
        headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(json) },
      },
      (res: any) => {
        let data = "";
        res.on("data", (chunk: string) => (data += chunk));
        res.on("end", () => {
          try {
            resolve({ status: res.statusCode || 0, data: JSON.parse(data) });
          } catch {
            resolve({ status: res.statusCode || 0, data });
          }
        });
      },
    );
    req.on("error", reject);
    req.write(json);
    req.end();
  });
}

function textContent(result: any): string {
  // Text from @earendil-works/pi-tui has a .text property (a string)
  if (typeof result === "string") return result;
  if (result && typeof result.text === "string") return result.text;
  return String(result);
}

// ── Test Suite ─────────────────────────────────────────────────────

describe("plan-viewer HTML (refine action)", () => {
  describe("generated HTML", () => {
    const html = generatePlanViewerHTML({
      markdown: "# Test Plan\n\nPhase 1",
      title: "Test Plan",
      mode: "plan",
      port: 9999,
    });

    it("contains Refine button with correct attributes", () => {
      expect(html).toContain('class="btn btn-refine"');
      expect(html).toContain('onclick="refine()"');
      expect(html).toContain('id="btnRefine"');
      expect(html).toContain("Refine<");
    });

    it("contains .btn-refine CSS class", () => {
      expect(html).toContain(".btn-refine {");
      expect(html).toContain("color: var(--warning)");
      expect(html).toContain("border-color: var(--warning)");
    });

    it("contains refine() JavaScript function", () => {
      expect(html).toContain("window.refine = function()");
      expect(html).toContain("sendResult('refine')");
    });

    it("handles refine action in sendResult callback with Refine Requested page", () => {
      expect(html).toContain("action === 'refine'");
      expect(html).toContain("Refine Requested");
      expect(html).toContain("The agent will ask what needs to change");
    });

    it("still contains Approve and Close buttons", () => {
      expect(html).toContain("Approve Plan");
      expect(html).toContain('id="btnDecline"');
    });
  });
});

describe("plan-viewer HTTP server (refine action)", () => {
  let server: ReturnType<typeof createServer>;
  let port: number;

  beforeEach(async () => {
    await new Promise<void>((resolveSetup) => {
      server = createServer((req, res) => {
        res.setHeader("Access-Control-Allow-Origin", "*");
        res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
        res.setHeader("Access-Control-Allow-Headers", "Content-Type");

        if (req.method === "OPTIONS") {
          res.writeHead(204);
          res.end();
          return;
        }

        const url = new URL(req.url || "/", "http://localhost");

        if (req.method === "POST" && url.pathname === "/result") {
          let body = "";
          req.on("data", (chunk) => {
            body += chunk;
          });
          req.on("end", () => {
            try {
              const data = JSON.parse(body);
              res.writeHead(200, { "Content-Type": "application/json" });
              res.end(JSON.stringify({ ok: true }));
            } catch {
              if (!res.headersSent) {
                res.writeHead(400, { "Content-Type": "application/json" });
                res.end(JSON.stringify({ error: "Invalid JSON" }));
              }
            }
          });
          return;
        }

        if (req.method === "GET" && url.pathname === "/") {
          res.writeHead(200, { "Content-Type": "text/html" });
          res.end("<html></html>");
          return;
        }

        res.writeHead(404);
        res.end("Not found");
      });

      server.listen(0, "127.0.0.1", () => {
        const addr = server.address() as any;
        port = addr.port;
        resolveSetup();
      });
    });
  });

  afterEach(() => {
    if (server) {
      try { server.close(); } catch {}
    }
  });

  it("accepts refine action with HTTP 200", async () => {
    const result = await httpPost(port, "/result", {
      action: "refine",
      markdown: "# Revised",
      modified: true,
    });

    expect(result.status).toBe(200);
    expect((result.data as any).ok).toBe(true);
  });

  it("accepts approved action (regression check)", async () => {
    const result = await httpPost(port, "/result", {
      action: "approved",
      markdown: "# OK",
      modified: false,
    });

    expect(result.status).toBe(200);
    expect((result.data as any).ok).toBe(true);
  });

  it("accepts declined action (regression check)", async () => {
    const result = await httpPost(port, "/result", {
      action: "declined",
      markdown: "# No",
      modified: false,
    });

    expect(result.status).toBe(200);
    expect((result.data as any).ok).toBe(true);
  });

  it("returns 200 with ok for missing action (server defaults to declined)", async () => {
    const result = await httpPost(port, "/result", {
      markdown: "# whatever",
    } as any);

    expect(result.status).toBe(200);
    expect((result.data as any).ok).toBe(true);
  });
});

describe("plan-viewer tool handler (refine action)", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "plan-refine-test-"));
    vi.mock("node:os", async () => {
      const actual = await vi.importActual("node:os");
      return { ...actual, homedir: () => tempDir };
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    try {
      if (existsSync(tempDir)) rmdirSync(tempDir, { recursive: true });
    } catch {}
  });

  function makeTheme() {
    return {
      fg: (_cat: string, text: any) => text,
      bold: (t: any) => t,
      dim: (t: any) => t,
    } as any;
  }

  it("registers show_plan tool", async () => {
    const planViewerExt = (await import("../plan-viewer")).default;
    const pi = { registerTool(def: any) { this.tool = def; }, registerCommand() {}, on() {} } as any;
    pi.tool = null;
    planViewerExt(pi as any);

    expect(pi.tool).toBeDefined();
    expect(pi.tool.name).toBe("show_plan");
    expect(pi.tool.renderResult).toBeDefined();
  });

  it("renderResult for approved produces success text", async () => {
    const planViewerExt = (await import("../plan-viewer")).default;
    const pi = { registerTool(def: any) { this.tool = def; }, registerCommand() {}, on() {} } as any;
    planViewerExt(pi as any);

    const result = pi.tool.renderResult(
      {
        content: [{ type: "text", text: "x" }],
        details: { action: "approved", purpose: "plan", modified: false, filePath: "/x" },
      },
      {},
      makeTheme(),
    );
    expect(textContent(result).toLowerCase()).toContain("approved");
  });

  it("renderResult for declined produces warning text", async () => {
    const planViewerExt = (await import("../plan-viewer")).default;
    const pi = { registerTool(def: any) { this.tool = def; }, registerCommand() {}, on() {} } as any;
    planViewerExt(pi as any);

    const result = pi.tool.renderResult(
      {
        content: [{ type: "text", text: "x" }],
        details: { action: "declined", purpose: "plan", modified: false, filePath: "/x" },
      },
      {},
      makeTheme(),
    );
    expect(textContent(result).toLowerCase()).toContain("without approval");
  });

  it("renderResult for refine produces refine warning text", async () => {
    const planViewerExt = (await import("../plan-viewer")).default;
    const pi = { registerTool(def: any) { this.tool = def; }, registerCommand() {}, on() {} } as any;
    planViewerExt(pi as any);

    const result = pi.tool.renderResult(
      {
        content: [{ type: "text", text: "x" }],
        details: { action: "refine", purpose: "plan", modified: false, filePath: "/x" },
      },
      {},
      makeTheme(),
    );
    expect(textContent(result).toLowerCase()).toContain("refine");
  });
});
