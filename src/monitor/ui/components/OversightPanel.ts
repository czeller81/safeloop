import type { MonitorViewModel } from '../../viewModel';
import { escapeHtml, formatNumber } from '../lib/formatters';

function renderLoopChip(label: string, value: string): string {
  return `
    <article class="oversight-chip">
      <span>${escapeHtml(label)}</span>
      <strong>${escapeHtml(value)}</strong>
    </article>
  `;
}

function renderLoopList(title: string, loops: Array<{ key: string; taskName: string; oversightScore: number; oversightLevel: string; recommendedAction: string; status: string }>, emptyMessage: string): string {
  return `
    <div class="oversight-list-group">
      <div class="section-heading">
        <h3>${escapeHtml(title)}</h3>
        <span>${escapeHtml(formatNumber(loops.length))}</span>
      </div>
      <div class="oversight-list">
        ${loops.length
          ? loops.map((loop) => `
            <article class="oversight-loop-card">
              <div class="oversight-loop-top">
                <strong>${escapeHtml(loop.taskName)}</strong>
                <span class="oversight-level ${escapeHtml(loop.oversightLevel)}">${escapeHtml(loop.oversightLevel)}</span>
              </div>
              <div class="oversight-loop-meta">Score ${escapeHtml(formatNumber(loop.oversightScore))}/100 · ${escapeHtml(loop.recommendedAction)} · ${escapeHtml(loop.status)}</div>
            </article>
          `).join('')
          : `<div class="empty-state">${escapeHtml(emptyMessage)}</div>`}
      </div>
    </div>
  `;
}

export function renderOversightPanel(viewModel: MonitorViewModel): string {
  const latest = viewModel.oversight.latestLoop ?? viewModel.current.latestRun;
  const summary = viewModel.oversight.summary;
  const needsReviewLoops = [...viewModel.oversight.loopTimecards]
    .filter((loop) => loop.oversightLevel !== 'healthy')
    .sort((a, b) => a.oversightScore - b.oversightScore)
    .slice(0, 5);
  const staleLoops = [...viewModel.oversight.loopTimecards]
    .filter((loop) => loop.status === 'stale')
    .slice(0, 5);

  return `
    <section class="panel-block" id="oversight-intelligence">
      <div class="section-heading section-heading-top">
        <div>
          <div class="panel-kicker">Oversight Intelligence</div>
          <h2>Proactive loop analysis</h2>
        </div>
        <div class="section-caption">Compact signals only. Raw loop data stays in the timecards and API payload.</div>
      </div>
      <div class="oversight-summary-grid">
        ${renderLoopChip('Latest score', `${formatNumber(summary.oversightScore)}/100`)}
        ${renderLoopChip('Recommended action', summary.recommendedAction)}
        ${renderLoopChip('Warnings / anomalies', `${formatNumber(summary.warningCount)} / ${formatNumber(summary.anomalyCount)}`)}
        ${renderLoopChip('Explainability coverage', `${formatNumber(summary.explainability.explanationCoveragePercent)}%`)}
        ${renderLoopChip('Feedback', `${formatNumber(summary.feedback.feedbackCount)} items · avg ${summary.feedback.averageScore === null ? 'n/a' : formatNumber(summary.feedback.averageScore, 1)}`)}
        ${renderLoopChip('Stale loops', `${formatNumber(summary.staleLoopCount)}`)}
      </div>
      <div class="oversight-highlight">
        <div class="section-heading">
          <h3>Latest loop</h3>
        </div>
        ${latest ? `
          <article class="oversight-latest-card">
            <div class="oversight-latest-top">
              <strong>${escapeHtml(latest.taskName)}</strong>
              <span class="oversight-level ${escapeHtml(latest.oversightLevel)}">${escapeHtml(latest.oversightLevel)}</span>
            </div>
            <div class="oversight-latest-meta">
              Score ${escapeHtml(formatNumber(latest.oversightScore))}/100 · ${escapeHtml(latest.recommendedAction)} · ${escapeHtml(latest.status)}
            </div>
          </article>
        ` : '<div class="empty-state">No active loop yet.</div>'}
      </div>
      <div class="oversight-grid">
        ${renderLoopList('Top 5 needs-review loops', needsReviewLoops, 'No loops currently need review.')}
        ${renderLoopList('Stale loops', staleLoops, 'No stale loops right now.')}
      </div>
    </section>
  `;
}
