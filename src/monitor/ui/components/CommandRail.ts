import type { MonitorViewModel } from '../../viewModel';
import { escapeHtml, formatCompact, formatNumber } from '../lib/formatters';

const NAV_ITEMS = [
  ['Overview', '#overview', 'OV'],
  ['Traces', '#trace-console', 'TR'],
  ['Loops', '#operational-details', 'LP'],
  ['Approvals', '#operational-details', 'HR'],
  ['Evidence', '#operational-details', 'EV'],
  ['Costs', '#operational-details', 'CO'],
  ['Diagnostics', '#operational-details', 'DX'],
] as const;

function countFor(label: string, viewModel: MonitorViewModel): string {
  switch (label) {
    case 'Traces':
      return formatCompact(viewModel.status.eventCount);
    case 'Loops':
      return formatNumber(viewModel.current.currentLoops.length);
    case 'Approvals':
      return formatNumber(viewModel.current.approvals.filter((approval) => approval.status === 'pending').length);
    case 'Evidence':
      return formatNumber(viewModel.current.artifacts.length + viewModel.historical.artifacts.length);
    case 'Costs':
      return formatCompact(viewModel.tokens.totalTokens);
    default:
      return '';
  }
}

export function renderCommandRail(viewModel: MonitorViewModel): string {
  return `
    <aside class="sl-command-rail" aria-label="Dashboard navigation">
      <nav class="rail-nav rail-nav--quiet">
        <div class="rail-product">
          <div class="rail-product-mark" aria-hidden="true">
            <span></span>
          </div>
          <div>
            <div class="rail-product-name">SafeLoop</div>
            <div class="rail-product-subtitle">Local governance</div>
          </div>
        </div>
        <div class="rail-nav-caption">Workspace</div>
        <div class="rail-nav-links">
          ${NAV_ITEMS.map(([label, href, icon]) => {
            const count = countFor(label, viewModel);
            return `
              <a href="${escapeHtml(href)}" data-nav-section="${escapeHtml(label.toLowerCase())}">
                <span class="rail-nav-icon" aria-hidden="true">${escapeHtml(icon)}</span>
                <span class="rail-nav-label">${escapeHtml(label)}</span>
                ${count ? `<strong>${escapeHtml(count)}</strong>` : ''}
              </a>
            `;
          }).join('')}
        </div>
      </nav>
    </aside>
  `;
}
