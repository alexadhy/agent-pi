// ABOUTME: Self-contained HTML template for the Agent Orchestrator Dashboard.
// ABOUTME: Renders task groups, waves, tasks, and subagents in a live-updating browser view.

export interface DashboardOptions {
  title: string;
  port: number;
}

export function generateDashboardHTML(opts: DashboardOptions): string {
  const { title, port } = opts;

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${title} — Orchestrator</title>
<style>
  :root {
    --font: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Oxygen, Ubuntu, sans-serif;
    --mono: "SF Mono", "Fira Code", "JetBrains Mono", Consolas, monospace;
    --radius: 8px;
    --radius-sm: 6px;
    --bg: #1e1e2e;
    --surface: #181825;
    --surface2: #313244;
    --surface3: #45475a;
    --border: #45475a;
    --border-light: #585b70;
    --text: #cdd6f4;
    --text-muted: #bac2de;
    --text-dim: #a6adc8;
    --accent: #89b4fa;
    --accent-hover: #74c7ec;
    --accent-dim: rgba(137, 180, 250, 0.12);
    --success: #a6e3a1;
    --success-bg: rgba(166, 227, 161, 0.08);
    --success-border: rgba(166, 227, 161, 0.25);
    --warning: #fab387;
    --warning-bg: rgba(250, 179, 135, 0.08);
    --warning-border: rgba(250, 179, 135, 0.25);
    --error: #f38ba8;
    --error-bg: rgba(243, 139, 168, 0.08);
    --error-border: rgba(243, 139, 168, 0.25);
    --pending-color: #a6adc8;
    --pending-bg: rgba(166, 173, 200, 0.08);
    --pending-border: rgba(166, 173, 200, 0.25);
    --working-color: #89b4fa;
    --working-bg: rgba(137, 180, 250, 0.08);
    --working-border: rgba(137, 180, 250, 0.25);
  }

  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    font-family: var(--font);
    background: var(--bg);
    color: var(--text);
    padding: 20px;
    min-height: 100vh;
  }

  /* Header */
  .header {
    display: flex; justify-content: space-between; align-items: center;
    padding: 12px 0; border-bottom: 1px solid var(--border); margin-bottom: 20px;
  }
  .header h1 { font-size: 1.4rem; font-weight: 600; color: var(--accent); }
  .header .subtitle { font-size: 0.85rem; color: var(--text-dim); margin-top: 2px; }
  .header .status-badge {
    display: inline-block; padding: 4px 12px; border-radius: 12px;
    font-size: 0.8rem; font-weight: 500; background: var(--success-bg);
    border: 1px solid var(--success-border); color: var(--success);
  }

  /* Group cards */
  .groups { display: flex; flex-direction: column; gap: 16px; }
  .group-card {
    background: var(--surface); border: 1px solid var(--border);
    border-radius: var(--radius); padding: 16px; transition: border-color 0.2s;
  }
  .group-card:hover { border-color: var(--border-light); }
  .group-header {
    display: flex; justify-content: space-between; align-items: flex-start;
    margin-bottom: 12px;
  }
  .group-name { font-size: 1.1rem; font-weight: 600; color: var(--accent); }
  .group-desc { font-size: 0.85rem; color: var(--text-dim); margin-top: 2px; }
  .group-meta { display: flex; gap: 12px; align-items: center; }
  .group-meta .badge {
    padding: 2px 8px; border-radius: 10px; font-size: 0.75rem;
    font-weight: 500; background: var(--surface2); color: var(--text-muted);
  }

  /* Progress bar */
  .progress-bar {
    width: 100%; height: 6px; background: var(--surface2);
    border-radius: 3px; margin: 8px 0 12px; overflow: hidden;
  }
  .progress-fill {
    height: 100%; background: var(--success); border-radius: 3px;
    transition: width 0.3s ease;
  }

  /* Wave section */
  .wave-section { margin-bottom: 12px; }
  .wave-label {
    font-size: 0.8rem; font-weight: 600; color: var(--text-muted);
    text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 6px;
  }
  .wave-label .count { color: var(--text-dim); font-weight: 400; }

  /* Task grid */
  .task-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; }
  .task-card {
    background: var(--surface2); border: 1px solid var(--border);
    border-radius: var(--radius-sm); padding: 10px 12px;
    transition: border-color 0.2s; cursor: default;
  }
  .task-card:hover { border-color: var(--border-light); }
  .task-text { font-size: 0.85rem; color: var(--text); margin-bottom: 4px; }
  .task-meta { display: flex; gap: 6px; align-items: center; flex-wrap: wrap; }
  .task-status {
    display: inline-block; padding: 1px 6px; border-radius: 8px;
    font-size: 0.7rem; font-weight: 500;
  }
  .task-status.pending {
    color: var(--pending-color); background: var(--pending-bg);
    border: 1px solid var(--pending-border);
  }
  .task-status.working {
    color: var(--working-color); background: var(--working-bg);
    border: 1px solid var(--working-border);
  }
  .task-status.completed {
    color: var(--success); background: var(--success-bg);
    border: 1px solid var(--success-border);
  }
  .task-status.failed {
    color: var(--error); background: var(--error-bg);
    border: 1px solid var(--error-border);
  }
  .task-agent {
    font-size: 0.7rem; color: var(--text-dim); font-family: var(--mono);
  }

  /* Agent panel */
  .agents-panel {
    margin-top: 20px; background: var(--surface);
    border: 1px solid var(--border); border-radius: var(--radius);
    padding: 16px;
  }
  .agents-title {
    font-size: 0.9rem; font-weight: 600; color: var(--text-muted);
    margin-bottom: 12px; text-transform: uppercase; letter-spacing: 0.5px;
  }
  .agent-row {
    display: flex; justify-content: space-between; align-items: center;
    padding: 8px 0; border-bottom: 1px solid var(--border);
  }
  .agent-row:last-child { border-bottom: none; }
  .agent-name { font-family: var(--mono); font-size: 0.85rem; color: var(--text); }
  .agent-role { font-size: 0.75rem; color: var(--text-dim); }
  .agent-status {
    padding: 2px 8px; border-radius: 10px; font-size: 0.75rem; font-weight: 500;
  }
  .agent-status.idle { background: var(--surface2); color: var(--text-dim); }
  .agent-status.working { background: var(--working-bg); color: var(--working-color); border: 1px solid var(--working-border); }
  .agent-status.done { background: var(--success-bg); color: var(--success); border: 1px solid var(--success-border); }
  .agent-status.error { background: var(--error-bg); color: var(--error); border: 1px solid var(--error-border); }

  /* Empty state */
  .empty {
    text-align: center; padding: 40px 20px; color: var(--text-dim);
    font-size: 0.9rem;
  }
  .empty .hint { font-size: 0.8rem; margin-top: 8px; color: var(--text-dim); opacity: 0.7; }

  /* Refresh indicator */
  .refresh-indicator {
    display: inline-block; width: 8px; height: 8px; border-radius: 50%;
    background: var(--success); margin-right: 6px; animation: pulse 2s infinite;
  }
  @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.4; } }
</style>
</head>
<body>
<div class="header">
  <div>
    <h1>⚡ Agent Orchestrator</h1>
    <div class="subtitle">Task groups · waves · agents</div>
  </div>
  <div>
    <span class="refresh-indicator"></span>
    <span class="status-badge" id="statusBadge">Live</span>
  </div>
</div>

<div id="content">
  <div class="empty">
    <div>No task groups yet</div>
    <div class="hint">Use /orch commands in Pi to create groups and tasks</div>
  </div>
</div>

<div id="agentsPanel" style="display:none">
  <div class="agents-panel" id="agentsContent">
    <div class="agents-title">🤖 Active Agents</div>
    <div id="agentList"></div>
  </div>
</div>

<script>
const POLL_INTERVAL = 3000;
let lastData = null;

async function fetchData() {
  try {
    const res = await fetch('/api/dashboard-data');
    if (!res.ok) throw new Error('HTTP ' + res.status);
    return await res.json();
  } catch {
    return null;
  }
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function taskCard(task) {
  const statusClass = task.status || 'pending';
  const agentHtml = task.agentName ? \`<span class="task-agent">\${escapeHtml(task.agentName)}</span>\` : '';
  return \`<div class="task-card">
    <div class="task-text">\${escapeHtml(task.text)}</div>
    <div class="task-meta">
      <span class="task-status \${statusClass}">\${statusClass}</span>
      \${agentHtml}
    </div>
  </div>\`;
}

function renderWaves(tasks) {
  if (!tasks || tasks.length === 0) return '<div class="empty"><div>No tasks in this group</div></div>';

  const waves = {};
  for (const t of tasks) {
    const w = t.wave || 1;
    if (!waves[w]) waves[w] = [];
    waves[w].push(t);
  }

  const sortedWaves = Object.keys(waves).sort((a,b) => Number(a) - Number(b));
  return sortedWaves.map(w => {
    const waveTasks = waves[w];
    const pending = waveTasks.filter(t => t.status === 'pending').length;
    const working = waveTasks.filter(t => t.status === 'working').length;
    const done = waveTasks.filter(t => t.status === 'completed').length;
    const total = waveTasks.length;
    return \`<div class="wave-section">
      <div class="wave-label">Wave \${w} <span class="count">(\${done}/\${total} · \${working} working, \${pending} pending)</span></div>
      <div class="task-grid">\${waveTasks.map(taskCard).join('')}</div>
    </div>\`;
  }).join('');
}

function renderGroup(group, tasks) {
  const total = tasks.length;
  const done = tasks.filter(t => t.status === 'completed').length;
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;
  const statusBadge = group.status === 'completed' ? 'completed' : \`wave \${group.currentWave || 1}/\${group.totalWaves || 1}\`;

  return \`<div class="group-card">
    <div class="group-header">
      <div>
        <div class="group-name">\${escapeHtml(group.name)}</div>
        <div class="group-desc">\${escapeHtml(group.description || '')}</div>
      </div>
      <div class="group-meta">
        <span class="badge">\${statusBadge}</span>
        <span class="badge">\${done}/\${total} tasks</span>
      </div>
    </div>
    <div class="progress-bar"><div class="progress-fill" style="width:\${pct}%"></div></div>
    \${renderWaves(tasks)}
  </div>\`;
}

function renderAgents(agents) {
  if (!agents || agents.length === 0) return '';
  const panel = document.getElementById('agentsPanel');
  panel.style.display = 'block';
  const list = document.getElementById('agentList');
  list.innerHTML = agents.map(a => \`<div class="agent-row">
    <div>
      <div class="agent-name">\${escapeHtml(a.name)}</div>
      <div class="agent-role">\${escapeHtml(a.role || 'worker')}</div>
    </div>
    <span class="agent-status \${a.status || 'idle'}">\${a.status || 'idle'}</span>
  </div>\`).join('');
}

function render(data) {
  const content = document.getElementById('content');
  const statusBadge = document.getElementById('statusBadge');

  if (!data) {
    statusBadge.textContent = 'Offline';
    statusBadge.style.background = 'var(--error-bg)';
    statusBadge.style.borderColor = 'var(--error-border)';
    statusBadge.style.color = 'var(--error)';
    return;
  }

  statusBadge.textContent = 'Live';
  statusBadge.style.background = 'var(--success-bg)';
  statusBadge.style.borderColor = 'var(--success-border)';
  statusBadge.style.color = 'var(--success)';

  const groups = data.groups || [];
  const tasks = data.tasks || [];
  const agents = data.agents || [];

  if (groups.length === 0) {
    content.innerHTML = \`<div class="empty">
      <div>No task groups yet</div>
      <div class="hint">Use \`orch_group_create\` in Pi to get started</div>
    </div>\`;
  } else {
    content.innerHTML = '<div class="groups">' +
      groups.map(g => {
        const groupTasks = tasks.filter(t => t.groupId === g.id);
        return renderGroup(g, groupTasks);
      }).join('') +
    '</div>';
  }

  renderAgents(agents);
}

async function poll() {
  const data = await fetchData();
  render(data);
  lastData = data;
}

poll();
setInterval(poll, POLL_INTERVAL);
</script>
</body>
</html>`;
}
