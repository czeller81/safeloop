import { createServer, type IncomingMessage, type ServerResponse } from 'http';
import { getDashboardSnapshot } from './dashboardData';
import type { SafeloopStorageOptions } from '../localStorage';

export interface MonitorServerOptions extends SafeloopStorageOptions {
  port?: number;
}

const DEFAULT_MONITOR_PORT = 3777;

function sendJson(res: ServerResponse, statusCode: number, payload: unknown): void {
  res.writeHead(statusCode, { 'content-type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(payload, null, 2));
}

function sendHtml(res: ServerResponse, html: string): void {
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
  res.end(html);
}

function sendText(res: ServerResponse, statusCode: number, text: string): void {
  res.writeHead(statusCode, { 'content-type': 'text/plain; charset=utf-8' });
  res.end(text);
}

export function renderMonitorHtml(): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Safeloop Live Loop Monitor</title>
  <style>
    :root { color-scheme: dark; }
    body { font-family: Inter, Arial, sans-serif; margin: 0; background: #0b1020; color: #e8ecff; }
    header { padding: 20px 24px; border-bottom: 1px solid #26304d; background: #0f1630; }
    h1 { margin: 0 0 6px; font-size: 24px; }
    .subtle { color: #9aa7d6; }
    main { padding: 20px 24px 32px; display: grid; gap: 16px; grid-template-columns: repeat(2, minmax(0, 1fr)); }
    section { background: #111a36; border: 1px solid #26304d; border-radius: 12px; padding: 16px; }
    section.full { grid-column: 1 / -1; }
    h2 { margin: 0 0 12px; font-size: 16px; }
    pre { margin: 0; white-space: pre-wrap; word-break: break-word; font-size: 12px; line-height: 1.5; }
    .grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; }
    .card { padding: 10px 12px; background: #0d142c; border-radius: 10px; border: 1px solid #223055; }
    .label { color: #9aa7d6; font-size: 12px; text-transform: uppercase; letter-spacing: 0.04em; }
    .value { font-size: 16px; margin-top: 4px; }
    .muted { color: #8c97bf; }
    ul { margin: 0; padding-left: 18px; }
    li { margin-bottom: 6px; }
    .score { font-size: 36px; font-weight: 700; }
    .pill { display: inline-block; padding: 3px 8px; border-radius: 999px; background: #1b2a57; font-size: 12px; margin-left: 8px; }
  </style>
</head>
<body>
  <header>
    <h1>Safeloop Live Loop Monitor <span class="pill">local-only</span></h1>
    <div class="subtle">Git tracks code. OpenTelemetry tracks runtime. Safeloop tracks agent work.</div>
  </header>
  <main>
    <section>
      <h2>Active Loops</h2>
      <div id="active-loops" class="grid"></div>
    </section>
    <section>
      <h2>Cost Dashboard</h2>
      <div id="cost-dashboard" class="grid"></div>
    </section>
    <section class="full">
      <h2>Event Timeline</h2>
      <pre id="event-timeline"></pre>
    </section>
    <section>
      <h2>Steering Dashboard</h2>
      <pre id="steering-dashboard"></pre>
    </section>
    <section>
      <h2>Risk Dashboard</h2>
      <pre id="risk-dashboard"></pre>
    </section>
    <section>
      <h2>Approval Queue</h2>
      <pre id="approval-queue"></pre>
    </section>
    <section>
      <h2>Artifact Timeline</h2>
      <pre id="artifact-timeline"></pre>
    </section>
    <section>
      <h2>Handoff Queue</h2>
      <pre id="handoff-queue"></pre>
    </section>
    <section class="full">
      <h2>Release Readiness</h2>
      <div id="readiness"></div>
    </section>
  </main>
  <script>
    async function refresh() {
      const response = await fetch('/api/dashboard');
      const snapshot = await response.json();
      render(snapshot);
    }

    function card(label, value) {
      return '<div class="card"><div class="label">' + label + '</div><div class="value">' + value + '</div></div>';
    }

    function list(items) {
      if (!items.length) return 'None';
      return items.map((item) => '- ' + item).join('\n');
    }

    function render(snapshot) {
      document.getElementById('active-loops').innerHTML = snapshot.activeLoops.map((loop) =>
        card(loop.agent, loop.task + ' · ' + loop.status + ' · ' + loop.durationSeconds + 's · ' + (loop.currentModel || 'No model'))
      ).join('') || card('No active loops', 'Waiting for events');

      document.getElementById('cost-dashboard').innerHTML = [
        card('Total cost', snapshot.costSummary.currency + ' ' + snapshot.costSummary.totalCost.toFixed(4)),
        card('Model usage', String(snapshot.modelUsage.length)),
        card('Cases', String(Object.keys(snapshot.costSummary.costByCase).length)),
        card('Agents', String(Object.keys(snapshot.costSummary.costByAgent).length))
      ].join('');

      document.getElementById('event-timeline').textContent = list(snapshot.events.map((event) => event.timestamp + ' · ' + event.type + ' · ' + event.summary));
      document.getElementById('steering-dashboard').textContent = list(snapshot.steeringInsights.map((entry) => entry.current.steeringProfileId + ' · ' + entry.verdict + ' · ' + entry.insights.join(', ')));
      document.getElementById('risk-dashboard').textContent = list(snapshot.risks.map((risk) => risk.summary + ' · ' + (risk.severity || 'unknown')));
      document.getElementById('approval-queue').textContent = list(snapshot.approvals.map((approval) => approval.summary + ' · ' + approval.reason));
      document.getElementById('artifact-timeline').textContent = list(snapshot.artifacts.map((artifact) => artifact.summary + (artifact.path ? ' · ' + artifact.path : '')));
      document.getElementById('handoff-queue').textContent = list(snapshot.handoffs.map((handoff) => (handoff.currentOwner || 'Unknown') + ' → ' + (handoff.nextOwner || 'Unknown')));
      document.getElementById('readiness').innerHTML = '<div class="score">' + snapshot.readiness.score + '/100</div><div class="subtle">' + snapshot.readiness.status + '</div><pre>' + list(snapshot.readiness.blockers) + '\n\n' + list(snapshot.readiness.recommendations) + '</pre>';
    }

    refresh();
    setInterval(refresh, 2000);
  </script>
</body>
</html>`;
}

export function createMonitorServer(options: SafeloopStorageOptions = {}) {
  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    const url = req.url ?? '/';
    if (url === '/api/dashboard') {
      sendJson(res, 200, getDashboardSnapshot(options));
      return;
    }
    if (url === '/health') {
      sendJson(res, 200, { ok: true, localOnly: true });
      return;
    }
    if (url === '/' || url.startsWith('/?')) {
      sendHtml(res, renderMonitorHtml());
      return;
    }
    sendText(res, 404, 'Not found');
  });

  return server;
}

export function startMonitorServer(options: MonitorServerOptions = {}): Promise<{ port: number; close: () => Promise<void> }> {
  const server = createMonitorServer(options);
  const port = options.port ?? DEFAULT_MONITOR_PORT;
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => {
      const address = server.address();
      const resolvedPort = typeof address === 'object' && address ? address.port : port;
      resolve({
        port: resolvedPort,
        close: () =>
          new Promise<void>((closeResolve, closeReject) => {
            server.close((error) => {
              if (error) {
                closeReject(error);
                return;
              }
              closeResolve();
            });
          }),
      });
    });
  });
}
