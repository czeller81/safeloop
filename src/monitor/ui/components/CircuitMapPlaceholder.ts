import type { MonitorViewModel, CircuitNode, CircuitEdge, CircuitGraph } from '../../viewModel';
import { escapeHtml, formatCompact, formatCostOrUnavailable, formatNumber } from '../lib/formatters';

// --- Node rendering ---

function nodeTypeIcon(type: CircuitNode['type']): string {
  switch (type) {
    case 'agent': return '\u25CF'; // ●
    case 'model': return '\u26A1'; // ⚡
    case 'human': return '\u25C6'; // ◆
    case 'tool': return '\u2699'; // ⚙
    case 'external': return '\u25CB'; // ○
    default: return '\u25CB';
  }
}

function nodeStatusClass(status: CircuitNode['status']): string {
  switch (status) {
    case 'active': return 'cmap-node--active';
    case 'idle': return 'cmap-node--idle';
    case 'waiting': return 'cmap-node--waiting';
    case 'blocked': return 'cmap-node--blocked';
    case 'completed': return 'cmap-node--completed';
    default: return 'cmap-node--unknown';
  }
}

function renderNodeCard(node: CircuitNode, currency: string): string {
  const statusCls = nodeStatusClass(node.status);
  const icon = nodeTypeIcon(node.type);
  const hasTokens = typeof node.tokenCount === 'number' && node.tokenCount > 0;
  const hasCost = typeof node.costTotal === 'number';
  const pricingAvailable = node.pricingAvailable ?? false;

  let metaHtml = '';
  if (hasTokens) {
    metaHtml += `<span class="cmap-node-tokens">${escapeHtml(formatCompact(node.tokenCount))} tok</span>`;
  }
  if (hasCost) {
    metaHtml += `<span class="cmap-node-cost">${escapeHtml(formatCostOrUnavailable(node.costTotal, pricingAvailable, currency))}</span>`;
  }

  return `
    <div class="cmap-node ${escapeHtml(statusCls)} cmap-node--${escapeHtml(node.type)}" data-node-id="${escapeHtml(node.id)}" data-node-status="${escapeHtml(node.status)}">
      <div class="cmap-node-ring"></div>
      <div class="cmap-node-icon">${icon}</div>
      <div class="cmap-node-label">${escapeHtml(node.label)}</div>
      <div class="cmap-node-type">${escapeHtml(node.type)}</div>
      ${metaHtml ? `<div class="cmap-node-meta">${metaHtml}</div>` : ''}
    </div>
  `;
}

// --- Edge rendering (SVG path between nodes) ---

function edgeStatusClass(status: CircuitEdge['status']): string {
  switch (status) {
    case 'active': return 'cmap-edge--active';
    case 'completed': return 'cmap-edge--completed';
    case 'pending': return 'cmap-edge--pending';
    case 'failed': return 'cmap-edge--failed';
    default: return 'cmap-edge--unknown';
  }
}

function edgeTypeLabel(type: CircuitEdge['type']): string {
  switch (type) {
    case 'handoff': return '\u2192'; // →
    case 'model_call': return '\u26A1'; // ⚡
    case 'approval_gate': return '\u25C6'; // ◆
    case 'artifact': return '\uD83D\uDCC4'; // 📄
    default: return '\u2192';
  }
}

function renderEdgeRow(edge: CircuitEdge): string {
  const statusCls = edgeStatusClass(edge.status);
  const typeIcon = edgeTypeLabel(edge.type);
  const fromLabel = edge.from.replace(/^(agent|model|human|tool|external):/, '');
  const toLabel = edge.to.replace(/^(agent|model|human|tool|external):/, '');

  return `
    <div class="cmap-edge ${escapeHtml(statusCls)} cmap-edge--${escapeHtml(edge.type)}" data-edge-id="${escapeHtml(edge.id)}">
      <span class="cmap-edge-from">${escapeHtml(fromLabel)}</span>
      <span class="cmap-edge-arrow ${escapeHtml(statusCls)}">${typeIcon}</span>
      <span class="cmap-edge-to">${escapeHtml(toLabel)}</span>
      ${edge.summary ? `<span class="cmap-edge-summary">${escapeHtml(edge.summary)}</span>` : ''}
    </div>
  `;
}

// --- Main render function ---

export function renderCircuitMapPlaceholder(viewModel: MonitorViewModel): string {
  const graph = viewModel.circuitGraph;
  const isHistoricalOnly = viewModel.liveActivity?.isHistoricalOnly ?? false;
  const currency = viewModel.spend?.currency ?? 'USD';

  if (!graph || (graph.nodes.length === 0 && graph.edges.length === 0)) {
    return `
      <section class="cmap-section" id="circuit-map">
        <div class="cmap-header">
          <div class="panel-kicker">Agent Circuit Map</div>
          <h2>Topology</h2>
        </div>
        <div class="cmap-empty">
          <div class="muted">No agent activity detected. The circuit map will populate when agents, models, and handoffs are active.</div>
        </div>
      </section>
    `;
  }

  // Session / historical cue
  let sessionCueHtml = '';
  if (isHistoricalOnly) {
    sessionCueHtml = '<div class="cmap-cue cmap-cue--historical">Historical view \u2014 no active flow. All nodes shown in completed state.</div>';
  } else if (graph.currentFlowPath.length > 0) {
    const pathHtml = graph.currentFlowPath
      .map(id => `<span class="cmap-flow-pill">${escapeHtml(id.replace(/^(agent|model|human|tool|external):/, ''))}</span>`)
      .join('<span class="cmap-flow-sep">\u2192</span>');
    sessionCueHtml = `<div class="cmap-cue cmap-cue--active">Active flow: ${pathHtml}</div>`;
  }

  // Sort nodes: active first, then waiting, then others
  const statusOrder: Record<string, number> = { active: 0, waiting: 1, blocked: 2, idle: 3, completed: 4, unknown: 5 };
  const sortedNodes = [...graph.nodes].sort((a, b) => (statusOrder[a.status] ?? 5) - (statusOrder[b.status] ?? 5));

  // Group nodes by type for the visual topology
  const agentNodes = sortedNodes.filter(n => n.type === 'agent');
  const modelNodes = sortedNodes.filter(n => n.type === 'model');
  const humanNodes = sortedNodes.filter(n => n.type === 'human');
  const otherNodes = sortedNodes.filter(n => n.type === 'tool' || n.type === 'external');

  // Render node groups
  function renderNodeGroup(title: string, nodes: CircuitNode[]): string {
    if (nodes.length === 0) return '';
    return `
      <div class="cmap-group">
        <div class="cmap-group-title">${escapeHtml(title)}</div>
        <div class="cmap-group-nodes">
          ${nodes.map(n => renderNodeCard(n, currency)).join('')}
        </div>
      </div>
    `;
  }

  // Render edges grouped by type
  const handoffEdges = graph.edges.filter(e => e.type === 'handoff');
  const modelCallEdges = graph.edges.filter(e => e.type === 'model_call');
  const approvalEdges = graph.edges.filter(e => e.type === 'approval_gate');
  const artifactEdges = graph.edges.filter(e => e.type === 'artifact');

  function renderEdgeGroup(title: string, edges: CircuitEdge[]): string {
    if (edges.length === 0) return '';
    return `
      <div class="cmap-edge-group">
        <div class="cmap-edge-group-title">${escapeHtml(title)}</div>
        ${edges.map(e => renderEdgeRow(e)).join('')}
      </div>
    `;
  }

  // Summary stats bar
  const activeCount = graph.nodes.filter(n => n.status === 'active').length;
  const waitingCount = graph.nodes.filter(n => n.status === 'waiting').length;
  const blockedCount = graph.nodes.filter(n => n.status === 'blocked').length;

  return `
    <section class="cmap-section${isHistoricalOnly ? ' cmap-section--historical' : ''}" id="circuit-map">
      <div class="cmap-header">
        <div class="panel-kicker">Agent Circuit Map</div>
        <h2>Topology</h2>
        <div class="cmap-summary-pills">
          <span class="cmap-pill">${escapeHtml(formatNumber(graph.nodes.length))} nodes</span>
          <span class="cmap-pill">${escapeHtml(formatNumber(graph.edges.length))} edges</span>
          ${activeCount > 0 ? `<span class="cmap-pill cmap-pill--active">${escapeHtml(formatNumber(activeCount))} active</span>` : ''}
          ${waitingCount > 0 ? `<span class="cmap-pill cmap-pill--waiting">${escapeHtml(formatNumber(waitingCount))} waiting</span>` : ''}
          ${blockedCount > 0 ? `<span class="cmap-pill cmap-pill--blocked">${escapeHtml(formatNumber(blockedCount))} blocked</span>` : ''}
        </div>
      </div>
      ${sessionCueHtml}
      <div class="cmap-topology">
        ${renderNodeGroup('Agents', agentNodes)}
        ${renderNodeGroup('Models', modelNodes)}
        ${renderNodeGroup('Human Gates', humanNodes)}
        ${renderNodeGroup('Tools / External', otherNodes)}
      </div>
      <div class="cmap-edges">
        ${renderEdgeGroup('Handoffs', handoffEdges)}
        ${renderEdgeGroup('Model Calls', modelCallEdges)}
        ${renderEdgeGroup('Approval Gates', approvalEdges)}
        ${renderEdgeGroup('Artifacts', artifactEdges)}
      </div>
    </section>
  `;
}
