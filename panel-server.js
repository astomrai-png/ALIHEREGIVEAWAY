const http = require('http');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const HOST = '127.0.0.1';
const PORT = Number(process.env.PANEL_PORT || 8787);
const PROJECT_DIR = __dirname;
const BOT_FILE = path.join(PROJECT_DIR, 'index.js');
const MAX_LOG_LINES = 250;
let botProcess = null;
let logLines = [];

function appendLog(text) {
  const lines = String(text).split(/\r?\n/).filter(Boolean);
  logLines.push(...lines);
  if (logLines.length > MAX_LOG_LINES) logLines = logLines.slice(-MAX_LOG_LINES);
}

function isRunning() {
  return Boolean(botProcess && botProcess.exitCode === null && !botProcess.killed);
}

function startBot() {
  if (isRunning()) return false;
  appendLog('[PANEL] Starting bot in SAFE_MODE.');
  botProcess = spawn(process.execPath, [BOT_FILE], {
    cwd: PROJECT_DIR,
    env: { ...process.env, SAFE_MODE: '1' },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  botProcess.stdout.on('data', data => appendLog(data));
  botProcess.stderr.on('data', data => appendLog(data));
  botProcess.on('error', err => appendLog(`[PANEL] Process error: ${err.message}`));
  botProcess.on('close', (code, signal) => {
    appendLog(`[PANEL] Bot stopped. code=${code ?? 'none'} signal=${signal ?? 'none'}`);
    botProcess = null;
  });
  return true;
}

function stopBot() {
  if (!isRunning()) return false;
  appendLog('[PANEL] Stopping bot.');
  botProcess.kill('SIGTERM');
  setTimeout(() => {
    if (isRunning()) botProcess.kill('SIGKILL');
  }, 4000).unref();
  return true;
}

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'Content-Length': Buffer.byteLength(body)
  });
  res.end(body);
}

const page = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Local Bot Panel</title>
<style>
:root{color-scheme:dark;font-family:system-ui,-apple-system,Segoe UI,sans-serif}body{margin:0;background:#0b1020;color:#eef2ff;min-height:100vh;display:grid;place-items:center}.card{width:min(720px,calc(100% - 32px));background:#141b2f;border:1px solid #2d3a60;border-radius:18px;padding:24px;box-shadow:0 18px 60px #0008}h1{margin:0 0 6px;font-size:26px}.muted{color:#aab5d6;margin:0 0 22px}.status{display:flex;align-items:center;gap:10px;background:#0e1528;border-radius:12px;padding:14px;margin-bottom:18px}.dot{width:11px;height:11px;border-radius:50%;background:#f59e0b}.dot.on{background:#34d399}.buttons{display:flex;gap:10px;flex-wrap:wrap}button{border:0;border-radius:10px;padding:11px 16px;color:white;background:#41568f;font-weight:700;cursor:pointer}button:hover{filter:brightness(1.15)}button.stop{background:#9f3f57}button.restart{background:#7b5aa6}pre{height:290px;overflow:auto;background:#070b16;border-radius:12px;padding:14px;white-space:pre-wrap;color:#c8d3f2;font-size:12px;margin:18px 0 0}.safe{font-size:12px;color:#95a4cc;margin-top:16px}
</style></head>
<body><main class="card"><h1>Local Bot Panel</h1><p class="muted">Private localhost controls for your own bot process</p><div class="status"><span id="dot" class="dot"></span><strong id="state">Checking…</strong><span id="pid" class="muted"></span></div><div class="buttons"><button onclick="act('start')">Start</button><button class="stop" onclick="act('stop')">Stop</button><button class="restart" onclick="act('restart')">Restart</button><button onclick="refresh()">Refresh</button></div><pre id="logs">Loading logs…</pre><div class="safe">Safe mode: only process controls are provided. No crash, spam, or targeting controls are included.</div></main>
<script>
async function refresh(){const r=await fetch('/api/status');const d=await r.json();document.getElementById('state').textContent=d.running?'Running':'Stopped';document.getElementById('dot').className='dot '+(d.running?'on':'');document.getElementById('pid').textContent=d.pid?'PID '+d.pid:'';document.getElementById('logs').textContent=d.logs.join('\\n')||'No panel logs yet.';const el=document.getElementById('logs');el.scrollTop=el.scrollHeight}
async function act(name){await fetch('/api/'+name,{method:'POST'});await refresh()}refresh();setInterval(refresh,3000)
</script></body></html>`;

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${HOST}:${PORT}`);
  if (req.method === 'GET' && url.pathname === '/') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    return res.end(page);
  }
  if (req.method === 'GET' && url.pathname === '/api/status') {
    return sendJson(res, 200, { running: isRunning(), pid: isRunning() ? botProcess.pid : null, logs: logLines });
  }
  if (req.method === 'POST' && url.pathname === '/api/start') {
    return sendJson(res, 200, { ok: true, changed: startBot() });
  }
  if (req.method === 'POST' && url.pathname === '/api/stop') {
    return sendJson(res, 200, { ok: true, changed: stopBot() });
  }
  if (req.method === 'POST' && url.pathname === '/api/restart') {
    stopBot();
    setTimeout(startBot, 500);
    return sendJson(res, 200, { ok: true });
  }
  sendJson(res, 404, { ok: false, error: 'Not found' });
});

server.listen(PORT, HOST, () => {
  console.log(`Local Bot Panel: http://${HOST}:${PORT}`);
});

process.on('SIGINT', () => { stopBot(); server.close(() => process.exit(0)); });
process.on('SIGTERM', () => { stopBot(); server.close(() => process.exit(0)); });
