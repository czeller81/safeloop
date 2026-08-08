import type { MonitorViewModel } from '../../viewModel';
import { escapeHtml, formatTimestamp } from '../lib/formatters';
import type { DashboardControlState, DashboardRuntimeControl } from '../../runtimeControls';

/**
 * Runtime security controls.
 *
 * The states are rendered as six distinct outcomes rather than a green/red
 * badge, because "explicitly enforced and verified" and "happens to be
 * unreachable today" are different security postures. An operator deciding
 * whether to trust a session has to be able to tell them apart.
 *
 * Only control names, policy variable NAMES, and effect tokens are shown.
 * Environment values never reach this component.
 */

const STATE_COPY: Record<DashboardControlState, { label: string; tone: string; meaning: string }> = {
  DISABLED: {
    label: 'Disabled',
    tone: 'control-ok',
    meaning: 'Explicitly enforced, and the adapter confirmed it at runtime.',
  },
  PENDING_VERIFICATION: {
    label: 'Pending verification',
    tone: 'control-pending',
    meaning: 'Enforcement is declared but the adapter has not confirmed it yet. Not the same as enforced.',
  },
  UNREACHABLE: {
    label: 'Unreachable',
    tone: 'control-weak',
    meaning: 'The path exists but this profile cannot reach it. Weaker than being explicitly disabled.',
  },
  UNMANAGED: {
    label: 'Unmanaged',
    tone: 'control-warn',
    meaning: 'A consequential path exists and SafeLoop has no explicit control over it.',
  },
  VERIFICATION_FAILED: {
    label: 'Verification failed',
    tone: 'control-fail',
    meaning: 'Policy intended to disable this path but verification did not succeed. The session was not started.',
  },
  NOT_APPLICABLE: {
    label: 'Not applicable',
    tone: 'control-muted',
    meaning: 'This control does not apply to the running agent.',
  },
};

function renderVerification(control: DashboardRuntimeControl): string {
  if (!control.verified) {
    return '<div class="control-row"><span>Runtime verification</span><span>Not yet reported</span></div>';
  }
  const outcome = control.verificationPassed ? 'PASSED' : 'FAILED';
  const by = control.verifiedBy ? ` &middot; ${escapeHtml(control.verifiedBy)}` : '';
  return `<div class="control-row"><span>Runtime verification</span><span>${outcome}${by}</span></div>`;
}

function renderPolicy(control: DashboardRuntimeControl): string {
  if (control.policy.length === 0) return '';
  const rows = control.policy.map((entry) => `
    <li><code>${escapeHtml(entry.name)}</code> <span class="control-effect">[${escapeHtml(entry.effect)}]</span></li>
  `).join('');
  return `
    <details class="control-details">
      <summary>Technical details</summary>
      <div class="control-detail-body">
        <div class="control-detail-heading">Launch environment policy</div>
        <ul class="control-policy">${rows}</ul>
        <p class="control-note">Variable names and effects only. SafeLoop never displays environment values.</p>
        ${control.verificationDetail ? `<p class="control-note">${escapeHtml(control.verificationDetail)}</p>` : ''}
        ${control.profile ? `<p class="control-note">Profile: ${escapeHtml(control.profile)}</p>` : ''}
      </div>
    </details>
  `;
}

function renderControl(control: DashboardRuntimeControl): string {
  const copy = STATE_COPY[control.state];
  return `
    <article class="control-card ${escapeHtml(copy.tone)}" data-control-id="${escapeHtml(control.controlId)}" data-control-state="${escapeHtml(control.state)}">
      <div class="control-card-top">
        <strong>${escapeHtml(control.name)}</strong>
        <span class="control-state ${escapeHtml(copy.tone)}">${escapeHtml(copy.label)}</span>
      </div>
      <p class="control-meaning">${escapeHtml(copy.meaning)}</p>
      <div class="control-row"><span>Enforcement</span><span>${escapeHtml(control.enforcement.join(' + ') || 'None declared')}</span></div>
      ${renderVerification(control)}
      <div class="control-row"><span>Scope</span><span>${escapeHtml(control.boundary)}</span></div>
      ${control.rationale ? `<p class="control-rationale">${escapeHtml(control.rationale)}</p>` : ''}
      <div class="control-card-meta">${escapeHtml(formatTimestamp(control.updatedAt))}</div>
      ${renderPolicy(control)}
    </article>
  `;
}

function renderBlocked(controls: DashboardRuntimeControl[]): string {
  const blocked = controls.filter((control) => control.blocked);
  if (blocked.length === 0) return '';
  const items = blocked.map((control) => `
    <li>
      <strong>${escapeHtml(control.name)}</strong> could not be confirmed disabled
      ${control.sessionId ? ` &middot; session <code>${escapeHtml(control.sessionId)}</code>` : ''}
      ${control.verificationDetail ? `<div class="control-note">${escapeHtml(control.verificationDetail)}</div>` : ''}
    </li>
  `).join('');
  return `
    <div class="control-blocked" role="alert">
      <div class="control-blocked-title">Session blocked</div>
      <p>Runtime control verification failed. The session was not started.</p>
      <ul>${items}</ul>
    </div>
  `;
}

export function renderRuntimeControlsPanel(viewModel: MonitorViewModel): string {
  const controls = viewModel.runtimeControls ?? [];

  return `
    <section class="panel-block" id="runtime-controls">
      <div class="section-heading section-heading-top">
        <div>
          <div class="panel-kicker">Runtime Security Controls</div>
          <h2>What this profile enforces, and what was verified</h2>
        </div>
        <div class="section-caption">Enforced for sessions launched through SafeLoop. Processes started outside the governed-session boundary are not covered.</div>
      </div>
      ${renderBlocked(controls)}
      <div class="control-grid">
        ${controls.length
          ? controls.map(renderControl).join('')
          : '<div class="empty-state">No runtime controls declared by the active profile</div>'}
      </div>
    </section>
  `;
}
