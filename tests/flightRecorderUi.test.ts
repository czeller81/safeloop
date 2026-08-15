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
    expect(html).toContain('Governed session reconstruction');
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
    expect(html).toContain('Prevented By SafeLoop');
    expect(html).toContain('Execution Proofs');
    expect(html).toContain('Memory Provenance');
    expect(html).toContain('Evidence Export');
    expect(html).not.toContain('password</dt>');
  });

});
