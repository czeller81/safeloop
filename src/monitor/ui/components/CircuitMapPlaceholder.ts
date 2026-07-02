import type { MonitorViewModel } from '../../viewModel';
import { escapeHtml, formatNumber } from '../lib/formatters';

export function renderCircuitMapPlaceholder(viewModel: MonitorViewModel): string {
  const graph = viewModel.circuitGraph;
  const isHistoricalOnly = viewModel.liveActivity?.isHistoricalOnly ?? false;

  if (!graph || (graph.nodes.length === 0 && graph.edges.length === 0)) {
    return `
      <section class="circuit-map-placeholder" id="circuit-map">
        <div class="circuit-map-header">
          <div class="panel-kicker">Agent Circuit Map</div>
          <h2>Topology</h2>
        </div>
        <div class="circuit-map-empty">
          <div class="muted">No agent activity detected. The circuit map will populate when agents, models, and handoffs are active.</div>
        </div>
      </section>
    `;
  }

  const nodesByType = {
    agent: graph.nodes.filter(n => n.type === 'agent').length,
    model: graph.nodes.filter(n => n.type === 'model').length,
    human: graph.nodes.filter(n => n.type === 'human').length,
    tool: graph.nodes.filter(n => n.type === 'tool').length,
    external: graph.nodes.filter(n => n.type === 'external').length,
  };

  const edgesByType = {
    handoff: graph.edges.filter(e => e.type === 'handoff').length,
    model_call: graph.edges.filter(e => e.type === 'model_call').length,
    approval_gate: graph.edges.filter(e => e.type === 'approval_gate').length,
    artifact: graph.edges.filter(e => e.type === 'artifact').length,
  };

  const activeNodes = graph.nodes.filter(n => n.status === 'active').length;
  const waitingNodes = graph.nodes.filter(n => n.status === 'waiting').length;

  const sessionCue = isHistoricalOnly
    ? '<div class="circuit-map-cue muted">Historical view — no active flow path</div>'
    : graph.currentFlowPath.length > 0
      ? `<div class="circuit-map-cue">Active flow: ${graph.currentFlowPath.map(id => `<span class="flow-node">${escapeHtml(id.replace(/^(agent|model|human):/, ''))}</span>`).join(' <span class="flow-arrow">&rarr;</span> ')}</div>`
      : '<div class="circuit-map-cue muted">No active handoff flow</div>';

  return `
    <section class="circuit-map-placeholder" id="circuit-map">
      <div class="circuit-map-header">
        <div class="panel-kicker">Agent Circuit Map</div>
        <h2>Topology</h2>
      </div>
      ${sessionCue}
      <div class="circuit-map-stats">
        <div class="circuit-stat">
          <span class="circuit-stat-value">${escapeHtml(formatNumber(graph.nodes.length))}</span>
          <span class="circuit-stat-label">Nodes</span>
        </div>
        <div class="circuit-stat">
          <span class="circuit-stat-value">${escapeHtml(formatNumber(graph.edges.length))}</span>
          <span class="circuit-stat-label">Edges</span>
        </div>
        <div class="circuit-stat">
          <span class="circuit-stat-value">${escapeHtml(formatNumber(graph.currentFlowPath.length))}</span>
          <span class="circuit-stat-label">Flow path</span>
        </div>
        <div class="circuit-stat">
          <span class="circuit-stat-value">${escapeHtml(formatNumber(activeNodes))}</span>
          <span class="circuit-stat-label">Active</span>
        </div>
        ${waitingNodes > 0 ? `
        <div class="circuit-stat circuit-stat--warn">
          <span class="circuit-stat-value">${escapeHtml(formatNumber(waitingNodes))}</span>
          <span class="circuit-stat-label">Waiting</span>
        </div>` : ''}
      </div>
      <div class="circuit-map-breakdown">
        <div class="circuit-breakdown-row">
          <span>Agents: ${escapeHtml(formatNumber(nodesByType.agent))}</span>
          <span>Models: ${escapeHtml(formatNumber(nodesByType.model))}</span>
          <span>Humans: ${escapeHtml(formatNumber(nodesByType.human))}</span>
        </div>
        <div class="circuit-breakdown-row">
          <span>Handoffs: ${escapeHtml(formatNumber(edgesByType.handoff))}</span>
          <span>Model calls: ${escapeHtml(formatNumber(edgesByType.model_call))}</span>
          <span>Approval gates: ${escapeHtml(formatNumber(edgesByType.approval_gate))}</span>
        </div>
      </div>
    </section>
  `;
}
