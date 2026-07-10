import type { MonitorDashboardPayload, MonitorViewModel } from '../../viewModel';
import { renderCommandBar } from './CommandBar';
import { renderCommandRail } from './CommandRail';
import { renderCircuitMapPlaceholder } from './CircuitMapPlaceholder';
import { renderDecisionInspector } from './DecisionInspector';
import { renderDiagnosticsPanel } from './DiagnosticsPanel';
import { renderHumanReviewPanel } from './HumanReviewPanel';
import { renderKpiGrid } from './KpiGrid';
import { renderLatestRunCard } from './LatestRunCard';
import { renderLoopTimecards } from './LoopTimecards';
import { renderOversightPanel } from './OversightPanel';
import { renderRiskPanel } from './RiskPanel';
import { renderSpendPanel } from './SpendPanel';
import { renderHandoffsCard } from './HandoffsCard';
import { renderOperatorSummaryPanel } from './OperatorSummaryPanel';
import { renderLiveActivityPanel } from './LiveActivityPanel';

export function renderAppBody(viewModel: MonitorViewModel): string {
  return `
    <div class="sl-command-center" data-monitor-ui="vite">
      ${renderCommandBar(viewModel)}
      <div class="sl-command-body">
        ${renderCommandRail(viewModel)}
        <main class="sl-canvas">
          ${renderCircuitMapPlaceholder(viewModel)}
          ${renderLiveActivityPanel(viewModel)}
          <details class="operational-details" id="operational-details" data-state-key="operational-details">
            <summary class="sl-lower-summary">
              <span class="sl-lower-title">Operational Details</span>
              <span class="sl-lower-caption">Loop analysis, cost, approvals, evidence ledger, and diagnostics</span>
            </summary>
            <div class="sl-lower-body">
              <section class="overview-metrics" id="overview-metrics">
                ${renderKpiGrid(viewModel)}
                ${renderLatestRunCard(viewModel)}
              </section>
              ${renderOperatorSummaryPanel(viewModel)}
              ${renderOversightPanel(viewModel)}
              ${renderSpendPanel(viewModel)}
              ${renderHandoffsCard(viewModel)}
              ${renderLoopTimecards(viewModel)}
              ${renderRiskPanel(viewModel)}
              ${renderHumanReviewPanel(viewModel)}
              ${renderDiagnosticsPanel(viewModel)}
            </div>
          </details>
        </main>
        ${renderDecisionInspector(viewModel)}
      </div>
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
  <title>Safeloop Command Center</title>
  ${styleBlock}
</head>
<body>
  <script id="safeloop-bootstrap" type="application/json">${bootstrapJson}</script>
  <div id="app">${renderAppBody(payload.viewModel)}</div>
</body>
</html>`;
}
