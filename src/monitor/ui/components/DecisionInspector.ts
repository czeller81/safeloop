import type { ArtifactItem, MonitorViewModel } from '../../viewModel';
import { escapeHtml, formatTimestamp } from '../lib/formatters';

function inspectorList(
  title: string,
  items: Array<{ summary: string; status?: string; severity?: string; timestamp?: string; path?: string }>,
  empty: string,
): string {
  return `
    <section class="inspector-section inspector-section--summary">
      <div class="inspector-section-title">${escapeHtml(title)}</div>
      <div class="inspector-list">
        ${items.length ? items.slice(0, 3).map((item) => `
          <div class="inspector-list-item">
            <strong>${escapeHtml(item.summary || item.path || 'Untitled')}</strong>
            <span>${escapeHtml(item.status || item.severity || item.path || (item.timestamp ? formatTimestamp(item.timestamp) : 'recorded'))}</span>
          </div>
        `).join('') : `<div class="inspector-empty">${escapeHtml(empty)}</div>`}
      </div>
    </section>
  `;
}

export function renderDecisionInspector(viewModel: MonitorViewModel): string {
  const needsReview = viewModel.current.approvals.filter((approval) => approval.status === 'pending');
  const unresolvedRisks = viewModel.current.risks;
  const latestEvidence: ArtifactItem[] = [...viewModel.current.artifacts, ...viewModel.historical.artifacts].slice(0, 3);
  const latestDecision = viewModel.liveActivity?.latestDecisions.slice(0, 1) ?? [];

  return `
    <aside class="decision-inspector" id="decision-inspector" aria-label="Decision Inspector">
      <div class="inspector-panel">
        <div class="inspector-header inspector-header--empty">
          <div>
            <div class="panel-kicker">Decision Inspector</div>
            <h2>Decision path</h2>
          </div>
        </div>
        <p class="inspector-hint">Select a trace to inspect the decision path.</p>
        ${inspectorList('Needs Review', needsReview, 'No pending human review')}
        ${inspectorList('Unresolved Risks', unresolvedRisks, 'No unresolved risks')}
        ${inspectorList('Latest Decision', latestDecision, 'No decisions recorded yet')}
        ${inspectorList('Latest Evidence', latestEvidence, 'No evidence recorded yet')}
      </div>
    </aside>
  `;
}
