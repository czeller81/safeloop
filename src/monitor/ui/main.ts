import './styles.css';
import { fetchDashboardPayload, readBootstrapPayload } from './lib/api';
import { normalizeDashboardPayload } from './lib/viewModels';
import { renderAppBody } from './components/App';
import type { MonitorDashboardPayload } from '../viewModel';

function getRootElement(): HTMLElement {
  const element = document.getElementById('app');
  if (!(element instanceof HTMLElement)) {
    throw new Error('Missing #app root element');
  }
  return element;
}

const root = getRootElement();

let payload: MonitorDashboardPayload | null = readBootstrapPayload();
let renderError: string | null = null;

// --- State preservation across innerHTML re-renders ---

interface UiState {
  detailsOpen: Record<string, boolean>;
  scrollPositions: Record<string, number>;
  focusedElement?: string;
  selectedTraceId?: string;
  activeTraceFilter?: string;
  selectedTracePayload?: Record<string, unknown>;
}

const UI_STORAGE_KEYS = {
  detailsOpen: 'safeloop:details-open',
  traceFilter: 'safeloop:trace-filter',
  selectedTraceId: 'safeloop:selected-trace-id',
  selectedTracePayload: 'safeloop:selected-trace-payload',
  selectedNavSection: 'safeloop:selected-nav-section',
} as const;

function readStorageJson<T>(key: string, fallback: T): T {
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? JSON.parse(raw) as T : fallback;
  } catch (_) {
    return fallback;
  }
}

function writeStorageJson(key: string, value: unknown): void {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch (_) {
    // ignore storage failures
  }
}

function readStorageText(key: string): string | undefined {
  try {
    return window.localStorage.getItem(key) || undefined;
  } catch (_) {
    return undefined;
  }
}

function writeStorageText(key: string, value: string | undefined): void {
  try {
    if (value) {
      window.localStorage.setItem(key, value);
    } else {
      window.localStorage.removeItem(key);
    }
  } catch (_) {
    // ignore storage failures
  }
}

function getFocusedElementKey(): string | undefined {
  const active = document.activeElement;
  if (!(active instanceof HTMLElement) || active === document.body) {
    return undefined;
  }

  const traceFilter = active.closest('[data-trace-filter]');
  if (traceFilter instanceof HTMLElement && traceFilter.dataset.traceFilter) {
    return `trace-filter:${traceFilter.dataset.traceFilter}`;
  }

  const traceRow = active.closest('.trace-row');
  if (traceRow instanceof HTMLElement && traceRow.dataset.traceId) {
    return `trace-row:${traceRow.dataset.traceId}`;
  }

  if (active.tagName === 'SUMMARY' && active.parentElement instanceof HTMLDetailsElement) {
    const key = active.parentElement.dataset.stateKey || active.parentElement.id;
    return key ? `details-summary:${key}` : undefined;
  }

  return active.id ? `id:${active.id}` : undefined;
}

function findFocusedElement(key: string | undefined): HTMLElement | null {
  if (!key) return null;
  const separator = key.indexOf(':');
  const kind = separator >= 0 ? key.slice(0, separator) : key;
  const value = separator >= 0 ? key.slice(separator + 1) : '';
  if (!value) return null;

  if (kind === 'trace-filter') {
    return Array.from(root.querySelectorAll<HTMLElement>('[data-trace-filter]'))
      .find((candidate) => candidate.dataset.traceFilter === value) ?? null;
  }

  if (kind === 'trace-row') {
    return Array.from(root.querySelectorAll<HTMLElement>('.trace-row'))
      .find((candidate) => candidate.dataset.traceId === value) ?? null;
  }

  if (kind === 'details-summary') {
    const details = root.querySelector<HTMLDetailsElement>(`details[id="${value}"], details[data-state-key="${value}"]`);
    return details?.querySelector<HTMLElement>('summary') ?? null;
  }

  if (kind === 'id') {
    return document.getElementById(value);
  }

  return null;
}

function captureUiState(): UiState {
  const state: UiState = {
    detailsOpen: readStorageJson<Record<string, boolean>>(UI_STORAGE_KEYS.detailsOpen, {}),
    scrollPositions: {},
    focusedElement: getFocusedElementKey(),
    selectedTraceId: (window as any).safeloopSelectedTraceId ?? readStorageText(UI_STORAGE_KEYS.selectedTraceId),
    activeTraceFilter: (window as any).safeloopTraceFilter ?? readStorageText(UI_STORAGE_KEYS.traceFilter),
    selectedTracePayload: (window as any).safeloopSelectedTracePayload ?? readStorageJson<Record<string, unknown> | undefined>(UI_STORAGE_KEYS.selectedTracePayload, undefined),
  };

  // Capture open/closed state of all <details> elements
  try {
    const details = root.querySelectorAll('details[id], details[data-state-key]');
    details.forEach((el) => {
      const key = (el as HTMLElement).dataset.stateKey || el.id;
      if (key) {
        state.detailsOpen[key] = (el as HTMLDetailsElement).open;
      }
    });
  } catch (_) { /* non-fatal */ }

  // Capture scroll positions for key scrollable containers
  try {
    state.scrollPositions.windowX = window.scrollX || 0;
    state.scrollPositions.windowY = window.scrollY || 0;
    const documentScroll = document.scrollingElement;
    if (documentScroll) {
      state.scrollPositions.document = documentScroll.scrollTop || 0;
    }
    const canvas = root.querySelector('.sl-canvas');
    if (canvas) {
      state.scrollPositions['sl-canvas'] = canvas.scrollTop || 0;
    }
    const inspector = root.querySelector('.decision-inspector');
    if (inspector) {
      state.scrollPositions['decision-inspector'] = inspector.scrollTop || 0;
    }
    const scrollables = root.querySelectorAll('[data-scroll-key]');
    scrollables.forEach((el) => {
      const key = (el as HTMLElement).dataset.scrollKey;
      if (key) {
        state.scrollPositions[key] = el.scrollTop;
      }
    });
    // Also capture the evidence stream timeline
    const evTimeline = root.querySelector('.ev-timeline');
    if (evTimeline && evTimeline.scrollTop > 0) {
      state.scrollPositions['ev-timeline'] = evTimeline.scrollTop;
    }
  } catch (_) { /* non-fatal */ }

  return state;
}

function restoreUiState(state: UiState): void {
  // Restore open/closed state of <details> elements
  try {
    const mergedDetails = {
      ...readStorageJson<Record<string, boolean>>(UI_STORAGE_KEYS.detailsOpen, {}),
      ...state.detailsOpen,
    };
    for (const [key, isOpen] of Object.entries(state.detailsOpen)) {
      const el = root.querySelector(`details[id="${key}"], details[data-state-key="${key}"]`) as HTMLDetailsElement | null;
      if (el) {
        el.open = isOpen;
      }
    }
    writeStorageJson(UI_STORAGE_KEYS.detailsOpen, mergedDetails);
  } catch (_) { /* non-fatal */ }

  // Restore scroll positions
  try {
    const restoreScroll = () => {
      const documentScroll = document.scrollingElement;
      if (documentScroll && typeof state.scrollPositions.document === 'number') {
        documentScroll.scrollTop = state.scrollPositions.document;
      }
      if (typeof state.scrollPositions.windowX === 'number' || typeof state.scrollPositions.windowY === 'number') {
        window.scrollTo(state.scrollPositions.windowX ?? window.scrollX, state.scrollPositions.windowY ?? window.scrollY);
      }
      const canvas = root.querySelector('.sl-canvas');
      if (canvas && typeof state.scrollPositions['sl-canvas'] === 'number') {
        canvas.scrollTop = state.scrollPositions['sl-canvas'];
      }
      const inspector = root.querySelector('.decision-inspector');
      if (inspector && typeof state.scrollPositions['decision-inspector'] === 'number') {
        inspector.scrollTop = state.scrollPositions['decision-inspector'];
      }
      for (const [key, scrollTop] of Object.entries(state.scrollPositions)) {
        if (key === 'windowX' || key === 'windowY' || key === 'document' || key === 'sl-canvas' || key === 'decision-inspector') {
          continue;
        }
        let el: Element | null = null;
        if (key === 'ev-timeline') {
          el = root.querySelector('.ev-timeline');
        } else {
          el = root.querySelector(`[data-scroll-key="${key}"]`);
        }
        if (el) {
          el.scrollTop = scrollTop;
        }
      }
    };
    const restoreFocus = () => {
      const focused = findFocusedElement(state.focusedElement);
      if (focused) {
        focused.focus({ preventScroll: true });
      }
    };
    restoreScroll();
    restoreFocus();
    window.requestAnimationFrame(() => {
      restoreScroll();
      restoreFocus();
    });
  } catch (_) { /* non-fatal */ }

  (window as any).safeloopTraceFilter = state.activeTraceFilter;
  (window as any).safeloopSelectedTraceId = state.selectedTraceId;
  (window as any).safeloopSelectedTracePayload = state.selectedTracePayload;
}

function escapeHtmlClient(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function renderInspectorField(label: string, value: unknown): string {
  const unavailable = value === undefined || value === null || value === '' || value === 'none' || value === '-';
  return `
    <div class="inspector-field${unavailable ? ' inspector-field--empty' : ''}">
      <span>${escapeHtmlClient(label)}</span>
      <strong>${escapeHtmlClient(unavailable ? 'Unavailable' : value)}</strong>
    </div>
  `;
}

function renderInspectorSection(title: string, body: string): string {
  return `
    <section class="inspector-card">
      <div class="inspector-section-title">${escapeHtmlClient(title)}</div>
      ${body}
    </section>
  `;
}

function renderInspectorNote(value: unknown): string {
  return `<p class="inspector-note">${escapeHtmlClient(value || 'Unavailable')}</p>`;
}

function redactInspectorPayload(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => redactInspectorPayload(item));
  }
  if (value && typeof value === 'object') {
    const redacted: Record<string, unknown> = {};
    for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
      if (/secret|token|api[_-]?key|password|credential|authorization/i.test(key)) {
        redacted[key] = '[redacted]';
      } else {
        redacted[key] = redactInspectorPayload(nested);
      }
    }
    return redacted;
  }
  return value;
}

function updateDecisionInspector(payload: Record<string, any>): void {
  const inspector = root.querySelector('#decision-inspector');
  if (!(inspector instanceof HTMLElement)) return;
  const risk = payload.risk?.severity || (payload.type === 'risk.detected' ? 'medium' : 'none');
  const approval = payload.approval?.status || payload.approval || 'none';
  const evidence = payload.evidence?.path || payload.evidence?.summary || payload.evidence || 'none';
  const status = payload.status || approval || 'recorded';
  const statusClass = String(status).toLowerCase().replace(/[^a-z0-9_-]+/g, '-');
  const usage = payload.usage || {};
  const cost = payload.cost || usage.estimatedCost || 'unavailable';
  const reviewText = approval === 'none' ? 'No human review required' : approval;
  const evidenceText = evidence === 'none' ? 'No evidence artifact attached' : evidence;
  const json = JSON.stringify(redactInspectorPayload(payload), null, 2);
  inspector.innerHTML = `
    <div class="inspector-panel inspector-panel--selected">
      <div class="inspector-header">
        <div>
          <div class="panel-kicker">Decision Inspector</div>
          <h2>${escapeHtmlClient(payload.type || 'Trace event')}</h2>
          <p class="inspector-timestamp">${escapeHtmlClient(payload.timestamp || 'Timestamp unavailable')}</p>
        </div>
        <span class="inspector-state inspector-state--${escapeHtmlClient(statusClass)}">${escapeHtmlClient(status)}</span>
      </div>
      ${renderInspectorSection('Summary', `
        ${renderInspectorNote(payload.summary || 'No summary available')}
        <div class="inspector-field-grid">
          ${renderInspectorField('Agent', payload.agent)}
          ${renderInspectorField('Case / session / task', [payload.caseId, payload.loopKey].filter(Boolean).join(' / '))}
        </div>
      `)}
      ${renderInspectorSection('SafeLoop Decision', `
        <div class="inspector-field-grid">
          ${renderInspectorField('Decision', payload.decision)}
          ${renderInspectorField('Status', status)}
          ${renderInspectorField('Reason', payload.reason)}
          ${renderInspectorField('Risk / severity', risk)}
        </div>
      `)}
      ${renderInspectorSection('Human Review', renderInspectorNote(reviewText))}
      ${renderInspectorSection('Evidence', `
        ${renderInspectorNote(evidenceText)}
        <div class="inspector-field-grid">
          ${renderInspectorField('Artifact', evidence === 'none' ? undefined : evidence)}
          ${renderInspectorField('Ledger state', evidence === 'none' ? 'No artifact attached' : 'Evidence attached')}
        </div>
      `)}
      ${renderInspectorSection('Cost / Tokens', `
        <div class="inspector-field-grid">
          ${renderInspectorField('Model', usage.model)}
          ${renderInspectorField('Provider', usage.provider)}
          ${renderInspectorField('Tokens', usage.totalTokens)}
          ${renderInspectorField('Estimated cost', cost)}
        </div>
      `)}
      <details class="inspector-json-details">
        <summary>Raw Event</summary>
        <pre class="inspector-code">${escapeHtmlClient(json)}</pre>
      </details>
    </div>
  `;
}

function bindTraceConsole(): void {
  try {
    const consoleEl = root.querySelector('#trace-console');
    if (!(consoleEl instanceof HTMLElement) || consoleEl.dataset.bound === 'true') return;
    consoleEl.dataset.bound = 'true';

    consoleEl.addEventListener('click', (event) => {
      const target = event.target;
      if (!(target instanceof HTMLElement)) return;

      const filter = target.closest('[data-trace-filter]');
      if (filter instanceof HTMLElement) {
        const group = filter.dataset.traceFilter || 'all';
        (window as any).safeloopTraceFilter = group;
        writeStorageText(UI_STORAGE_KEYS.traceFilter, group);
        root.querySelectorAll('.trace-filter-chip').forEach((chip) => chip.classList.remove('trace-filter-chip--active'));
        filter.classList.add('trace-filter-chip--active');
        root.querySelectorAll<HTMLElement>('.trace-row').forEach((row) => {
          row.hidden = group !== 'all' && row.dataset.traceGroup !== group;
        });
        return;
      }

      const row = target.closest('.trace-row');
      if (row instanceof HTMLElement) {
        const raw = row.dataset.tracePayload;
        if (!raw) return;
        const traceId = row.dataset.traceId;
        root.querySelectorAll('.trace-row--selected').forEach((selected) => selected.classList.remove('trace-row--selected'));
        row.classList.add('trace-row--selected');
        try {
          const parsed = JSON.parse(raw) as Record<string, unknown>;
          (window as any).safeloopSelectedTraceId = traceId;
          (window as any).safeloopSelectedTracePayload = parsed;
          writeStorageText(UI_STORAGE_KEYS.selectedTraceId, traceId);
          writeStorageJson(UI_STORAGE_KEYS.selectedTracePayload, parsed);
          updateDecisionInspector(parsed);
        } catch (_) {
          // ignore malformed row payloads
        }
      }
    });

    const rememberedFilter = (window as any).safeloopTraceFilter ?? readStorageText(UI_STORAGE_KEYS.traceFilter);
    if (typeof rememberedFilter === 'string') {
      applyTraceFilter(rememberedFilter);
    }
    restoreSelectedTrace();
  } catch (_) { /* non-fatal */ }
}

function bindDetailsState(): void {
  try {
    root.querySelectorAll<HTMLDetailsElement>('details[id], details[data-state-key]').forEach((details) => {
      if ((details as HTMLElement).dataset.detailsBound === 'true') return;
      (details as HTMLElement).dataset.detailsBound = 'true';
      details.addEventListener('toggle', () => {
        const key = (details as HTMLElement).dataset.stateKey || details.id;
        if (!key) return;
        const current = readStorageJson<Record<string, boolean>>(UI_STORAGE_KEYS.detailsOpen, {});
        current[key] = details.open;
        writeStorageJson(UI_STORAGE_KEYS.detailsOpen, current);
      });
    });
  } catch (_) { /* non-fatal */ }
}

function bindNavState(): void {
  try {
    const activeSection = readStorageText(UI_STORAGE_KEYS.selectedNavSection);
    root.querySelectorAll<HTMLElement>('[data-nav-section]').forEach((link) => {
      link.classList.toggle('rail-nav-link--active', Boolean(activeSection && link.dataset.navSection === activeSection));
      if (link.dataset.navBound === 'true') return;
      link.dataset.navBound = 'true';
      link.addEventListener('click', () => {
        const section = link.dataset.navSection;
        if (!section) return;
        writeStorageText(UI_STORAGE_KEYS.selectedNavSection, section);
        root.querySelectorAll<HTMLElement>('[data-nav-section]').forEach((candidate) => {
          candidate.classList.toggle('rail-nav-link--active', candidate.dataset.navSection === section);
        });
      });
    });
  } catch (_) { /* non-fatal */ }
}

function applyTraceFilter(group: string): void {
  const normalized = group || 'all';
  (window as any).safeloopTraceFilter = normalized;
  writeStorageText(UI_STORAGE_KEYS.traceFilter, normalized);
  root.querySelectorAll<HTMLElement>('.trace-filter-chip').forEach((chip) => {
    chip.classList.toggle('trace-filter-chip--active', chip.dataset.traceFilter === normalized);
  });
  root.querySelectorAll<HTMLElement>('.trace-row').forEach((row) => {
    row.hidden = normalized !== 'all' && row.dataset.traceGroup !== normalized;
  });
}

function restoreSelectedTrace(): void {
  const selectedTraceId = (window as any).safeloopSelectedTraceId ?? readStorageText(UI_STORAGE_KEYS.selectedTraceId);
  if (!selectedTraceId) return;
  const row = Array.from(root.querySelectorAll<HTMLElement>('.trace-row')).find((candidate) => candidate.dataset.traceId === selectedTraceId);
  if (!row) {
    (window as any).safeloopSelectedTraceId = undefined;
    writeStorageText(UI_STORAGE_KEYS.selectedTraceId, undefined);
    return;
  }
  root.querySelectorAll('.trace-row--selected').forEach((selected) => selected.classList.remove('trace-row--selected'));
  row.classList.add('trace-row--selected');
  const raw = row.dataset.tracePayload;
  try {
    const parsed = raw ? JSON.parse(raw) as Record<string, unknown> : (window as any).safeloopSelectedTracePayload;
    if (parsed) {
      (window as any).safeloopSelectedTracePayload = parsed;
      writeStorageJson(UI_STORAGE_KEYS.selectedTracePayload, parsed);
      updateDecisionInspector(parsed);
    }
  } catch (_) {
    const cached = readStorageJson<Record<string, unknown> | undefined>(UI_STORAGE_KEYS.selectedTracePayload, undefined);
    if (cached) updateDecisionInspector(cached);
  }
}

function render(): void {
  if (!payload) {
    root.innerHTML = `
      <div class="sl-command-center">
        <main class="sl-canvas">
          <section class="panel-block">
            <div class="panel-kicker">Safeloop Monitor</div>
            <h2>Loading dashboard\u2026</h2>
          </section>
        </main>
      </div>
    `;
    return;
  }

  const next = {
    ...payload,
    viewModel: {
      ...payload.viewModel,
      diagnostics: {
        ...payload.viewModel.diagnostics,
        lastRenderError: renderError,
      },
    },
  } satisfies MonitorDashboardPayload;

  // Capture UI state before destroying the DOM
  const uiState = captureUiState();

  root.innerHTML = renderAppBody(next.viewModel);

  // Restore UI state after re-render
  restoreUiState(uiState);
  bindDetailsState();
  bindNavState();
  bindTraceConsole();
}

function setError(message: string | null): void {
  renderError = message;
  render();
}

async function refresh(): Promise<void> {
  try {
    const next = await fetchDashboardPayload();
    // update new-events delta tracking
    try {
      const last = (window as any).safeloopLastCount ?? null;
      const incoming = next?.viewModel?.status?.eventCount ?? null;
      if (typeof last === 'number' && typeof incoming === 'number' && incoming > last) {
        (window as any).safeloopNewEvents = incoming - last;
        setTimeout(() => { (window as any).safeloopNewEvents = 0; }, 9000);
      }
      (window as any).safeloopLastCount = incoming;
      (window as any).safeloopLastUpdated = next?.viewModel?.status?.lastUpdated ?? null;
    } catch (e) {
      // non-fatal
    }

    payload = next;
    setError(null);
    // update liveness UI elements
    try {
      const lastUpdated = next?.viewModel?.status?.lastUpdated ?? (window as any).safeloopLastUpdated ?? null;
      const newEvents = (window as any).safeloopNewEvents ?? 0;
      const elAge = document.getElementById('safeloop-last-age');
      const elNew = document.getElementById('safeloop-new-events');
      if (elAge) {
        if (!lastUpdated) {
          elAge.textContent = 'unavailable';
        } else {
          const ageMs = Date.now() - Date.parse(String(lastUpdated));
          if (isNaN(ageMs) || ageMs < 1000) elAge.textContent = 'just now';
          else if (ageMs < 60000) elAge.textContent = `${Math.round(ageMs/1000)}s ago`;
          else elAge.textContent = `${Math.round(ageMs/60000)}m ago`;
        }
      }
      if (elNew) {
        if (typeof newEvents === 'number' && newEvents > 0) {
          elNew.textContent = `+${newEvents} new events`;
          elNew.style.display = '';
        } else {
          elNew.style.display = 'none';
        }
      }
    } catch (e) {
      // non-fatal
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    setError(message);
  }
}

async function boot(): Promise<void> {
  if (!payload) {
    await refresh();
  } else {
    payload = normalizeDashboardPayload(payload);
    render();
  }

  (window as any).safeloopRefresh = refresh;
  (window as any).safeloopLastCount = payload?.viewModel?.status?.eventCount ?? 0;
  (window as any).safeloopNewEvents = 0;
  (window as any).safeloopLastUpdated = payload?.viewModel?.status?.lastUpdated ?? null;

  // Update age display every second
  setInterval(() => {
    try {
      const elAge = document.getElementById('safeloop-last-age');
      const last = (window as any).safeloopLastUpdated;
      if (elAge && last) {
        const ageMs = Date.now() - Date.parse(String(last));
        if (isNaN(ageMs) || ageMs < 1000) elAge.textContent = 'just now';
        else if (ageMs < 60000) elAge.textContent = `${Math.round(ageMs/1000)}s ago`;
        else elAge.textContent = `${Math.round(ageMs/60000)}m ago`;
      }
      const elNew = document.getElementById('safeloop-new-events');
      const newEvents = (window as any).safeloopNewEvents ?? 0;
      if (elNew) {
        if (typeof newEvents === 'number' && newEvents > 0) {
          elNew.textContent = `+${newEvents} new events`;
          elNew.style.display = '';
        } else {
          elNew.style.display = 'none';
        }
      }
    } catch (e) {
      // ignore
    }
  }, 1000);

  window.setInterval(() => {
    void refresh();
  }, 5000);
}

void boot();
