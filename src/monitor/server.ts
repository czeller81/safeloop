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
  header { padding: 20px 24px 18px; border-bottom: 1px solid #26304d; background: linear-gradient(180deg, #101938 0%, #0b1020 100%); }
  h1 { margin: 0 0 6px; font-size: 24px; }
  .subtle { color: #9aa7d6; }
  .kpi-grid { display: grid; gap: 10px; grid-template-columns: repeat(8, minmax(0, 1fr)); margin-top: 16px; }
  .kpi-card, .panel, .status-item { background: #111a36; border: 1px solid #26304d; border-radius: 12px; padding: 14px; }
  .kpi-card { min-height: 86px; display: flex; flex-direction: column; justify-content: space-between; }
  .kpi-label { color: #9aa7d6; font-size: 12px; text-transform: uppercase; letter-spacing: 0.04em; }
  .kpi-value { font-size: 22px; font-weight: 700; margin-top: 6px; word-break: break-word; }
  .kpi-subvalue { color: #8c97bf; font-size: 12px; margin-top: 4px; }
  .status-pill { display: inline-flex; align-items: center; gap: 6px; padding: 4px 10px; border-radius: 999px; font-size: 12px; font-weight: 700; }
  .status-pill.connected { background: rgba(65, 195, 128, 0.16); color: #78f0c2; }
  .status-pill.connecting { background: rgba(255, 203, 96, 0.16); color: #ffd36a; }
  .status-pill.error { background: rgba(255, 113, 113, 0.16); color: #ffb5b5; }
  main { padding: 20px 24px 32px; display: grid; gap: 16px; grid-template-columns: repeat(2, minmax(0, 1fr)); }
  section { background: #111a36; border: 1px solid #26304d; border-radius: 12px; padding: 16px; }
  section.full { grid-column: 1 / -1; }
  h2 { margin: 0 0 12px; font-size: 16px; }
  .section-hint { color: #9aa7d6; font-size: 12px; margin: -4px 0 12px; }
  .cards { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; }
  .cards.compact { grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); }
  .mini-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: 10px; }
  .bar-chart { display: grid; gap: 10px; }
  .bar-row { display: grid; gap: 6px; }
  .bar-label { display: flex; justify-content: space-between; gap: 10px; color: #d8e0ff; font-size: 12px; }
  .bar-track { height: 10px; background: #1b2444; border-radius: 999px; overflow: hidden; }
  .bar-fill { height: 100%; border-radius: inherit; background: linear-gradient(90deg, #6aa8ff 0%, #78f0c2 100%); }
  .metric-list { display: grid; gap: 8px; }
  .metric-row { display: flex; justify-content: space-between; gap: 10px; align-items: flex-start; padding: 10px 12px; border-radius: 10px; background: #0e1730; border: 1px solid #243254; }
  .metric-row .left { min-width: 0; }
  .metric-row .title { font-weight: 600; margin-bottom: 2px; word-break: break-word; }
  .metric-row .meta { color: #8c97bf; font-size: 12px; }
  .metric-row .badge { white-space: nowrap; }
  .badge { display: inline-flex; align-items: center; padding: 3px 8px; border-radius: 999px; background: #1b2a57; font-size: 12px; }
  .muted { color: #8c97bf; }
  ul { margin: 0; padding-left: 18px; }
  li { margin-bottom: 8px; }
  pre { margin: 0; white-space: pre-wrap; word-break: break-word; font-size: 12px; line-height: 1.5; }
  details { margin-top: 12px; }
  details summary { cursor: pointer; color: #9aa7d6; font-size: 12px; }
  .score { font-size: 36px; font-weight: 700; margin-bottom: 4px; }
  .error { color: #ffb5b5; }
  .diagnostics { display: grid; gap: 8px; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); }
</style>
</head>
<body>
  <header>
    <h1>Safeloop Live Loop Monitor <span class="badge">local-only</span></h1>
    <div class="subtle">Executive control tower for agent work, spend, review, and risk.</div>
    <div class="kpi-grid" id="kpi-grid">
      <div class="kpi-card"><div class="kpi-label">Connection status</div><div class="kpi-value" id="kpi-connection">Connecting…</div><div class="kpi-subvalue" id="monitoring-path">${escapeHtmlText(monitoredPath)}</div></div>
      <div class="kpi-card"><div class="kpi-label">Event count</div><div class="kpi-value" id="kpi-event-count">0</div><div class="kpi-subvalue">Total events in the local stream</div></div>
      <div class="kpi-card"><div class="kpi-label">Active agent count</div><div class="kpi-value" id="kpi-active-agents">0</div><div class="kpi-subvalue">Unique active agents</div></div>
      <div class="kpi-card"><div class="kpi-label">Total cost</div><div class="kpi-value" id="kpi-total-cost">USD 0.0000</div><div class="kpi-subvalue">Local accountability record</div></div>
      <div class="kpi-card"><div class="kpi-label">Usage count</div><div class="kpi-value" id="kpi-usage-count">0</div><div class="kpi-subvalue">Token / cost records</div></div>
      <div class="kpi-card"><div class="kpi-label">High risk count</div><div class="kpi-value" id="kpi-high-risk">0</div><div class="kpi-subvalue">Unique high-severity risks</div></div>
      <div class="kpi-card"><div class="kpi-label">Pending approval count</div><div class="kpi-value" id="kpi-pending-approval">0</div><div class="kpi-subvalue">Human review waiting</div></div>
      <div class="kpi-card"><div class="kpi-label">Last updated</div><div class="kpi-value" id="kpi-last-updated">Waiting for data</div><div class="kpi-subvalue" id="kpi-last-success">No successful poll yet</div></div>
    </div>
  </header>
  <main>
    <section>
      <h2>Spend Overview</h2>
      <div class="section-hint">Cost is summarized as explicit accountability, not hidden telemetry.</div>
      <div class="mini-grid" id="spend-overview"></div>
    </section>
    <section>
      <h2>Token Usage</h2>
      <div class="section-hint">Latest token / cost records with project and task context.</div>
      <div class="cards compact" id="model-usage"></div>
    </section>
    <section>
      <h2>Active Agent Work</h2>
      <div class="section-hint">Grouped by agent + task + status. Latest 8 groups by default.</div>
      <div class="metric-list" id="active-loops"></div>
      <details class="raw-details" id="active-loops-raw-details">
        <summary>Show all raw agent work records</summary>
        <div class="metric-list" id="active-loops-raw"></div>
      </details>
    </section>
    <section class="full">
      <h2>Activity Timeline</h2>
      <div class="section-hint">Latest 20 events by default, plus a raw drilldown for the full stream.</div>
      <div class="mini-grid" id="events-by-type"></div>
      <div class="metric-list" id="event-timeline"></div>
      <details class="raw-details">
        <summary>Show all raw events</summary>
        <div class="metric-list" id="event-timeline-raw"></div>
      </details>
    </section>
    <section>
      <h2>Risk &amp; Guardrails</h2>
      <div class="section-hint">Grouped by summary + severity and sorted by severity first.</div>
      <div class="mini-grid" id="risks-by-severity"></div>
      <div class="metric-list" id="risk-dashboard"></div>
      <details class="raw-details">
        <summary>Show all raw risks</summary>
        <div class="metric-list" id="risk-dashboard-raw"></div>
      </details>
    </section>
    <section>
      <h2>Human Review</h2>
      <div class="section-hint">Pending approvals first; approved items are grouped and collapsed.</div>
      <div class="mini-grid" id="approvals-by-status"></div>
      <div class="metric-list" id="approval-queue"></div>
      <details class="raw-details">
        <summary>Show all raw approvals</summary>
        <div class="metric-list" id="approval-queue-raw"></div>
      </details>
    </section>
    <section>
      <h2>Work Products</h2>
      <div class="section-hint">Artifacts grouped by file path. Latest 10 groups by default.</div>
      <div class="metric-list" id="artifact-timeline"></div>
      <details class="raw-details">
        <summary>Show all raw work products</summary>
        <div class="metric-list" id="artifact-timeline-raw"></div>
      </details>
    </section>
    <section>
      <h2>Agent Handoffs</h2>
      <div class="section-hint">Grouped by from + to + summary. Latest 10 groups by default.</div>
      <div class="metric-list" id="handoff-queue"></div>
      <details class="raw-details">
        <summary>Show all raw handoffs</summary>
        <div class="metric-list" id="handoff-queue-raw"></div>
      </details>
    </section>
    <section class="full">
      <h2>Release Readiness</h2>
      <div id="readiness"></div>
    </section>
    <section class="full">
      <h2>Diagnostics</h2>
      <div class="section-hint">Compact runtime checks and response metadata.</div>
      <div class="diagnostics" id="diagnostics"></div>
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
      return '<div class="panel"><div class="kpi-label">' + escapeHtml(title) + '</div><div class="value">' + safeLines.map((line) => escapeHtml(line)).join('<br />') + '</div></div>';
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

    function normalizeList(value) {
      return Array.isArray(value) ? value : [];
    }

    function normalizeSnapshot(snapshot) {
      const data = snapshot || {};
      const events = normalizeList(data.events).length ? normalizeList(data.events) : normalizeList(data.eventTimeline);
      const approvals = normalizeList(data.approvals).length ? normalizeList(data.approvals) : normalizeList(data.approvalQueue);
      const risks = normalizeList(data.risks).length ? normalizeList(data.risks) : normalizeList(data.riskDashboard?.warnings);
      const artifacts = normalizeList(data.artifacts);
      const handoffs = normalizeList(data.handoffs);
      const activeLoops = normalizeList(data.activeLoops);
      const costSummary = data.costSummary || data.costDashboard || {};
      const monitoredPath = data.monitoredPath || data.monitoringPath || 'Unknown';
      return { data, events, approvals, risks, artifacts, handoffs, activeLoops, costSummary, monitoredPath };
    }

    function groupRecords(items, keyFn, sorter) {
      const grouped = new Map();
      for (const item of items) {
        const key = keyFn(item);
        const entry = grouped.get(key);
        if (entry) {
          entry.count += 1;
          entry.items.push(item);
          entry.latest = item;
        } else {
          grouped.set(key, { key, count: 1, items: [item], latest: item });
        }
      }
      const records = Array.from(grouped.values());
      if (typeof sorter === 'function') {
        records.sort(sorter);
      }
      return records;
    }

    function groupCounts(values) {
      const counts = new Map();
      for (const value of values) {
        counts.set(value, (counts.get(value) || 0) + 1);
      }
      return Array.from(counts.entries()).sort((a, b) => b[1] - a[1]);
    }

    function severityRank(severity) {
      const normalized = String(severity || '').toLowerCase();
      if (normalized === 'critical' || normalized === 'high') return 0;
      if (normalized === 'medium') return 1;
      if (normalized === 'low') return 2;
      return 3;
    }

    function statusRank(status) {
      const normalized = String(status || '').toLowerCase();
      if (normalized === 'pending') return 0;
      if (normalized === 'review') return 1;
      if (normalized === 'approved') return 2;
      if (normalized === 'rejected') return 3;
      return 4;
    }

    function renderChart(title, entries, formatLabel) {
      const rows = Array.isArray(entries) ? entries : [];
      if (!rows.length) {
        return card(title, ['None']);
      }
      const max = Math.max(...rows.map((row) => Number(row[1]) || 0), 1);
      const bars = rows.slice(0, 6).map(([label, value]) => {
        const ratio = Math.max(0, (Number(value) || 0) / max);
        return '<div class="bar-row"><div class="bar-label"><span>' + escapeHtml(formatLabel ? formatLabel(label) : label) + '</span><span>' + escapeHtml(String(Number(value).toFixed ? Number(value).toFixed(4) : value)) + '</span></div><div class="bar-track"><div class="bar-fill" style="width:' + (ratio * 100).toFixed(1) + '%"></div></div></div>';
      }).join('');
      return '<div class="panel"><div class="kpi-label">' + escapeHtml(title) + '</div><div class="bar-chart">' + bars + '</div></div>';
    }

    function renderChartFromMap(title, map) {
      return renderChart(title, Object.entries(map || {}), (label) => label);
    }

    function renderKpiCards(snapshot) {
      const data = snapshot.data;
      const totalCost = snapshot.costSummary.totalCost ?? 0;
      const currency = snapshot.costSummary.currency || 'USD';
      const activeAgents = new Set(snapshot.activeLoops.map((item) => item.agent || item.agentId || 'Unknown'));
      const highRisks = snapshot.risks.filter((risk) => String(risk?.severity || '').toLowerCase() === 'high' || String(risk?.severity || '').toLowerCase() === 'critical');
      const pendingApprovals = snapshot.approvals.filter((approval) => String(approval?.status || '').toLowerCase() === 'pending');
      setText('kpi-connection', 'Connected');
      setText('kpi-event-count', String(data.eventCount ?? snapshot.events.length));
      setText('kpi-active-agents', String(activeAgents.size));
      setText('kpi-total-cost', formatMoney(totalCost, currency));
      setText('kpi-usage-count', String(snapshot.costSummary.usageCount ?? snapshot.data.modelUsage?.length ?? 0));
      setText('kpi-high-risk', String(highRisks.length));
      setText('kpi-pending-approval', String(pendingApprovals.length));
      setText('kpi-last-updated', data.lastUpdated || 'Unknown');
      setText('kpi-last-success', state.lastSuccessfulPollTime || 'No successful poll yet');
      setText('monitoring-path', data.monitoredPath || 'Unknown');
    }

    function renderMetricsList(items, emptyText) {
      const list = Array.isArray(items) ? items : [];
      if (!list.length) {
        return '<div class="panel muted">' + escapeHtml(emptyText) + '</div>';
      }
      return list.join('');
    }

    function renderActiveAgentWork(activeLoops) {
      const grouped = groupRecords(activeLoops, (loop) => [loop.agent || loop.agentId || 'Unknown', loop.task || 'Unknown task', loop.status || 'unknown'].join(' | '), (a, b) => b.count - a.count || severityRank(a.latest.status) - severityRank(b.latest.status));
      const sorted = grouped.slice(0, 8);
      const compact = sorted.map((entry) => {
        const latest = entry.latest;
        return '<div class="metric-row"><div class="left"><div class="title">' + escapeHtml(latest.agent || latest.agentId || 'Unknown agent') + ' · ' + escapeHtml(latest.task || 'Unknown task') + '</div><div class="meta">Status: ' + escapeHtml(latest.status || 'unknown') + ' · Model: ' + escapeHtml(latest.currentModel || 'No model') + ' · Case: ' + escapeHtml(latest.caseId || 'Unknown') + '</div></div><div class="badge">×' + escapeHtml(String(entry.count)) + '</div></div>';
      });
      const raw = activeLoops.slice(0, 50).map((loop) => '<div class="metric-row"><div class="left"><div class="title">' + escapeHtml(loop.agent || loop.agentId || 'Unknown agent') + ' · ' + escapeHtml(loop.task || 'Unknown task') + '</div><div class="meta">Status: ' + escapeHtml(loop.status || 'unknown') + ' · Model: ' + escapeHtml(loop.currentModel || 'No model') + ' · Duration: ' + escapeHtml(String(loop.durationSeconds ?? 0)) + 's</div></div><div class="badge">' + escapeHtml(loop.caseId || 'Unknown case') + '</div></div>');
      document.getElementById('active-loops').innerHTML = renderMetricsList(compact, 'No active agent work');
      document.getElementById('active-loops-raw').innerHTML = renderMetricsList(raw, 'No active agent work');
    }

    function renderTimeline(events) {
      const latest = events.slice().sort((a, b) => String(b.timestamp || '').localeCompare(String(a.timestamp || ''))).slice(0, 20);
      const timeline = latest.map((event) => '<div class="metric-row"><div class="left"><div class="title">' + escapeHtml(event.type) + ' · ' + escapeHtml(event.summary || 'No summary') + '</div><div class="meta">' + escapeHtml(event.timestamp || 'Unknown time') + ' · ' + escapeHtml(event.agentName || event.agentId || 'Unknown agent') + '</div></div><div class="badge">' + escapeHtml(event.caseId || 'No case') + '</div></div>');
      const raw = events.slice().sort((a, b) => String(b.timestamp || '').localeCompare(String(a.timestamp || ''))).map((event) => '<div class="metric-row"><div class="left"><div class="title">' + escapeHtml(event.type) + ' · ' + escapeHtml(event.summary || 'No summary') + '</div><div class="meta">' + escapeHtml(event.timestamp || 'Unknown time') + ' · ' + escapeHtml(event.agentName || event.agentId || 'Unknown agent') + '</div></div><div class="badge">' + escapeHtml(event.caseId || 'No case') + '</div></div>');
      document.getElementById('event-timeline').innerHTML = renderMetricsList(timeline, 'No events yet');
      document.getElementById('event-timeline-raw').innerHTML = renderMetricsList(raw, 'No events yet');
      document.getElementById('events-by-type').innerHTML = renderChart('Events by type', groupCounts(events.map((event) => event.type)), (label) => label);
    }

    function renderRisks(risks) {
      const grouped = groupRecords(risks, (risk) => [risk.summary || 'Risk', risk.severity || 'unknown'].join(' | '), (a, b) => severityRank(a.latest.severity) - severityRank(b.latest.severity) || b.count - a.count).slice(0, 10);
      const summary = grouped.map((entry) => {
        const latest = entry.latest;
        return '<div class="metric-row"><div class="left"><div class="title">' + escapeHtml(latest.summary || 'Risk') + '</div><div class="meta">Severity: ' + escapeHtml(latest.severity || 'unknown') + ' · Mitigation: ' + escapeHtml(latest.mitigation || 'None') + '</div></div><div class="badge">×' + escapeHtml(String(entry.count)) + '</div></div>';
      });
      const raw = risks.map((risk) => '<div class="metric-row"><div class="left"><div class="title">' + escapeHtml(risk.summary || 'Risk') + '</div><div class="meta">Severity: ' + escapeHtml(risk.severity || 'unknown') + ' · Mitigation: ' + escapeHtml(risk.mitigation || 'None') + '</div></div><div class="badge">' + escapeHtml(risk.id || 'Risk') + '</div></div>');
      document.getElementById('risk-dashboard').innerHTML = renderMetricsList(summary, 'No risks');
      document.getElementById('risk-dashboard-raw').innerHTML = renderMetricsList(raw, 'No risks');
      document.getElementById('risks-by-severity').innerHTML = renderChart('Risks by severity', groupCounts(risks.map((risk) => risk.severity || 'unknown')).sort((a, b) => severityRank(a[0]) - severityRank(b[0])), (label) => label);
    }

    function renderApprovals(approvals) {
      const grouped = groupRecords(approvals, (approval) => [approval.summary || 'Approval', approval.approver || 'Unknown', approval.status || 'pending'].join(' | '), (a, b) => statusRank(a.latest.status) - statusRank(b.latest.status) || b.count - a.count).slice(0, 10);
      const summary = grouped.map((entry) => {
        const latest = entry.latest;
        return '<div class="metric-row"><div class="left"><div class="title">' + escapeHtml(latest.summary || 'Approval') + '</div><div class="meta">Approver: ' + escapeHtml(latest.approver || 'Unknown') + ' · Status: ' + escapeHtml(latest.status || 'pending') + '</div></div><div class="badge">×' + escapeHtml(String(entry.count)) + '</div></div>';
      });
      const raw = approvals.map((approval) => '<div class="metric-row"><div class="left"><div class="title">' + escapeHtml(approval.summary || 'Approval') + '</div><div class="meta">Approver: ' + escapeHtml(approval.approver || 'Unknown') + ' · Reason: ' + escapeHtml(approval.reason || 'None') + '</div></div><div class="badge">' + escapeHtml(approval.status || 'pending') + '</div></div>');
      document.getElementById('approval-queue').innerHTML = renderMetricsList(summary, 'No approvals');
      document.getElementById('approval-queue-raw').innerHTML = renderMetricsList(raw, 'No approvals');
      document.getElementById('approvals-by-status').innerHTML = renderChart('Approvals by status', groupCounts(approvals.map((approval) => approval.status || 'pending')).sort((a, b) => statusRank(a[0]) - statusRank(b[0])), (label) => label);
    }

    function renderArtifacts(artifacts) {
      const grouped = groupRecords(artifacts, (artifact) => artifact.path || artifact.summary || 'Unknown path', (a, b) => b.count - a.count).slice(0, 10);
      const summary = grouped.map((entry) => {
        const latest = entry.latest;
        return '<div class="metric-row"><div class="left"><div class="title">' + escapeHtml(latest.path || latest.summary || 'Artifact') + '</div><div class="meta">' + escapeHtml(latest.summary || 'No summary') + '</div></div><div class="badge">×' + escapeHtml(String(entry.count)) + '</div></div>';
      });
      const raw = artifacts.map((artifact) => '<div class="metric-row"><div class="left"><div class="title">' + escapeHtml(artifact.path || artifact.summary || 'Artifact') + '</div><div class="meta">' + escapeHtml(artifact.summary || 'No summary') + '</div></div><div class="badge">' + escapeHtml(artifact.id || 'Artifact') + '</div></div>');
      document.getElementById('artifact-timeline').innerHTML = renderMetricsList(summary, 'No work products');
      document.getElementById('artifact-timeline-raw').innerHTML = renderMetricsList(raw, 'No work products');
    }

    function renderHandoffs(handoffs) {
      const grouped = groupRecords(handoffs, (handoff) => [handoff.currentOwner || 'Unknown', handoff.nextOwner || 'Unknown', handoff.summary || 'Handoff'].join(' | '), (a, b) => b.count - a.count).slice(0, 10);
      const summary = grouped.map((entry) => {
        const latest = entry.latest;
        return '<div class="metric-row"><div class="left"><div class="title">' + escapeHtml(latest.summary || 'Handoff') + '</div><div class="meta">From: ' + escapeHtml(latest.currentOwner || 'Unknown') + ' · To: ' + escapeHtml(latest.nextOwner || 'Unknown') + '</div></div><div class="badge">×' + escapeHtml(String(entry.count)) + '</div></div>';
      });
      const raw = handoffs.map((handoff) => '<div class="metric-row"><div class="left"><div class="title">' + escapeHtml(handoff.summary || 'Handoff') + '</div><div class="meta">From: ' + escapeHtml(handoff.currentOwner || 'Unknown') + ' · To: ' + escapeHtml(handoff.nextOwner || 'Unknown') + '</div></div><div class="badge">' + escapeHtml(handoff.id || 'Handoff') + '</div></div>');
      document.getElementById('handoff-queue').innerHTML = renderMetricsList(summary, 'No handoffs');
      document.getElementById('handoff-queue-raw').innerHTML = renderMetricsList(raw, 'No handoffs');
    }

    function renderModelUsage(items, currency) {
      const entries = normalizeList(items);
      const grouped = groupRecords(entries, (entry) => [entry.agent || entry.agentId || 'Unknown', entry.project || 'Unknown project', entry.taskName || entry.taskId || 'Unknown task', entry.model || 'Unknown model'].join(' | '), (a, b) => b.count - a.count).slice(0, 10);
      const cards = grouped.map((entry) => {
        const latest = entry.latest;
        return '<div class="panel"><div class="kpi-label">' + escapeHtml(latest.model || 'Model usage') + '</div><div class="value">' + escapeHtml(latest.agent || latest.agentId || 'Unknown agent') + '</div><div class="kpi-subvalue">' + escapeHtml(latest.project || 'Unknown project') + ' · ' + escapeHtml(latest.taskName || latest.taskId || 'Unknown task') + '</div><div class="kpi-subvalue">Tokens: ' + escapeHtml(String(latest.totalTokens ?? 0)) + ' · Cost: ' + escapeHtml(formatMoney(latest.estimatedCost ?? 0, latest.currency || currency || 'USD')) + ' · ×' + escapeHtml(String(entry.count)) + '</div></div>';
      });
      if (!cards.length) {
        document.getElementById('model-usage').innerHTML = '<div class="panel muted">No token usage records yet</div>';
        return;
      }
      document.getElementById('model-usage').innerHTML = cards.join('');
    }

    function renderSpendOverview(costSummary) {
      const cards = [
        renderChartFromMap('Cost by agent', costSummary.costByAgent),
        renderChartFromMap('Cost by model', costSummary.costByModel),
        renderChartFromMap('Cost by project', costSummary.costByProject),
      ];
      document.getElementById('spend-overview').innerHTML = cards.join('');
    }

    function renderDiagnostics(snapshot) {
      const entries = [
        card('Last poll URL', [state.lastPollUrl || 'Not polled yet']),
        card('HTTP status', [state.lastHttpStatus || 'Unknown']),
        card('Response keys', [state.responseKeys.length ? state.responseKeys.join(', ') : 'None']),
        card('Last successful poll', [state.lastSuccessfulPollTime || 'Waiting for data']),
        card('Last render error', [state.lastRenderError || 'None']),
      ];
      document.getElementById('diagnostics').innerHTML = entries.join('');
    }

    function render(snapshot, successfulPollTime) {
      const normalized = normalizeSnapshot(snapshot);
      const data = normalized.data;
      const activeLoops = normalized.activeLoops;
      const modelUsage = normalizeList(data.modelUsage);
      const readiness = data.readiness || { score: 0, status: 'Unknown', blockers: [], recommendations: [] };
      const steeringInsights = normalizeList(data.steeringInsights);
      const artifacts = normalized.artifacts;
      const handoffs = normalized.handoffs;
      const costSummary = normalized.costSummary || {};
      const risks = normalized.risks;
      const approvals = normalized.approvals;
      const events = normalized.events;

      state.lastSuccessfulPollTime = successfulPollTime || state.lastSuccessfulPollTime;
      state.lastRenderError = 'None';
      setText('kpi-connection', 'Connected');
      setText('kpi-event-count', String(data.eventCount ?? events.length));
      setText('kpi-active-agents', String(new Set(activeLoops.map((item) => item.agent || item.agentId || 'Unknown')).size));
      setText('kpi-total-cost', formatMoney(costSummary.totalCost ?? 0, costSummary.currency || 'USD'));
      setText('kpi-usage-count', String(costSummary.usageCount ?? modelUsage.length ?? 0));
      setText('kpi-high-risk', String(risks.filter((risk) => String(risk?.severity || '').toLowerCase() === 'high' || String(risk?.severity || '').toLowerCase() === 'critical').length));
      setText('kpi-pending-approval', String(approvals.filter((approval) => String(approval?.status || '').toLowerCase() === 'pending').length));
      setText('kpi-last-updated', data.lastUpdated || 'Unknown');
      setText('kpi-last-success', successfulPollTime || state.lastSuccessfulPollTime || 'Waiting for data');
      setText('monitoring-path', data.monitoredPath || 'Unknown');

      renderSpendOverview(costSummary);
      renderModelUsage(modelUsage, costSummary.currency || 'USD');
      renderActiveAgentWork(activeLoops);
      renderTimeline(events);
      renderRisks(risks);
      renderApprovals(approvals);
      renderArtifacts(artifacts);
      renderHandoffs(handoffs);
      renderDiagnostics(snapshot);

      document.getElementById('readiness').innerHTML = '<div class="panel"><div class="score">' + escapeHtml(String(readiness.score ?? 0)) + '/100</div><div class="value">' + escapeHtml(readiness.status || 'Unknown') + '</div><div class="kpi-subvalue" style="margin-top:12px;">Blockers</div><pre>' + escapeHtml(listAsLines(readiness.blockers).join('
')) + '</pre><div class="kpi-subvalue" style="margin-top:12px;">Recommendations</div><pre>' + escapeHtml(listAsLines(readiness.recommendations).join('
')) + '</pre></div>';

      document.getElementById('steering-dashboard').innerHTML = steeringInsights.length
        ? steeringInsights.map((entry) => card(entry.current?.steeringProfileId || 'Unknown profile', [
            'Verdict: ' + (entry.verdict || 'unknown'),
            'Token delta: ' + formatDelta(entry.deltas?.tokens),
            'Cost delta: ' + formatDelta(entry.deltas?.cost),
            'Readiness delta: ' + formatDelta(entry.deltas?.releaseReadiness),
          ])).join('')
        : card('No steering data', ['Waiting for steering events']);
    }

    async function refresh() {
      const pollUrl = new URL('/api/dashboard', window.location.href).toString();
      state.lastPollUrl = pollUrl;
      renderDiagnostics({});
      try {
        setText('kpi-connection', 'Refreshing…');
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
        setText('kpi-connection', 'Error');
        document.getElementById('event-timeline').innerHTML = '<div class="panel error">' + escapeHtml(message) + '</div>';
        renderDiagnostics({});
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
