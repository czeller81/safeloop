import type { MonitorViewModel } from '../../viewModel';
import { escapeHtml } from '../lib/formatters';

export function renderHandoffsCard(viewModel: MonitorViewModel): string {
  const handoffs = viewModel.current.handoffs || [];
  if (!handoffs.length) {
    return '';
  }

  const loops = viewModel.current.currentLoops || [];
  const artifacts = viewModel.current.artifacts || [];
  const approvals = viewModel.current.approvals || [];

  const rows = handoffs
    .map((h) => {
      const loop = loops.find((l) => l.caseId === h.caseId || l.taskName === h.summary || l.key === (h.loopKey as string));
      const artifactsCount = artifacts.filter((a) => a.caseId === h.caseId || a.loopKey === h.loopKey).length;
      const approval = approvals.find((a) => a.caseId === h.caseId || a.loopKey === h.loopKey);
      const status = loop?.status || (approval ? approval.status : 'unknown');
      const taskName = loop?.taskName || h.summary || '';

      return `
        <div class="handoff-row">
          <div class="handoff-flow">${escapeHtml(h.from || 'Unknown')} &rarr; ${escapeHtml(h.to || 'Unknown')}</div>
          <div class="handoff-meta">
            <div><strong>Task:</strong> ${escapeHtml(taskName)}</div>
            <div><strong>Case:</strong> ${escapeHtml(h.caseId || (loop && loop.caseId) || '')}</div>
            <div><strong>Status:</strong> ${escapeHtml(String(status))}</div>
            <div><strong>Artifacts:</strong> ${escapeHtml(String(artifactsCount))}</div>
            <div><strong>Approvals:</strong> ${escapeHtml(approval ? approval.status : (viewModel.current.latestRun ? viewModel.current.latestRun.approvalsStatus : 'none'))}</div>
            <div><strong>Summary:</strong> ${escapeHtml(String(h.summary || ''))}</div>
            <div class="handoff-ts">${escapeHtml(String(h.timestamp || ''))}</div>
          </div>
        </div>
      `;
    })
    .join('\n');

  return `
    <section class="panel-block handoffs-block" id="hand-offs">
      <div class="section-heading">
        <div>
          <div class="panel-kicker">Agent Handoffs</div>
          <h2>Handoffs</h2>
        </div>
        <div class="section-caption">Visible handoff flow and metadata</div>
      </div>
      <div class="handoffs-list">
        ${rows}
      </div>
    </section>
  `;
}
