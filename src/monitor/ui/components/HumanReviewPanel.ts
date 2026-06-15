import type { MonitorViewModel } from '../../viewModel';
import { escapeHtml, formatNumber } from '../lib/formatters';

function renderApprovalList(title: string, items: Array<{ id: string; summary: string; approver?: string; reason?: string; status: string }>): string {
  return `
    <div class="review-column">
      <div class="section-heading">
        <h3>${escapeHtml(title)}</h3>
        <span>${escapeHtml(formatNumber(items.length))}</span>
      </div>
      <div class="review-list">
        ${items.length ? items.map((item) => `
          <article class="review-card">
            <div class="review-card-top">
              <strong>${escapeHtml(item.summary)}</strong>
              <span class="review-status ${escapeHtml(item.status)}">${escapeHtml(item.status)}</span>
            </div>
            <div class="review-card-meta">${escapeHtml(item.approver || 'No approver')} · ${escapeHtml(item.reason || 'No reason')}</div>
          </article>
        `).join('') : '<div class="empty-state">No items</div>'}
      </div>
    </div>
  `;
}

export function renderHumanReviewPanel(viewModel: MonitorViewModel): string {
  return `
    <section class="panel-block" id="human-review">
      <div class="section-heading section-heading-top">
        <div>
          <div class="panel-kicker">Human Review</div>
          <h2>Approvals and readiness gates</h2>
        </div>
        <div class="section-caption">Current and historical approval queues stay separate.</div>
      </div>
      <div class="review-summary-grid">
        <article class="review-summary-card">
          <span>Current readiness</span>
          <strong>${escapeHtml(formatNumber(viewModel.current.currentReadiness.score))}/100</strong>
          <em>${escapeHtml(viewModel.current.currentReadiness.status)}</em>
        </article>
        <article class="review-summary-card">
          <span>Historical ledger readiness</span>
          <strong>${escapeHtml(formatNumber(viewModel.historical.readiness.score))}/100</strong>
          <em>${escapeHtml(viewModel.historical.readiness.status)}</em>
        </article>
      </div>
      <div class="review-grid">
        ${renderApprovalList('Current approvals', viewModel.current.approvals)}
        ${renderApprovalList('Historical approvals', viewModel.historical.approvals)}
      </div>
    </section>
  `;
}
