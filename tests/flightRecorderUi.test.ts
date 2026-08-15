import { renderFlightRecorderPanel } from '../src/monitor/ui/components/FlightRecorderPanel';
import type { MonitorViewModel } from '../src/monitor/viewModel';

describe('Flight Recorder monitor UI', () => {
  it('renders session summaries with escaped recorder fields', () => {
    const html = renderFlightRecorderPanel({
      flightRecorder: {
        schema_version: 1,
        sessions: [{
          session_id: 'session-ui-1',
          task_ids: ['task-ui-1'],
          primary_task_id: 'task-ui-1',
          agent_id: 'agent<script>',
          tenant_id: 'tenant-ui',
          profile: 'coding',
          task_goal: '<script>alert(1)</script>',
          started_at: '2026-08-14T00:00:00.000Z',
          last_event_at: '2026-08-14T00:01:00.000Z',
          duration_ms: 60_000,
          work_event_count: 9,
          proposal_count: 1,
          decision_count: 1,
          approval_count: 0,
          execution_count: 1,
          evidence_count: 1,
          artifact_count: 1,
          memory_event_count: 0,
          memory_candidate_count: 0,
          memory_persisted_count: 0,
          memory_rejected_count: 0,
          verified_count: 1,
          partially_verified_count: 0,
          not_verifiable_count: 0,
          failed_count: 0,
          prevented_count: 0,
          final_state: 'execution.completed',
          latest_summary: 'done',
        }],
        page: { limit: 25, returned_count: 1, total_count: 1, has_more: false, max_limit: 500 },
      },
    } as unknown as MonitorViewModel);

    expect(html).toContain('Flight Recorder');
    expect(html).toContain('Operator observability');
    expect(html).toContain('safeloop session inspect session-ui-1');
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(html).toContain('agent&lt;script&gt; / tenant-ui');
    expect(html).not.toContain('<script>alert(1)</script>');
  });

  it('renders the latest session detail timeline, proof, memory, and coverage sections', () => {
    const summary = {
      session_id: 'session-detail-1',
      task_ids: ['task-detail-1'],
      primary_task_id: 'task-detail-1',
      agent_id: 'agent-detail',
      tenant_id: 'tenant-detail',
      profile: 'coding',
      task_goal: 'inspect detail',
      started_at: '2026-08-14T00:00:00.000Z',
      last_event_at: '2026-08-14T00:01:00.000Z',
      duration_ms: 60_000,
      work_event_count: 3,
      proposal_count: 1,
      decision_count: 1,
      approval_count: 0,
      execution_count: 1,
      evidence_count: 1,
      artifact_count: 1,
      memory_event_count: 1,
      memory_candidate_count: 1,
      memory_persisted_count: 1,
      memory_rejected_count: 0,
      verified_count: 1,
      partially_verified_count: 0,
      not_verifiable_count: 0,
      failed_count: 0,
      prevented_count: 1,
      final_state: 'verification.recorded',
      latest_summary: 'verified',
    };
    const html = renderFlightRecorderPanel({
      flightRecorder: {
        schema_version: 1,
        sessions: [summary],
        page: { limit: 25, returned_count: 1, total_count: 1, has_more: false, max_limit: 500 },
      },
      flightRecorderDetail: {
        schema_version: 1,
        summary,
        coverage: {
          profile: 'coding',
          paths: [{ path: 'filesystem', status: 'MANAGED', consequential: true }],
          managed_enabled_count: 1,
          unmanaged_enabled_count: 0,
          disabled_count: 0,
          summary: '1 observed path managed.',
        },
        timeline: [{
          id: 'event-detail-1',
          type: 'decision.recorded',
          category: 'DECISION',
          timestamp: '2026-08-14T00:00:10.000Z',
          task_id: 'task-detail-1',
          summary: 'decision made',
          explanation: 'SafeLoop recorded an effective governance decision of DENY.',
          causal_links: { causes: ['missing-link'], linked_event_ids: [], missing_links: ['missing-link'] },
          refs: { decision_id: 'decision-detail-1' },
          data: { disposition: 'DENY', password: '[REDACTED]' },
        }],
        prevented_actions: [{
          event_id: 'event-detail-1',
          timestamp: '2026-08-14T00:00:10.000Z',
          category: 'denied_by_policy',
          reason: 'policy denied',
          approval_could_resolve: false,
          execution_occurred: false,
          related_ids: { decision_id: 'decision-detail-1' },
        }],
        prevention_conflicts: [],
        execution_proofs: [{
          execution_id: 'execution-detail-1',
          executor: 'filesystem',
          operation: 'write',
          verification_status: 'VERIFIED',
          verification_summary: 'hash observed',
          verification_scope: 'target path',
          limitation: 'Filesystem proof covers direct state observed at the resolved target path; file bodies are not included.',
          evidence_ids: ['evidence-detail-1'],
          artifact_ids: ['artifact-detail-1'],
        }],
        evidence: [],
        artifacts: [],
        memory: [{
          memory_id: 'memory-detail-1',
          status: 'ACTIVE',
          decision: 'ALLOW',
          confidence: 0.9,
          source_task: 'task-detail-1',
          source_session: 'session-detail-1',
          evidence_ids: ['evidence-detail-1'],
          artifact_ids: ['artifact-detail-1'],
          persisted: true,
          store: 'reference',
        }],
        known_limitations: ['SafeLoop governs routed/managed execution paths, not arbitrary OS activity.'],
        diagnostics: { work_event_count: 3, legacy_event_count: 3, legacy_unresolved_count: 0, work_events_missing_parent_count: 0, dangling_internal_edge_count: 0 },
      },
    } as unknown as MonitorViewModel);

    expect(html).toContain('Causal Timeline');
    expect(html).toContain('Link unavailable: missing-link');
    expect(html).toContain('Prevented / Conflicts / Unknown');
    expect(html).toContain('Execution Proofs');
    expect(html).toContain('Memory Provenance');
    expect(html).toContain('Evidence / Artifacts');
    expect(html).not.toContain('password</dt>');
  });

  it('renders observability graph conflicts and unknown states without HTML injection', () => {
    const summary = {
      session_id: 'session-observe-ui', task_ids: ['task-observe'], primary_task_id: 'task-observe',
      agent_id: 'agent-observe', tenant_id: 'tenant-observe', profile: 'coding', task_goal: 'observe graph',
      started_at: '2026-08-14T00:00:00.000Z', last_event_at: '2026-08-14T00:01:00.000Z', duration_ms: 60_000,
      work_event_count: 2, proposal_count: 1, decision_count: 1, approval_count: 0, execution_count: 0,
      evidence_count: 0, artifact_count: 0, memory_event_count: 0, memory_candidate_count: 0, memory_persisted_count: 0,
      memory_rejected_count: 0, verified_count: 0, partially_verified_count: 0, not_verifiable_count: 0, failed_count: 0,
      prevented_count: 0, prevention_conflict_count: 1, uncertainty_count: 1, missing_causal_link_count: 1,
      governance_intervention_count: 0, verification_summary: 'Unknown', final_state: 'decision.recorded', latest_summary: 'conflict',
    };
    const html = renderFlightRecorderPanel({
      flightRecorder: { schema_version: 1, sessions: [summary], page: { limit: 25, returned_count: 1, total_count: 1, has_more: false, max_limit: 500 } },
      flightRecorderDetail: {
        schema_version: 1,
        summary,
        coverage: { paths: [], managed_enabled_count: 0, unmanaged_enabled_count: 0, disabled_count: 0, summary: 'Unknown coverage.' },
        timeline: [],
        prevented_actions: [],
        prevention_conflicts: [{
          blocked_event_id: 'deny-1', execution_event_ids: ['exec-1'], category: 'denied_by_policy',
          reason: '<svg onload=alert(1)> authorization=secret-value', execution_occurred: true,
          execution_status: 'observed', temporal_status: 'after_block', related_ids: { decision_id: 'decision-1' },
        }],
        execution_proofs: [], evidence: [], artifacts: [], memory: [], known_limitations: [],
        diagnostics: { work_event_count: 2, legacy_event_count: 2, legacy_unresolved_count: 0, work_events_missing_parent_count: 0, dangling_internal_edge_count: 1 } as any,
        observability: {
          schema_version: 1,
          session_id: 'session-observe-ui',
          browser_metadata: { session_id: 'session-observe-ui', task_or_goal: 'observe graph', event_count: 2, prevention_count: 0, conflict_count: 1, uncertainty_count: 1, execution_count: 0, verification_summary: 'Unknown' },
          summary_cards: [{ label: '1 conflicts', status: 'conflict', description: 'Recorded contradiction' }],
          filters: [{ id: 'conflict', label: 'Conflicts', count: 1 }, { id: 'unknown', label: 'Unknown', count: 1 }],
          graph: {
            nodes: [{ id: 'node-1', kind: 'DECISION', label: '<img src=x onerror=alert(1)>', status: 'conflict', text: 'javascript:alert(1)', badges: [{ label: 'Conflict', status: 'conflict', description: '<script>alert(1)</script>' }], refs: { decision_id: 'decision-1' }, detail: { reason: '<script>alert(1)</script>' } }],
            edges: [{ from: 'missing:parent', to: 'node-1', type: 'missing_reference', recorded: false, label: 'missing recorded reference' }],
            diagnostics: { uses_recorded_causal_links_only: true, missing_reference_count: 1, conflict_count: 1, cycle_detected: false },
          },
          conflict_center: [{ id: 'deny-1', status: 'CONFLICT', label: '<script>alert(1)</script>', description: '<img src=x onerror=alert(1)>', related_ids: { blocked_event_id: 'deny-1', execution_event_ids: ['exec-1'] } }],
        },
      },
    } as unknown as MonitorViewModel);

    expect(html).toContain('Causal Work Graph');
    expect(html).toContain('Conflict Center');
    expect(html).toContain('Recorded links only');
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;');
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).not.toContain('<img src=x onerror=alert(1)>');
    expect(html).not.toContain('<svg onload=alert(1)>');
  });
});
