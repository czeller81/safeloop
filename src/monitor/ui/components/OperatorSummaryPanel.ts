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

  const openQueue = oc.attentionQueue.filter((it) => (it.state ?? 'open') === 'open');
  const handledQueue = oc.attentionQueue.filter((it) => (it.state ?? 'open') !== 'open');
  const pendingApprovals = viewModel.current.approvals.filter((approval) => approval.status === 'pending');
  const resolvedApprovals = viewModel.current.approvals.filter((approval) => approval.status !== 'pending').slice(0, 4);
  const unresolvedRisks = viewModel.current.risks.slice(0, 4);

  const renderQueueItem = (it: typeof oc.attentionQueue[number]) => {
    const stateLabel = it.state ? `<span class="state state-${escapeHtml(it.state)}">${escapeHtml(it.state)}</span>` : '';
    const priorityLabel = it.priority ? `<span class="queue-meta-chip">${escapeHtml(it.priority)} priority</span>` : '';
    return `
      <li class="queue-item queue-${escapeHtml(it.priority)}">
        <div class="queue-head"><strong>${escapeHtml(it.title)}</strong> ${stateLabel}</div>
        <div class="queue-summary">${escapeHtml(it.summary)}</div>
        <div class="queue-meta">
          ${priorityLabel}
          <span class="queue-meta-note">Review state is recorded by SafeLoop events.</span>
        </div>
      </li>`;
  };

  const reviewGroups = `
    <div class="operator-review-grid">
      <div class="operator-review-group">
        <h4>Pending approvals</h4>
        ${pendingApprovals.length ? pendingApprovals.slice(0, 4).map((approval) => `
          <div class="operator-mini-item">
            <strong>${escapeHtml(approval.summary)}</strong>
            <span>${escapeHtml(approval.reason || approval.approver || 'Awaiting review')}</span>
          </div>
        `).join('') : '<div class="empty-state">No pending approvals.</div>'}
      </div>
      <div class="operator-review-group">
        <h4>Unresolved risks</h4>
        ${unresolvedRisks.length ? unresolvedRisks.map((risk) => `
          <div class="operator-mini-item operator-mini-item--risk">
            <strong>${escapeHtml(risk.summary)}</strong>
            <span>${escapeHtml(risk.mitigation || risk.severity || 'No mitigation recorded')}</span>
          </div>
        `).join('') : '<div class="empty-state">No current risks.</div>'}
      </div>
      <div class="operator-review-group">
        <h4>Recent resolved approvals</h4>
        ${resolvedApprovals.length ? resolvedApprovals.map((approval) => `
          <div class="operator-mini-item operator-mini-item--resolved">
            <strong>${escapeHtml(approval.summary)}</strong>
            <span>${escapeHtml(approval.status)}</span>
          </div>
        `).join('') : '<div class="empty-state">No resolved approvals yet.</div>'}
      </div>
      <div class="operator-review-group">
        <h4>Operator actions</h4>
        ${handledQueue.length ? handledQueue.slice(0, 4).map((item) => `
          <div class="operator-mini-item operator-mini-item--resolved">
            <strong>${escapeHtml(item.title)}</strong>
            <span>${escapeHtml(item.state || 'open')}${item.operatorNote ? `: ${escapeHtml(item.operatorNote)}` : ''}</span>
          </div>
        `).join('') : '<div class="empty-state">No acknowledged, reviewed, or resolved items.</div>'}
      </div>
    </div>
  `;

  const recommended = oc.recommendedAction ? `<div class="panel-cta">Recommended: ${escapeHtml(oc.recommendedAction)}</div>` : '';

  return `
    <section class="panel-block" id="operator-console">
      <div class="panel-kicker">Operator Console</div>
      <h3>SafeLoop status: <span class="status-label status-${escapeHtml(oc.status)}">${statusLabel}</span></h3>
      ${reason}
      ${counts}
      ${recommended}
      ${reviewGroups}
      <h4>Human attention queue</h4>
      <ul class="attention-queue">${openQueue.slice(0, 8).map(renderQueueItem).join('') || '<li class="empty-state">No open attention items.</li>'}</ul>
    </section>
  `;
}

function escapeHtml(input: unknown): string {
  const s = typeof input === 'string' ? input : String(input ?? '');
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
