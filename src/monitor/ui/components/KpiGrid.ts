import type { MonitorViewModel } from '../../viewModel';
import { escapeHtml, formatCompact, formatCostOrUnavailable, formatNumber } from '../lib/formatters';

export function renderKpiGrid(viewModel: MonitorViewModel): string {
  const live = viewModel.liveActivity;
  const activeAgents = live?.activeAgents.length ?? 0;
  const activeLoops = live?.currentLoopState.running ?? viewModel.current.currentLoops.filter((loop) => loop.status === 'running').length;
  const pendingApprovals = viewModel.current.approvals.filter((approval) => approval.status === 'pending').length;
  const riskSignals = viewModel.current.risks.length + viewModel.oversight.summary.warningCount + viewModel.oversight.summary.anomalyCount;
  const guardedEvents = viewModel.historical.loopCount + viewModel.current.currentLoops.reduce((count, loop) => count + loop.eventCount, 0);
  const totalTokens = viewModel.tokens.totalTokens || viewModel.timecardSummary?.totals.totalTokens || 0;
  const estimatedCost = formatCostOrUnavailable(viewModel.spend.totalCost, viewModel.spend.pricingAvailable, viewModel.spend.currency);

  return `
    <section class="kpi-grid" aria-label="Monitor KPIs">
      <article class="kpi-card">
        <div class="kpi-label">Total events</div>
        <div class="kpi-value">${escapeHtml(formatNumber(viewModel.status.eventCount))}</div>
        <div class="kpi-meta">Audit ledger entries</div>
      </article>
      <article class="kpi-card">
        <div class="kpi-label">Active agents</div>
        <div class="kpi-value">${escapeHtml(formatNumber(activeAgents))}</div>
        <div class="kpi-meta">${escapeHtml(formatNumber(activeLoops))} running loops</div>
      </article>
      <article class="kpi-card">
        <div class="kpi-label">Human attention</div>
        <div class="kpi-value">${escapeHtml(formatNumber(pendingApprovals))}</div>
        <div class="kpi-meta">Pending approvals</div>
      </article>
      <article class="kpi-card">
        <div class="kpi-label">Risk signals</div>
        <div class="kpi-value">${escapeHtml(formatNumber(riskSignals))}</div>
        <div class="kpi-meta">Risks, warnings, anomalies</div>
      </article>
      <article class="kpi-card">
        <div class="kpi-label">Guard decisions</div>
        <div class="kpi-value">${escapeHtml(formatCompact(guardedEvents))}</div>
        <div class="kpi-meta">Loop and evidence activity</div>
      </article>
      <article class="kpi-card">
        <div class="kpi-label">Token usage</div>
        <div class="kpi-value">${escapeHtml(formatCompact(totalTokens))}</div>
        <div class="kpi-meta">${escapeHtml(formatCompact(viewModel.tokens.records.length))} usage records</div>
      </article>
      <article class="kpi-card">
        <div class="kpi-label">Estimated cost</div>
        <div class="kpi-value kpi-value--cost">${escapeHtml(estimatedCost)}</div>
        <div class="kpi-meta">${escapeHtml(viewModel.spend.currency)} ledger total</div>
      </article>
      <article class="kpi-card">
        <div class="kpi-label">Readiness</div>
        <div class="kpi-value">${escapeHtml(formatNumber(viewModel.current.currentReadiness.score))}/100</div>
        <div class="kpi-meta">${escapeHtml(viewModel.current.currentReadiness.status)}</div>
      </article>
    </section>
  `;
}
