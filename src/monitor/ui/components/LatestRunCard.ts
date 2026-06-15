import type { MonitorViewModel } from '../../viewModel';
import { escapeHtml, formatCompact, formatCurrency, formatDuration, formatNumber, formatTimestamp, formatList } from '../lib/formatters';

export function renderLatestRunCard(viewModel: MonitorViewModel): string {
  const latest = viewModel.current.latestRun;
  if (!latest) {
    return `
      <section class="latest-run-card" id="latest-run">
        <div class="run-label">Latest Run</div>
        <div class="run-title">No current run detected</div>
        <div class="run-muted">The monitor will promote the most recent meaningful loop here once events arrive.</div>
      </section>
    `;
  }

  return `
    <section class="latest-run-card latest-loop-timecard loop-highlight-card" id="latest-run" aria-label="Latest run">
      <div class="run-label">Latest Run</div>
      <div class="run-title">${escapeHtml(latest.taskName)}</div>
      <div class="run-grid">
        <div class="run-item">
          <div class="run-item-label">Agent</div>
          <div class="run-item-value">${escapeHtml(latest.agent || latest.agentId || 'Unknown')}</div>
        </div>
        <div class="run-item">
          <div class="run-item-label">Project</div>
          <div class="run-item-value">${escapeHtml(latest.project || 'None')}</div>
        </div>
        <div class="run-item">
          <div class="run-item-label">Status</div>
          <div class="run-item-value">${escapeHtml(latest.status)}</div>
        </div>
        <div class="run-item">
          <div class="run-item-label">Duration</div>
          <div class="run-item-value">${escapeHtml(formatDuration(latest.durationMs))}</div>
        </div>
        <div class="run-item">
          <div class="run-item-label">Tokens</div>
          <div class="run-item-value">${escapeHtml(formatCompact(latest.totalTokens))}</div>
        </div>
        <div class="run-item">
          <div class="run-item-label">Cost</div>
          <div class="run-item-value">${escapeHtml(formatCurrency(latest.estimatedCost, viewModel.spend.currency))}</div>
        </div>
        <div class="run-item">
          <div class="run-item-label">Events</div>
          <div class="run-item-value">${escapeHtml(formatNumber(latest.eventCount))}</div>
        </div>
        <div class="run-item">
          <div class="run-item-label">Models</div>
          <div class="run-item-value">${escapeHtml(formatList(latest.models))}</div>
        </div>
      </div>
      <div class="run-footer">
        <span>${escapeHtml(latest.approvalsStatus)}</span>
        <span>${escapeHtml(formatNumber(latest.risksCount))} risks</span>
        <span>${escapeHtml(formatNumber(latest.artifactsCount))} artifacts</span>
        <span>${escapeHtml(formatNumber(latest.handoffsCount))} handoffs</span>
      </div>
    </section>
  `;
}
