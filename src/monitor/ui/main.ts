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
}

function captureUiState(): UiState {
  const state: UiState = { detailsOpen: {}, scrollPositions: {} };

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
    const scrollables = root.querySelectorAll('[data-scroll-key]');
    scrollables.forEach((el) => {
      const key = (el as HTMLElement).dataset.scrollKey;
      if (key && el.scrollTop > 0) {
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
    for (const [key, isOpen] of Object.entries(state.detailsOpen)) {
      const el = root.querySelector(`details[id="${key}"], details[data-state-key="${key}"]`) as HTMLDetailsElement | null;
      if (el) {
        el.open = isOpen;
      }
    }
  } catch (_) { /* non-fatal */ }

  // Restore scroll positions
  try {
    for (const [key, scrollTop] of Object.entries(state.scrollPositions)) {
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
  } catch (_) { /* non-fatal */ }
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
