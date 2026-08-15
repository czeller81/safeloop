import type { MonitorViewModel } from '../../viewModel';
import { escapeHtml } from '../lib/formatters';

function statusClass(status: string | undefined): string {
  switch (status) {
    case 'healthy': return 'ok';
    case 'degraded': return 'warning';
    case 'unhealthy': return 'danger';
    default: return 'muted';
  }
}

export function renderOperationalHealthPanel(viewModel: MonitorViewModel): string {
  const snapshot = viewModel.operationalHealth;
  if (!snapshot) {
    return `
      <section class="operational-health-panel">
        <div class="panel-heading">
          <div>
            <p class="eyebrow">Runtime Health</p>
            <h2>Operational health unavailable</h2>
          </div>
          <span class="status-pill muted">unknown</span>
        </div>
      </section>
    `;
  }
  const health = snapshot.health;
  const cards = [
    ['Readiness', health.readiness.status, health.readiness.summary],
    ['Governance', health.governance.status, health.governance.summary],
    ['Evidence', health.evidence.status, health.evidence.summary],
    ['Dependencies', health.dependencies.some((entry) => entry.status === 'unhealthy') ? 'unhealthy' : health.dependencies.some((entry) => entry.status === 'degraded') ? 'degraded' : 'healthy', `${health.dependencies.length} components checked`],
    ['Telemetry', health.telemetry.status, health.telemetry.summary],
    ['Synthetic', snapshot.synthetic.status, snapshot.synthetic.summary],
  ];
  const lifecycle = snapshot.policy_lifecycle;
  const metrics = snapshot.metrics.slice(0, 8).map((sample) => `
    <li>
      <span>${escapeHtml(sample.name)}</span>
      <strong>${sample.value}</strong>
    </li>
  `).join('');
  return `
    <section class="operational-health-panel" id="operational-health">
      <div class="panel-heading">
        <div>
          <p class="eyebrow">Runtime Health</p>
          <h2>Operational telemetry</h2>
        </div>
        <span class="status-pill ${statusClass(health.overall_status)}">${escapeHtml(health.overall_status)}</span>
      </div>
      <div class="health-card-grid">
        ${cards.map(([label, status, summary]) => `
          <article class="health-card">
            <div class="health-card-top">
              <span>${escapeHtml(label)}</span>
              <span class="status-dot ${statusClass(status)}"></span>
            </div>
            <strong>${escapeHtml(status)}</strong>
            <p>${escapeHtml(summary)}</p>
          </article>
        `).join('')}
      </div>
      <div class="policy-lifecycle-strip">
        <div>
          <h3>Policy lifecycle</h3>
          <p>${escapeHtml(lifecycle?.active_bundle?.version ?? 'No active bundle')} ? ${escapeHtml(lifecycle?.active_config?.snapshot_id ?? 'No active config')}</p>
        </div>
        <span class="status-pill ${statusClass(lifecycle?.drift_state === 'NO_DRIFT' ? 'healthy' : lifecycle?.drift_state === 'DRIFT' ? 'unhealthy' : 'unknown')}">${escapeHtml(lifecycle?.drift_state ?? 'UNKNOWN')}</span>
      </div>
      <div class="health-metrics-row">
        <div>
          <h3>Synthetic controls</h3>
          <p>${snapshot.synthetic.positive_controls.filter((entry) => entry.status === 'pass').length}/${snapshot.synthetic.positive_controls.length} positive, ${snapshot.synthetic.negative_controls.filter((entry) => entry.status === 'pass').length}/${snapshot.synthetic.negative_controls.length} negative</p>
        </div>
        <ul>${metrics}</ul>
      </div>
    </section>
  `;
}
