import type { MonitorViewModel } from '../../viewModel';

export function renderOperatorSummaryPanel(viewModel: MonitorViewModel): string {
  const oc = viewModel.operatorConsole;
  if (!oc) {
    return `<!-- operatorConsole not available -->`;
  }

  const statusLabel = oc.status.toUpperCase();
  const reason = oc.reason ? `<div class="panel-subtle">${escapeHtml(oc.reason)}</div>` : '';

  const counts = `
    <div class="kpi-grid">
      <div class="kpi-card"><div class="kpi-title">Agents</div><div class="kpi-value">${oc.summary.activeAgents}</div></div>
      <div class="kpi-card"><div class="kpi-title">Active loops</div><div class="kpi-value">${oc.summary.activeLoops}</div></div>
      <div class="kpi-card"><div class="kpi-title">Pending approvals</div><div class="kpi-value">${oc.summary.unresolvedApprovals}</div></div>
      <div class="kpi-card"><div class="kpi-title">Open risks</div><div class="kpi-value">${oc.summary.openRisks}</div></div>
    </div>
  `;

  const queue = oc.attentionQueue.slice(0, 8).map((it) => {
    return `<li class="queue-item queue-${escapeHtml(it.priority)}"><strong>${escapeHtml(it.title)}</strong><div class="queue-summary">${escapeHtml(it.summary)}</div></li>`;
  }).join('');

  const recommended = oc.recommendedAction ? `<div class="panel-cta">Recommended: ${escapeHtml(oc.recommendedAction)}</div>` : '';

  return `
    <section class="panel-block">
      <div class="panel-kicker">Operator Console</div>
      <h3>SafeLoop status: <span class="status-label status-${escapeHtml(oc.status)}">${statusLabel}</span></h3>
      ${reason}
      ${counts}
      ${recommended}
      <h4>Human attention queue</h4>
      <ul class="attention-queue">${queue}</ul>
    </section>
  `;
}

function escapeHtml(input: unknown): string {
  const s = typeof input === 'string' ? input : String(input ?? '');
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
