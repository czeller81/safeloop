import type { MonitorViewModel } from '../../viewModel';
import { escapeHtml, formatCompact, formatCostOrUnavailable, formatDuration, formatNumber } from '../lib/formatters';

function renderRailOperator(viewModel: MonitorViewModel): string {
  const oc = viewModel.operatorConsole;
  if (!oc) return '';

  const openItems = oc.attentionQueue.filter(i => i.state === 'open').length;
  return `
    <div class="rail-card">
      <div class="rail-card-title">Operator</div>
      <div class="rail-card-status rail-card-status--${escapeHtml(oc.status)}">${escapeHtml(oc.status.toUpperCase())}</div>
      <div class="rail-card-body">
        <div class="rail-metric"><span>Queue</span><strong>${escapeHtml(formatNumber(openItems))} open</strong></div>
        <div class="rail-metric"><span>Agents</span><strong>${escapeHtml(formatNumber(oc.summary.activeAgents))}</strong></div>
        <div class="rail-metric"><span>Loops</span><strong>${escapeHtml(formatNumber(oc.summary.activeLoops))}</strong></div>
      </div>
    </div>
  `;
}

function renderRailRisk(viewModel: MonitorViewModel): string {
  const riskCount = viewModel.current.risks.length;
  const pendingApprovals = viewModel.current.approvals.filter(a => a.status === 'pending').length;
  const oversightScore = viewModel.oversight.summary.oversightScore;
  const oversightLevel = viewModel.oversight.summary.oversightLevel;

  return `
    <div class="rail-card">
      <div class="rail-card-title">Risk &amp; Approval</div>
      <div class="rail-card-body">
        <div class="rail-metric"><span>Oversight</span><strong>${escapeHtml(formatNumber(oversightScore))}/100 <em class="oversight-level ${escapeHtml(oversightLevel)}">${escapeHtml(oversightLevel)}</em></strong></div>
        <div class="rail-metric"><span>Risks</span><strong>${escapeHtml(formatNumber(riskCount))}</strong></div>
        <div class="rail-metric"><span>Approvals pending</span><strong>${escapeHtml(formatNumber(pendingApprovals))}</strong></div>
      </div>
    </div>
  `;
}

function renderRailCost(viewModel: MonitorViewModel): string {
  const pulse = viewModel.liveActivity?.tokenCostPulse;
  const pricingAvailable = viewModel.spend.pricingAvailable;

  return `
    <div class="rail-card">
      <div class="rail-card-title">Cost &amp; Tokens</div>
      <div class="rail-card-body">
        <div class="rail-metric"><span>Latest run</span><strong>${escapeHtml(formatCostOrUnavailable(viewModel.spend.latestRunCost, pricingAvailable, viewModel.spend.currency))}</strong></div>
        <div class="rail-metric"><span>Tokens (60m)</span><strong>${escapeHtml(formatCompact(pulse?.recentTokenTotal ?? 0))}</strong></div>
        <div class="rail-metric"><span>Trend</span><strong>${pricingAvailable ? escapeHtml(pulse?.costTrend ?? 'unknown') : escapeHtml('\u2014')}</strong></div>
      </div>
    </div>
  `;
}

function renderRailSession(viewModel: MonitorViewModel): string {
  const latest = viewModel.current.latestRun;
  const live = viewModel.liveActivity;
  const loopState = live?.currentLoopState;
  const tc = viewModel.timecardSummary;

  const billableCount = tc?.totals.billableCandidateCount ?? 0;
  const billableLabel = billableCount > 0
    ? `${formatNumber(billableCount)} billable`
    : 'Not billable yet';

  return `
    <div class="rail-card">
      <div class="rail-card-title">Session &amp; Timecards</div>
      <div class="rail-card-body">
        <div class="rail-metric"><span>Latest run</span><strong>${escapeHtml(latest?.taskName || 'None')}</strong></div>
        <div class="rail-metric"><span>Status</span><strong>${escapeHtml(latest?.status || 'idle')}</strong></div>
        <div class="rail-metric"><span>Duration</span><strong>${escapeHtml(formatDuration(latest?.durationMs))}</strong></div>
        <div class="rail-metric"><span>Running</span><strong>${escapeHtml(formatNumber(loopState?.running ?? 0))}</strong></div>
        <div class="rail-metric"><span>Completed</span><strong>${escapeHtml(formatNumber(loopState?.completed ?? 0))}</strong></div>
        <div class="rail-metric rail-metric--separator"><span>Billable</span><strong class="${billableCount > 0 ? 'rail-billable' : ''}">${escapeHtml(billableLabel)}</strong></div>
        <div class="rail-metric"><span>Total tokens</span><strong>${escapeHtml(formatCompact(tc?.totals.totalTokens ?? 0))}</strong></div>
        <div class="rail-metric"><span>Total cost</span><strong>${escapeHtml(formatCostOrUnavailable(tc?.totals.totalEstimatedCost ?? 0, tc?.totals.pricingAvailable ?? false, viewModel.spend.currency))}</strong></div>
      </div>
      <div class="rail-card-action">
        <a href="/api/timecards/export" target="_blank" rel="noopener" class="rail-export-link">Export timecards \u2197</a>
      </div>
    </div>
  `;
}

export function renderCommandRail(viewModel: MonitorViewModel): string {
  return `
    <aside class="sl-command-rail" aria-label="Command center rail">
      ${renderRailOperator(viewModel)}
      ${renderRailRisk(viewModel)}
      ${renderRailCost(viewModel)}
      ${renderRailSession(viewModel)}
    </aside>
  `;
}
