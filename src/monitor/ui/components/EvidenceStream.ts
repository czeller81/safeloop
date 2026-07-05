import type { MonitorViewModel, SectionItem } from '../../viewModel';
import { escapeHtml, formatTimestamp } from '../lib/formatters';

type EventTone = 'neutral' | 'good' | 'warn' | 'bad' | 'info';

interface EventTypeInfo {
  label: string;
  cssClass: string;
  tone: EventTone;
}

function getEventTypeInfo(eventType: string | undefined): EventTypeInfo {
  switch (eventType) {
    case 'handoff.created':
      return { label: 'Handoff', cssClass: 'ev--handoff', tone: 'info' };
    case 'task.started':
      return { label: 'Started', cssClass: 'ev--started', tone: 'info' };
    case 'task.completed':
      return { label: 'Completed', cssClass: 'ev--completed', tone: 'good' };
    case 'artifact.changed':
      return { label: 'Artifact', cssClass: 'ev--artifact', tone: 'neutral' };
    case 'token.cost':
    case 'model.usage':
      return { label: 'Model call', cssClass: 'ev--model', tone: 'info' };
    case 'risk.detected':
      return { label: 'Risk', cssClass: 'ev--risk', tone: 'bad' };
    case 'approval.requested':
      return { label: 'Approval needed', cssClass: 'ev--approval-req', tone: 'warn' };
    case 'approval.resolved':
      return { label: 'Approval resolved', cssClass: 'ev--approval-res', tone: 'good' };
    case 'decision.made':
    case 'decision.explained':
      return { label: 'Decision', cssClass: 'ev--decision', tone: 'info' };
    case 'feedback.recorded':
      return { label: 'Feedback', cssClass: 'ev--feedback', tone: 'neutral' };
    case 'operator.action.recorded':
      return { label: 'Operator', cssClass: 'ev--operator', tone: 'good' };
    case 'steering.applied':
      return { label: 'Steering', cssClass: 'ev--steering', tone: 'info' };
    case 'test.completed':
      return { label: 'Test', cssClass: 'ev--test', tone: 'good' };
    case 'context.loaded':
      return { label: 'Context', cssClass: 'ev--context', tone: 'neutral' };
    case 'report.generated':
      return { label: 'Report', cssClass: 'ev--report', tone: 'neutral' };
    default:
      return { label: 'Event', cssClass: 'ev--unknown', tone: 'neutral' };
  }
}

function renderEventRow(item: SectionItem): string {
  const info = getEventTypeInfo(item.eventType);
  const context = [
    item.caseId ? `case ${item.caseId}` : '',
    item.loopKey ? `loop ${item.loopKey}` : '',
  ].filter(Boolean).join(' / ');
  const detail = {
    id: item.id,
    eventType: item.eventType ?? 'unknown',
    timestamp: item.timestamp,
    agent: item.agent ?? item.agentId ?? 'System',
    caseId: item.caseId ?? null,
    loopKey: item.loopKey ?? null,
    summary: item.summary,
  };

  return `
    <details class="ev-row ${escapeHtml(info.cssClass)}">
      <summary class="ev-row-summary">
        <span class="ev-ts">${escapeHtml(formatTimestamp(item.timestamp))}</span>
        <span class="ev-badge ev-badge--${escapeHtml(info.tone)}">${escapeHtml(item.eventType || info.label)}</span>
        <span class="ev-agent">${escapeHtml(item.agent || item.agentId || 'System')}</span>
        <span class="ev-context">${escapeHtml(context || 'no case/session')}</span>
        <span class="ev-summary">${escapeHtml(item.summary)}</span>
      </summary>
      <div class="ev-detail">
        <div class="ev-detail-grid">
          <div><span>Event</span><strong>${escapeHtml(item.id)}</strong></div>
          <div><span>Type</span><strong>${escapeHtml(item.eventType || 'unknown')}</strong></div>
          <div><span>Agent</span><strong>${escapeHtml(item.agent || item.agentId || 'System')}</strong></div>
          <div><span>Case</span><strong>${escapeHtml(item.caseId || 'unavailable')}</strong></div>
        </div>
        <pre>${escapeHtml(JSON.stringify(detail, null, 2))}</pre>
      </div>
    </details>
  `;
}

export function renderEvidenceStream(viewModel: MonitorViewModel): string {
  const live = viewModel.liveActivity;
  const isHistoricalOnly = live?.isHistoricalOnly ?? false;
  const hasCurrentSession = live?.hasCurrentSession ?? false;
  const recentActivity: SectionItem[] = live?.recentActivity ?? [];

  let sessionCueHtml = '';
  if (isHistoricalOnly) {
    sessionCueHtml = '<div class="ev-cue ev-cue--historical">Historical evidence only. Events below are from a past session.</div>';
  } else if (hasCurrentSession) {
    sessionCueHtml = `<div class="ev-cue ev-cue--live">Recording live evidence: ${escapeHtml(String(recentActivity.length))} events in the current session</div>`;
  }

  if (recentActivity.length === 0) {
    return `
      <section class="ev-stream" id="evidence-stream">
        <div class="ev-header">
          <div class="panel-kicker">Evidence Stream</div>
          <h3>Live event trace</h3>
        </div>
        ${sessionCueHtml}
        <div class="ev-empty">
          <div class="muted">No evidence emitted yet. Events will appear here as agents execute tasks, call models, request approvals, and hand off work.</div>
        </div>
      </section>
    `;
  }

  const visibleItems = recentActivity.slice(0, 40);
  const hiddenCount = recentActivity.length - visibleItems.length;

  return `
    <section class="ev-stream${isHistoricalOnly ? ' ev-stream--historical' : ''}" id="evidence-stream">
      <div class="ev-header">
        <div class="panel-kicker">Evidence Stream</div>
        <h3>Live event trace</h3>
        <span class="ev-count">${escapeHtml(String(recentActivity.length))} events</span>
      </div>
      ${sessionCueHtml}
      <div class="ev-table-head" aria-hidden="true">
        <span>Time</span>
        <span>Type</span>
        <span>Agent</span>
        <span>Context</span>
        <span>Summary</span>
      </div>
      <div class="ev-timeline" data-scroll-key="ev-timeline">
        ${visibleItems.map(renderEventRow).join('')}
      </div>
      ${hiddenCount > 0 ? `<div class="ev-overflow muted">${escapeHtml(String(hiddenCount))} more events in this session. Full ledger remains available in the historical section.</div>` : ''}
    </section>
  `;
}
