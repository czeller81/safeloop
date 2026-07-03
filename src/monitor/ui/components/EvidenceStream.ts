import type { MonitorViewModel, SectionItem } from '../../viewModel';
import { escapeHtml, formatTimestamp } from '../lib/formatters';

// --- Event type → icon + label mapping ---

interface EventTypeInfo {
  icon: string;
  label: string;
  cssClass: string;
}

function getEventTypeInfo(eventType: string | undefined): EventTypeInfo {
  switch (eventType) {
    case 'handoff.created':
      return { icon: '\u2197', label: 'Handoff', cssClass: 'ev--handoff' }; // ↗
    case 'task.started':
      return { icon: '\u25B6', label: 'Started', cssClass: 'ev--started' }; // ▶
    case 'task.completed':
      return { icon: '\u2713', label: 'Completed', cssClass: 'ev--completed' }; // ✓
    case 'artifact.changed':
      return { icon: '\uD83D\uDCC4', label: 'Artifact', cssClass: 'ev--artifact' }; // 📄
    case 'token.cost':
    case 'model.usage':
      return { icon: '\u26A1', label: 'Model call', cssClass: 'ev--model' }; // ⚡
    case 'risk.detected':
      return { icon: '\u26A0', label: 'Risk', cssClass: 'ev--risk' }; // ⚠
    case 'approval.requested':
      return { icon: '\u25C6', label: 'Approval needed', cssClass: 'ev--approval-req' }; // ◆
    case 'approval.resolved':
      return { icon: '\u2713\u25C6', label: 'Approval resolved', cssClass: 'ev--approval-res' }; // ✓◆
    case 'decision.made':
    case 'decision.explained':
      return { icon: '\uD83D\uDCA1', label: 'Decision', cssClass: 'ev--decision' }; // 💡
    case 'feedback.recorded':
      return { icon: '\uD83D\uDCAC', label: 'Feedback', cssClass: 'ev--feedback' }; // 💬
    case 'operator.action.recorded':
      return { icon: '\uD83D\uDC64', label: 'Operator', cssClass: 'ev--operator' }; // 👤
    case 'steering.applied':
      return { icon: '\uD83C\uDFAF', label: 'Steering', cssClass: 'ev--steering' }; // 🎯
    case 'test.completed':
      return { icon: '\u2714', label: 'Test', cssClass: 'ev--test' }; // ✔
    case 'context.loaded':
      return { icon: '\uD83D\uDCE5', label: 'Context', cssClass: 'ev--context' }; // 📥
    case 'report.generated':
      return { icon: '\uD83D\uDCCB', label: 'Report', cssClass: 'ev--report' }; // 📋
    default:
      return { icon: '\u25CB', label: 'Event', cssClass: 'ev--unknown' }; // ○
  }
}

function renderEventRow(item: SectionItem): string {
  const info = getEventTypeInfo(item.eventType);

  return `
    <div class="ev-row ${escapeHtml(info.cssClass)}">
      <div class="ev-icon" title="${escapeHtml(info.label)}">${info.icon}</div>
      <div class="ev-badge">${escapeHtml(info.label)}</div>
      <div class="ev-body">
        <span class="ev-agent">${escapeHtml(item.agent || 'System')}</span>
        <span class="ev-summary">${escapeHtml(item.summary)}</span>
      </div>
      <div class="ev-ts">${escapeHtml(formatTimestamp(item.timestamp))}</div>
    </div>
  `;
}

export function renderEvidenceStream(viewModel: MonitorViewModel): string {
  const live = viewModel.liveActivity;
  const isHistoricalOnly = live?.isHistoricalOnly ?? false;
  const hasCurrentSession = live?.hasCurrentSession ?? false;
  const recentActivity: SectionItem[] = live?.recentActivity ?? [];

  // Session cue
  let sessionCueHtml = '';
  if (isHistoricalOnly) {
    sessionCueHtml = '<div class="ev-cue ev-cue--historical">Historical evidence \u2014 no live activity. Events below are from a past session.</div>';
  } else if (hasCurrentSession) {
    sessionCueHtml = `<div class="ev-cue ev-cue--live">Recording live evidence \u2014 ${escapeHtml(String(recentActivity.length))} events in current session</div>`;
  }

  // Empty state
  if (recentActivity.length === 0) {
    return `
      <section class="ev-stream" id="evidence-stream">
        <div class="ev-header">
          <div class="panel-kicker">Evidence Stream</div>
          <h3>Black-box recorder</h3>
        </div>
        ${sessionCueHtml}
        <div class="ev-empty">
          <div class="muted">No evidence emitted yet. Events will appear here as agents execute tasks, call models, request approvals, and hand off work.</div>
        </div>
      </section>
    `;
  }

  // Render event rows (max 30 for performance)
  const visibleItems = recentActivity.slice(0, 30);
  const hiddenCount = recentActivity.length - visibleItems.length;

  const rowsHtml = visibleItems.map(renderEventRow).join('');

  return `
    <section class="ev-stream${isHistoricalOnly ? ' ev-stream--historical' : ''}" id="evidence-stream">
      <div class="ev-header">
        <div class="panel-kicker">Evidence Stream</div>
        <h3>Black-box recorder</h3>
        <span class="ev-count">${escapeHtml(String(recentActivity.length))} events</span>
      </div>
      ${sessionCueHtml}
      <div class="ev-timeline" data-scroll-key="ev-timeline">
        ${rowsHtml}
      </div>
      ${hiddenCount > 0 ? `<div class="ev-overflow muted">${escapeHtml(String(hiddenCount))} more events in this session. Full ledger available in historical section.</div>` : ''}
    </section>
  `;
}
