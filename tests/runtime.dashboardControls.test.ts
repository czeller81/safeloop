/**
 * Dashboard visibility for runtime security controls.
 *
 * The point of these tests is that an operator can tell, without reading
 * source, whether a control is explicitly enforced, merely unreachable,
 * unmanaged, or failed verification — and that the dashboard can never show a
 * compliant-looking session when verification did not succeed.
 */

import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { createSafeloopRuntime, computeControlStatus, type SafeloopRuntime, type SessionHandle } from '../src/runtime/runtimeCore';
import { loadProfile, type RuntimeControlDeclaration } from '../src/runtime/profiles';
import { readEvents } from '../src/eventStream';
import {
  controlsCompliant,
  deriveRuntimeControls,
  type DashboardRuntimeControl,
} from '../src/monitor/runtimeControls';
import { renderRuntimeControlsPanel } from '../src/monitor/ui/components/RuntimeControlsPanel';
import { validateProtocol } from '../src/runtime/schemaValidator';
import type { MonitorViewModel } from '../src/monitor/viewModel';

let baseDir: string;
let runtime: SafeloopRuntime;
let handle: SessionHandle;

function render(controls: DashboardRuntimeControl[]): string {
  return renderRuntimeControlsPanel({ runtimeControls: controls } as unknown as MonitorViewModel);
}

function controlsFromLedger(): DashboardRuntimeControl[] {
  return deriveRuntimeControls(readEvents({ baseDir }));
}

function declaration(overrides: Partial<RuntimeControlDeclaration> = {}): RuntimeControlDeclaration {
  return {
    control_id: 'dependency_installation',
    name: 'Lazy dependency installation',
    intended_state: 'DISABLED',
    consequential: true,
    requires_runtime_verification: true,
    enforcement: ['profile launch_environment', 'adapter runtime verification'],
    policy: [
      { name: 'HERMES_DISABLE_LAZY_INSTALLS', effect: 'enforced' },
      { name: 'HERMES_LAZY_INSTALL_TARGET', effect: 'unset' },
    ],
    boundary: 'Enforced for sessions launched through SafeLoop.',
    ...overrides,
  };
}

beforeEach(() => {
  baseDir = mkdtempSync(join(tmpdir(), 'safeloop-v02-dash-'));
  runtime = createSafeloopRuntime({ storageOptions: { baseDir }, defaultProfile: 'coding' });
  handle = runtime.startSession({ agent: { agent_id: 'hermes' }, tenant_id: 'tenant-a', profile: 'coding' });
});

afterEach(() => {
  rmSync(baseDir, { recursive: true, force: true });
});

// 1
describe('DISABLED renders when enforcement and verification both pass', () => {
  it('reports DISABLED only after the adapter confirms it', () => {
    const status = runtime.reportControlVerification(handle.credential, {
      session_id: handle.session.session_id,
      control_id: 'dependency_installation',
      passed: true,
      verified_by: 'hermes.safeloop_guard',
    });

    expect(status.state).toBe('DISABLED');
    expect(validateProtocol('runtime-control-status', status).valid).toBe(true);

    const controls = controlsFromLedger();
    expect(controls[0].state).toBe('DISABLED');

    const html = render(controls);
    expect(html).toContain('Disabled');
    expect(html).toContain('data-control-state="DISABLED"');
    expect(html).toContain('PASSED');
  });
});

// 2
describe('UNREACHABLE is not mislabeled DISABLED', () => {
  it('keeps the two states distinct in model and markup', () => {
    const unreachable = computeControlStatus(
      declaration({ intended_state: 'UNREACHABLE', requires_runtime_verification: false }),
      undefined,
    );
    expect(unreachable.state).toBe('UNREACHABLE');

    const html = render([{ ...controlShape(), state: 'UNREACHABLE' }]);
    expect(html).toContain('data-control-state="UNREACHABLE"');
    expect(html).toContain('Unreachable');
    expect(html).not.toContain('data-control-state="DISABLED"');
    // The copy must say why it is weaker, not just name it.
    expect(html).toMatch(/Weaker than being explicitly disabled/i);
  });

  it('never reports DISABLED while verification is only intended', () => {
    // A declaration alone is an intention. Before the adapter confirms it, the
    // honest answer is PENDING_VERIFICATION.
    expect(computeControlStatus(declaration(), undefined).state).toBe('PENDING_VERIFICATION');
    expect(controlsFromLedger()[0].state).toBe('PENDING_VERIFICATION');
    expect(render(controlsFromLedger())).not.toContain('data-control-state="DISABLED"');
  });
});

// 3
describe('UNMANAGED is visibly distinct', () => {
  it('renders its own state and explanation', () => {
    const html = render([{ ...controlShape(), state: 'UNMANAGED' }]);
    expect(html).toContain('data-control-state="UNMANAGED"');
    expect(html).toContain('Unmanaged');
    expect(html).toMatch(/SafeLoop has no explicit control/i);
  });

  it('gives each state a distinct tone class, so none collapse together', () => {
    const states: DashboardRuntimeControl['state'][] = [
      'DISABLED', 'PENDING_VERIFICATION', 'UNREACHABLE', 'UNMANAGED', 'VERIFICATION_FAILED', 'NOT_APPLICABLE',
    ];
    const tones = states.map((state) => {
      const html = render([{ ...controlShape(), state }]);
      return html.match(/class="control-state (control-[a-z]+)"/)?.[1];
    });
    expect(new Set(tones).size).toBe(states.length);
  });
});

// 4
describe('VERIFICATION_FAILED is reported when runtime verification fails', () => {
  it('records the failure and never claims DISABLED', () => {
    const status = runtime.reportControlVerification(handle.credential, {
      session_id: handle.session.session_id,
      control_id: 'dependency_installation',
      passed: false,
      verified_by: 'hermes.safeloop_guard',
      detail: 'gate could not be confirmed disabled',
    });

    expect(status.state).toBe('VERIFICATION_FAILED');

    const controls = controlsFromLedger();
    expect(controls[0].state).toBe('VERIFICATION_FAILED');
    expect(controls[0].blocked).toBe(true);

    const html = render(controls);
    expect(html).toContain('data-control-state="VERIFICATION_FAILED"');
    expect(html).toContain('Verification failed');
    expect(html).not.toContain('data-control-state="DISABLED"');
  });
});

// 5
describe('a failed seal produces a blocked-session state', () => {
  it('surfaces a blocked session rather than a generic error', () => {
    runtime.reportControlVerification(handle.credential, {
      session_id: handle.session.session_id,
      control_id: 'dependency_installation',
      passed: false,
      detail: 'LazyInstallStillEnabled',
    });

    const entry = runtime.status().sessions.find((item) => item.session_id === handle.session.session_id)!;
    expect(entry.blocked_reason).toMatch(/could not be confirmed disabled/i);

    const html = render(controlsFromLedger());
    expect(html).toContain('control-blocked');
    expect(html).toContain('Session blocked');
    expect(html).toMatch(/The session was not started/i);
    expect(html).toContain('role="alert"');
  });

  it('keeps the technical detail behind an expandable control', () => {
    runtime.reportControlVerification(handle.credential, {
      session_id: handle.session.session_id,
      control_id: 'dependency_installation',
      passed: false,
      detail: 'gate returned allowed',
    });
    const html = render(controlsFromLedger());
    expect(html).toContain('<details');
    expect(html).toContain('Technical details');
  });
});

// 6
describe('the governance boundary is visible', () => {
  it('states the scope and does not claim host-wide enforcement', () => {
    runtime.reportControlVerification(handle.credential, {
      session_id: handle.session.session_id, control_id: 'dependency_installation', passed: true,
    });
    const html = render(controlsFromLedger());

    expect(html).toMatch(/Enforced for sessions launched through SafeLoop/i);
    expect(html).toMatch(/Processes started outside the (SafeLoop )?governed-session boundary are not covered/i);
    expect(html).not.toMatch(/can never install|cannot install packages on this machine|host-wide/i);
  });
});

// 7
describe('the dashboard never displays secrets', () => {
  it('shows policy variable names and effects but no values', () => {
    process.env.HERMES_LAZY_INSTALL_TARGET = '/tmp/super-secret-durable-target';
    try {
      runtime.reportControlVerification(handle.credential, {
        session_id: handle.session.session_id, control_id: 'dependency_installation', passed: true,
      });
      const html = render(controlsFromLedger());

      expect(html).toContain('HERMES_DISABLE_LAZY_INSTALLS');
      expect(html).toContain('[enforced]');
      expect(html).toContain('[unset]');
      expect(html).not.toContain('super-secret-durable-target');
    } finally {
      delete process.env.HERMES_LAZY_INSTALL_TARGET;
    }
  });

  it('drops any value that reaches the ledger inside a policy entry', () => {
    const controls = deriveRuntimeControls([{
      id: 'e1', type: 'runtime.control.verified', timestamp: new Date().toISOString(),
      agentId: 'hermes', sessionId: 's1', summary: 'x',
      metadata: {
        controlId: 'c', controlName: 'C', controlState: 'DISABLED',
        policy: [{ name: 'SECRET_VAR', effect: 'enforced', value: 'leaked-value' }],
      },
    } as never]);

    expect(controls[0].policy).toEqual([{ name: 'SECRET_VAR', effect: 'enforced' }]);
    expect(JSON.stringify(controls[0])).not.toContain('leaked-value');
    expect(render(controls)).not.toContain('leaked-value');
  });

  it('never renders a runtime credential or signing secret', () => {
    runtime.reportControlVerification(handle.credential, {
      session_id: handle.session.session_id, control_id: 'dependency_installation', passed: true,
    });
    const html = render(controlsFromLedger());
    expect(html).not.toContain(handle.credential);
  });
});

// 8
describe('a hostile parent environment cannot make the dashboard claim enabled', () => {
  it('reports DISABLED from the governed profile regardless of the parent target', () => {
    // The parent process sets the durable install target that would otherwise
    // let installs proceed. The profile unsets it, and the dashboard reflects
    // the governed profile, not the ambient environment.
    process.env.HERMES_LAZY_INSTALL_TARGET = '/tmp/hostile-durable-target';
    try {
      runtime.reportControlVerification(handle.credential, {
        session_id: handle.session.session_id, control_id: 'dependency_installation', passed: true,
      });
      const controls = controlsFromLedger();

      expect(controls[0].state).toBe('DISABLED');
      expect(controls[0].policy).toContainEqual({ name: 'HERMES_LAZY_INSTALL_TARGET', effect: 'unset' });
      expect(render(controls)).not.toContain('hostile-durable-target');
    } finally {
      delete process.env.HERMES_LAZY_INSTALL_TARGET;
    }
  });

  it('treats a pending control as non-compliant so ambient state cannot look green', () => {
    expect(controlsCompliant(controlsFromLedger())).toBe(false);
    runtime.reportControlVerification(handle.credential, {
      session_id: handle.session.session_id, control_id: 'dependency_installation', passed: true,
    });
    expect(controlsCompliant(controlsFromLedger())).toBe(true);
  });

  it('never reports a consequential unmanaged control as compliant', () => {
    expect(controlsCompliant([{ ...controlShape(), state: 'UNMANAGED', consequential: true }])).toBe(false);
    expect(controlsCompliant([{ ...controlShape(), state: 'VERIFICATION_FAILED' }])).toBe(false);
  });
});

// 9
describe('status comes from recorded evidence, not hard-coded UI', () => {
  it('renders nothing when the ledger holds no control events', () => {
    const html = render(deriveRuntimeControls([]));
    expect(html).toContain('No runtime controls declared');
    expect(html).not.toContain('Lazy dependency installation');
  });

  it('takes the control name, policy, and boundary from the event payload', () => {
    const controls = deriveRuntimeControls([{
      id: 'e1', type: 'runtime.control.verified', timestamp: new Date().toISOString(),
      agentId: 'other-agent', sessionId: 's1', summary: 'x',
      metadata: {
        controlId: 'network_egress', controlName: 'Network egress',
        controlState: 'DISABLED', consequential: true,
        enforcement: ['profile firewall policy'],
        policy: [{ name: 'SOME_AGENT_NO_NET', effect: 'enforced' }],
        boundary: 'Enforced for sessions launched through SafeLoop.',
      },
    } as never]);

    // Nothing Hermes-specific: the UI renders whatever the profile declared.
    expect(controls[0].name).toBe('Network egress');
    const html = render(controls);
    expect(html).toContain('Network egress');
    expect(html).toContain('SOME_AGENT_NO_NET');
    expect(html).not.toContain('HERMES');
  });

  it('lets a later verification supersede the declaration', () => {
    const now = Date.now();
    const controls = deriveRuntimeControls([
      { id: 'a', type: 'runtime.control.declared', timestamp: new Date(now).toISOString(), agentId: 'h', sessionId: 's1', summary: '',
        metadata: { controlId: 'c', controlName: 'C', controlState: 'PENDING_VERIFICATION' } },
      { id: 'b', type: 'runtime.control.verified', timestamp: new Date(now + 1000).toISOString(), agentId: 'h', sessionId: 's1', summary: '',
        metadata: { controlId: 'c', controlName: 'C', controlState: 'DISABLED' } },
    ] as never);
    expect(controls).toHaveLength(1);
    expect(controls[0].state).toBe('DISABLED');
  });
});

// 10
describe('the control model is generic, not Hermes-specific', () => {
  it('carries no agent name in SafeLoop source', () => {
    const source = [
      require('fs').readFileSync('src/monitor/runtimeControls.ts', 'utf8'),
      require('fs').readFileSync('src/monitor/ui/components/RuntimeControlsPanel.ts', 'utf8'),
      require('fs').readFileSync('src/runtime/profiles.ts', 'utf8'),
    ].join('\n');
    expect(source).not.toMatch(/HERMES_|hermes/i);
  });

  it('computes state for a future agent control with no code change', () => {
    const status = computeControlStatus(
      declaration({
        control_id: 'browser_automation',
        name: 'Browser automation',
        policy: [{ name: 'SOME_FUTURE_AGENT_NO_BROWSER', effect: 'enforced' }],
      }),
      { performed: true, passed: true },
    );
    expect(status.state).toBe('DISABLED');
    expect(status.name).toBe('Browser automation');
    expect(validateProtocol('runtime-control-status', status).valid).toBe(true);
  });

  it('declares the control in every shipped profile as data', () => {
    for (const id of ['coding', 'research', 'assistant', 'strict-local']) {
      const controls = loadProfile(id).runtime_controls ?? [];
      const dependency = controls.find((control) => control.control_id === 'dependency_installation');
      expect({ id, found: Boolean(dependency) }).toEqual({ id, found: true });
      expect(dependency?.requires_runtime_verification).toBe(true);
      expect(dependency?.boundary).toMatch(/launched through SafeLoop/i);
    }
  });
});

/** Minimal shape for rendering a single control in a chosen state. */
function controlShape(): DashboardRuntimeControl {
  return {
    sessionId: 's1',
    agentId: 'agent',
    profile: 'coding',
    controlId: 'dependency_installation',
    name: 'Lazy dependency installation',
    state: 'DISABLED',
    consequential: true,
    enforcement: ['profile launch_environment', 'adapter runtime verification'],
    policy: [
      { name: 'HERMES_DISABLE_LAZY_INSTALLS', effect: 'enforced' },
      { name: 'HERMES_LAZY_INSTALL_TARGET', effect: 'unset' },
    ],
    boundary: 'Enforced for sessions launched through SafeLoop. Processes started outside the SafeLoop governed-session boundary are not covered by this control.',
    verified: true,
    verificationPassed: true,
    updatedAt: new Date().toISOString(),
    blocked: false,
  };
}
