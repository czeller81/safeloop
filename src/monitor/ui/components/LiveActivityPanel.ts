import type { MonitorViewModel, SectionItem, HandoffDetail, TokenCostPulse } from '../../viewModel';
import { escapeHtml, formatCompact, formatTimestamp } from '../lib/formatters';

export function renderLiveActivityPanel(viewModel: MonitorViewModel): string {
  const live = (viewModel as any).liveActivity as {
    activeAgents: string[];
    recentActivity: SectionItem[];
    handoffFlow: HandoffDetail[];
    tokenCostPulse?: TokenCostPulse;
  } | undefined;

  if (!live) {
    return `
      <section class="live-activity-panel">
        <h2>Live Activity</h2>
        <div class="muted">Live activity not available.</div>
      </section>
    `;
  }

  const agentsHtml = live.activeAgents && live.activeAgents.length
    ? `<div class="agent-list">${live.activeAgents.map((a: string) => `<span class="agent-pill">${escapeHtml(a)}</span>`).join('')}</div>`
    : '<div class="muted">No active agents</div>';

  const recent = (live.recentActivity || []).slice(0, 12).map((it: SectionItem) => `
    <li class="activity-item">
      <div class="act-ts">${escapeHtml(formatTimestamp(it.timestamp))}</div>
      <div class="act-body"><strong>${escapeHtml(it.agent || 'Unknown')}</strong>  ${escapeHtml(it.summary)}</div>
    </li>
  `).join('');

  const handoff = (live.handoffFlow || []).slice(0, 10).map((h: HandoffDetail) => `
    <li class="handoff-item">
      <div class="handoff-ts">${escapeHtml(formatTimestamp(h.timestamp || ''))}</div>
      <div class="handoff-body">${escapeHtml((h.fromAgent || 'unknown'))}  ${escapeHtml((h.toAgent || 'unknown'))} <em>${escapeHtml(h.summary || '')}</em></div>
    </li>
  `).join('');

  const tokenPulse = live.tokenCostPulse || { recentTokenTotal: 0, recentCostTotal: 0, topCostAgent: '', topCostTask: '', costTrend: 'unknown' };

  return `
    <section class="live-activity-panel" id="live-activity">
      <h2>Live Activity</h2>
      <div class="live-grid">
        <div class="panel-block agents">
          <h3>Active Agents</h3>
          ${agentsHtml}
        </div>
        <div class="panel-block activity">
          <h3>Recent Activity</h3>
          <ul class="recent-activity">${recent}</ul>
        </div>
        <div class="panel-block handoffs">
          <h3>Handoff Flow</h3>
          <ul class="handoff-flow">${handoff}</ul>
        </div>
        <div class="panel-block tokens">
          <h3>Token-Cost Pulse</h3>
          <div>Tokens (last 60m): <strong>${escapeHtml(formatCompact(tokenPulse.recentTokenTotal))}</strong></div>
          <div>Cost (last 60m): <strong>${escapeHtml(String(tokenPulse.recentCostTotal.toFixed ? tokenPulse.recentCostTotal.toFixed(4) : tokenPulse.recentCostTotal))}</strong></div>
          <div>Top agent: <strong>${escapeHtml(tokenPulse.topCostAgent || '\u2014')}</strong></div>
          <div>Cost trend: <strong>${escapeHtml(tokenPulse.costTrend)}</strong></div>
        </div>
      </div>
    </section>
  `;
}
