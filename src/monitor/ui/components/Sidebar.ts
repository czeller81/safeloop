import type { MonitorViewModel } from '../../viewModel';
import { escapeHtml, formatTimestamp } from '../lib/formatters';

export function renderSidebar(viewModel: MonitorViewModel): string {
  return `
    <aside class="sl-sidebar" aria-label="Safeloop navigation">
      <div class="sl-sidebar-card">
        <div class="sl-sidebar-kicker">Safeloop Monitor</div>
        <div class="sl-sidebar-title">Live loop watch</div>
        <div class="sl-sidebar-meta">${escapeHtml(viewModel.status.connection)} · ${escapeHtml(formatTimestamp(viewModel.status.lastUpdated))}</div>
        <div class="sl-sidebar-path">${escapeHtml(viewModel.status.monitoredPath)}</div>
      </div>
      <nav class="sl-sidebar-card sl-sidebar-nav" aria-label="Monitor sections">
        <a href="#latest-run">Run summary</a>
        <a href="#spend">Spend</a>
        <a href="#loop-timecards">Loop Timecards</a>
        <a href="#risks">Risks &amp; Guardrails</a>
        <a href="#human-review">Human Review</a>
        <a href="#diagnostics">Diagnostics</a>
        <a href="#historical-ledger">Historical Ledger</a>
      </nav>
    </aside>
  `;
}
