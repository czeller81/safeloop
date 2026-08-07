import type { MonitorViewModel } from '../../viewModel';
import { escapeHtml, formatNumber } from '../lib/formatters';

type StoryTone = 'idle' | 'active' | 'healthy' | 'warning' | 'blocked' | 'approval' | 'evidence';

interface StoryStage {
  id: string;
  label: string;
  count: number;
  tone: StoryTone;
  detail: string;
}

function decisionTone(viewModel: MonitorViewModel): StoryTone {
  if (viewModel.current.risks.some((risk) => risk.severity === 'high')) return 'blocked';
  if (viewModel.current.risks.length > 0 || viewModel.oversight.summary.warningCount > 0) return 'warning';
  if ((viewModel.liveActivity?.latestDecisions.length ?? 0) > 0) return 'healthy';
  return 'idle';
}

function buildStages(viewModel: MonitorViewModel): StoryStage[] {
  const live = viewModel.liveActivity;
  const eventCount = viewModel.status.eventCount;
  const decisionCount = live?.latestDecisions.length ?? 0;
  const pendingApprovals = viewModel.current.approvals.filter((approval) => approval.status === 'pending').length;
  const totalApprovals = viewModel.current.approvals.length + viewModel.historical.approvals.length;
  const artifactCount = viewModel.current.artifacts.length + viewModel.historical.artifacts.length;
  const stoppedCount = (live?.recentActivity ?? []).filter((item) => {
    const eventType = String(item.eventType ?? '').toLowerCase();
    const summary = String(item.summary ?? '').toLowerCase();
    const decision = String(item.metadata?.decision ?? '').toLowerCase();
    const status = String(item.metadata?.status ?? '').toLowerCase();
    return eventType.includes('blocked') || summary.includes('blocked') || decision === 'deny' || status === 'blocked';
  }).length;

  return [
    {
      id: 'observe',
      label: 'Observe',
      count: eventCount,
      tone: eventCount > 0 ? 'active' : 'idle',
      detail: eventCount > 0 ? 'agent actions' : 'waiting for traces',
    },
    {
      id: 'decide',
      label: 'Decide',
      count: decisionCount,
      tone: decisionTone(viewModel),
      detail: decisionCount > 0 ? 'policy decisions' : 'no decision yet',
    },
    {
      id: 'stop',
      label: 'Stop',
      count: stoppedCount,
      tone: stoppedCount > 0 ? 'blocked' : 'idle',
      detail: stoppedCount > 0 ? 'blocked before execution' : 'no stopped commands',
    },
    {
      id: 'approve',
      label: 'Approve',
      count: pendingApprovals || totalApprovals,
      tone: pendingApprovals > 0 ? 'approval' : totalApprovals > 0 ? 'healthy' : 'idle',
      detail: pendingApprovals > 0 ? 'human review' : totalApprovals > 0 ? 'review recorded' : 'no human gate',
    },
    {
      id: 'prove',
      label: 'Prove',
      count: artifactCount,
      tone: artifactCount > 0 ? 'evidence' : 'idle',
      detail: artifactCount > 0 ? 'audit evidence' : 'no evidence yet',
    },
  ];
}

export function renderCircuitMapPlaceholder(viewModel: MonitorViewModel): string {
  const stages = buildStages(viewModel);
  return `
    <section class="governance-strip governance-strip--story" id="overview" aria-label="Observe Decide Approve Prove">
      <div class="governance-strip-header">
        <div>
          <div class="panel-kicker">Governance Path</div>
          <h2>Observe -> Decide -> Stop / Approve -> Prove</h2>
          <p>SafeLoop captures local agent work, routes risky actions through the guard, stops blocked commands, and records evidence.</p>
        </div>
        <span>${escapeHtml(formatNumber(viewModel.status.eventCount))} ledger events</span>
      </div>
      <div class="governance-strip-flow governance-strip-flow--story">
        <svg class="governance-strip-lines" viewBox="0 0 100 12" preserveAspectRatio="none" aria-hidden="true">
          <path class="governance-strip-line" d="M 4 6 L 96 6" />
        </svg>
        ${stages.map((stage, index) => `
          <div class="governance-strip-node governance-strip-node--${escapeHtml(stage.tone)}" data-node="${escapeHtml(stage.id)}">
            <span class="strip-index">${escapeHtml(String(index + 1).padStart(2, '0'))}</span>
            <strong><span class="strip-status-dot" aria-hidden="true"></span>${escapeHtml(stage.label)}</strong>
            <em>${escapeHtml(formatNumber(stage.count))}</em>
            <small>${escapeHtml(stage.detail)}</small>
          </div>
        `).join('')}
      </div>
    </section>
  `;
}
