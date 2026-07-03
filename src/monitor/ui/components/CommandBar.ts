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
    sessionLabel = currentSessionId ? `Run: ${currentSessionId}` : 'Session active';
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

  // Deployment metadata
  const deployment = viewModel.deployment;
  const deployMode = deployment?.mode ?? 'local';
  const deployTransport = deployment?.transport ?? 'polling';

  return `
    <header class="sl-command-bar" role="banner">
      <div class="command-bar-left">
        <span class="command-bar-brand">SAFELOOP</span>
        <span class="command-bar-title">Control Room</span>
        <span class="command-bar-status command-bar-status--${escapeHtml(operatorStatus)}">${escapeHtml(operatorStatus.toUpperCase())}</span>
      </div>
      <div class="command-bar-center">
        <span class="command-bar-badge command-bar-badge--${escapeHtml(deployMode)}">Mode: ${escapeHtml(deployMode)} \u00B7 ${escapeHtml(deployTransport)}</span>
        <span class="command-bar-session command-bar-session--${escapeHtml(sessionClass)}">${escapeHtml(sessionLabel)}</span>
      </div>
      <div class="command-bar-right">
        <span class="command-bar-pill" title="Cost burn">${escapeHtml(costLabel)}</span>
        <span class="command-bar-pill${agentCount > 0 ? ' command-bar-pill--live' : ''}" title="Active agents">${escapeHtml(formatNumber(agentCount))} agents</span>
        ${pendingApprovals > 0 ? `<span class="command-bar-pill command-bar-pill--warn" title="Pending approvals">\u25C6 ${escapeHtml(formatNumber(pendingApprovals))} pending</span>` : ''}
        ${riskCount > 0 ? `<span class="command-bar-pill command-bar-pill--danger" title="Current risks">\u26A0 ${escapeHtml(formatNumber(riskCount))} risks</span>` : ''}
      </div>
    </header>
  `;
}
