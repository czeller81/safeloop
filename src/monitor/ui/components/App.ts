import type { MonitorDashboardPayload, MonitorViewModel } from '../../viewModel';
import { renderDiagnosticsPanel } from './DiagnosticsPanel';
import { renderHero } from './Hero';
import { renderHumanReviewPanel } from './HumanReviewPanel';
import { renderKpiGrid } from './KpiGrid';
import { renderLatestRunCard } from './LatestRunCard';
import { renderLoopTimecards } from './LoopTimecards';
import { renderOversightPanel } from './OversightPanel';
import { renderRiskPanel } from './RiskPanel';
import { renderSidebar } from './Sidebar';
import { renderSpendPanel } from './SpendPanel';
import { renderHandoffsCard } from './HandoffsCard';

export function renderAppBody(viewModel: MonitorViewModel): string {
  return `
    <div class="sl-layout" data-monitor-ui="vite">
      ${renderSidebar(viewModel)}
      <main class="sl-main">
        ${renderHero(viewModel)}
        ${renderKpiGrid(viewModel)}
        ${renderLatestRunCard(viewModel)}
        ${renderHandoffsCard(viewModel)}
        ${renderOversightPanel(viewModel)}
        ${renderSpendPanel(viewModel)}
        ${renderLoopTimecards(viewModel)}
        ${renderRiskPanel(viewModel)}
        ${renderHumanReviewPanel(viewModel)}
        ${renderDiagnosticsPanel(viewModel)}
      </main>
    </div>
  `;
}

export function renderFallbackDocument(payload: MonitorDashboardPayload, cssText = ''): string {
  const bootstrapJson = JSON.stringify(payload).replace(/</g, '\\u003c');
  const styleBlock = cssText ? `<style>${cssText}</style>` : '';
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Safeloop Live Loop Monitor</title>
  ${styleBlock}
</head>
<body>
  <script id="safeloop-bootstrap" type="application/json">${bootstrapJson}</script>
  <div id="app">${renderAppBody(payload.viewModel)}</div>
</body>
</html>`;
}
