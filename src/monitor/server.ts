import { createServer, type IncomingMessage, type ServerResponse } from 'http';
import { existsSync, readFileSync, statSync } from 'fs';
import { extname, resolve } from 'path';
import { getDashboardSnapshot } from './dashboardData';
import { buildMonitorDashboardPayload, summarizeLoopSummaries } from './viewModel';
import { renderAppBody, renderFallbackDocument } from './ui/components/App';
import type { SafeloopStorageOptions } from '../localStorage';

export { summarizeLoopSummaries } from './viewModel';

export interface MonitorServerOptions extends SafeloopStorageOptions {
  port?: number;
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
      sendJson(res, 200, buildMonitorDashboardPayload(getDashboardSnapshot(options)));
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
