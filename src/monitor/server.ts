import { createServer, type IncomingMessage, type ServerResponse } from 'http';
import { existsSync, readFileSync, statSync } from 'fs';
import { extname, resolve } from 'path';
import { getDashboardSnapshot } from './dashboardData';
import { appendEvent } from '../eventStream';
import { evaluateRuntimePolicy, recordRuntimeGovernanceEvent, verifyCandidateMemory } from '../runtimeGovernance';
import { buildMonitorDashboardPayload, summarizeLoopSummaries } from './viewModel';
import { renderAppBody, renderFallbackDocument } from './ui/components/App';
import { redactSensitive } from './redact';
import type { SafeloopStorageOptions } from '../localStorage';

export { summarizeLoopSummaries } from './viewModel';

export interface MonitorServerOptions extends SafeloopStorageOptions {
  port?: number;
  // optional external event file paths to merge into the snapshot (full file paths)
  externalEventPaths?: string[];
}

const DEFAULT_MONITOR_PORT = 3777;
const PROJECT_ROOT = resolve(__dirname, '..', '..');
const MONITOR_DIST_DIR = resolve(PROJECT_ROOT, 'dist', 'monitor');
const MONITOR_DIST_INDEX = resolve(MONITOR_DIST_DIR, 'index.html');
const MONITOR_UI_INDEX = resolve(PROJECT_ROOT, 'src', 'monitor', 'ui', 'index.html');
const MONITOR_UI_CSS = resolve(PROJECT_ROOT, 'src', 'monitor', 'ui', 'styles.css');

const CONTENT_TYPES: Record<string, string> = {
  '.css': 'text/css; charset=utf-8',
  '.gif': 'image/gif',
  '.html': 'text/html; charset=utf-8',
  '.ico': 'image/x-icon',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.txt': 'text/plain; charset=utf-8',
  '.webp': 'image/webp',
  '.woff2': 'font/woff2',
};

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

function readJsonBody(req: IncomingMessage, res: ServerResponse, maxBytes: number, onBody: (payload: any) => void): void {
  let body = '';
  let tooLarge = false;
  req.on('data', (chunk) => {
    if (tooLarge) return;
    body += chunk;
    if (Buffer.byteLength(body, 'utf8') > maxBytes) {
      tooLarge = true;
      sendJson(res, 413, { error: `request body exceeds ${maxBytes} byte limit` });
    }
  });
  req.on('end', () => {
    if (tooLarge) return;
    try {
      onBody(body ? JSON.parse(body) : {});
    } catch (error) {
      sendJson(res, 400, { error: error instanceof Error ? error.message : String(error) });
    }
  });
}

function buildDashboardPayload(options: SafeloopStorageOptions = {}) {
  return redactSensitive(buildMonitorDashboardPayload(getDashboardSnapshot(options)));
}

function sendSse(res: ServerResponse, event: string, payload: unknown): void {
  res.write(`event: ${event}\n`);
  res.write(`data: ${JSON.stringify(payload).replace(/\r?\n/g, ' ')}\n\n`);
}

function streamDashboardEvents(res: ServerResponse, options: SafeloopStorageOptions = {}): () => void {
  res.writeHead(200, {
    'content-type': 'text/event-stream; charset=utf-8',
    'cache-control': 'no-cache, no-transform',
    connection: 'keep-alive',
    'x-accel-buffering': 'no',
  });
  res.write(': SafeLoop local event stream\n\n');

  let lastSignature = '';
  const sendIfChanged = (force = false) => {
    try {
      const payload = buildDashboardPayload(options) as any;
      const signature = `${payload?.eventCount ?? 0}:${payload?.lastUpdated ?? ''}:${payload?.eventDiagnostics?.malformedLineCount ?? 0}`;
      if (force || signature !== lastSignature) {
        lastSignature = signature;
        sendSse(res, 'dashboard', payload);
      }
    } catch (error) {
      sendSse(res, 'error', { message: error instanceof Error ? error.message : String(error) });
    }
  };

  sendIfChanged(true);
  const interval = setInterval(() => sendIfChanged(false), 1000);
  const heartbeat = setInterval(() => sendSse(res, 'heartbeat', { now: new Date().toISOString() }), 15000);
  return () => {
    clearInterval(interval);
    clearInterval(heartbeat);
  };
}

function escapeBootstrapJson(value: unknown): string {
  return JSON.stringify(value).replace(/</g, '\\u003c');
}

function readBuiltTemplate(): string | null {
  if (!existsSync(MONITOR_DIST_INDEX)) {
    return null;
  }
  return readFileSync(MONITOR_DIST_INDEX, 'utf8');
}

function readFallbackCss(): string {
  if (existsSync(MONITOR_UI_CSS)) {
    return readFileSync(MONITOR_UI_CSS, 'utf8');
  }
  return '';
}

function renderMonitorDocument(options: SafeloopStorageOptions = {}): string {
  const snapshot = getDashboardSnapshot(options);
  const payload = buildMonitorDashboardPayload(snapshot);
  const template = readBuiltTemplate();
  if (template) {
    const bootstrap = escapeBootstrapJson(payload);
    return template
      .replace('__SAFELOOP_BOOTSTRAP__', bootstrap)
      .replace('<div id="app" data-monitor-ui="vite"></div>', `<div id="app" data-monitor-ui="vite">${renderAppBody(payload.viewModel)}</div>`);
  }
  return renderFallbackDocument(payload, readFallbackCss());
}

export function renderMonitorHtml(options: SafeloopStorageOptions = {}): string {
  return renderMonitorDocument(options);
}

function readStaticAsset(urlPath: string): { filePath: string; contentType: string } | null {
  const cleanPath = decodeURIComponent(urlPath.split('?')[0].split('#')[0]);
  if (!cleanPath || cleanPath === '/' || cleanPath.startsWith('/api/')) {
    return null;
  }
  const relativePath = cleanPath.replace(/^\/+/, '');
  const filePath = resolve(MONITOR_DIST_DIR, relativePath);
  if (!filePath.startsWith(MONITOR_DIST_DIR)) {
    return null;
  }
  if (!existsSync(filePath)) {
    return null;
  }
  const stats = statSync(filePath);
  if (!stats.isFile()) {
    return null;
  }
  const contentType = CONTENT_TYPES[extname(filePath).toLowerCase()] ?? 'application/octet-stream';
  return { filePath, contentType };
}

export function createMonitorServer(options: SafeloopStorageOptions = {}) {
  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    const url = req.url ?? '/';

    if (url.startsWith('/api/dashboard')) {
      sendJson(res, 200, buildDashboardPayload(options));
      return;
    }

    if (url.startsWith('/api/events/stream') && (req.method === 'GET' || !req.method)) {
      const close = streamDashboardEvents(res, options);
      req.on('close', close);
      return;
    }

    if (url === '/api/governance/evaluate' && req.method === 'POST') {
      readJsonBody(req, res, 1024 * 1024, (payload) => {
        const result = evaluateRuntimePolicy(payload.input ?? payload);
        if (payload.record === true) {
          recordRuntimeGovernanceEvent(result.event, options);
        }
        sendJson(res, 200, redactSensitive(result));
      });
      return;
    }

    if (url === '/api/governance/memory' && req.method === 'POST') {
      readJsonBody(req, res, 1024 * 1024, (payload) => {
        const result = verifyCandidateMemory(payload.memory ?? payload, {
          scenario: payload.scenario,
          minimumConfidence: payload.minimumConfidence,
          storageOptions: options,
        });
        sendJson(res, 200, redactSensitive(result));
      });
      return;
    }

    // Timecard export endpoint: returns billable agent timecards as structured JSON
    if (url.startsWith('/api/timecards/export') && (req.method === 'GET' || !req.method)) {
      const snapshot = getDashboardSnapshot(options);
      const dashboardPayload = buildMonitorDashboardPayload(snapshot);
      const vm = dashboardPayload.viewModel;

      const exportPayload = {
        generatedAt: new Date().toISOString(),
        deployment: vm.deployment ?? null,
        currentSessionId: vm.liveActivity?.currentSessionId ?? null,
        isHistoricalOnly: vm.liveActivity?.isHistoricalOnly ?? false,
        timecardSummary: vm.timecardSummary ?? {
          current: [],
          historical: [],
          totals: {
            currentCount: 0,
            historicalCount: 0,
            billableCandidateCount: 0,
            totalDurationMs: 0,
            totalTokens: 0,
            totalEstimatedCost: 0,
            pricingAvailable: false,
          },
        },
      };

      sendJson(res, 200, redactSensitive(exportPayload));
      return;
    }

    // Operator action endpoint: record local operator events into the SafeLoop ledger
    if (url === '/api/operator/actions' && req.method === 'POST') {
      const MAX_BODY_BYTES = 1024 * 1024; // 1 MB
      let body = '';
      let tooLarge = false;
      req.on('data', (chunk) => {
        if (tooLarge) return;
        body += chunk;
        if (Buffer.byteLength(body, 'utf8') > MAX_BODY_BYTES) {
          tooLarge = true;
          sendJson(res, 413, { error: 'request body exceeds 1MB limit' });
        }
      });
      req.on('end', () => {
        if (tooLarge) return;
        try {
          const payload = body ? JSON.parse(body) : {};
          const action = typeof payload.action === 'string' ? payload.action.trim() : '';
          const targetId = typeof payload.targetId === 'string' ? payload.targetId.trim() : '';

          const allowed = new Set(['acknowledged', 'reviewed', 'resolved']);
          if (!action || !allowed.has(action)) {
            sendJson(res, 400, { error: 'invalid action' });
            return;
          }
          if (!targetId) {
            sendJson(res, 400, { error: 'missing targetId' });
            return;
          }

          const caseId = typeof payload.caseId === 'string' && payload.caseId.trim() ? payload.caseId.trim() : undefined;
          const agent = typeof payload.agent === 'string' && payload.agent.trim() ? payload.agent.trim() : undefined;
          const targetType = typeof payload.targetType === 'string' && payload.targetType.trim() ? payload.targetType.trim() : undefined;
          const note = typeof payload.note === 'string' && payload.note.trim() ? payload.note.trim() : undefined;

          const eventId = `operator:${Date.now()}:${targetId}:${action}`;
          const summary = `Operator marked ${targetId} as ${action}`;

          try {
            const recorded = appendEvent(
              {
                id: eventId,
                type: 'operator.action.recorded',
                agentId: agent ?? 'operator',
                agentName: agent ?? 'operator',
                caseId: caseId ?? undefined,
                summary,
                metadata: {
                  source: { kind: 'operator-action' },
                  action,
                  targetId,
                  targetType: targetType ?? undefined,
                  note: note ?? undefined,
                },
              },
              options,
            );

            sendJson(res, 201, { ok: true, id: recorded.id });
            return;
          } catch (err) {
            // write failure
            sendJson(res, 500, { error: 'failed to record operator action' });
            return;
          }
        } catch (err) {
          sendJson(res, 400, { error: 'invalid json' });
          return;
        }
      });
      return;
    }

    if (url === '/health') {
      sendJson(res, 200, { ok: true, localOnly: true });
      return;
    }

    const staticAsset = readStaticAsset(url);
    if (staticAsset) {
      res.writeHead(200, { 'content-type': staticAsset.contentType });
      res.end(readFileSync(staticAsset.filePath));
      return;
    }

    if (url === '/' || url.startsWith('/?') || !url.startsWith('/api/')) {
      sendHtml(res, renderMonitorDocument(options));
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
