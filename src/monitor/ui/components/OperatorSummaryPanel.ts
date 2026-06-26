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
    const stateLabel = it.state ? `<span class="state state-${escapeHtml(it.state)}">${escapeHtml(it.state)}</span>` : '';
    return `
      <li class="queue-item queue-${escapeHtml(it.priority)}">
        <div class="queue-head"><strong>${escapeHtml(it.title)}</strong> ${stateLabel}</div>
        <div class="queue-summary">${escapeHtml(it.summary)}</div>
        <div class="queue-actions">
          <button class="operator-action-btn" data-action="acknowledged" data-target-id="${escapeHtml(it.id)}">Acknowledge</button>
          <button class="operator-action-btn" data-action="reviewed" data-target-id="${escapeHtml(it.id)}">Mark reviewed</button>
          <button class="operator-action-btn" data-action="resolved" data-target-id="${escapeHtml(it.id)}">Resolve</button>
        </div>
      </li>`;
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
      <script>
        (function(){
          function postAction(action,targetId){
            return fetch('/api/operator/actions',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({action,targetId})});
          }
          document.querySelectorAll('.operator-action-btn').forEach(function(b){
            b.addEventListener('click',function(){
              var act = b.getAttribute('data-action');
              var id = b.getAttribute('data-target-id');
              if(!act||!id) return;
              b.disabled = true;
-              postAction(act,id).then(function(){ window.location.reload(); }).catch(function(){ b.disabled = false; });
+              var refresher = (window as any).safeloopRefresh;
+              postAction(act,id).then(function(){
+                if (typeof refresher === 'function') {
+                  try { refresher(); } catch (e) { window.location.reload(); }
+                } else {
+                  window.location.reload();
+                }
+              }).catch(function(){ b.disabled = false; });
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
