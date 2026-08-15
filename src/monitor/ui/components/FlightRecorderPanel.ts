import type { MonitorViewModel } from '../../viewModel';
import { escapeHtml, formatDuration, formatNumber, formatTimestamp } from '../lib/formatters';

type FlightIndex = NonNullable<MonitorViewModel['flightRecorder']>;
type FlightSummary = FlightIndex['sessions'][number];
type FlightDetail = NonNullable<MonitorViewModel['flightRecorderDetail']>;
type FlightEvent = FlightDetail['timeline'][number];

function safeJson(value: unknown): string {
  return escapeHtml(JSON.stringify(value ?? {}, null, 2));
}

function renderSession(session: FlightSummary): string {
  return `
    <article class="flight-session-card" data-session-id="${escapeHtml(session.session_id)}">
      <div class="flight-session-main">
        <div>
          <span class="flight-eyebrow">${escapeHtml(session.final_state)}</span>
          <h3>${escapeHtml(session.task_goal || session.primary_task_id || session.session_id)}</h3>
          <p>${escapeHtml(session.agent_id || 'unknown agent')} / ${escapeHtml(session.tenant_id || 'unknown tenant')}</p>
        </div>
        <div class="flight-session-time">
          <strong>${escapeHtml(formatTimestamp(session.started_at || session.last_event_at || ''))}</strong>
          <span>${escapeHtml(formatDuration(session.duration_ms || 0))}</span>
        </div>
      </div>
      <div class="flight-metrics" aria-label="Flight Recorder session counters">
        <div><span>Events</span><strong>${escapeHtml(formatNumber(session.work_event_count))}</strong></div>
        <div><span>Exec</span><strong>${escapeHtml(formatNumber(session.execution_count))}</strong></div>
        <div><span>Approvals</span><strong>${escapeHtml(formatNumber(session.approval_count))}</strong></div>
        <div class="${session.prevented_count ? 'flight-danger' : ''}"><span>Prevented</span><strong>${escapeHtml(formatNumber(session.prevented_count))}</strong></div>
        <div><span>Evidence</span><strong>${escapeHtml(formatNumber(session.evidence_count))}</strong></div>
        <div><span>Memory</span><strong>${escapeHtml(formatNumber(session.memory_event_count))}</strong></div>
      </div>
      <code>safeloop session inspect ${escapeHtml(session.session_id)}</code>
    </article>
  `;
}

function renderTimelineEvent(event: FlightEvent): string {
  const missing = event.causal_links.missing_links.length
    ? `<p class="flight-warning">Link unavailable: ${escapeHtml(event.causal_links.missing_links.join(', '))}</p>`
    : '';
  const linked = event.causal_links.linked_event_ids.length
    ? `<p>Linked events: ${escapeHtml(event.causal_links.linked_event_ids.join(', '))}</p>`
    : '<p>Linked events: none recorded</p>';
  return `
    <details class="flight-event-row">
      <summary>
        <span class="flight-event-type">${escapeHtml(event.category)}</span>
        <span>${escapeHtml(event.summary)}</span>
        <time>${escapeHtml(formatTimestamp(event.timestamp))}</time>
      </summary>
      <div class="flight-event-detail">
        <p>${escapeHtml(event.explanation)}</p>
        ${linked}
        ${missing}
        <dl>
          <dt>Event</dt><dd>${escapeHtml(event.id)}</dd>
          <dt>Type</dt><dd>${escapeHtml(event.type)}</dd>
          <dt>Task</dt><dd>${escapeHtml(event.task_id ?? 'n/a')}</dd>
        </dl>
        <pre>${safeJson({ refs: event.refs, data: event.data })}</pre>
      </div>
    </details>
  `;
}

function renderProofs(detail: FlightDetail): string {
  if (!detail.execution_proofs.length) return '<div class="empty-state">No execution proofs recorded for this session.</div>';
  return detail.execution_proofs.map((proof) => `
    <article class="flight-proof-card">
      <div><span class="flight-event-type">${escapeHtml(proof.executor)}</span><strong>${escapeHtml(proof.operation ?? 'operation')}</strong></div>
      <p>${escapeHtml(proof.verification_status)}: ${escapeHtml(proof.verification_summary)}</p>
      <p>${escapeHtml(proof.limitation)}</p>
      <pre>${safeJson({ before: proof.before, after: proof.after, result: proof.result, evidence_ids: proof.evidence_ids, artifact_ids: proof.artifact_ids })}</pre>
    </article>
  `).join('');
}

function renderMemory(detail: FlightDetail): string {
  if (!detail.memory.length) return '<div class="empty-state">No persisted governed memory recorded for this session.</div>';
  return detail.memory.map((memory) => `
    <article class="flight-proof-card">
      <div><span class="flight-event-type">MEMORY</span><strong>${escapeHtml(memory.memory_id)}</strong></div>
      <p>${escapeHtml(memory.status)}${memory.decision ? ` / ${escapeHtml(memory.decision)}` : ''}${memory.confidence !== undefined ? ` / confidence ${escapeHtml(formatNumber(memory.confidence, 2))}` : ''}</p>
      <p>Source: ${escapeHtml(memory.source_session ?? 'n/a')} / ${escapeHtml(memory.source_task ?? 'n/a')}</p>
      <p>Evidence: ${escapeHtml(memory.evidence_ids.join(', ') || 'none recorded')}</p>
    </article>
  `).join('');
}

function renderPrevented(detail: FlightDetail): string {
  const prevented = detail.prevented_actions.length
    ? detail.prevented_actions.map((entry) => `
      <article class="flight-proof-card flight-danger-card">
        <div><span class="flight-event-type">PREVENTED</span><strong>${escapeHtml(entry.category)}</strong></div>
        <p>${escapeHtml(entry.reason)}</p>
        <p>Execution occurred: ${escapeHtml(String(entry.execution_occurred))}</p>
        <p>Approval could resolve: ${escapeHtml(String(entry.approval_could_resolve))}</p>
      </article>
    `).join('')
    : '<div class="empty-state">No prevented actions recorded for this session.</div>';
  const conflicts = detail.prevention_conflicts.length
    ? detail.prevention_conflicts.map((conflict) => `
      <article class="flight-proof-card flight-warning-card">
        <div><span class="flight-event-type">INCONSISTENT RECORD</span><strong>${escapeHtml(conflict.category)}</strong></div>
        <p>${escapeHtml(conflict.reason)}</p>
        <p>Execution occurred: true</p>
        <p>Execution events: ${escapeHtml(conflict.execution_event_ids.join(', '))}</p>
      </article>
    `).join('')
    : '';
  return prevented + conflicts;
}

function renderDetail(detail?: FlightDetail): string {
  if (!detail) return '<div class="empty-state">Select a governed runtime session to see the Flight Recorder timeline.</div>';
  const s = detail.summary;
  return `
    <section class="flight-detail" aria-label="Flight Recorder session detail">
      <div class="flight-detail-header">
        <div>
          <span class="section-kicker">Session Detail</span>
          <h3>${escapeHtml(s.task_goal || s.primary_task_id || s.session_id)}</h3>
          <p>${escapeHtml(s.session_id)} / ${escapeHtml(s.agent_id ?? 'unknown agent')} / ${escapeHtml(s.tenant_id ?? 'unknown tenant')}</p>
        </div>
        <code>safeloop session inspect ${escapeHtml(s.session_id)} --json</code>
      </div>
      <div class="flight-summary-strip">
        <div><span>Start</span><strong>${escapeHtml(formatTimestamp(s.started_at))}</strong></div>
        <div><span>Duration</span><strong>${escapeHtml(formatDuration(s.duration_ms))}</strong></div>
        <div><span>Executions</span><strong>${escapeHtml(formatNumber(s.execution_count))}</strong></div>
        <div><span>Approvals</span><strong>${escapeHtml(formatNumber(s.approval_count))}</strong></div>
        <div><span>Prevented</span><strong>${escapeHtml(formatNumber(s.prevented_count))}</strong></div>
        <div><span>Evidence</span><strong>${escapeHtml(formatNumber(s.evidence_count))}</strong></div>
        <div><span>Memory events</span><strong>${escapeHtml(formatNumber(s.memory_event_count))}</strong></div>
        <div><span>Last state</span><strong>${escapeHtml(s.final_state)}</strong></div>
      </div>
      <div class="flight-detail-grid">
        <section>
          <h4>Causal Timeline</h4>
          <div class="flight-timeline">${detail.timeline.map(renderTimelineEvent).join('')}</div>
        </section>
        <aside>
          <h4>Prevented By SafeLoop</h4>
          ${renderPrevented(detail)}
          <h4>Governance Coverage</h4>
          <p>${escapeHtml(detail.coverage.summary)}</p>
          <ul>${detail.coverage.paths.map((path) => `<li>${escapeHtml(path.path)}: ${escapeHtml(path.status)}</li>`).join('')}</ul>
          <h4>What SafeLoop Cannot Prove</h4>
          <ul>${detail.known_limitations.map((item) => `<li>${escapeHtml(item)}</li>`).join('')}</ul>
        </aside>
      </div>
      <div class="flight-lower-grid">
        <section><h4>Execution Proofs</h4>${renderProofs(detail)}</section>
        <section><h4>Memory Provenance</h4>${renderMemory(detail)}</section>
        <section><h4>Evidence Export</h4><p>Safe JSON export excludes file bodies, full process output, credentials, authorization headers, and hidden reasoning.</p><code>POST /v1/session/export</code></section>
      </div>
    </section>
  `;
}

export function renderFlightRecorderPanel(viewModel: MonitorViewModel): string {
  const flight = viewModel.flightRecorder;
  const sessions = flight?.sessions ?? [];
  const totals = sessions.reduce((acc, session) => {
    acc.executions += session.execution_count;
    acc.prevented += session.prevented_count;
    acc.evidence += session.evidence_count;
    acc.memory += session.memory_event_count;
    return acc;
  }, { executions: 0, prevented: 0, evidence: 0, memory: 0 });

  return `
    <section class="flight-recorder-panel" id="flight-recorder">
      <div class="panel-heading">
        <div>
          <span class="section-kicker">Flight Recorder</span>
          <h2>Governed session reconstruction</h2>
        </div>
        <span>${escapeHtml(formatNumber(sessions.length))} sessions</span>
      </div>
      <div class="flight-summary-strip">
        <div><span>Executions</span><strong>${escapeHtml(formatNumber(totals.executions))}</strong></div>
        <div><span>Prevented</span><strong>${escapeHtml(formatNumber(totals.prevented))}</strong></div>
        <div><span>Evidence</span><strong>${escapeHtml(formatNumber(totals.evidence))}</strong></div>
        <div><span>Memory events</span><strong>${escapeHtml(formatNumber(totals.memory))}</strong></div>
      </div>
      <div class="flight-session-list">
        ${sessions.length ? sessions.map(renderSession).join('') : '<div class="empty-state">No governed runtime sessions recorded yet.</div>'}
      </div>
      ${renderDetail(viewModel.flightRecorderDetail)}
    </section>
  `;
}
