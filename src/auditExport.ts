import { writeFileSync } from 'fs';
import { mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import { resolve } from 'path';
import { readEventsWithDiagnostics, type SafeloopStreamEvent } from './eventStream';
import { verifyLedger } from './ledgerIntegrity';
import { readSafeloopPolicyConfig, runPolicyDoctor } from './policyConfig';
import { runMcpDoctor } from './mcpDiagnostics';
import { getDashboardSnapshot } from './monitor/dashboardData';
import { buildMonitorDashboardPayload } from './monitor/viewModel';
import { redactSensitive } from './monitor/redact';
import { ensureParentDir, resolveSafeloopPath, type SafeloopStorageOptions } from './localStorage';

export interface AuditExportSummary {
  eventCount: number;
  decisionCount: number;
  approvalCount: number;
  pendingApprovalCount: number;
  riskCount: number;
  artifactCount: number;
  totalEstimatedCost: number;
  totalTokens: number;
}

export interface AuditExportBundle {
  version: 1;
  generatedAt: string;
  baseDir: string;
  localOnly: true;
  securityBoundary: string;
  policy: ReturnType<typeof readSafeloopPolicyConfig>;
  policyDoctor: ReturnType<typeof runPolicyDoctor>;
  ledgerVerification: ReturnType<typeof verifyLedger>;
  mcpDoctor: ReturnType<typeof runMcpDoctor>;
  eventDiagnostics: ReturnType<typeof readEventsWithDiagnostics>['diagnostics'];
  summary: AuditExportSummary;
  approvals: unknown[];
  risks: unknown[];
  artifacts: unknown[];
  costSummary: unknown;
  readiness: unknown;
  timecardSummary: unknown;
  events: SafeloopStreamEvent[];
}

export interface AuditExportWriteResult {
  path: string;
  bundle: AuditExportBundle;
}

export interface AuditExportOptions extends SafeloopStorageOptions {
  host?: string;
  projectRoot?: string;
  outPath?: string;
}

function summarizeEvents(events: SafeloopStreamEvent[], dashboardPayload: ReturnType<typeof buildMonitorDashboardPayload>): AuditExportSummary {
  const vm = dashboardPayload.viewModel;
  const approvals = dashboardPayload.approvals ?? [];
  return {
    eventCount: events.length,
    decisionCount: events.filter((event) => String(event.type).startsWith('decision.')).length,
    approvalCount: approvals.length,
    pendingApprovalCount: approvals.filter((approval: any) => approval.status === 'pending').length,
    riskCount: dashboardPayload.risks?.length ?? 0,
    artifactCount: dashboardPayload.artifacts?.length ?? 0,
    totalEstimatedCost: vm.timecardSummary?.totals.totalEstimatedCost ?? dashboardPayload.costSummary?.totalCost ?? 0,
    totalTokens: vm.timecardSummary?.totals.totalTokens ?? vm.tokens.totalTokens ?? 0,
  };
}

export function createAuditExportBundle(options: AuditExportOptions = {}): AuditExportBundle {
  const baseDir = resolve(options.baseDir ?? process.cwd());
  const mcpDiagnosticBaseDir = mkdtempSync(resolve(tmpdir(), 'safeloop-mcp-doctor-'));
  const eventRead = readEventsWithDiagnostics({ baseDir });
  const dashboardPayload = buildMonitorDashboardPayload(getDashboardSnapshot({ baseDir }));

  const bundle: AuditExportBundle = {
    version: 1,
    generatedAt: new Date().toISOString(),
    baseDir,
    localOnly: true,
    securityBoundary: 'SafeLoop records and mediates actions routed through SafeLoop. It is cooperative governance and not an OS sandbox.',
    policy: readSafeloopPolicyConfig({ baseDir }),
    policyDoctor: runPolicyDoctor({ baseDir }),
    ledgerVerification: verifyLedger({ baseDir }),
    mcpDoctor: runMcpDoctor({
      baseDir: mcpDiagnosticBaseDir,
      host: options.host ?? 'hermes',
      projectRoot: options.projectRoot ?? process.cwd(),
    }),
    eventDiagnostics: eventRead.diagnostics,
    summary: summarizeEvents(eventRead.events, dashboardPayload),
    approvals: dashboardPayload.approvals ?? [],
    risks: dashboardPayload.risks ?? [],
    artifacts: dashboardPayload.artifacts ?? [],
    costSummary: dashboardPayload.costSummary,
    readiness: dashboardPayload.readiness,
    timecardSummary: dashboardPayload.viewModel.timecardSummary,
    events: eventRead.events,
  };

  return redactSensitive(bundle);
}

export function resolveAuditExportPath(options: AuditExportOptions = {}): string {
  return options.outPath
    ? resolve(options.outPath)
    : resolveSafeloopPath(`audit-export-${new Date().toISOString().replace(/[:.]/g, '-')}.json`, options);
}

export function writeAuditExportBundle(options: AuditExportOptions = {}): AuditExportWriteResult {
  const path = resolveAuditExportPath(options);
  const bundle = createAuditExportBundle(options);
  ensureParentDir(path);
  writeFileSync(path, `${JSON.stringify(bundle, null, 2)}\n`, 'utf8');
  return { path, bundle };
}
