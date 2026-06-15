import { buildMonitorViewModel, type MonitorDashboardPayload, type MonitorViewModel } from '../../viewModel';
import type { DashboardSnapshot } from '../../dashboardData';

export function hasViewModel(payload: Partial<MonitorDashboardPayload> | null | undefined): payload is MonitorDashboardPayload {
  return Boolean(payload && typeof payload === 'object' && 'viewModel' in payload && payload.viewModel);
}

export function normalizeDashboardPayload(payload: Partial<MonitorDashboardPayload> | null | undefined): MonitorDashboardPayload {
  if (hasViewModel(payload)) {
    return payload;
  }

  const fallbackSnapshot = payload as unknown as DashboardSnapshot;
  const viewModel: MonitorViewModel = buildMonitorViewModel(fallbackSnapshot);

  return {
    ...(payload ?? {}),
    viewModel,
  } as MonitorDashboardPayload;
}

export function getViewModel(payload: Partial<MonitorDashboardPayload> | null | undefined): MonitorViewModel {
  return normalizeDashboardPayload(payload).viewModel;
}
