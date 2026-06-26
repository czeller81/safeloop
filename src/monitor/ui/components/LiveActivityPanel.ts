import type { MonitorViewModel, SectionItem, HandoffDetail, TokenCostPulse, AgentStatus } from '../../viewModel';
import { escapeHtml, formatCompact, formatTimestamp } from '../lib/formatters';

export function renderLiveActivityPanel(viewModel: MonitorViewModel): string {
  const live = (viewModel as any).liveActivity as {
    activeAgents: string[];
    recentActivity: SectionItem[];
    handoffFlow: HandoffDetail[];
    tokenCostPulse?: TokenCostPulse;
    agentStatuses?: Record<string, AgentStatus>;
  } | undefined;

  if (!live) {
    return `
      <section class="live-activity-panel">
        <h2>Live Activity</h2>
        <div class="muted">Live activity not available.</div>
      </section>
    `;
  }

  // Session-awareness cues (from viewModel)
  const currentSessionId = (viewModel as any).liveActivity?.currentSessionId;
  const historicalHiddenCount = (viewModel as any).liveActivity?.historicalHiddenCount ?? 0;
  const hasCurrentSession = (viewModel as any).liveActivity?.hasCurrentSession ?? false;
  let sessionCueHtml = '';
  if (hasCurrentSession) {
    sessionCueHtml = `<div class="live-session-cue"><strong>Current session active</strong>${currentSessionId ? `: ${escapeHtml(String(currentSessionId))}` : ''} &mdash; <span class="muted">${escapeHtml(String(historicalHiddenCount))} historical events hidden</span></div>`;
  } else if ((viewModel.historical?.loopCount ?? 0) > 0) {
    sessionCueHtml = `<div class="live-session-cue muted">No current session activity. Historical ledger available below.</div>`;
  }

  // Render agent cards using agentStatuses when available to avoid name concatenation
  let agentsHtml = '';
  const agentStatuses = (live as any).agentStatuses as Record<string, AgentStatus> | undefined;
  if (agentStatuses && Object.keys(agentStatuses).length > 0) {
    agentsHtml = '<div class="agent-list">' +
      Object.keys(agentStatuses).map((agent) => {
        const s = agentStatuses[agent];
        return (`
          <div class="agent-card">
            <div class="agent-name">${escapeHtml(s.agent || agent)}</div>
            <div class="agent-meta">
              <span class="agent-status status-${escapeHtml(String(s.status))}">${escapeHtml(String(s.status))}</span>
              ${s.lastEventTimestamp ? `<span class="agent-last">${escapeHtml(formatTimestamp(s.lastEventTimestamp))}</span>` : ''}
            </div>
            <div class="agent-details">${escapeHtml(String(s.details || ''))}</div>
          </div>
        `);
      }).join('') +
      '</div>';
  } else if (live.activeAgents && live.activeAgents.length) {
    agentsHtml = `<div class="agent-list">${live.activeAgents.map((a: string) => `<span class="agent-pill">${escapeHtml(a)}</span>`).join(' ')}</div>`;
  } else {
    agentsHtml = '<div class="muted">No active agents</div>';
  }

  const recent = (live.recentActivity || []).slice(0, 12).map((it: SectionItem) => `
    <li class="activity-item">
      <div class="act-ts">${escapeHtml(formatTimestamp(it.timestamp))}</div>
      <div class="act-body"><strong>${escapeHtml(it.agent || 'Unknown')}</strong>  ${escapeHtml(it.summary)}</div>
    </li>
  `).join('');

  // Build handoff flow grouped by caseId and render a lightweight chain
  const handoffsByCase = (live.handoffFlow || []).reduce((acc: Record<string, HandoffDetail[]>, h) => {
    const k = h.caseId || 'case-unknown';
    const list = acc[k] ?? [];
    list.push(h);
    acc[k] = list;
    return acc;
  }, {} as Record<string, HandoffDetail[]>);

  const handoffHtml = Object.keys(handoffsByCase).slice(0, 8).map((caseId) => {
    const events = (handoffsByCase[caseId] || []).slice().sort((a,b)=> (new Date(a.timestamp||'').getTime() - new Date(b.timestamp||'').getTime()));
    // derive ordered node list
    const nodes: string[] = [];
    for (const ev of events) {
      const evAny: any = ev;
      const from = evAny.fromAgent || evAny.from || evAny.fromAgentId || 'unknown';
      const to = evAny.toAgent || evAny.to || evAny.toAgentId || 'unknown';
      if (!nodes.length) nodes.push(from);
      if (nodes[nodes.length-1] !== from) nodes.push(from);
      if (nodes[nodes.length-1] !== to) nodes.push(to);
    }
    const chain = nodes.map(n => `<span class="handoff-node">${escapeHtml(n)}</span>`).join(' <span class="handoff-arrow">\u2192</span> ');
    const edgeDetails = events.map(e => `<div class="handoff-edge">${escapeHtml(formatTimestamp(e.timestamp||''))} \u2014 ${escapeHtml(e.summary||'')}</div>`).join('');
    return `
      <div class="handoff-case">
        <div class="handoff-chain">${chain}</div>
        <div class="handoff-edges">${edgeDetails}</div>
      </div>
    `;
  }).join('') || '<div class="muted">No handoffs</div>';

  // Token cost pulse: prefer explicit telemetry when available
  const tokenRecords = viewModel.tokens?.records ?? [];
  const tokenPulse = live.tokenCostPulse || { recentTokenTotal: 0, recentCostTotal: 0, topCostAgent: '', topCostTask: '', costTrend: 'unknown' };
  const tokensHtml = (tokenRecords.length === 0)
    ? '<div class="muted">No token-cost events emitted yet. Emit token.cost / model.usage events to populate spend by agent/model/task.</div>'
    : `
      <div>Tokens (last 60m): <strong>${escapeHtml(formatCompact(tokenPulse.recentTokenTotal))}</strong></div>
      <div>Cost (last 60m): <strong>${escapeHtml(String(tokenPulse.recentCostTotal.toFixed ? tokenPulse.recentCostTotal.toFixed(4) : tokenPulse.recentCostTotal))}</strong></div>
      <div>Top agent: <strong>${escapeHtml(tokenPulse.topCostAgent || '\u2014')}</strong></div>
      <div>Cost trend: <strong>${escapeHtml(tokenPulse.costTrend)}</strong></div>
    `;

  return `
    <section class="live-activity-panel" id="live-activity">
      <h2>Live Activity</h2>
      ${sessionCueHtml}
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
          <div class="handoff-flow">${handoffHtml}</div>
        </div>
        <div class="panel-block tokens">
          <h3>Token-Cost Pulse</h3>
          ${tokensHtml}
        </div>
      </div>
    </section>
  `;
}
