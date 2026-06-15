import { normalizeDashboardPayload } from './viewModels';
import type { MonitorDashboardPayload } from '../../viewModel';

export function readBootstrapPayload(): MonitorDashboardPayload | null {
  const node = document.getElementById('safeloop-bootstrap');
  const raw = node?.textContent?.trim();
  if (!raw) {
    return null;
  }
  try {
    return normalizeDashboardPayload(JSON.parse(raw) as MonitorDashboardPayload);
  } catch {
    return null;
  }
}

export async function fetchDashboardPayload(signal?: AbortSignal): Promise<MonitorDashboardPayload> {
  const response = await fetch('/api/dashboard', {
    method: 'GET',
    headers: {
      accept: 'application/json',
    },
    signal,
  });

  const json = (await response.json()) as MonitorDashboardPayload;
  const payload = normalizeDashboardPayload(json);
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }
  return payload;
}
