import type { MonitorViewModel } from '../../viewModel';
import { escapeHtml, formatNumber, formatTimestamp } from '../lib/formatters';

function renderRiskCards(title: string, items: Array<{ id: string; summary: string; severity?: string; mitigation?: string; timestamp: string }>): string {
  return `
    <div class="risk-group">
      <div class="section-heading">
        <h3>${escapeHtml(title)}</h3>
        <span>${escapeHtml(formatNumber(items.length))}</span>
      </div>
      <div class="risk-list">
        ${items.length ? items.map((item) => `
          <article class="risk-card">
            <div class="risk-card-top">
              <strong>${escapeHtml(item.summary)}</strong>
              <span class="risk-severity ${escapeHtml((item.severity || 'medium').toLowerCase())}">${escapeHtml(item.severity || 'medium')}</span>
            </div>
            <div class="risk-card-meta">${escapeHtml(formatTimestamp(item.timestamp))}</div>
            ${item.mitigation ? `<p>${escapeHtml(item.mitigation)}</p>` : ''}
          </article>
        `).join('') : '<div class="empty-state">No items</div>'}
      </div>
    </div>
  `;
}

export function renderRiskPanel(viewModel: MonitorViewModel): string {
  return `
    <section class="panel-block" id="risks">
      <div class="section-heading section-heading-top">
        <div>
          <div class="panel-kicker">Risks &amp; Guardrails</div>
          <h2>Current risk surface vs. historical ledger</h2>
        </div>
        <div class="section-caption">Current risks affect current readiness. Historical risks are separate.</div>
      </div>
      <div class="risk-grid">
        ${renderRiskCards('Current risks', viewModel.current.risks)}
        ${renderRiskCards('Historical risks', viewModel.historical.risks)}
      </div>
    </section>
  `;
}
