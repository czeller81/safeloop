import type { MonitorViewModel } from '../../viewModel';
import { escapeHtml, formatDuration, formatNumber, formatTimestamp } from '../lib/formatters';

type FlightIndex = NonNullable<MonitorViewModel['flightRecorder']>;
type FlightSummary = FlightIndex['sessions'][number];
type FlightDetail = NonNullable<MonitorViewModel['flightRecorderDetail']>;
type FlightEvent = FlightDetail['timeline'][number];
type FlightNode = NonNullable<FlightDetail['observability']>['graph']['nodes'][number];
type FlightEdge = NonNullable<FlightDetail['observability']>['graph']['edges'][number];

function safeJson(value: unknown): string {
  return escapeHtml(JSON.stringify(value ?? {}, null, 2));
}

function unknown(value: unknown, fallback = 'Unknown'): string {
  return value === undefined || value === null || value === '' ? fallback : String(value);
}

function renderStateBadge(label: string, status = 'unknown', description?: string): string {
  return `<span class="flight-state flight-state--${escapeHtml(status)}" title="${escapeHtml(description ?? label)}"><b aria-hidden="true">${escapeHtml(status.slice(0, 1).toUpperCase())}</b>${escapeHtml(label)}</span>`;
}

function searchableText(session: FlightSummary): string {
  return [session.session_id, session.task_goal, session.primary_task_id, session.agent_id, session.tenant_id, session.final_state, session.verification_summary]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
}

function renderSession(session: FlightSummary): string {
  const filters = [
    session.execution_count ? 'executed' : '',
    session.prevented_count ? 'prevented' : '',
    session.prevention_conflict_count ? 'conflict' : '',
    session.uncertainty_count ? 'unknown' : '',
    session.evidence_count ? 'evidence' : '',
    session.artifact_count ? 'artifact' : '',
    session.approval_count ? 'approval' : '',
    session.governance_intervention_count ? 'governance' : '',
  ].filter(Boolean).join(' ');
  return `
    <article class="flight-session-card" data-flight-session data-session-id="${escapeHtml(session.session_id)}" data-filter="${escapeHtml(filters)}" data-search="${escapeHtml(searchableText(session))}">
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
        <div class="${session.prevented_count ? 'flight-danger' : ''}"><span>Prevented</span><strong>${escapeHtml(formatNumber(session.prevented_count))}</strong></div>
        <div class="${session.prevention_conflict_count ? 'flight-warning' : ''}"><span>Conflicts</span><strong>${escapeHtml(formatNumber(session.prevention_conflict_count ?? 0))}</strong></div>
        <div class="${session.uncertainty_count ? 'flight-warning' : ''}"><span>Unknown</span><strong>${escapeHtml(formatNumber(session.uncertainty_count ?? 0))}</strong></div>
        <div><span>Verify</span><strong>${escapeHtml(session.verification_summary ?? 'Unknown')}</strong></div>
      </div>
      <code>safeloop session inspect ${escapeHtml(session.session_id)}</code>
    </article>
  `;
}

function renderFilters(detail?: FlightDetail): string {
  const filters = detail?.observability?.filters ?? [
    { id: 'executed', label: 'Executed', count: 0 },
    { id: 'prevented', label: 'Prevented', count: 0 },
    { id: 'conflict', label: 'Conflicts', count: 0 },
    { id: 'unknown', label: 'Unknown', count: 0 },
    { id: 'evidence', label: 'Evidence', count: 0 },
    { id: 'artifact', label: 'Artifacts', count: 0 },
    { id: 'approval', label: 'Approval', count: 0 },
    { id: 'permit', label: 'Permit', count: 0 },
    { id: 'breaker', label: 'Breaker', count: 0 },
    { id: 'budget', label: 'Budget', count: 0 },
  ];
  return `
    <form class="flight-filter-bar" role="search" aria-label="Filter sessions and events">
      <label for="flight-search">Search</label>
      <input id="flight-search" type="search" placeholder="event, proposal, execution, artifact, redacted text" autocomplete="off" data-flight-search />
      <button type="button" data-flight-filter="all">All</button>
      ${filters.map((filter) => `<button type="button" data-flight-filter="${escapeHtml(filter.id)}">${escapeHtml(filter.label)} <span>${escapeHtml(formatNumber(filter.count))}</span></button>`).join('')}
    </form>
  `;
}

function renderTimelineEvent(event: FlightEvent): string {
  const missing = event.causal_links.missing_links.length
    ? `<p class="flight-warning">Link unavailable: ${escapeHtml(event.causal_links.missing_links.join(', '))}</p>`
    : '';
  const linked = event.causal_links.linked_event_ids.length
    ? `<p>Linked events: ${escapeHtml(event.causal_links.linked_event_ids.join(', '))}</p>`
    : '<p>Linked events: none recorded</p>';
  const data = event.data ?? {};
  const filter = [event.category.toLowerCase(), event.refs.evidence_ids ? 'evidence' : '', event.refs.artifact_ids ? 'artifact' : '', event.causal_links.missing_links.length ? 'unknown' : ''].filter(Boolean).join(' ');
  return `
    <details class="flight-event-row" data-flight-item data-filter="${escapeHtml(filter)}" data-search="${escapeHtml([event.id, event.type, event.summary, event.explanation, Object.values(event.refs).flat().join(' ')].join(' ').toLowerCase())}">
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
          <dt>Task</dt><dd>${escapeHtml(event.task_id ?? 'Unknown')}</dd>
          <dt>Evidence</dt><dd>${escapeHtml(Array.isArray(event.refs.evidence_ids) ? event.refs.evidence_ids.join(', ') : 'Unknown')}</dd>
          <dt>Artifacts</dt><dd>${escapeHtml(Array.isArray(event.refs.artifact_ids) ? event.refs.artifact_ids.join(', ') : 'Unknown')}</dd>
        </dl>
        <pre>${safeJson({ refs: event.refs, data })}</pre>
      </div>
    </details>
  `;
}

function renderGraphNode(node: FlightNode): string {
  const badges = node.badges.map((badge) => renderStateBadge(badge.label, badge.status, badge.description)).join('');
  return `
    <details class="flight-graph-node flight-graph-node--${escapeHtml(node.status)}" data-flight-item data-filter="${escapeHtml([node.kind.toLowerCase(), node.status].join(' '))}" data-search="${escapeHtml([node.id, node.label, node.text, Object.values(node.refs).flat().join(' ')].join(' ').toLowerCase())}">
      <summary>
        <span class="flight-node-kind">${escapeHtml(node.kind)}</span>
        <strong>${escapeHtml(node.label)}</strong>
        <em>${escapeHtml(node.status.replace(/_/g, ' '))}</em>
      </summary>
      <p>${escapeHtml(node.text)}</p>
      <div class="flight-badge-row">${badges}</div>
      <pre>${safeJson({ id: node.id, refs: node.refs, detail: node.detail })}</pre>
    </details>
  `;
}

function renderGraphEdge(edge: FlightEdge): string {
  return `<li class="${edge.recorded ? '' : 'flight-warning'}"><strong>${escapeHtml(edge.from)}</strong> -> <strong>${escapeHtml(edge.to)}</strong> <span>${escapeHtml(edge.label)}</span></li>`;
}

function renderGraph(detail: FlightDetail): string {
  const graph = detail.observability?.graph;
  if (!graph) return '<div class="empty-state">No causal graph projection available.</div>';
  return `
    <section class="flight-graph" aria-label="Causal work graph">
      <div class="flight-section-heading"><h4>Causal Work Graph</h4><p>Edges are recorded references only. Visual adjacency is not causal.</p></div>
      <div class="flight-badge-row">
        ${renderStateBadge('Recorded links only', 'verified')}
        ${renderStateBadge(`${graph.diagnostics.missing_reference_count} missing`, graph.diagnostics.missing_reference_count ? 'missing_reference' : 'verified')}
        ${renderStateBadge(`${graph.diagnostics.conflict_count} conflicts`, graph.diagnostics.conflict_count ? 'conflict' : 'verified')}
        ${renderStateBadge(graph.diagnostics.cycle_detected ? 'Cycle detected' : 'No cycle detected', graph.diagnostics.cycle_detected ? 'unknown' : 'verified')}
      </div>
      <div class="flight-graph-grid">
        <div>${graph.nodes.slice(0, 80).map(renderGraphNode).join('')}${graph.nodes.length > 80 ? `<p class="flight-warning">Graph preview limited to 80 of ${escapeHtml(formatNumber(graph.nodes.length))} nodes.</p>` : ''}</div>
        <aside><h5>Recorded Edges</h5><ul>${graph.edges.slice(0, 120).map(renderGraphEdge).join('') || '<li>No recorded graph edges.</li>'}</ul></aside>
      </div>
    </section>
  `;
}

function renderProofs(detail: FlightDetail): string {
  if (!detail.execution_proofs.length) return '<div class="empty-state">No execution proofs recorded for this session.</div>';
  return detail.execution_proofs.map((proof) => `
    <article class="flight-proof-card" data-flight-item data-filter="evidence ${escapeHtml(proof.verification_status.toLowerCase())}" data-search="${escapeHtml([proof.execution_id, proof.executor, proof.operation, proof.verification_status, proof.verification_summary].join(' ').toLowerCase())}">
      <div><span class="flight-event-type">${escapeHtml(proof.executor)}</span><strong>${escapeHtml(proof.operation ?? 'operation')}</strong></div>
      <p>${renderStateBadge(proof.verification_status, proof.verification_status.toLowerCase())} ${escapeHtml(proof.verification_summary)}</p>
      <p>${escapeHtml(proof.limitation)}</p>
      <pre>${safeJson({ before: proof.before, after: proof.after, result: proof.result, evidence_ids: proof.evidence_ids, artifact_ids: proof.artifact_ids })}</pre>
    </article>
  `).join('');
}

function renderEvidenceArtifacts(detail: FlightDetail): string {
  const evidence = detail.evidence.map((item) => `
    <article class="flight-proof-card" data-flight-item data-filter="evidence" data-search="${escapeHtml([item.evidence_id, item.supported_claim, item.verification_status, item.artifact_ids.join(' ')].join(' ').toLowerCase())}">
      <div><span class="flight-event-type">EVIDENCE</span><strong>${escapeHtml(item.evidence_id)}</strong></div>
      <p>${escapeHtml(item.verification_status)}: ${escapeHtml(item.supported_claim ?? 'Unknown')}</p>
      <p>Artifacts: ${escapeHtml(item.artifact_ids.join(', ') || 'Unknown')}</p>
    </article>
  `).join('');
  const artifacts = detail.artifacts.map((artifact) => `
    <article class="flight-proof-card" data-flight-item data-filter="artifact" data-search="${escapeHtml([artifact.artifact_id, artifact.path, artifact.operation].join(' ').toLowerCase())}">
      <div><span class="flight-event-type">ARTIFACT</span><strong>${escapeHtml(artifact.operation)}</strong></div>
      <p>${escapeHtml(artifact.path)}</p>
      <p>Hash: ${escapeHtml(artifact.content_hash)}</p>
    </article>
  `).join('');
  return evidence || artifacts ? evidence + artifacts : '<div class="empty-state">No evidence or artifacts recorded for this session.</div>';
}

function renderMemory(detail: FlightDetail): string {
  if (!detail.memory.length) return '<div class="empty-state">No persisted governed memory recorded for this session.</div>';
  return detail.memory.map((memory) => `
    <article class="flight-proof-card" data-flight-item data-filter="memory" data-search="${escapeHtml([memory.memory_id, memory.status, memory.provenance, memory.source_task].join(' ').toLowerCase())}">
      <div><span class="flight-event-type">MEMORY</span><strong>${escapeHtml(memory.memory_id)}</strong></div>
      <p>${escapeHtml(memory.status)}${memory.decision ? ` / ${escapeHtml(memory.decision)}` : ''}${memory.confidence !== undefined ? ` / confidence ${escapeHtml(formatNumber(memory.confidence, 2))}` : ''}</p>
      <p>Source: ${escapeHtml(memory.source_session ?? 'Unknown')} / ${escapeHtml(memory.source_task ?? 'Unknown')}</p>
      <p>Evidence: ${escapeHtml(memory.evidence_ids.join(', ') || 'Unknown')}</p>
    </article>
  `).join('');
}

function renderPrevented(detail: FlightDetail): string {
  const prevented = detail.prevented_actions.length
    ? detail.prevented_actions.map((entry) => `
      <article class="flight-proof-card flight-danger-card" data-flight-item data-filter="prevented ${escapeHtml(entry.execution_status ?? String(entry.execution_occurred))}" data-search="${escapeHtml([entry.event_id, entry.category, entry.reason, Object.values(entry.related_ids).join(' ')].join(' ').toLowerCase())}">
        <div><span class="flight-event-type">PREVENTED</span><strong>${escapeHtml(entry.category)}</strong></div>
        <p>${escapeHtml(entry.reason)}</p>
        <p>Execution status: ${renderStateBadge((entry.execution_status ?? String(entry.execution_occurred)) === 'unknown' ? 'Unknown' : (entry.execution_status ?? String(entry.execution_occurred)), entry.execution_status ?? String(entry.execution_occurred))}</p>
        ${entry.uncertainty_reason ? `<p class="flight-warning">${escapeHtml(entry.uncertainty_reason)}</p>` : ''}
        <p>Event: ${escapeHtml(entry.event_id)} / Approval could resolve: ${escapeHtml(String(entry.approval_could_resolve))}</p>
      </article>
    `).join('')
    : '<div class="empty-state">No prevented actions recorded for this session.</div>';
  const conflicts = detail.prevention_conflicts.length
    ? detail.prevention_conflicts.map((conflict) => `
      <article class="flight-proof-card flight-warning-card" data-flight-item data-filter="conflict" data-search="${escapeHtml([conflict.blocked_event_id, conflict.category, conflict.reason, conflict.execution_event_ids.join(' ')].join(' ').toLowerCase())}">
        <div><span class="flight-event-type">CONFLICT</span><strong>${escapeHtml(conflict.category)}</strong></div>
        <p>${escapeHtml(conflict.reason)}</p>
        <p>Execution status: ${renderStateBadge(conflict.execution_status ?? 'observed', conflict.execution_status ?? 'observed')}</p>
        <p>Temporal status: ${escapeHtml(conflict.temporal_status ?? 'after_block')}</p>
        <p>Blocked: ${escapeHtml(conflict.blocked_event_id)} / Execution events: ${escapeHtml(conflict.execution_event_ids.join(', '))}</p>
      </article>
    `).join('')
    : '';
  return prevented + conflicts;
}

function renderConflictCenter(detail: FlightDetail): string {
  const entries = detail.observability?.conflict_center ?? [];
  if (!entries.length) return '<div class="empty-state">No conflicts or unknown-certainty records in this session.</div>';
  return entries.map((entry) => `
    <article class="flight-proof-card ${entry.status === 'CONFLICT' ? 'flight-warning-card' : ''}" data-flight-item data-filter="${escapeHtml(entry.status.toLowerCase())}" data-search="${escapeHtml([entry.id, entry.label, entry.description, Object.values(entry.related_ids).flat().join(' ')].join(' ').toLowerCase())}">
      <div><span class="flight-event-type">${escapeHtml(entry.status)}</span><strong>${escapeHtml(entry.label)}</strong></div>
      <p>${escapeHtml(entry.description)}</p>
      <pre>${safeJson(entry.related_ids)}</pre>
    </article>
  `).join('');
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
        <div><span>Prevented</span><strong>${escapeHtml(formatNumber(s.prevented_count))}</strong></div>
        <div><span>Conflicts</span><strong>${escapeHtml(formatNumber(s.prevention_conflict_count ?? 0))}</strong></div>
        <div><span>Unknown</span><strong>${escapeHtml(formatNumber(s.uncertainty_count ?? 0))}</strong></div>
        <div><span>Verify</span><strong>${escapeHtml(s.verification_summary ?? 'Unknown')}</strong></div>
        <div><span>Last state</span><strong>${escapeHtml(s.final_state)}</strong></div>
      </div>
      <div class="flight-observability-strip" aria-label="Operator status summary">
        ${(detail.observability?.summary_cards ?? []).map((card) => renderStateBadge(card.label, card.status, card.description)).join('')}
      </div>
      ${renderFilters(detail)}
      <div class="flight-detail-grid">
        <section>
          ${renderGraph(detail)}
          <h4>Causal Timeline</h4>
          <div class="flight-timeline" data-scroll-key="flight-timeline">${detail.timeline.map(renderTimelineEvent).join('')}</div>
        </section>
        <aside>
          <h4>Prevented / Conflicts / Unknown</h4>
          ${renderPrevented(detail)}
          <h4>Conflict Center</h4>
          ${renderConflictCenter(detail)}
          <h4>Governance Coverage</h4>
          <p>${escapeHtml(detail.coverage.summary)}</p>
          <ul>${detail.coverage.paths.map((path) => `<li>${escapeHtml(path.path)}: ${escapeHtml(path.status)}</li>`).join('')}</ul>
          <h4>What SafeLoop Cannot Prove</h4>
          <ul>${detail.known_limitations.map((item) => `<li>${escapeHtml(item)}</li>`).join('')}</ul>
        </aside>
      </div>
      <div class="flight-lower-grid">
        <section><h4>Execution Proofs</h4>${renderProofs(detail)}</section>
        <section><h4>Evidence / Artifacts</h4>${renderEvidenceArtifacts(detail)}</section>
        <section><h4>Memory Provenance</h4>${renderMemory(detail)}</section>
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
    acc.conflicts += session.prevention_conflict_count ?? 0;
    acc.unknown += session.uncertainty_count ?? 0;
    acc.evidence += session.evidence_count;
    acc.memory += session.memory_event_count;
    return acc;
  }, { executions: 0, prevented: 0, conflicts: 0, unknown: 0, evidence: 0, memory: 0 });

  return `
    <section class="flight-recorder-panel" id="flight-recorder" data-flight-recorder>
      <div class="panel-heading">
        <div>
          <span class="section-kicker">Flight Recorder</span>
          <h2>Operator observability</h2>
          <p>The dashboard observes redacted recorded evidence. It does not make governance decisions.</p>
        </div>
        <span>${escapeHtml(formatNumber(sessions.length))} sessions</span>
      </div>
      <div class="flight-summary-strip">
        <div><span>Executions</span><strong>${escapeHtml(formatNumber(totals.executions))}</strong></div>
        <div><span>Prevented</span><strong>${escapeHtml(formatNumber(totals.prevented))}</strong></div>
        <div><span>Conflicts</span><strong>${escapeHtml(formatNumber(totals.conflicts))}</strong></div>
        <div><span>Unknown</span><strong>${escapeHtml(formatNumber(totals.unknown))}</strong></div>
        <div><span>Evidence</span><strong>${escapeHtml(formatNumber(totals.evidence))}</strong></div>
        <div><span>Memory events</span><strong>${escapeHtml(formatNumber(totals.memory))}</strong></div>
      </div>
      ${renderFilters(viewModel.flightRecorderDetail)}
      <div class="flight-session-list" aria-label="Authorized session browser">
        ${sessions.length ? sessions.map(renderSession).join('') : '<div class="empty-state">No governed runtime sessions recorded yet.</div>'}
      </div>
      ${renderDetail(viewModel.flightRecorderDetail)}
    </section>
  `;
}