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

function render(): void {
  if (!payload) {
    root.innerHTML = `
      <div class="sl-layout">
        <main class="sl-main">
          <section class="panel-block">
            <div class="panel-kicker">Safeloop Monitor</div>
            <h2>Loading dashboard…</h2>
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

  root.innerHTML = renderAppBody(next.viewModel);
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
        // clear after a short time so UI can show +N briefly
        setTimeout(() => { (window as any).safeloopNewEvents = 0; }, 9000);
      }
      (window as any).safeloopLastCount = incoming;
      (window as any).safeloopLastUpdated = next?.viewModel?.status?.lastUpdated ?? null;
    } catch (e) {
      // non-fatal
    }

    payload = next;
    setError(null);
    // update liveness UI elements (hero badges)
    try {
      // prefer the explicit lastUpdated on the payload
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
      // non-fatal UI update failure
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

  // expose a simple refresh hook for inline scripts to call instead of full reload
  (window as any).safeloopRefresh = refresh;
  // initialize lastCount for delta tracking
  (window as any).safeloopLastCount = payload?.viewModel?.status?.eventCount ?? 0;
  (window as any).safeloopNewEvents = 0;
  (window as any).safeloopLastUpdated = payload?.viewModel?.status?.lastUpdated ?? null;

  // optional: update hero age every second so "Last event" feels live
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
