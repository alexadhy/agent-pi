import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { createServer, type Server } from "node:http";
import { execFile } from "node:child_process";
import { registerActiveViewer, clearActiveViewer, notifyViewerOpen } from "./lib/viewer-session.ts";
import "./lib/runtime-contract.ts";

export type KanbanTask = { id: string | number; text: string; status: string; agentName?: string; wave?: number };

export function collectKanbanTasks(): KanbanTask[] {
  const orch = globalThis.__piOrchestrator?.getState() as any;
  const project = Array.isArray(orch?.tasks) ? orch.tasks : [];
  const local = globalThis.__piTaskList?.tasks ?? [];
  const tasks = project.length ? project : local;
  const agents = Array.isArray(orch?.agents) ? orch.agents : [];
  return tasks.map((task: any, index: number) => {
    const id = task.id ?? index + 1;
    const owner = task.agentName || agents.find((agent: any) => agent.currentTaskId === id)?.name;
    return {
      id,
      text: String(task.text ?? ""),
      status: task.status === "working" || task.status === "inprogress" ? "working" : task.status === "completed" || task.status === "done" ? "completed" : task.status === "failed" ? "failed" : "pending",
      agentName: owner,
      wave: task.wave,
    };
  });
}

export function renderKanbanHTML(): string {
  const columns = ["pending", "working", "completed", "failed"];
  const cards = JSON.stringify(collectKanbanTasks()).replace(/</g, "\\u003c");
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Kanban</title><style>
:root{color-scheme:dark;font-family:ui-sans-serif,system-ui;background:#111827;color:#f3f4f6}body{margin:0;padding:24px}h1{margin:0 0 6px}.sub{color:#9ca3af;margin-bottom:20px}.board{display:grid;grid-template-columns:repeat(4,minmax(210px,1fr));gap:16px}.column{background:#1f2937;border-radius:12px;padding:14px;min-height:260px}.column h2{font-size:14px;text-transform:uppercase;letter-spacing:.08em;margin:0 0 12px;color:#cbd5e1}.card{background:#374151;border-radius:9px;padding:12px;margin:9px 0;box-shadow:0 2px 5px #0004}.card p{margin:0 0 8px;line-height:1.4}.owner{font-size:12px;color:#93c5fd}.empty{color:#6b7280;font-size:13px}@media(max-width:850px){.board{grid-template-columns:repeat(2,minmax(180px,1fr))}}@media(max-width:520px){body{padding:14px}.board{grid-template-columns:1fr}}
</style></head><body><h1>Project Kanban</h1><div class="sub">Tasks and current agent ownership · auto-refreshes every 3 seconds</div><div id="board" class="board"></div><script>
const initial=${cards}; const labels={pending:'Pending',working:'Working',completed:'Completed',failed:'Failed'};
function draw(tasks){document.querySelector('#board').innerHTML=Object.keys(labels).map(s=>'<section class="column"><h2>'+labels[s]+' ('+tasks.filter(t=>t.status===s).length+')</h2>'+((tasks.filter(t=>t.status===s).map(t=>'<article class="card"><p>#'+t.id+' '+escapeHtml(t.text)+'</p>'+(t.agentName?'<div class="owner">Assigned: '+escapeHtml(t.agentName)+'</div>':'<div class="owner">Unassigned</div>')+'</article>').join(''))||'<div class="empty">No tasks</div>')+'</section>').join('')}
function escapeHtml(v){return String(v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))} draw(initial); setInterval(async()=>{try{const r=await fetch('/api/kanban');draw(await r.json())}catch{}},3000);
</script></body></html>`;
}

let server: Server | undefined; let port = 0;
function openBrowser(url: string): void { const command = process.platform === "darwin" ? "open" : process.platform === "win32" ? "start" : "xdg-open"; execFile(command, [url], () => {}); }

export default function (pi: ExtensionAPI) {
  pi.registerCommand("kanban", { description: "Open the project Kanban board with task and subagent ownership.", handler: async (_args, ctx) => {
    if (!server) {
      server = createServer((req, res) => { if (req.url === "/api/kanban") { res.writeHead(200, { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }); res.end(JSON.stringify(collectKanbanTasks())); return; } res.writeHead(200, { "Content-Type": "text/html" }); res.end(renderKanbanHTML()); });
      server.listen(0, "127.0.0.1", () => { const address = server?.address(); port = address && typeof address === "object" ? address.port : 0; const url = `http://127.0.0.1:${port}`; openBrowser(url); });
      registerActiveViewer({ kind: "board", title: "Project Kanban", url: `http://127.0.0.1:${port}`, server, onClose: () => { server = undefined; port = 0; } });
      notifyViewerOpen(ctx as ExtensionContext, { kind: "board", title: "Project Kanban", url: `http://127.0.0.1:${port}`, server, onClose: () => {} });
    } else openBrowser(`http://127.0.0.1:${port}`);
    return `Kanban opened at http://127.0.0.1:${port}`;
  }});
  pi.on("session_shutdown", async () => { if (server) { server.close(); clearActiveViewer(); server = undefined; port = 0; } });
}
