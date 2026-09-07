// ABOUTME: Self-contained HTML for the local Kanban task viewer.
// ABOUTME: The page polls the extension endpoint so task and agent changes appear live.

export interface KanbanHtmlOptions { title: string; }

export function generateKanbanHTML({ title }: KanbanHtmlOptions): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
<style>
:root{font-family:system-ui,-apple-system,sans-serif;color:#d8dee9;background:#1e2430;--panel:#252d3a;--line:#3b4656;--muted:#9aa8bb;--blue:#88c0d0;--green:#a3be8c;--yellow:#ebcb8b;--red:#bf616a}
*{box-sizing:border-box}body{margin:0;padding:28px;min-height:100vh}header{display:flex;justify-content:space-between;align-items:end;border-bottom:1px solid var(--line);padding-bottom:18px;margin-bottom:22px}h1{font-size:1.55rem;margin:0;color:var(--blue)}.subtitle{color:var(--muted);margin-top:5px;font-size:.9rem}.live{color:var(--green);font-size:.85rem}.live.offline{color:var(--red)}
.board{display:grid;grid-template-columns:repeat(4,minmax(220px,1fr));gap:14px;align-items:start}.column{background:var(--panel);border:1px solid var(--line);border-radius:8px;min-height:180px;padding:12px}.column-head{display:flex;justify-content:space-between;align-items:center;border-bottom:1px solid var(--line);padding-bottom:10px;margin-bottom:10px}.column h2{font-size:.92rem;margin:0;text-transform:uppercase;letter-spacing:.08em}.count{color:var(--muted);font-size:.8rem}.pending h2{color:var(--muted)}.working h2{color:var(--blue)}.completed h2{color:var(--green)}.failed h2{color:var(--red)}
.card{background:#303a49;border:1px solid var(--line);border-radius:6px;padding:11px;margin-bottom:9px}.card:last-child{margin-bottom:0}.text{font-size:.92rem;line-height:1.35;overflow-wrap:anywhere}.meta{display:flex;flex-wrap:wrap;gap:7px;color:var(--muted);font-size:.72rem;margin-top:9px}.owner{color:var(--yellow);font-family:ui-monospace,monospace}.empty{color:var(--muted);font-size:.82rem;padding:12px 2px}.error{text-align:center;color:var(--red);padding:50px}
@media(max-width:950px){.board{grid-template-columns:repeat(2,minmax(220px,1fr))}}@media(max-width:560px){body{padding:16px}.board{grid-template-columns:1fr}header{align-items:start;gap:12px;flex-direction:column}}
</style>
</head>
<body>
<header><div><h1>${title}</h1><div class="subtitle">Project tasks grouped by current status</div></div><div id="live" class="live">Live</div></header>
<main id="app"><div class="error">Loading tasks...</div></main>
<script>
const statuses=[['pending','Pending'],['working','Working'],['completed','Completed'],['failed','Failed']];
function escapeHtml(value){return String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
function card(task){const owner=task.owner?'<span class="owner">Owner: '+escapeHtml(task.owner)+'</span>':'';const group=task.group?' <span>'+escapeHtml(task.group)+'</span>':'';const wave=task.wave?' <span>Wave '+task.wave+'</span>':'';return '<article class="card"><div class="text">'+escapeHtml(task.text)+'</div><div class="meta">'+owner+group+wave+'<span>'+escapeHtml(task.source)+'</span></div></article>';}
function render(data){document.getElementById('app').innerHTML='<section class="board">'+statuses.map(([status,label])=>{const tasks=(data.tasks||[]).filter(task=>task.status===status);return '<section class="column '+status+'"><div class="column-head"><h2>'+label+'</h2><span class="count">'+tasks.length+'</span></div>'+(tasks.length?tasks.map(card).join(''):'<div class="empty">No tasks</div>')+'</section>';}).join('')+'</section>';}
async function poll(){const live=document.getElementById('live');try{const response=await fetch('/api/kanban-data');if(!response.ok)throw new Error();render(await response.json());live.textContent='Live';live.className='live';}catch{live.textContent='Offline';live.className='live offline';}}
poll();setInterval(poll,3000);
</script>
</body>
</html>`;
}
