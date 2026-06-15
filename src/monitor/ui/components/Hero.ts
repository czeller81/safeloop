import type { MonitorViewModel } from '../../viewModel';
import { escapeHtml, formatTimestamp } from '../lib/formatters';

export function renderHero(viewModel: MonitorViewModel): string {
  return `
    <section class="sl-hero" id="top">
      <div class="hero-top">
        <div class="hero-copy">
          <div class="hero-brand">
            <div class="sl-brand-mark" aria-hidden="true">
              <svg class="safeloop-logo" viewBox="0 0 96 96" fill="none" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Safeloop logo">
                <circle cx="48" cy="48" r="32" stroke="currentColor" stroke-width="3.5" opacity="0.75"/>
                <path d="M29 53c8-11 15-16 19-16 6 0 11 5 19 16" stroke="currentColor" stroke-width="4.5" stroke-linecap="round" stroke-linejoin="round"/>
                <path d="M37 44c3-4 7-6 11-6s8 2 11 6" stroke="currentColor" stroke-width="4.5" stroke-linecap="round" opacity="0.85"/>
                <circle cx="48" cy="59" r="3.5" fill="currentColor"/>
              </svg>
            </div>
            <div class="hero-brand-copy">
              <div class="eyebrow">Safeloop v0.7.0 · live monitor</div>
              <h1>Safeloop</h1>
              <p class="hero-subtitle">Agent Cost, Control &amp; Accountability Monitor</p>
              <p class="hero-subtitle">Clear loop accountability, cleaner release readiness, and a monitor view that separates the active run from the historical ledger.</p>
            </div>
          </div>
          <div class="hero-path">Monitoring: ${escapeHtml(viewModel.status.monitoredPath)}</div>
        </div>
        <div class="hero-meta">
          <span class="sl-meta-pill">Local-only</span>
          <span class="sl-meta-pill">Version v0.7.0</span>
          <span class="sl-meta-pill">${escapeHtml(viewModel.status.connection)}</span>
          <span class="sl-meta-pill">Updated ${escapeHtml(formatTimestamp(viewModel.status.lastUpdated))}</span>
          <span class="sl-meta-pill">Events ${escapeHtml(String(viewModel.status.eventCount))}</span>
        </div>
      </div>
    </section>
  `;
}
