import { createServer, type IncomingMessage, type ServerResponse } from 'http';
import { resolve } from 'path';
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

function escapeHtmlText(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function renderMonitorHtml(options: SafeloopStorageOptions = {}): string {
  const monitoredPath = resolve(options.baseDir ?? process.cwd(), '.safeloop');
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
    .grid { display: grid; gap: 10px; }
    .status-grid { display: grid; gap: 12px; grid-template-columns: repeat(4, minmax(0, 1fr)); margin-top: 16px; }
    .status-item, .panel { background: #111a36; border: 1px solid #26304d; border-radius: 12px; padding: 14px; }
    .panel { height: 100%; }
    .label { color: #9aa7d6; font-size: 12px; text-transform: uppercase; letter-spacing: 0.04em; }
    .value { font-size: 15px; margin-top: 4px; word-break: break-word; }
    .muted { color: #8c97bf; }
    main { padding: 20px 24px 32px; display: grid; gap: 16px; grid-template-columns: repeat(2, minmax(0, 1fr)); }
    section { background: #111a36; border: 1px solid #26304d; border-radius: 12px; padding: 16px; }
    section.full { grid-column: 1 / -1; }
    h2 { margin: 0 0 12px; font-size: 16px; }
    .cards { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; }
    ul { margin: 0; padding-left: 18px; }
    li { margin-bottom: 8px; }
    pre { margin: 0; white-space: pre-wrap; word-break: break-word; font-size: 12px; line-height: 1.5; }
    .score { font-size: 36px; font-weight: 700; margin-bottom: 4px; }
    .pill { display: inline-block; padding: 3px 8px; border-radius: 999px; background: #1b2a57; font-size: 12px; margin-left: 8px; }
    .error { color: #ffb5b5; }
  </style>
</head>
<body>
  <header>
    <h1>Safeloop Live Loop Monitor <span class="pill">local-only</span></h1>
    <div class="subtle">Git tracks code. OpenTelemetry tracks runtime. Safeloop tracks agent work.</div>
    <div class="status-grid">
      <div class="status-item">
        <div class="label">Monitoring:</div>
        <div class="value" id="monitoring-path">${escapeHtmlText(monitoredPath)}</div>
      </div>
      <div class="status-item">
        <div class="label">Events:</div>
        <div class="value" id="event-count">0</div>
      </div>
      <div class="status-item">
        <div class="label">Last Updated:</div>
        <div class="value" id="last-updated">Waiting for data</div>
      </div>
      <div class="status-item">
        <div class="label">Connection:</div>
        <div class="value" id="monitor-status">Connecting…</div>
      </div>
    </div>
  </header>
  <main>
    <section>
      <h2>Active Loops</h2>
      <div id="active-loops" class="cards"></div>
    </section>
    <section>
      <h2>Cost Dashboard</h2>
      <div id="cost-dashboard" class="cards"></div>
    </section>
    <section>
      <h2>Model Usage</h2>
      <div id="model-usage" class="cards"></div>
    </section>
    <section>
      <h2>Diagnostics</h2>
      <div id="diagnostics" class="cards"></div>
    </section>
    <section class="full">
      <h2>Event Timeline</h2>
      <div id="event-timeline"></div>
    </section>
    <section>
      <h2>Steering Dashboard</h2>
      <div id="steering-dashboard" class="cards"></div>
    </section>
    <section>
      <h2>Risk Dashboard</h2>
      <div id="risk-dashboard" class="cards"></div>
    </section>
    <section>
      <h2>Approval Queue</h2>
      <div id="approval-queue" class="cards"></div>
    </section>
    <section>
      <h2>Artifact Timeline</h2>
      <div id="artifact-timeline" class="cards"></div>
    </section>
    <section>
      <h2>Handoff Queue</h2>
      <div id="handoff-queue" class="cards"></div>
    </section>
    <section class="full">
      <h2>Release Readiness</h2>
      <div id="readiness"></div>
    </section>
  </main>
  <script>
    const POLL_MS = 2000;
    const state = {
      lastPollUrl: '',
      lastHttpStatus: 'Connecting',
      lastSuccessfulPollTime: 'Waiting for data',
      responseKeys: [],
      lastRenderError: 'None',
    };

    function escapeHtml(value) {
      return String(value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
    }

    function card(title, lines) {
      const safeLines = Array.isArray(lines) ? lines : [String(lines ?? '')];
      return '<div class="panel"><div class="label">' + escapeHtml(title) + '</div><div class="value">' + safeLines.map((line) => escapeHtml(line)).join('<br />') + '</div></div>';
    }

    function setText(id, value) {
      const node = document.getElementById(id);
      if (node) {
        node.textContent = value;
      }
    }

    function formatMoney(value, currency) {
      const amount = Number(value);
      const safeAmount = Number.isFinite(amount) ? amount.toFixed(4) : '0.0000';
      return currency + ' ' + safeAmount;
    }

    function formatBreakdown(map) {
      const entries = Object.entries(map || {});
      if (!entries.length) {
        return ['None'];
      }
      return entries.map(([key, value]) => key + ': ' + Number(value).toFixed(4));
    }

    function formatDelta(value) {
      const amount = Number(value || 0);
      const sign = amount > 0 ? '+' : '';
      return sign + amount;
    }

    function listAsLines(items) {
      const values = Array.isArray(items) ? items : [];
      if (!values.length) {
        return ['None'];
      }
      return values.map((item) => String(item));
    }

    function renderDiagnostics() {
      const entries = [
        card('Last poll URL', [state.lastPollUrl || 'Not polled yet']),
        card('Last HTTP status', [state.lastHttpStatus || 'Unknown']),
        card('Last successful poll time', [state.lastSuccessfulPollTime || 'Waiting for data']),
        card('Response keys received', [state.responseKeys.length ? state.responseKeys.join(', ') : 'None']),
        card('Last render error', [state.lastRenderError || 'None']),
      ];
      document.getElementById('diagnostics').innerHTML = entries.join('');
    }

    function normalizeList(value) {
      return Array.isArray(value) ? value : [];
    }

    function normalizeSnapshot(snapshot) {
      const data = snapshot || {};
      const events = normalizeList(data.events).length ? normalizeList(data.events) : normalizeList(data.eventTimeline);
      const approvals = normalizeList(data.approvals).length ? normalizeList(data.approvals) : normalizeList(data.approvalQueue);
      const risks = normalizeList(data.risks).length ? normalizeList(data.risks) : normalizeList(data.riskDashboard?.warnings);
      const costSummary = data.costSummary || data.costDashboard || {};
      const monitoredPath = data.monitoredPath || data.monitoringPath || 'Unknown';
      return { data, events, approvals, risks, costSummary, monitoredPath };
    }

    function renderModelUsage(items, currency) {
      const entries = normalizeList(items);
      if (!entries.length) {
        return card('No model usage', ['Waiting for model usage events']);
      }
      return entries.map((entry) => card(entry.model || entry.agent || entry.agentId || 'Model usage', [
        'Agent: ' + (entry.agent || entry.agentId || 'Unknown'),
        'Project: ' + (entry.project || 'Unknown'),
        'Task: ' + (entry.taskName || entry.taskId || 'Unknown'),
        'Tokens: ' + String(entry.totalTokens ?? 0),
        'Estimated cost: ' + formatMoney(entry.estimatedCost ?? 0, entry.currency || currency || 'USD'),
      ])).join('');
    }

    function render(snapshot, successfulPollTime) {
      const normalized = normalizeSnapshot(snapshot);
      const data = normalized.data;
      const activeLoops = normalizeList(data.activeLoops);
      const modelUsage = normalizeList(data.modelUsage);
      const readiness = data.readiness || { score: 0, status: 'Unknown', blockers: [], recommendations: [] };
      const steeringInsights = normalizeList(data.steeringInsights);
      const artifacts = normalizeList(data.artifacts);
      const handoffs = normalizeList(data.handoffs);
      const costSummary = normalized.costSummary || {};
      const fallbackRisks = normalized.risks;
      const approvals = normalized.approvals;
      const events = normalized.events;
      const monitoredPath = normalized.monitoredPath;

      setText('monitoring-path', monitoredPath);
      setText('event-count', String(data.eventCount ?? events.length));
      setText('last-updated', data.lastUpdated || 'Unknown');
      setText('monitor-status', 'Connected');

      document.getElementById('active-loops').innerHTML = activeLoops.length
        ? activeLoops.map((loop) => card(loop.agent || 'Unknown', [
            'Agent: ' + (loop.agent || 'Unknown'),
            'Task: ' + (loop.task || 'Unknown task'),
            'Status: ' + (loop.status || 'unknown'),
            'Model: ' + (loop.currentModel || 'No model'),
            'Case: ' + (loop.caseId || 'Unknown'),
          ])).join('')
        : card('No active loops', ['Waiting for events']);

      document.getElementById('cost-dashboard').innerHTML = [
        card('Total cost', [formatMoney(costSummary.totalCost ?? 0, costSummary.currency || 'USD')]),
        card('Usage count', [String(costSummary.usageCount ?? modelUsage.length ?? 0)]),
        card('Cost by model', formatBreakdown(costSummary.costByModel)),
        card('Cost by agent', formatBreakdown(costSummary.costByAgent)),
        card('Cost by task', formatBreakdown(costSummary.costByTask)),
        card('Cost by project', formatBreakdown(costSummary.costByProject)),
      ].join('');

      document.getElementById('model-usage').innerHTML = renderModelUsage(modelUsage, costSummary.currency || 'USD');

      renderDiagnostics();

      document.getElementById('event-timeline').innerHTML = events.length
        ? '<ul>' + events.map((event) => '<li><strong>' + escapeHtml(event.type) + '</strong> — ' + escapeHtml(event.summary) + '<div class="muted">' + escapeHtml(event.timestamp) + ' · ' + escapeHtml(event.agentName || event.agentId) + '</div></li>').join('') + '</ul>'
        : '<div class="panel muted">No events yet</div>';

      document.getElementById('steering-dashboard').innerHTML = steeringInsights.length
        ? steeringInsights.map((entry) => card(entry.current?.steeringProfileId || 'Unknown profile', [
            'Verdict: ' + (entry.verdict || 'unknown'),
            'Token delta: ' + formatDelta(entry.deltas?.tokens),
            'Cost delta: ' + formatDelta(entry.deltas?.cost),
            'Readiness delta: ' + formatDelta(entry.deltas?.releaseReadiness),
          ])).join('')
        : card('No steering data', ['Waiting for steering events']);

      document.getElementById('risk-dashboard').innerHTML = fallbackRisks.length
        ? fallbackRisks.map((risk) => {
            const item = typeof risk === 'string' ? { summary: risk } : risk;
            return card(item.summary || 'Risk', [
              'Severity: ' + (item.severity || 'unknown'),
              'Mitigation: ' + (item.mitigation || 'None'),
            ]);
          }).join('')
        : card('No risks', ['Waiting for risk events']);

      document.getElementById('approval-queue').innerHTML = approvals.length
        ? approvals.map((approval) => card(approval.summary || 'Approval', [
            'Approver: ' + (approval.approver || 'Unknown'),
            'Reason: ' + (approval.reason || 'None'),
            'Status: ' + (approval.status || 'pending'),
          ])).join('')
        : card('No approvals', ['Waiting for approval events']);

      document.getElementById('artifact-timeline').innerHTML = artifacts.length
        ? artifacts.map((artifact) => card(artifact.summary || 'Artifact', [
            'File path: ' + (artifact.path || 'Unknown'),
            'Change summary: ' + (artifact.summary || 'None'),
          ])).join('')
        : card('No artifacts', ['Waiting for artifact events']);

      document.getElementById('handoff-queue').innerHTML = handoffs.length
        ? handoffs.map((handoff) => card(handoff.summary || 'Handoff', [
            'Current owner: ' + (handoff.currentOwner || 'Unknown'),
            'Next owner: ' + (handoff.nextOwner || 'Unknown'),
            'Recommended actions: ' + (handoff.summary || 'None'),
          ])).join('')
        : card('No handoffs', ['Waiting for handoff events']);

      document.getElementById('readiness').innerHTML = '<div class="panel"><div class="score">' + escapeHtml(String(readiness.score ?? 0)) + '/100</div><div class="value">' + escapeHtml(readiness.status || 'Unknown') + '</div><div class="label" style="margin-top:12px;">Blockers</div><pre>' + escapeHtml(listAsLines(readiness.blockers).join('<br />')) + '</pre><div class="label" style="margin-top:12px;">Recommendations</div><pre>' + escapeHtml(listAsLines(readiness.recommendations).join('<br />')) + '</pre></div>';
    }

    async function refresh() {
      const pollUrl = new URL('/api/dashboard', window.location.href).toString();
      state.lastPollUrl = pollUrl;
      renderDiagnostics();
      try {
        setText('monitor-status', 'Refreshing…');
        const response = await fetch(pollUrl, { cache: 'no-store' });
        state.lastHttpStatus = response.status + ' ' + (response.statusText || 'OK');
        if (!response.ok) {
          state.lastRenderError = 'Dashboard request failed with HTTP ' + response.status;
          throw new Error(state.lastRenderError);
        }
        const snapshot = await response.json();
        state.responseKeys = Object.keys(snapshot || {});
        state.lastSuccessfulPollTime = new Date().toISOString();
        state.lastRenderError = 'None';
        render(snapshot, state.lastSuccessfulPollTime);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.error('Safeloop monitor refresh failed:', error);
        state.lastRenderError = message;
        if (!state.lastHttpStatus || state.lastHttpStatus === 'Connecting') {
          state.lastHttpStatus = 'Error';
        }
        setText('monitor-status', 'Error');
        document.getElementById('event-timeline').innerHTML = '<div class="panel error">' + escapeHtml(message) + '</div>';
        renderDiagnostics();
      } finally {
        setTimeout(refresh, POLL_MS);
      }
    }

    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', refresh, { once: true });
    } else {
      refresh();
    }
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
      sendHtml(res, renderMonitorHtml(options));
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
