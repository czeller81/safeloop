import type { MonitorViewModel } from '../../viewModel';
import { escapeHtml, formatList } from '../lib/formatters';

export function renderDiagnosticsPanel(viewModel: MonitorViewModel): string {
  return `
    <section class="panel-block" id="diagnostics">
      <div class="section-heading section-heading-top">
        <div>
          <div class="panel-kicker">Diagnostics</div>
          <h2>Polling and render status</h2>
        </div>
        <div class="section-caption">The monitor should show the fetch state before and after polling.</div>
      </div>
      <div class="diagnostics-grid">
        <article class="diagnostic-card">
          <span>Last poll URL</span>
          <strong>${escapeHtml(viewModel.diagnostics.lastPollUrl)}</strong>
        </article>
        <article class="diagnostic-card">
          <span>HTTP status</span>
          <strong>${escapeHtml(viewModel.diagnostics.lastHttpStatus)}</strong>
        </article>
        <article class="diagnostic-card">
          <span>Last render error</span>
          <strong>${escapeHtml(viewModel.diagnostics.lastRenderError || 'None')}</strong>
        </article>
        <article class="diagnostic-card diag-details">
          <span>Response keys</span>
          <strong>${escapeHtml(formatList(viewModel.diagnostics.responseKeys))}</strong>
        </article>
      </div>
    </section>
  `;
}
