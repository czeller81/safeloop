import type { LoopTimecard, MonitorViewModel } from '../../viewModel';
import { escapeHtml, formatCompact, formatCurrency, formatDuration, formatNumber, formatTimestamp } from '../lib/formatters';

function renderLoopCard(loop: LoopTimecard, currency: string): string {
  return `
    <article class="timecard">
      <div class="timecard-top">
        <div>
          <div class="timecard-label">${escapeHtml(loop.status)}</div>
          <h3>${escapeHtml(loop.taskName)}</h3>
        </div>
        <div class="timecard-chip">${escapeHtml(formatCurrency(loop.estimatedCost, currency))}</div>
      </div>
      <div class="timecard-grid">
        <div><span>Agent</span><strong>${escapeHtml(loop.agent || loop.agentId || 'Unknown')}</strong></div>
        <div><span>Project</span><strong>${escapeHtml(loop.project || 'None')}</strong></div>
        <div><span>Tokens</span><strong>${escapeHtml(formatCompact(loop.totalTokens))}</strong></div>
        <div><span>Duration</span><strong>${escapeHtml(formatDuration(loop.durationMs))}</strong></div>
        <div><span>Events</span><strong>${escapeHtml(formatNumber(loop.eventCount))}</strong></div>
        <div><span>Models</span><strong>${escapeHtml(loop.models.join(', ') || 'None')}</strong></div>
        <div><span>Approval</span><strong>${escapeHtml(loop.approvalsStatus)}</strong></div>
        <div><span>Risks</span><strong>${escapeHtml(formatNumber(loop.risksCount))}</strong></div>
      </div>
      <div class="timecard-oversight">
        <span>Oversight</span>
        <strong>${escapeHtml(formatNumber(loop.oversightScore))}/100</strong>
        <em>${escapeHtml(loop.oversightLevel)} · ${escapeHtml(loop.recommendedAction)}</em>
      </div>
      <div class="timecard-footer">
        <span>${escapeHtml(formatTimestamp(loop.firstTimestamp))}</span>
        <span>${escapeHtml(formatTimestamp(loop.lastTimestamp))}</span>
        <span>${escapeHtml(formatNumber(loop.artifactsCount))} artifacts</span>
        <span>${escapeHtml(formatNumber(loop.handoffsCount))} handoffs</span>
      </div>
    </article>
  `;
}

function renderLoopList(title: string, loops: LoopTimecard[], currency: string, emptyMessage: string, className: string): string {
  return `
    <div class="timecard-section ${className}">
      <div class="section-heading">
        <h3>${escapeHtml(title)}</h3>
        <span>${escapeHtml(formatNumber(loops.length))}</span>
      </div>
      <div class="timecard-list">
        ${loops.length ? loops.map((loop) => renderLoopCard(loop, currency)).join('') : `<div class="empty-state">${escapeHtml(emptyMessage)}</div>`}
      </div>
    </div>
  `;
}

export function renderLoopTimecards(viewModel: MonitorViewModel): string {
  const latestKey = viewModel.current.latestRun?.key;
  const currentLoops = latestKey
    ? viewModel.current.currentLoops.filter((loop) => loop.key !== latestKey)
    : [...viewModel.current.currentLoops];

  return `
    <section class="panel-block" id="loop-timecards">
      <div class="section-heading section-heading-top">
        <div>
          <div class="panel-kicker">Loop Timecards</div>
          <h2>Current and historical loop execution</h2>
        </div>
        <div class="section-caption">Current loop detail stays visible. Historical ledger stays collapsed until opened.</div>
      </div>
      ${renderLoopList('Current loops', currentLoops, viewModel.spend.currency, 'No other current loops right now.', 'current-loop-timecards')}
      <details class="historical-ledger" id="historical-ledger">
        <summary>
          <span class="summary-title">Historical Ledger</span>
          <span class="summary-caption">${escapeHtml(formatNumber(viewModel.historical.loopCount))} loops · ${escapeHtml(formatNumber(viewModel.historical.riskCount))} risks</span>
        </summary>
        <div class="historical-body">
          <div class="historical-metrics">
            <div class="mini-metric"><span>Readiness</span><strong>${escapeHtml(formatNumber(viewModel.historical.readiness.score))}/100</strong></div>
            <div class="mini-metric"><span>Events</span><strong>${escapeHtml(formatNumber(viewModel.historical.eventCount))}</strong></div>
            <div class="mini-metric"><span>Cost</span><strong>${escapeHtml(formatCurrency(viewModel.spend.totalLedgerCost, viewModel.spend.currency))}</strong></div>
          </div>
          ${renderLoopList('Historical loops', viewModel.historical.loops, viewModel.spend.currency, 'No historical loops yet.', 'historical-loop-timecards')}
        </div>
      </details>
    </section>
  `;
}
