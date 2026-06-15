import type { MonitorViewModel } from '../../viewModel';
import { escapeHtml, formatCompact, formatCurrency } from '../lib/formatters';

function renderMetricList(title: string, entries: Record<string, number>, currency: string): string {
  const rows = Object.entries(entries).sort((a, b) => b[1] - a[1]);
  return `
    <div class="metric-panel">
      <h3>${escapeHtml(title)}</h3>
      <div class="metric-rows">
        ${rows.length ? rows.map(([label, value]) => `
          <div class="metric-row">
            <span>${escapeHtml(label)}</span>
            <strong>${escapeHtml(formatCurrency(value, currency))}</strong>
          </div>
        `).join('') : '<div class="empty-state">None</div>'}
      </div>
    </div>
  `;
}

export function renderSpendPanel(viewModel: MonitorViewModel): string {
  return `
    <section class="panel-block" id="spend">
      <div class="section-heading section-heading-top">
        <div>
          <div class="panel-kicker">Spend</div>
          <h2>Token and cost accountability</h2>
        </div>
        <div class="section-caption">Ledger cost is shown separately from the latest run cost.</div>
      </div>
      <div class="spend-grid">
        <article class="metric-card">
          <span>Total ledger cost</span>
          <strong>${escapeHtml(formatCurrency(viewModel.spend.totalCost, viewModel.spend.currency))}</strong>
          <em>${escapeHtml(formatCompact(viewModel.spend.usageCount))} records</em>
        </article>
        <article class="metric-card">
          <span>Latest run cost</span>
          <strong>${escapeHtml(formatCurrency(viewModel.spend.latestRunCost, viewModel.spend.currency))}</strong>
          <em>${escapeHtml(viewModel.current.latestRun?.taskName || 'No latest run')}</em>
        </article>
        <article class="metric-card">
          <span>Total ledger cost</span>
          <strong>${escapeHtml(formatCurrency(viewModel.spend.totalLedgerCost, viewModel.spend.currency))}</strong>
          <em>Full history</em>
        </article>
      </div>
      <div class="metric-panels">
        ${renderMetricList('By agent', viewModel.spend.byAgent, viewModel.spend.currency)}
        ${renderMetricList('By model', viewModel.spend.byModel, viewModel.spend.currency)}
        ${renderMetricList('By project', viewModel.spend.byProject, viewModel.spend.currency)}
        ${renderMetricList('By task', viewModel.spend.byTask, viewModel.spend.currency)}
      </div>
    </section>
  `;
}
