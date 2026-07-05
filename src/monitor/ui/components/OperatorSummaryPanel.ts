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
    return `
      <li class="queue-item queue-${escapeHtml(it.priority)}">
        <div class="queue-head"><strong>${escapeHtml(it.title)}</strong> ${stateLabel}</div>
        <div class="queue-summary">${escapeHtml(it.summary)}</div>
        <div class="queue-actions">
          <button class="sl-btn sl-btn--subtle" data-action="acknowledged" data-target-id="${escapeHtml(it.id)}">Acknowledge</button>
          <button class="sl-btn sl-btn--subtle" data-action="reviewed" data-target-id="${escapeHtml(it.id)}">Mark reviewed</button>
          <button class="sl-btn sl-btn--primary" data-action="resolved" data-target-id="${escapeHtml(it.id)}">Resolve</button>
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
      <script>
        (function(){
          function postAction(action,targetId){
            return fetch('/api/operator/actions',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({action,targetId})});
          }
          document.querySelectorAll('.sl-btn[data-action]').forEach(function(b){
            b.addEventListener('click',function(){
              var act = b.getAttribute('data-action');
              var id = b.getAttribute('data-target-id');
              if(!act||!id) return;
              b.disabled = true;
              var refresher = window.safeloopRefresh;
              postAction(act,id).then(function(){
                if (typeof refresher === 'function') {
                  try { refresher(); } catch (e) { window.location.reload(); }
                } else {
                  window.location.reload();
                }
              }).catch(function(){ b.disabled = false; });
            });
          });
        })();
      </script>
    </section>
  `;
}

function escapeHtml(input: unknown): string {
  const s = typeof input === 'string' ? input : String(input ?? '');
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
