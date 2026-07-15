import type { MonitorViewModel } from '../../viewModel';
import { escapeHtml, formatCompact, formatCostOrUnavailable, formatNumber } from '../lib/formatters';

function riskSummary(viewModel: MonitorViewModel): { label: string; tone: string } {
  const currentRisks = viewModel.current.risks.length;
  const warnings = viewModel.oversight.summary.warningCount + viewModel.oversight.summary.anomalyCount;
  if (currentRisks > 0 || viewModel.oversight.summary.oversightLevel === 'critical') {
    return { label: 'High', tone: 'danger' };
  }
  if (warnings > 0 || viewModel.oversight.summary.oversightLevel === 'needs_review') {
    return { label: 'Review', tone: 'warn' };
  }
  return { label: 'Low', tone: 'good' };
}

function metric(label: string, value: string, tone = 'neutral', valueId?: string): string {
  return `
    <div class="top-metric top-metric--${escapeHtml(tone)}">
      <span>${escapeHtml(label)}</span>
      <strong${valueId ? ` id="${escapeHtml(valueId)}"` : ''}>${escapeHtml(value)}</strong>
    </div>
  `;
}

export function renderCommandBar(viewModel: MonitorViewModel): string {
  const live = viewModel.liveActivity;
  const activeLoops = live?.currentLoopState?.running ?? viewModel.current.currentLoops.filter((loop) => loop.status === 'running').length;
  const pendingApprovals = viewModel.current.approvals.filter((approval) => approval.status === 'pending').length;
  const risk = riskSummary(viewModel);
  const estimatedCost = formatCostOrUnavailable(viewModel.spend.totalCost, viewModel.spend.pricingAvailable, viewModel.spend.currency);
  const monitoredPath = viewModel.status.monitoredPath || 'local SafeLoop ledger';

  return `
    <header class="sl-command-bar" role="banner">
      <div class="top-title-group">
        <div class="top-title-row">
          <span class="top-product-eyebrow">AI agent governance</span>
          <strong>SafeLoop Command Center</strong>
          <span class="mode-chip">Local Mode</span>
        </div>
        <div class="top-path" title="${escapeHtml(monitoredPath)}">${escapeHtml(monitoredPath)}</div>
      </div>
      <div class="top-metrics" aria-label="SafeLoop monitor status">
        ${metric('Events', formatCompact(viewModel.status.eventCount))}
        ${metric('Active loops', formatNumber(activeLoops), activeLoops > 0 ? 'good' : 'neutral')}
        ${metric('Approvals', formatNumber(pendingApprovals), pendingApprovals > 0 ? 'approval' : 'neutral')}
        ${metric('Risk', risk.label, risk.tone)}
        ${metric('Estimated cost', estimatedCost)}
        ${metric('Last updated', 'just now', 'neutral', 'safeloop-last-age')}
      </div>
    </header>
  `;
}
