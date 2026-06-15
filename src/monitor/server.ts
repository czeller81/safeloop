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

function formatCurrency(value: number, currency: string): string {
  const amount = Number(value);
  const safeAmount = Number.isFinite(amount) ? amount.toFixed(4) : '0.0000';
  return `${currency} ${safeAmount}`;
}

function pickLatestDogfoodRunForCard(snapshot: ReturnType<typeof getDashboardSnapshot>) {
  const records = Array.isArray(snapshot.modelUsage) ? snapshot.modelUsage : [];
  if (!records.length) {
    return null;
  }

  const sorted = [...records].sort((a, b) => String(b.timestamp ?? '').localeCompare(String(a.timestamp ?? '')));
  const targeted = sorted.find((record) => {
    const taskName = String(record.taskName || record.taskId || '');
    return /dogfood live monitor cost accountability/i.test(taskName) || /dogfood/i.test(taskName);
  });
  const latest = targeted ?? sorted[0];
  const latestCaseId = latest.caseId ?? '';
  const relatedEvents = Array.isArray(snapshot.events)
    ? snapshot.events.filter((event) => latestCaseId && event.caseId === latestCaseId)
    : [];
  const completed = relatedEvents.some((event) => event.type === 'task.completed' || event.type === 'report.generated');
  const pendingReview = relatedEvents.some((event) => event.type === 'approval.requested') && !relatedEvents.some((event) => event.type === 'approval.resolved');
  const status = completed ? 'Completed' : pendingReview ? 'Waiting for review' : 'Running';

  return { latest, status };
}

function renderLatestDogfoodRunCard(snapshot: ReturnType<typeof getDashboardSnapshot>): string {
  const result = pickLatestDogfoodRunForCard(snapshot);
  if (!result) {
    return `
          <div class="latest-run-card sl-panel-glow" id="latest-dogfood-run">
            <div class="run-label">Latest Dogfood Run</div>
            <div class="muted">Waiting for the latest local run to load.</div>
          </div>`;
  }

  const { latest, status } = result;
  const totalTokens = Number(latest.totalTokens ?? Number(latest.inputTokens ?? 0) + Number(latest.outputTokens ?? 0));
  const currency = snapshot.costSummary?.currency || 'USD';
  const metrics = [
    ['taskName', latest.taskName || latest.taskId || 'Unknown task'],
    ['project', latest.project || 'Unknown project'],
    ['agent', latest.agent || latest.agentId || 'Unknown agent'],
    ['estimated cost', formatCurrency(latest.estimatedCost ?? 0, currency)],
    ['tokens', Number.isFinite(totalTokens) ? String(totalTokens) : '0'],
  ];

  return `
          <div class="latest-run-card sl-panel-glow" id="latest-dogfood-run">
            <div class="run-label">Latest Dogfood Run</div>
            <div class="run-title">${escapeHtmlText(latest.taskName || 'Dogfood run')}</div>
            <div class="run-grid">
              ${metrics
                .map(([label, value]) => `
                <div class="run-item">
                  <div class="run-item-label">${escapeHtmlText(label)}</div>
                  <div class="run-item-value">${escapeHtmlText(String(value))}</div>
                </div>`)
                .join('')}
            </div>
            <div class="run-status">Status: ${escapeHtmlText(status)}</div>
          </div>`;
}

export function renderMonitorHtml(options: SafeloopStorageOptions = {}): string {
  const monitoredPath = resolve(options.baseDir ?? process.cwd(), '.safeloop');
  const snapshot = getDashboardSnapshot(options);
  const latestDogfoodRunHtml = renderLatestDogfoodRunCard(snapshot);
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Safeloop Live Loop Monitor</title>
<style>
  :root {
    color-scheme: dark;
    --sl-bg: #05030d;
    --sl-bg-soft: #09071a;
    --sl-panel: rgba(15, 12, 35, 0.82);
    --sl-panel-strong: rgba(22, 17, 50, 0.92);
    --sl-border: rgba(157, 105, 255, 0.28);
    --sl-border-strong: rgba(176, 125, 255, 0.58);
    --sl-purple: #9d69ff;
    --sl-purple-bright: #b78cff;
    --sl-purple-soft: #6d46d9;
    --sl-pink: #ff4fd8;
    --sl-cyan: #78e7ff;
    --sl-green: #39ff88;
    --sl-yellow: #ffd166;
    --sl-red: #ff4d6d;
    --sl-text: #f7f3ff;
    --sl-text-muted: #b8add8;
    --sl-text-dim: #786f9b;
    --sl-radius-sm: 10px;
    --sl-radius-md: 16px;
    --sl-radius-lg: 24px;
    --sl-radius-xl: 32px;
    --sl-glow-purple: 0 0 28px rgba(157, 105, 255, 0.35);
    --sl-glow-strong: 0 0 45px rgba(157, 105, 255, 0.55);
    --sl-shadow-panel: 0 24px 80px rgba(0, 0, 0, 0.45);
    --sl-space-1: 4px;
    --sl-space-2: 8px;
    --sl-space-3: 12px;
    --sl-space-4: 16px;
    --sl-space-5: 24px;
    --sl-space-6: 32px;
  }

  * { box-sizing: border-box; }
  html, body { min-height: 100%; }
  body {
    margin: 0;
    font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
    color: var(--sl-text);
    background:
      radial-gradient(circle at 18% 16%, rgba(157, 105, 255, 0.18), transparent 24%),
      radial-gradient(circle at 80% 8%, rgba(255, 79, 216, 0.10), transparent 20%),
      radial-gradient(circle at 50% 50%, rgba(120, 231, 255, 0.06), transparent 28%),
      linear-gradient(180deg, #020108 0%, var(--sl-bg) 100%);
    overflow-x: hidden;
  }
  body::before {
    content: '';
    position: fixed;
    inset: 0;
    pointer-events: none;
    background:
      linear-gradient(180deg, rgba(255,255,255,0.02), transparent 22%),
      radial-gradient(circle at 50% 0%, rgba(157, 105, 255, 0.12), transparent 28%);
    mix-blend-mode: screen;
  }
  .sl-shell {
    position: relative;
    z-index: 1;
    max-width: 1600px;
    margin: 0 auto;
    padding: var(--sl-space-6) var(--sl-space-5) calc(var(--sl-space-6) * 1.5);
  }
  .sl-hero,
  section,
  .panel,
  .kpi-card,
  .metric-row,
  .status-item {
    position: relative;
    background: linear-gradient(180deg, rgba(22, 17, 50, 0.92), rgba(10, 8, 25, 0.92));
    border: 1px solid var(--sl-border);
    border-radius: var(--sl-radius-xl);
    box-shadow: var(--sl-shadow-panel);
    backdrop-filter: blur(18px);
  }
  .sl-panel-glow,
  .sl-hero::after,
  section::after,
  .panel::after,
  .kpi-card::after {
    content: '';
    position: absolute;
    inset: 0;
    border-radius: inherit;
    pointer-events: none;
    box-shadow: inset 0 1px 0 rgba(255,255,255,0.05), inset 0 0 0 1px rgba(255,255,255,0.02), 0 0 50px rgba(157, 105, 255, 0.08);
  }
  .sl-hero {
    overflow: hidden;
    padding: var(--sl-space-6);
    background:
      radial-gradient(circle at 18% 12%, rgba(157, 105, 255, 0.34), transparent 24%),
      radial-gradient(circle at 82% 10%, rgba(255, 79, 216, 0.13), transparent 18%),
      linear-gradient(180deg, rgba(18, 14, 41, 0.96), rgba(6, 5, 15, 0.96));
    margin-bottom: var(--sl-space-5);
  }
  .sl-hero::before {
    content: '';
    position: absolute;
    inset: -1px;
    border-radius: inherit;
    padding: 1px;
    background: linear-gradient(120deg, rgba(157,105,255,0.65), rgba(120,231,255,0.18), rgba(255,79,216,0.25));
    -webkit-mask: linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0);
    -webkit-mask-composite: xor;
            mask-composite: exclude;
    pointer-events: none;
  }
  .sl-hero > * { position: relative; z-index: 1; }
  .hero-top {
    display: flex;
    flex-wrap: wrap;
    align-items: flex-start;
    justify-content: space-between;
    gap: var(--sl-space-4);
  }
  .hero-copy { max-width: 760px; }
  .eyebrow {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    padding: 6px 12px;
    border-radius: 999px;
    color: #f8f3ff;
    background: rgba(157, 105, 255, 0.16);
    border: 1px solid rgba(157, 105, 255, 0.24);
    font-size: 12px;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    box-shadow: var(--sl-glow-purple);
  }
  h1 {
    margin: 14px 0 10px;
    font-size: clamp(36px, 4vw, 62px);
    line-height: 0.95;
    letter-spacing: -0.04em;
  }
  .hero-subtitle {
    margin: 0;
    max-width: 58ch;
    color: var(--sl-text-muted);
    font-size: 17px;
    line-height: 1.55;
  }
  .hero-meta {
    display: flex;
    flex-wrap: wrap;
    gap: 10px;
    justify-content: flex-end;
    align-items: center;
    margin-top: var(--sl-space-4);
  }
  .sl-meta-pill,
  .sl-status-chip {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    padding: 8px 12px;
    border-radius: 999px;
    border: 1px solid rgba(157, 105, 255, 0.24);
    background: rgba(9, 7, 26, 0.78);
    color: var(--sl-text);
    font-size: 12px;
    line-height: 1;
    white-space: nowrap;
  }
  .sl-status-chip.connected { color: var(--sl-green); border-color: rgba(57, 255, 136, 0.34); box-shadow: 0 0 0 1px rgba(57,255,136,0.08), 0 0 24px rgba(57,255,136,0.12); }
  .sl-status-chip.connecting { color: var(--sl-yellow); border-color: rgba(255, 209, 102, 0.34); box-shadow: 0 0 0 1px rgba(255,209,102,0.08), 0 0 24px rgba(255,209,102,0.12); }
  .sl-status-chip.error { color: #ffb5b5; border-color: rgba(255, 77, 109, 0.34); box-shadow: 0 0 0 1px rgba(255,77,109,0.08), 0 0 24px rgba(255,77,109,0.12); }
  .hero-path {
    margin-top: 14px;
    color: var(--sl-text-dim);
    font-size: 12px;
    word-break: break-word;
  }
  .hero-bottom {
    margin-top: var(--sl-space-4);
    display: grid;
    gap: 12px;
    grid-template-columns: minmax(0, 1fr);
  }
  .latest-run-card {
    padding: 18px;
    border-radius: var(--sl-radius-lg);
    background:
      radial-gradient(circle at 12% 0%, rgba(120, 231, 255, 0.12), transparent 28%),
      linear-gradient(180deg, rgba(17, 13, 40, 0.96), rgba(8, 7, 21, 0.96));
    border: 1px solid rgba(120, 231, 255, 0.24);
    box-shadow: var(--sl-shadow-panel), 0 0 0 1px rgba(120, 231, 255, 0.05), 0 0 28px rgba(120, 231, 255, 0.08);
  }
  .latest-run-card .run-label {
    color: var(--sl-cyan);
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.14em;
    margin-bottom: 10px;
  }
  .latest-run-card .run-title {
    font-size: 20px;
    font-weight: 800;
    letter-spacing: -0.03em;
    margin: 0 0 10px;
  }
  .latest-run-card .run-grid {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 10px 16px;
  }
  .latest-run-card .run-item {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .latest-run-card .run-item-label {
    color: var(--sl-text-dim);
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.12em;
  }
  .latest-run-card .run-item-value {
    color: var(--sl-text);
    font-size: 14px;
    font-weight: 600;
    line-height: 1.35;
    word-break: break-word;
  }
  .latest-run-card .run-status {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    width: fit-content;
    margin-top: 14px;
    padding: 6px 10px;
    border-radius: 999px;
    background: rgba(120, 231, 255, 0.12);
    border: 1px solid rgba(120, 231, 255, 0.25);
    color: var(--sl-cyan);
    font-size: 12px;
  }
  .sl-sticky-nav {
    position: sticky;
    top: 12px;
    z-index: 4;
    margin: var(--sl-space-4) 0 var(--sl-space-5);
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    padding: 10px;
    border-radius: 999px;
    background: rgba(8, 7, 21, 0.78);
    border: 1px solid rgba(157, 105, 255, 0.18);
    box-shadow: var(--sl-shadow-panel), 0 0 30px rgba(157, 105, 255, 0.08);
    backdrop-filter: blur(18px);
  }
  .sl-sticky-nav a {
    color: var(--sl-text-muted);
    text-decoration: none;
    font-size: 12px;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    padding: 8px 12px;
    border-radius: 999px;
    border: 1px solid transparent;
  }
  .sl-sticky-nav a:hover,
  .sl-sticky-nav a:focus-visible {
    color: var(--sl-text);
    border-color: rgba(157, 105, 255, 0.25);
    background: rgba(157, 105, 255, 0.10);
    outline: none;
  }
  .section-hint::before {
    content: '';
  }
  .historical-section .section-hint::before {
    content: 'Historical ledger';
    display: inline-flex;
    align-items: center;
    margin-right: 10px;
    margin-bottom: 4px;
    padding: 2px 8px;
    border-radius: 999px;
    background: rgba(157, 105, 255, 0.14);
    border: 1px solid rgba(157, 105, 255, 0.18);
    color: var(--sl-purple-bright);
    font-size: 10px;
    text-transform: uppercase;
    letter-spacing: 0.12em;
  }
  .kpi-grid {
    display: grid;
    gap: 12px;
    grid-template-columns: repeat(6, minmax(0, 1fr));
    margin-top: var(--sl-space-5);
  }
  .kpi-card {
    min-height: 108px;
    display: flex;
    flex-direction: column;
    justify-content: space-between;
    padding: 18px;
    border-radius: var(--sl-radius-lg);
    background: linear-gradient(180deg, rgba(17, 13, 40, 0.92), rgba(10, 8, 25, 0.92));
  }
  .kpi-label {
    color: var(--sl-text-dim);
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.12em;
  }
  .kpi-value {
    font-size: 28px;
    font-weight: 800;
    margin-top: 10px;
    letter-spacing: -0.04em;
    word-break: break-word;
  }
  .kpi-subvalue {
    color: var(--sl-text-muted);
    font-size: 12px;
    margin-top: 4px;
    line-height: 1.4;
  }
  .sl-main {
    display: grid;
    gap: var(--sl-space-5);
    grid-template-columns: repeat(12, minmax(0, 1fr));
    align-items: start;
  }
  section {
    padding: var(--sl-space-5);
    overflow: hidden;
    scroll-margin-top: 88px;
  }
  section:not(.full) { grid-column: span 6; }
  section.full { grid-column: 1 / -1; }

  section h2 {
    margin: 0 0 10px;
    font-size: 16px;
    letter-spacing: 0.02em;
  }
  .section-hint {
    color: var(--sl-text-muted);
    font-size: 12px;
    margin: -4px 0 14px;
    line-height: 1.5;
  }
  .cards { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; }
  .cards.compact { grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); }
  .mini-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: 12px; }
  .bar-chart { display: grid; gap: 12px; }
  .bar-row { display: grid; gap: 7px; }
  .bar-label { display: flex; justify-content: space-between; gap: 10px; color: var(--sl-text); font-size: 12px; }
  .bar-track { height: 10px; background: rgba(40, 33, 74, 0.88); border-radius: 999px; overflow: hidden; box-shadow: inset 0 1px 2px rgba(0,0,0,0.35); }
  .bar-fill { height: 100%; border-radius: inherit; background: linear-gradient(90deg, var(--sl-purple) 0%, var(--sl-cyan) 100%); box-shadow: var(--sl-glow-purple); }
  .metric-list { display: grid; gap: 10px; }
  .metric-row {
    display: flex;
    justify-content: space-between;
    gap: 10px;
    align-items: flex-start;
    padding: 14px 16px;
    border-radius: var(--sl-radius-md);
    background: rgba(8, 7, 21, 0.62);
    border: 1px solid rgba(157, 105, 255, 0.18);
  }
  .metric-row .left { min-width: 0; }
  .metric-row .title { font-weight: 700; margin-bottom: 3px; word-break: break-word; }
  .metric-row .meta { color: var(--sl-text-muted); font-size: 12px; line-height: 1.45; }
  .metric-row .badge { white-space: nowrap; }
  .badge {
    display: inline-flex;
    align-items: center;
    padding: 4px 10px;
    border-radius: 999px;
    background: rgba(157, 105, 255, 0.18);
    color: var(--sl-text);
    border: 1px solid rgba(157, 105, 255, 0.25);
    font-size: 12px;
    box-shadow: 0 0 22px rgba(157, 105, 255, 0.10);
  }
  .muted { color: var(--sl-text-muted); }
  ul { margin: 0; padding-left: 18px; }
  li { margin-bottom: 8px; }
  pre {
    margin: 0;
    white-space: pre-wrap;
    word-break: break-word;
    font-size: 12px;
    line-height: 1.5;
    color: var(--sl-text-muted);
  }
  details { margin-top: 14px; }
  details summary { cursor: pointer; color: var(--sl-purple-bright); font-size: 12px; letter-spacing: 0.02em; }
  .score { font-size: 36px; font-weight: 800; margin-bottom: 4px; letter-spacing: -0.04em; }
  .error { color: #ffb5b5; }
  .diagnostics { display: grid; gap: 12px; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); }
  .panel { padding: 14px 16px; border-radius: var(--sl-radius-lg); background: rgba(8, 7, 21, 0.62); border: 1px solid rgba(157, 105, 255, 0.18); }
  .sl-diagnostics { margin-top: var(--sl-space-2); }
  @media (max-width: 1200px) {
    .kpi-grid { grid-template-columns: repeat(3, minmax(0, 1fr)); }
    section:not(.full) { grid-column: 1 / -1; }
  }
  @media (max-width: 760px) {
    .sl-shell { padding: 18px 14px 28px; }
    .sl-hero { padding: 22px 18px; }
    .kpi-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
    .hero-meta { justify-content: flex-start; }
    .cards, .mini-grid, .diagnostics { grid-template-columns: 1fr; }
  }
</style>
</head>
<body>
  <div class="sl-shell">
    <header class="sl-hero sl-panel-glow" id="overview">
      <div class="hero-top">
        <div class="hero-copy">
          <div class="eyebrow">Safeloop v0.7.0 · live monitor</div>
          <h1>Safeloop</h1>
          <p class="hero-subtitle">Agent Cost, Control & Accountability Monitor</p>
          <div class="hero-path">Monitored path: <span id="monitoring-path">${escapeHtmlText(monitoredPath)}</span></div>
        </div>
        <div class="hero-status-row">
          <div class="hero-meta">
            <span class="sl-status-chip connecting" id="kpi-connection">Connecting…</span>
            <span class="sl-meta-pill">Local-only</span>
            <span class="sl-meta-pill">Version v0.7.0</span>
            <span class="sl-meta-pill">Last updated: <span id="kpi-last-updated">Waiting for data</span></span>
            <span class="sl-meta-pill">Last success: <span id="kpi-last-success">No successful poll yet</span></span>
          </div>
        </div>
      </div>
      <div class="hero-bottom">
        ${latestDogfoodRunHtml}
      </div>
      <div class="kpi-grid" id="kpi-grid">
        <div class="kpi-card"><div class="kpi-label">Event count</div><div class="kpi-value" id="kpi-event-count">0</div><div class="kpi-subvalue">Total events in the local stream</div></div>
        <div class="kpi-card"><div class="kpi-label">Active agent count</div><div class="kpi-value" id="kpi-active-agents">0</div><div class="kpi-subvalue">Unique active agents</div></div>
        <div class="kpi-card"><div class="kpi-label">Total cost</div><div class="kpi-value" id="kpi-total-cost">USD 0.0000</div><div class="kpi-subvalue">Local accountability record</div></div>
        <div class="kpi-card"><div class="kpi-label">Usage count</div><div class="kpi-value" id="kpi-usage-count">0</div><div class="kpi-subvalue">Token / cost records</div></div>
        <div class="kpi-card"><div class="kpi-label">High risk count</div><div class="kpi-value" id="kpi-high-risk">0</div><div class="kpi-subvalue">Unique high-severity risks</div></div>
        <div class="kpi-card"><div class="kpi-label">Pending approval count</div><div class="kpi-value" id="kpi-pending-approval">0</div><div class="kpi-subvalue">Human review waiting</div></div>
      </div>
    </header>
    <nav class="sl-sticky-nav" aria-label="Quick navigation">
      <a href="#overview">Overview</a>
      <a href="#spend">Spend</a>
      <a href="#activity">Activity</a>
      <a href="#risks">Risks</a>
      <a href="#human-review">Human Review</a>
      <a href="#diagnostics">Diagnostics</a>
    </nav>
    <main class="sl-main">
      <section class="historical-section" id="spend">
        <h2>Spend Overview</h2>
        <div class="section-hint">Cost is summarized as explicit accountability, not hidden telemetry.</div>
        <div class="mini-grid" id="spend-overview"></div>
      </section>
      <section class="historical-section">
        <h2>Token Usage</h2>
        <div class="section-hint">Latest token / cost records with project and task context.</div>
        <div class="cards compact" id="model-usage"></div>
      </section>
      <section class="historical-section" id="activity">
        <h2>Active Agent Work</h2>
        <div class="section-hint">Grouped by agent + task + status. Latest 8 groups by default.</div>
        <div class="metric-list" id="active-loops"></div>
        <details class="raw-details" id="active-loops-raw-details">
          <summary>Show raw agent work records</summary>
          <div class="metric-list" id="active-loops-raw"></div>
        </details>
      </section>
      <section class="historical-section">
        <h2>Activity Timeline</h2>
        <div class="section-hint">Latest 20 events by default, plus a raw drilldown for the full stream.</div>
        <div class="mini-grid" id="events-by-type"></div>
        <div class="metric-list" id="event-timeline"></div>
        <details class="raw-details">
          <summary>Show raw event ledger</summary>
          <div class="metric-list" id="event-timeline-raw"></div>
        </details>
      </section>
      <section class="historical-section" id="risks">
        <h2>Risk &amp; Guardrails</h2>
        <div class="section-hint">Grouped by summary + severity and sorted by severity first.</div>
        <div class="mini-grid" id="risks-by-severity"></div>
        <div class="metric-list" id="risk-dashboard"></div>
        <details class="raw-details">
          <summary>Show raw risk ledger</summary>
          <div class="metric-list" id="risk-dashboard-raw"></div>
        </details>
      </section>
      <section class="historical-section" id="human-review">
        <h2>Human Review</h2>
        <div class="section-hint">Pending approvals first; approved items are grouped and collapsed.</div>
        <div class="mini-grid" id="approvals-by-status"></div>
        <div class="metric-list" id="approval-queue"></div>
        <details class="raw-details">
          <summary>Show raw approvals</summary>
          <div class="metric-list" id="approval-queue-raw"></div>
        </details>
      </section>
      <section class="historical-section">
        <h2>Work Products</h2>
        <div class="section-hint">Artifacts grouped by file path. Latest 10 groups by default.</div>
        <div class="metric-list" id="artifact-timeline"></div>
        <details class="raw-details">
          <summary>Show raw work products</summary>
          <div class="metric-list" id="artifact-timeline-raw"></div>
        </details>
      </section>
      <section class="historical-section">
        <h2>Agent Handoffs</h2>
        <div class="section-hint">Grouped by from + to + summary. Latest 10 groups by default.</div>
        <div class="metric-list" id="handoff-queue"></div>
        <details class="raw-details">
          <summary>Show raw handoffs</summary>
          <div class="metric-list" id="handoff-queue-raw"></div>
        </details>
      </section>
      <section class="historical-section">
        <h2>Steering Insights</h2>
        <div class="section-hint">Comparative run-to-run steering deltas and verdicts.</div>
        <div class="metric-list" id="steering-dashboard"></div>
      </section>
      <section class="full historical-section">
        <h2>Release Readiness</h2>
        <div id="readiness"></div>
      </section>
      <section class="full sl-diagnostics historical-section" id="diagnostics">
        <h2>Diagnostics</h2>
        <div class="section-hint">Compact runtime checks and response metadata.</div>
        <div class="diagnostics" id="diagnostics-panel"></div>
      </section>
    </main>
  </div>
  <script>
    const POLL_MS = 2000;
    const state = {
      scriptLoaded: 'yes',
      pollStarted: 'no',
      lastPollUrl: '',
      lastHttpStatus: 'Connecting',
      lastFetchError: 'None',
      lastPollLatency: 'N/A',
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

    function setConnectionChip(text, tone) {
      const node = document.getElementById('kpi-connection');
      if (node) {
        node.textContent = text;
        node.className = 'sl-status-chip ' + tone;
      }
    }
    function formatMoney(value, currency) {
      const amount = Number(value);
      const safeAmount = Number.isFinite(amount) ? amount.toFixed(4) : '0.0000';
      return currency + ' ' + safeAmount;
    }

    function formatBreakdown(map) {
      const entries = map instanceof Map ? Array.from(map.entries()) : Object.entries(map || {});
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
      const entries = map instanceof Map ? Array.from(map.entries()) : Object.entries(map || {});
      return renderChart(title, entries, (label) => label);
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
        renderChartFromMap('Cost by task', costSummary.costByTask),
      ];
      document.getElementById('spend-overview').innerHTML = cards.join('');
    }

    function pickLatestDogfoodRun(items, events) {
      const records = normalizeList(items);
      if (!records.length) {
        return null;
      }
      const sorted = [...records].sort((a, b) => String(b.timestamp || '').localeCompare(String(a.timestamp || '')));
      const targeted = sorted.find((record) => {
        const taskName = String(record.taskName || record.taskId || '');
        return /dogfood live monitor cost accountability/i.test(taskName) || /dogfood/i.test(taskName);
      });
      const latest = targeted || sorted[0];
      const relatedEvents = normalizeList(events).filter((event) => latest.caseId && event.caseId === latest.caseId);
      const completed = relatedEvents.some((event) => event.type === 'task.completed' || event.type === 'report.generated');
      const pendingReview = relatedEvents.some((event) => event.type === 'approval.requested') && !relatedEvents.some((event) => event.type === 'approval.resolved');
      const status = completed ? 'Completed' : pendingReview ? 'Waiting for review' : 'Running';
      return {
        ...latest,
        status,
      };
    }

    function renderLatestDogfoodRun(items, events, currency) {
      const container = document.getElementById('latest-dogfood-run');
      if (!container) {
        return;
      }
      const latest = pickLatestDogfoodRun(items, events);
      if (!latest) {
        container.innerHTML = '<div class="run-label">Latest Dogfood Run</div><div class="muted">No dogfood run has been recorded yet.</div>';
        return;
      }
      const totalTokens = Number(latest.totalTokens ?? (Number(latest.inputTokens ?? 0) + Number(latest.outputTokens ?? 0)));
      const tokens = Number.isFinite(totalTokens) ? totalTokens : 0;
      const metricItems = [
        ['taskName', latest.taskName || latest.taskId || 'Unknown task'],
        ['project', latest.project || 'Unknown project'],
        ['agent', latest.agent || latest.agentId || 'Unknown agent'],
        ['estimated cost', formatMoney(latest.estimatedCost ?? 0, latest.currency || currency || 'USD')],
        ['tokens', String(tokens)],
      ];
      container.innerHTML = '<div class="run-label">Latest Dogfood Run</div><div class="run-title">' + escapeHtml(latest.taskName || 'Dogfood run') + '</div><div class="run-grid">' + metricItems.map(([label, value]) => '<div class="run-item"><div class="run-item-label">' + escapeHtml(label) + '</div><div class="run-item-value">' + escapeHtml(value) + '</div></div>').join('') + '</div><div class="run-status">Status: ' + escapeHtml(latest.status || 'Running') + '</div>';
    }

    function renderDiagnostics(snapshot) {
      const entries = [
        card('script loaded', [state.scriptLoaded || 'no']),
        card('poll started', [state.pollStarted || 'no']),
        card('last poll URL', [state.lastPollUrl || 'Not polled yet']),
        card('last HTTP status', [state.lastHttpStatus || 'Unknown']),
        card('last poll latency', [state.lastPollLatency || 'N/A']),
        card('last fetch error', [state.lastFetchError || 'None']),
        card('Response keys', [state.responseKeys.length ? state.responseKeys.join(', ') : 'None']),
        card('Last successful poll', [state.lastSuccessfulPollTime || 'Waiting for data']),
        card('last render error', [state.lastRenderError || 'None']),
      ];
      document.getElementById('diagnostics-panel').innerHTML = entries.join('');
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
      setConnectionChip('Connected', 'connected');
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
      renderLatestDogfoodRun(modelUsage, events, costSummary.currency || 'USD');
      renderModelUsage(modelUsage, costSummary.currency || 'USD');
      renderActiveAgentWork(activeLoops);
      renderTimeline(events);
      renderRisks(risks);
      renderApprovals(approvals);
      renderArtifacts(artifacts);
      renderHandoffs(handoffs);
      renderDiagnostics(snapshot);

      const readinessBlockers = escapeHtml(listAsLines(readiness.blockers).join('\\n'));
      const readinessRecommendations = escapeHtml(listAsLines(readiness.recommendations).join('\\n'));
      document.getElementById('readiness').innerHTML = '<div class="panel"><div class="score">' + escapeHtml(String(readiness.score ?? 0)) + '/100</div><div class="value">' + escapeHtml(readiness.status || 'Unknown') + '</div><div class="kpi-subvalue" style="margin-top:12px;">Blockers</div><pre>' + readinessBlockers + '</pre><div class="kpi-subvalue" style="margin-top:12px;">Recommendations</div><pre>' + readinessRecommendations + '</pre></div>';

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
      state.pollStarted = 'yes';
      state.lastFetchError = 'None';
      const startedAt = Date.now();
      renderDiagnostics({});
      try {
        setConnectionChip('Refreshing…', 'connecting');
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
        state.lastPollLatency = (Date.now() - startedAt) + ' ms';
        render(snapshot, state.lastSuccessfulPollTime);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.error('Safeloop monitor refresh failed:', error);
        state.lastFetchError = message;
        state.lastRenderError = message;
        state.lastPollLatency = (Date.now() - startedAt) + ' ms';
        if (!state.lastHttpStatus || state.lastHttpStatus === 'Connecting') {
          state.lastHttpStatus = 'Error';
        }
        setConnectionChip('Error', 'error');
        document.getElementById('event-timeline').innerHTML = '<div class="panel error">' + escapeHtml(message) + '</div>';
        renderDiagnostics({});
      } finally {
        setTimeout(refresh, POLL_MS);
      }
    }

    function reportRuntimeError(message) {
      state.lastRenderError = message;
      renderDiagnostics({});
    }

    window.onerror = function (_event, _source, _line, _column, error) {
      reportRuntimeError(error instanceof Error ? error.message : String(error || 'Unknown runtime error'));
      return false;
    };

    window.onunhandledrejection = function (event) {
      const reason = event && 'reason' in event ? (event.reason instanceof Error ? event.reason.message : String(event.reason || 'Unknown rejection')) : 'Unknown rejection';
      reportRuntimeError(reason);
      return false;
    };

    renderDiagnostics({});

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
