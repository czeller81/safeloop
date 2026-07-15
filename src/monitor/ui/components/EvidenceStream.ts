import type { ApprovalItem, ArtifactItem, MonitorViewModel, RiskItem, SectionItem } from '../../viewModel';
import { escapeHtml, formatCompact, formatCostOrUnavailable, formatTimestamp } from '../lib/formatters';

type Tone = 'neutral' | 'healthy' | 'warning' | 'danger' | 'approval' | 'trace' | 'evidence';

interface TraceRow {
  id: string;
  timestamp: string;
  agent: string;
  caseId?: string;
  sessionId?: string;
  task?: string;
  eventType: string;
  summary: string;
  decision: string;
  risk: string;
  approval: string;
  evidence: string;
  cost: string;
  usage?: {
    provider?: string;
    model?: string;
    inputTokens?: number;
    outputTokens?: number;
    totalTokens?: number;
    estimatedCost?: number;
    pricingAvailable?: boolean;
  };
  status: string;
  tone: Tone;
  raw: Record<string, unknown>;
}

function eventGroup(eventType: string): string {
  if (eventType.startsWith('approval.')) return 'approval';
  if (eventType.startsWith('decision.') || eventType === 'steering.applied') return 'decision';
  if (eventType === 'risk.detected') return 'risk';
  if (eventType === 'artifact.changed' || eventType === 'report.generated' || eventType === 'test.completed') return 'evidence';
  if (eventType === 'token.cost' || eventType === 'model.usage') return 'cost';
  if (eventType === 'handoff.created') return 'handoff';
  if (eventType.startsWith('task.')) return 'task';
  return 'event';
}

function toneFor(row: TraceRow): Tone {
  if (row.status === 'blocked' || row.risk === 'high') return 'danger';
  if (row.approval !== 'none' && row.approval !== 'approved') return 'approval';
  if (row.risk !== 'none') return 'warning';
  if (row.evidence !== 'none') return 'evidence';
  if (row.decision === 'allow' || row.status === 'completed') return 'healthy';
  return 'trace';
}

function decisionFor(item: SectionItem): string {
  switch (item.eventType) {
    case 'decision.made':
    case 'decision.explained':
      return 'recorded';
    case 'approval.requested':
      return 'review';
    case 'approval.resolved':
      return 'resolved';
    case 'task.completed':
      return 'complete';
    default:
      return '-';
  }
}

function statusFor(item: SectionItem): string {
  switch (item.eventType) {
    case 'task.started':
      return 'running';
    case 'task.completed':
      return 'completed';
    case 'approval.requested':
      return 'waiting';
    case 'approval.resolved':
      return 'approved';
    case 'risk.detected':
      return 'warning';
    default:
      return 'recorded';
  }
}

function findById<T extends { id: string }>(items: T[], id: string): T | undefined {
  return items.find((item) => item.id === id);
}

function latestTokenCost(viewModel: MonitorViewModel, item: SectionItem): string {
  if (item.eventType !== 'token.cost' && item.eventType !== 'model.usage') return '-';
  const record = viewModel.tokens.records.find((entry) => {
    return entry.timestamp === item.timestamp || entry.caseId === item.caseId;
  });
  if (!record) return formatCompact(viewModel.liveActivity?.tokenCostPulse.recentTokenTotal ?? 0);
  const tokenLabel = formatCompact(record.totalTokens);
  const costLabel = formatCostOrUnavailable(record.estimatedCost, record.pricingAvailable ?? false, viewModel.spend.currency);
  return `${tokenLabel} / ${costLabel}`;
}

function latestTokenUsage(viewModel: MonitorViewModel, item: SectionItem): TraceRow['usage'] | undefined {
  if (item.eventType !== 'token.cost' && item.eventType !== 'model.usage') return undefined;
  const record = viewModel.tokens.records.find((entry) => {
    return entry.timestamp === item.timestamp || entry.caseId === item.caseId;
  });
  if (!record) return undefined;
  return {
    provider: record.provider,
    model: record.model,
    inputTokens: record.inputTokens,
    outputTokens: record.outputTokens,
    totalTokens: record.totalTokens,
    estimatedCost: record.estimatedCost,
    pricingAvailable: record.pricingAvailable,
  };
}

function buildTraceRows(viewModel: MonitorViewModel): TraceRow[] {
  const live = viewModel.liveActivity;
  const approvals = [...viewModel.current.approvals, ...viewModel.historical.approvals];
  const risks = [...viewModel.current.risks, ...viewModel.historical.risks];
  const artifacts = [...viewModel.current.artifacts, ...viewModel.historical.artifacts];
  const items = live?.recentActivity ?? [];

  return items.slice(0, 80).map((item) => {
    const approval = findById<ApprovalItem>(approvals, item.id);
    const risk = findById<RiskItem>(risks, item.id);
    const artifact = findById<ArtifactItem>(artifacts, item.id);
    const row: TraceRow = {
      id: item.id,
      timestamp: item.timestamp,
      agent: item.agent || item.agentId || 'System',
      caseId: item.caseId,
      sessionId: item.loopKey,
      eventType: item.eventType || 'event',
      summary: item.summary,
      decision: decisionFor(item),
      risk: risk?.severity || (item.eventType === 'risk.detected' ? 'medium' : 'none'),
      approval: approval?.status || (item.eventType === 'approval.requested' ? 'pending' : 'none'),
      evidence: artifact?.path || (item.eventType === 'artifact.changed' ? 'artifact' : 'none'),
      cost: latestTokenCost(viewModel, item),
      usage: latestTokenUsage(viewModel, item),
      status: approval?.status || statusFor(item),
      tone: 'neutral',
      raw: {
        id: item.id,
        type: item.eventType || 'event',
        timestamp: item.timestamp,
        agent: item.agent || item.agentId || 'System',
        caseId: item.caseId ?? null,
        loopKey: item.loopKey ?? null,
        summary: item.summary,
        decision: decisionFor(item),
        status: approval?.status || statusFor(item),
        risk: risk ?? null,
        approval: approval ?? null,
        evidence: artifact ?? null,
        cost: latestTokenCost(viewModel, item),
        usage: latestTokenUsage(viewModel, item) ?? null,
      },
    };
    row.tone = toneFor(row);
    return row;
  });
}

function renderFilterChips(rows: TraceRow[]): string {
  const groups = new Map<string, number>();
  for (const row of rows) {
    const group = eventGroup(row.eventType);
    groups.set(group, (groups.get(group) ?? 0) + 1);
  }
  const chips = Array.from(groups.entries())
    .sort((a, b) => b[1] - a[1])
    .map(([group, count]) => `
      <button type="button" class="trace-filter-chip" data-trace-filter="${escapeHtml(group)}">
        ${escapeHtml(group)} <span>${escapeHtml(String(count))}</span>
      </button>
    `)
    .join('');
  return `
    <div class="trace-filter-bar">
      <button type="button" class="trace-filter-chip trace-filter-chip--active" data-trace-filter="all">all <span>${escapeHtml(String(rows.length))}</span></button>
      ${chips}
    </div>
  `;
}

function renderBadge(value: string, tone: Tone | string): string {
  return `<span class="trace-badge trace-badge--${escapeHtml(tone)}">${escapeHtml(value)}</span>`;
}

function renderTraceValue(value: string, tone: Tone | string): string {
  if (value === 'none' || value === '-') {
    return `<span class="trace-muted-value">${escapeHtml(value)}</span>`;
  }
  return renderBadge(value, tone);
}

function renderTraceRow(row: TraceRow, index: number): string {
  const payload = JSON.stringify(row.raw);
  const caseLabel = [row.caseId, row.sessionId].filter(Boolean).join(' / ') || '-';
  return `
    <button
      type="button"
      class="trace-row trace-row--${escapeHtml(row.tone)}${index === 0 ? ' trace-row--latest' : ''}"
      data-trace-group="${escapeHtml(eventGroup(row.eventType))}"
      data-trace-id="${escapeHtml(row.id)}"
      data-trace-payload="${escapeHtml(payload)}"
    >
      <span class="trace-time">${escapeHtml(formatTimestamp(row.timestamp))}</span>
      <span class="trace-agent">${escapeHtml(row.agent)}</span>
      <span class="trace-case">${escapeHtml(caseLabel)}</span>
      <span class="trace-event">
        ${renderBadge(row.eventType, eventGroup(row.eventType))}
        <small>${escapeHtml(row.summary || 'event recorded')}</small>
      </span>
      <span class="trace-decision">${escapeHtml(row.decision)}</span>
      <span class="trace-risk">${renderTraceValue(row.risk, row.risk === 'high' ? 'danger' : 'warning')}</span>
      <span class="trace-approval">${renderTraceValue(row.approval, row.approval === 'pending' ? 'approval' : row.approval === 'rejected' ? 'danger' : 'neutral')}</span>
      <span class="trace-evidence">${escapeHtml(row.evidence)}</span>
      <span class="trace-cost">${escapeHtml(row.cost)}</span>
      <span class="trace-status">${renderTraceValue(row.status, row.tone)}</span>
    </button>
  `;
}

export function renderEvidenceStream(viewModel: MonitorViewModel): string {
  const live = viewModel.liveActivity;
  const rows = buildTraceRows(viewModel);
  const isHistoricalOnly = live?.isHistoricalOnly ?? false;
  const hasCurrentSession = live?.hasCurrentSession ?? false;

  let cue = '';
  if (isHistoricalOnly) {
    cue = '<span class="trace-cue trace-cue--historical">Historical ledger</span>';
  } else if (hasCurrentSession) {
    cue = '<span class="trace-cue trace-cue--live">Live local session</span>';
  }

  if (rows.length === 0) {
    return `
      <section class="trace-console" id="trace-console">
        <div class="trace-console-header">
          <div>
            <div class="panel-kicker">Trace Console</div>
            <h2>Waiting for local SafeLoop events</h2>
            <p>Agent actions, SafeLoop decisions, human gates, and evidence will appear here.</p>
          </div>
          ${cue}
        </div>
        <div class="trace-empty">Events will appear here as agents act, SafeLoop decides, humans approve, and evidence is recorded.</div>
      </section>
    `;
  }

  return `
    <section class="trace-console${isHistoricalOnly ? ' trace-console--historical' : ''}" id="trace-console">
      <div class="trace-console-header">
        <div>
          <div class="panel-kicker">Trace Console</div>
          <h2>Trace Console</h2>
          <p>Inspect what the agent attempted, how SafeLoop responded, and what evidence was produced.</p>
        </div>
        <div class="trace-console-meta">
          ${cue}
          <span>${escapeHtml(String(rows.length))} visible traces</span>
        </div>
      </div>
      ${renderFilterChips(rows)}
      <div class="trace-table" data-scroll-key="trace-table">
        <div class="trace-table-head" aria-hidden="true">
          <span>Time</span>
          <span>Agent</span>
          <span>Case</span>
          <span>Event</span>
          <span>Decision</span>
          <span>Risk</span>
          <span>Approval</span>
          <span>Evidence</span>
          <span>Cost</span>
          <span>Status</span>
        </div>
        <div class="trace-table-body">
          ${rows.map(renderTraceRow).join('')}
        </div>
      </div>
    </section>
  `;
}
