import type { MonitorViewModel } from '../../viewModel';
import { escapeHtml, formatCompact, formatCurrency, formatNumber } from '../lib/formatters';

export function renderKpiGrid(viewModel: MonitorViewModel): string {
  return `
    <section class="kpi-grid" aria-label="Monitor KPIs">
      <article class="kpi-card">
        <div class="kpi-label">Current readiness</div>
        <div class="kpi-value">${escapeHtml(formatNumber(viewModel.current.currentReadiness.score))}/100</div>
        <div class="kpi-meta">${escapeHtml(viewModel.current.currentReadiness.status)}</div>
      </article>
      <article class="kpi-card">
        <div class="kpi-label">Historical ledger readiness</div>
        <div class="kpi-value">${escapeHtml(formatNumber(viewModel.historical.readiness.score))}/100</div>
        <div class="kpi-meta">${escapeHtml(viewModel.historical.readiness.status)}</div>
      </article>
      <article class="kpi-card">
        <div class="kpi-label">Ledger spend</div>
        <div class="kpi-value">${escapeHtml(formatCurrency(viewModel.spend.totalCost, viewModel.spend.currency))}</div>
        <div class="kpi-meta">${escapeHtml(formatCompact(viewModel.spend.usageCount))} usage records</div>
      </article>
      <article class="kpi-card">
        <div class="kpi-label">Current loops</div>
        <div class="kpi-value">${escapeHtml(formatNumber(viewModel.current.currentLoops.length))}</div>
        <div class="kpi-meta">${escapeHtml(formatCompact(viewModel.historical.loopCount))} historical loops</div>
      </article>
    </section>
  `;
}
