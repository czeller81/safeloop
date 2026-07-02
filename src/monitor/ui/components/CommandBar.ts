import type { MonitorViewModel } from '../../viewModel';
import { escapeHtml, formatCostOrUnavailable, formatNumber } from '../lib/formatters';

export function renderCommandBar(viewModel: MonitorViewModel): string {
  const live = viewModel.liveActivity;
  const isHistoricalOnly = live?.isHistoricalOnly ?? false;
  const hasCurrentSession = live?.hasCurrentSession ?? false;
  const currentSessionId = live?.currentSessionId;
  const operatorStatus = viewModel.operatorConsole?.status ?? 'watch';

  // Session state label
  let sessionLabel = 'No session';
  let sessionClass = 'muted';
  if (hasCurrentSession) {
    sessionLabel = currentSessionId ? `Session: ${currentSessionId}` : 'Session active';
    sessionClass = 'active';
  } else if (isHistoricalOnly) {
    sessionLabel = 'Historical only';
    sessionClass = 'historical';
  }

  // Quick counts
  const pendingApprovals = viewModel.current.approvals.filter(a => a.status === 'pending').length;
  const riskCount = viewModel.current.risks.length;
  const agentCount = live?.activeAgents?.length ?? 0;

  // Cost pill
  const costLabel = formatCostOrUnavailable(
    viewModel.spend.latestRunCost,
    viewModel.spend.pricingAvailable,
    viewModel.spend.currency,
  );

  return `
    <header class="sl-command-bar" role="banner">
      <div class="command-bar-left">
        <span class="command-bar-brand">SafeLoop</span>
        <span class="command-bar-status command-bar-status--${escapeHtml(operatorStatus)}">${escapeHtml(operatorStatus.toUpperCase())}</span>
        <span class="command-bar-badge">${escapeHtml('Local monitor')}</span>
      </div>
      <div class="command-bar-center">
        <span class="command-bar-session command-bar-session--${escapeHtml(sessionClass)}">${escapeHtml(sessionLabel)}</span>
      </div>
      <div class="command-bar-right">
        <span class="command-bar-pill" title="Latest run cost">${escapeHtml(costLabel)}</span>
        <span class="command-bar-pill" title="Active agents">${escapeHtml(formatNumber(agentCount))} agents</span>
        ${pendingApprovals > 0 ? `<span class="command-bar-pill command-bar-pill--warn" title="Pending approvals">${escapeHtml(formatNumber(pendingApprovals))} approvals</span>` : ''}
        ${riskCount > 0 ? `<span class="command-bar-pill command-bar-pill--danger" title="Current risks">${escapeHtml(formatNumber(riskCount))} risks</span>` : ''}
      </div>
    </header>
  `;
}
