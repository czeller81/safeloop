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
  outcome: string;
  execution: string;
  reason?: string;
  tone: Tone;
  raw: Record<string, unknown>;
}

interface ControlMetric {
  label: string;
  value: number;
  detail: string;
  tone: Tone;
}

function metadataFor(item: SectionItem): Record<string, unknown> {
  const metadata = (item as SectionItem & { metadata?: unknown }).metadata;
  return metadata && typeof metadata === 'object' && !Array.isArray(metadata) ? metadata as Record<string, unknown> : {};
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
  if (row.status === 'blocked' || row.risk === 'high' || row.outcome === 'Stopped' || row.decision === 'deny') return 'danger';
  if (row.outcome === 'Held for review') return 'approval';
  if (row.approval !== 'none' && row.approval !== 'approved') return 'approval';
  if (row.risk !== 'none') return 'warning';
  if (row.evidence !== 'none') return 'evidence';
  if (row.decision === 'allow' || row.status === 'completed') return 'healthy';
  return 'trace';
}

function decisionFor(item: SectionItem): string {
  const decision = String(metadataFor(item).decision ?? '').toLowerCase();
  if (decision === 'allow' || decision === 'allowed') return 'allow';
  if (decision === 'deny' || decision === 'blocked' || decision === 'block') return 'deny';
  if (decision === 'review' || decision === 'approval_required') return 'review';

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
  const metadataStatus = String(metadataFor(item).status ?? '').toLowerCase();
  if (metadataStatus) return metadataStatus;

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

function reasonFor(item: SectionItem): string | undefined {
  const metadata = metadataFor(item);
  const reason = metadata?.reason ?? metadata?.rationale ?? metadata?.policyReason ?? metadata?.matchedRule ?? metadata?.mitigation;
  return reason === undefined || reason === null || reason === '' ? undefined : String(reason);
}

function outcomeFor(item: SectionItem, decision: string, approval: string, risk: string): { label: string; execution: string } {
  const type = item.eventType || '';
  const summary = String(item.summary || '').toLowerCase();

  if (type === 'command.blocked' || type === 'preflight.blocked' || decision === 'deny' || summary.includes('blocked')) {
    return { label: 'Stopped', execution: 'not run' };
  }

  if (type === 'approval.requested' || type === 'preflight.approval_required' || approval === 'pending' || decision === 'review') {
    return { label: 'Held for review', execution: 'awaiting approval' };
  }

  if (type === 'command.allowed' || type === 'preflight.allowed' || decision === 'allow') {
    return { label: 'Allowed', execution: 'cleared to run' };
  }

  if (type === 'approval.resolved') {
    return { label: approval === 'rejected' ? 'Rejected' : 'Approved', execution: approval === 'rejected' ? 'not run' : 'approved' };
  }

  if (type === 'artifact.changed' || type === 'report.generated') {
    return { label: 'Proved', execution: 'evidence recorded' };
  }

  if (risk !== 'none') {
    return { label: 'Flagged', execution: 'risk recorded' };
  }

  return { label: 'Observed', execution: 'ledger record' };
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
    const decision = decisionFor(item);
    const riskLabel = risk?.severity || (item.eventType === 'risk.detected' ? 'medium' : 'none');
    const approvalLabel = approval?.status || (item.eventType === 'approval.requested' ? 'pending' : 'none');
    const outcome = outcomeFor(item, decision, approvalLabel, riskLabel);
    const row: TraceRow = {
      id: item.id,
      timestamp: item.timestamp,
      agent: item.agent || item.agentId || 'System',
      caseId: item.caseId,
      sessionId: item.loopKey,
      eventType: item.eventType || 'event',
      summary: item.summary,
      decision,
      risk: riskLabel,
      approval: approvalLabel,
      evidence: artifact?.path || (item.eventType === 'artifact.changed' ? 'artifact' : 'none'),
      cost: latestTokenCost(viewModel, item),
      usage: latestTokenUsage(viewModel, item),
      status: approval?.status || statusFor(item),
      outcome: outcome.label,
      execution: outcome.execution,
      reason: reasonFor(item),
      tone: 'neutral',
      raw: {
        id: item.id,
        type: item.eventType || 'event',
        timestamp: item.timestamp,
        agent: item.agent || item.agentId || 'System',
        caseId: item.caseId ?? null,
        loopKey: item.loopKey ?? null,
        summary: item.summary,
        decision,
        outcome: outcome.label,
        execution: outcome.execution,
        reason: reasonFor(item) ?? risk?.mitigation ?? approval?.reason ?? null,
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
  const proof = row.evidence === 'none' ? 'No evidence attached' : row.evidence;
  const approvalTone = row.approval === 'pending' ? 'approval' : row.approval === 'rejected' ? 'danger' : row.approval === 'approved' ? 'healthy' : 'neutral';
  return `
    <button
      type="button"
      class="trace-row trace-row--${escapeHtml(row.tone)}${index === 0 ? ' trace-row--latest' : ''}"
      data-trace-group="${escapeHtml(eventGroup(row.eventType))}"
      data-trace-id="${escapeHtml(row.id)}"
      data-trace-payload="${escapeHtml(payload)}"
    >
      <span class="trace-outcome-marker" aria-hidden="true"></span>
      <span class="trace-record-main">
        <span class="trace-record-topline">
          <span class="trace-time">${escapeHtml(formatTimestamp(row.timestamp))}</span>
          ${renderBadge(row.eventType, eventGroup(row.eventType))}
        </span>
        <strong>${escapeHtml(row.summary || 'event recorded')}</strong>
        <span class="trace-record-context">${escapeHtml(row.agent)} · ${escapeHtml(caseLabel)}</span>
      </span>
      <span class="trace-record-decision">
        <span class="trace-column-label">SafeLoop</span>
        ${renderBadge(row.outcome, row.tone)}
        <small>${escapeHtml(row.decision === '-' ? row.execution : `${row.decision} · ${row.execution}`)}</small>
      </span>
      <span class="trace-record-review">
        <span class="trace-column-label">Review</span>
        ${renderTraceValue(row.approval, approvalTone)}
        <small>${escapeHtml(row.risk === 'none' ? 'no risk signal' : `risk: ${row.risk}`)}</small>
      </span>
      <span class="trace-record-proof">
        <span class="trace-column-label">Proof</span>
        ${renderTraceValue(row.evidence === 'none' ? 'none' : 'evidence', row.evidence === 'none' ? 'neutral' : 'evidence')}
        <small>${escapeHtml(proof)}</small>
      </span>
      <span class="trace-record-cost">
        <span class="trace-column-label">Cost</span>
        <strong>${escapeHtml(row.cost)}</strong>
        <small>${renderTraceValue(row.status, row.tone)}</small>
      </span>
    </button>
  `;
}

function countRows(rows: TraceRow[], predicate: (row: TraceRow) => boolean): number {
  return rows.filter(predicate).length;
}

function buildControlMetrics(rows: TraceRow[], viewModel: MonitorViewModel): ControlMetric[] {
  const captured = rows.length;
  const allowed = countRows(rows, (row) =>
    row.decision === 'allow' ||
    row.eventType === 'command.allowed' ||
    row.eventType === 'preflight.allowed',
  );
  const held = countRows(rows, (row) =>
    row.approval === 'pending' ||
    row.status === 'waiting' ||
    row.eventType === 'approval.requested' ||
    row.eventType === 'preflight.approval_required',
  );
  const stopped = countRows(rows, (row) =>
    row.status === 'blocked' ||
    row.decision === 'deny' ||
    row.eventType === 'command.blocked' ||
    row.eventType === 'preflight.blocked',
  );
  const evidence = countRows(rows, (row) =>
    row.eventType === 'artifact.changed' ||
    row.eventType === 'report.generated' ||
    row.evidence !== 'none',
  );

  return [
    {
      label: 'Captured',
      value: captured,
      detail: viewModel.liveActivity?.isHistoricalOnly ? 'from ledger history' : 'live traces',
      tone: 'trace',
    },
    {
      label: 'Allowed',
      value: allowed,
      detail: 'actions cleared',
      tone: 'healthy',
    },
    {
      label: 'Held',
      value: held,
      detail: 'human review gates',
      tone: 'approval',
    },
    {
      label: 'Stopped',
      value: stopped,
      detail: 'blocked before execution',
      tone: stopped > 0 ? 'danger' : 'neutral',
    },
    {
      label: 'Proved',
      value: evidence,
      detail: 'evidence records',
      tone: 'evidence',
    },
  ];
}

function renderControlPlane(rows: TraceRow[], viewModel: MonitorViewModel): string {
  const metrics = buildControlMetrics(rows, viewModel);
  return `
    <div class="trace-control-plane" aria-label="SafeLoop control outcomes">
      ${metrics.map((metric) => `
        <div class="trace-control-card trace-control-card--${escapeHtml(metric.tone)}">
          <span>${escapeHtml(metric.label)}</span>
          <strong>${escapeHtml(formatCompact(metric.value))}</strong>
          <small>${escapeHtml(metric.detail)}</small>
        </div>
      `).join('')}
    </div>
  `;
}

function scoreFor(row: TraceRow): number {
  if (row.outcome === 'Stopped' || row.tone === 'danger') return 84;
  if (row.tone === 'warning') return 70;
  if (row.outcome === 'Held for review' || row.tone === 'approval') return 62;
  if (row.outcome === 'Proved' || row.tone === 'evidence') return 38;
  if (row.outcome === 'Allowed' || row.tone === 'healthy') return 24;
  return 46;
}

function inverseScoreFor(row: TraceRow): number {
  const base = 100 - scoreFor(row);
  if (row.eventType.startsWith('task.')) return Math.max(18, base - 16);
  if (row.eventType.startsWith('decision.')) return Math.max(20, base - 8);
  if (row.eventType === 'token.cost' || row.eventType === 'model.usage') return Math.max(22, base - 2);
  return base;
}

function chartPoints(rows: TraceRow[], scorer: (row: TraceRow) => number): string {
  const ordered = rows.slice(0, 28).reverse();
  if (!ordered.length) return '';
  const width = 760;
  const height = 220;
  const step = ordered.length > 1 ? width / (ordered.length - 1) : width;
  return ordered.map((row, index) => {
    const x = Math.round(index * step);
    const y = Math.round(height - (Math.max(0, Math.min(100, scorer(row))) / 100) * height);
    return `${x},${y}`;
  }).join(' ');
}

function chartFlags(rows: TraceRow[]): string {
  const ordered = rows.slice(0, 28).reverse();
  const width = 760;
  const step = ordered.length > 1 ? width / (ordered.length - 1) : width;
  return ordered.map((row, index) => {
    const x = Math.round(index * step);
    if (row.outcome === 'Stopped') {
      return `<rect class="telemetry-flag telemetry-flag--danger" x="${x - 8}" y="20" width="16" height="180" rx="4" />`;
    }
    if (row.outcome === 'Held for review') {
      return `<rect class="telemetry-flag telemetry-flag--approval" x="${x - 8}" y="42" width="16" height="136" rx="4" />`;
    }
    if (row.outcome === 'Proved' || row.evidence !== 'none') {
      return `<rect class="telemetry-flag telemetry-flag--evidence" x="${x - 5}" y="132" width="10" height="48" rx="3" />`;
    }
    return '';
  }).join('');
}

function renderTelemetryMini(label: string, value: string, detail: string, tone: Tone): string {
  return `
    <article class="telemetry-mini telemetry-mini--${escapeHtml(tone)}">
      <span>${escapeHtml(label)}</span>
      <strong>${escapeHtml(value)}</strong>
      <em>${escapeHtml(detail)}</em>
      <i aria-hidden="true"></i>
    </article>
  `;
}

function renderTelemetryBoard(rows: TraceRow[], viewModel: MonitorViewModel): string {
  const allowed = countRows(rows, (row) => row.outcome === 'Allowed');
  const held = countRows(rows, (row) => row.outcome === 'Held for review');
  const stopped = countRows(rows, (row) => row.outcome === 'Stopped');
  const proved = countRows(rows, (row) => row.outcome === 'Proved' || row.evidence !== 'none');
  const risk = countRows(rows, (row) => row.risk !== 'none');
  const pressure = rows.length ? Math.round(((stopped * 1.2 + held * 0.8 + risk * 0.6) / rows.length) * 100) : 0;
  const proofDensity = rows.length ? Math.round((proved / rows.length) * 100) : 0;
  const guardLine = chartPoints(rows, scoreFor);
  const proofLine = chartPoints(rows, inverseScoreFor);
  const latest = rows[0];

  return `
    <section class="telemetry-board" aria-label="SafeLoop telemetry board">
      <div class="telemetry-chart-panel">
        <div class="telemetry-panel-head">
          <div>
            <span class="panel-kicker">Governance Behavior Chart</span>
            <h3>Agent activity vs. SafeLoop control pressure</h3>
          </div>
          <span class="telemetry-range">Live ledger</span>
        </div>
        <svg class="telemetry-chart" viewBox="0 0 760 260" preserveAspectRatio="none" aria-hidden="true">
          <defs>
            <linearGradient id="safeLoopRiskGradient" x1="0" x2="0" y1="0" y2="1">
              <stop offset="0%" stop-color="rgba(239,101,122,0.35)" />
              <stop offset="100%" stop-color="rgba(239,101,122,0)" />
            </linearGradient>
            <linearGradient id="safeLoopProofGradient" x1="0" x2="0" y1="0" y2="1">
              <stop offset="0%" stop-color="rgba(92,200,232,0.28)" />
              <stop offset="100%" stop-color="rgba(92,200,232,0)" />
            </linearGradient>
          </defs>
          <g class="telemetry-grid">
            <path d="M0 44 H760" />
            <path d="M0 88 H760" />
            <path d="M0 132 H760" />
            <path d="M0 176 H760" />
            <path d="M0 220 H760" />
          </g>
          ${chartFlags(rows)}
          <polyline class="telemetry-area telemetry-area--risk" points="0,220 ${guardLine} 760,220" />
          <polyline class="telemetry-line telemetry-line--risk" points="${guardLine}" />
          <polyline class="telemetry-area telemetry-area--proof" points="0,220 ${proofLine} 760,220" />
          <polyline class="telemetry-line telemetry-line--proof" points="${proofLine}" />
          <g class="telemetry-bars">
            ${rows.slice(0, 28).reverse().map((row, index, ordered) => {
              const step = ordered.length > 1 ? 760 / (ordered.length - 1) : 760;
              const height = row.eventType.startsWith('task.') ? 22 : row.eventType === 'token.cost' ? 34 : 12;
              return `<rect x="${Math.round(index * step) - 2}" y="${220 - height}" width="4" height="${height}" rx="2" />`;
            }).join('')}
          </g>
        </svg>
        <div class="telemetry-legend">
          <span><i class="legend-risk"></i>Control pressure</span>
          <span><i class="legend-proof"></i>Proof trail</span>
          <span><i class="legend-bars"></i>Agent events</span>
        </div>
      </div>
      <aside class="telemetry-side">
        ${renderTelemetryMini('Guard pressure', `${pressure}%`, `${stopped} stopped / ${held} held`, pressure > 45 ? 'danger' : pressure > 20 ? 'warning' : 'healthy')}
        ${renderTelemetryMini('Proof density', `${proofDensity}%`, `${proved} evidence records`, 'evidence')}
        ${renderTelemetryMini('Current risk', risk > 0 ? 'High' : 'Low', `${risk} risk signals`, risk > 0 ? 'danger' : 'healthy')}
        <article class="telemetry-latest">
          <span>Latest governed action</span>
          <strong>${escapeHtml(latest?.summary ?? 'Waiting for local events')}</strong>
          <em>${escapeHtml(latest ? `${latest.outcome} / ${latest.execution}` : viewModel.status.monitoredPath)}</em>
        </article>
      </aside>
    </section>
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
          <h2>Governance Overview</h2>
          <p>Agent activity, SafeLoop decisions, human review pressure, and audit evidence in one local telemetry view.</p>
        </div>
        <div class="trace-console-meta">
          <span class="trace-cue trace-cue--stream" id="safeloop-new-events" style="display:none"></span>
          ${cue}
          <span>${escapeHtml(String(rows.length))} visible traces</span>
        </div>
      </div>
      ${renderControlPlane(rows, viewModel)}
      ${renderTelemetryBoard(rows, viewModel)}
      ${renderFilterChips(rows)}
      <div class="trace-table" data-scroll-key="trace-table">
        <div class="trace-receipt-banner">
          <strong>Observe -> Decide -> Approve -> Prove</strong>
          <span>Local-first proof trail for governed AI actions</span>
        </div>
        <div class="trace-table-head trace-table-head--records" aria-hidden="true">
          <span>Captured Action</span>
          <span>SafeLoop Decision</span>
          <span>Human Gate</span>
          <span>Evidence</span>
          <span>Accountability</span>
        </div>
        <div class="trace-table-body">
          ${rows.map(renderTraceRow).join('')}
        </div>
      </div>
    </section>
  `;
}
