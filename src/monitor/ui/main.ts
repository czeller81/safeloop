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
    payload = next;
    setError(null);
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

  window.setInterval(() => {
    void refresh();
  }, 5000);
}

void boot();
