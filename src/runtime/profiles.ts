/**
 * Governance profiles.
 *
 * Profiles are data, not code: they live as JSON under `profiles/` and are
 * evaluated by the generic matcher here. Executors never contain profile
 * knowledge — they ask the runtime for a decision and obey it. Adding a
 * profile must never require touching an executor.
 *
 * Evaluation is deterministic:
 *   1. compute structural facts about the canonical action
 *   2. select every rule whose declared conditions all hold (AND within a rule)
 *   3. take the most severe disposition among matching rules
 *
 * Severity ordering is total, so rule file order can never change an outcome.
 */

import { existsSync, readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import { canonicalStringify } from './canonicalAction';
import { classifyWorkspaceRelation, isGovernanceConfigPath, isSensitivePath } from './workspace';
import type { ActionKind, CanonicalAction, ManagedPathDeclaration, RuntimeDispositionCode } from './protocol';

export interface ProfileRuleMatch {
  action_kinds?: ActionKind[];
  operations?: string[];
  tools?: string[];
  methods?: string[];
  workspace?: 'inside' | 'outside' | 'unknown';
  sensitive_path?: boolean;
  governance_config?: boolean;
  destructive?: boolean;
  target_pattern?: string;
  argument_pattern?: string;
  /**
   * Apply patterns case-insensitively. JavaScript has no inline `(?i)` group,
   * so profiles declare this explicitly rather than embedding it in the
   * pattern (which would throw at load time).
   */
  ignore_case?: boolean;
}

export interface ProfileRule {
  id: string;
  description: string;
  disposition: RuntimeDispositionCode;
  match: ProfileRuleMatch;
}

export interface ProfileBudgets {
  maximum_actions?: number;
  maximum_runtime_ms?: number;
  maximum_tokens?: number;
  maximum_cost_usd?: number;
  maximum_retries?: number;
}

export interface GovernanceProfile {
  id: string;
  name: string;
  description: string;
  /** Disposition applied when no rule matches. */
  default_disposition: RuntimeDispositionCode;
  rules: ProfileRule[];
  budgets: ProfileBudgets;
  memory_write_policy: 'allow' | 'allow_with_ttl' | 'require_review' | 'quarantine' | 'reject';
  minimum_memory_confidence: number;
  managed_paths: ManagedPathDeclaration[];
}

export interface ActionFacts {
  action_kind: ActionKind;
  operation: string;
  tool: string;
  method: string;
  workspace: 'inside' | 'outside' | 'unknown';
  sensitive_path: boolean;
  governance_config: boolean;
  destructive: boolean;
  target: string;
  resource: string;
  arguments_json: string;
}

export interface ProfileEvaluation {
  disposition: RuntimeDispositionCode;
  matched_rules: string[];
  explanations: string[];
  facts: ActionFacts;
}

/** Total ordering: a more severe rule always wins, regardless of file order. */
const SEVERITY: Record<RuntimeDispositionCode, number> = {
  ALLOW: 0,
  ALLOW_WITH_WARNING: 1,
  PAUSE: 2,
  REQUIRE_APPROVAL: 3,
  DENY: 4,
  STOP_AGENT: 5,
};

export function moreSevere(a: RuntimeDispositionCode, b: RuntimeDispositionCode): RuntimeDispositionCode {
  return SEVERITY[a] >= SEVERITY[b] ? a : b;
}

/** Operations that destroy or overwrite existing state, per action family. */
const DESTRUCTIVE_OPERATIONS: Record<string, readonly string[]> = {
  filesystem: ['delete', 'overwrite', 'move', 'chmod', 'truncate'],
  git: ['force_push', 'reset_hard', 'clean', 'branch_delete', 'remote_remove', 'remote_set_url', 'tag_delete'],
  http: ['authenticated_mutation'],
  memory: [],
  shell: [],
  mcp: [],
  delegation: [],
  custom: [],
};

const DESTRUCTIVE_SHELL_PATTERNS: readonly RegExp[] = [
  /\brm\s+(-[a-zA-Z]*[rf][a-zA-Z]*\s+)+/,
  /\bmkfs(\.[a-z0-9]+)?\b/,
  /\bdd\s+[^|]*\bof=/,
  /\bshred\b/,
  /:\(\)\s*\{.*\};\s*:/,
  /\bchmod\s+(-R\s+)?(777|a\+rwx)\b/,
  /\bsudo\b/,
  />\s*\/dev\/[sh]d[a-z]/,
];

export function computeActionFacts(action: CanonicalAction, workspace?: string): ActionFacts {
  const argumentsJson = canonicalStringify(action.arguments);
  const pathish = action.target || action.resource;

  const destructive = (() => {
    const family = DESTRUCTIVE_OPERATIONS[action.action_kind] ?? [];
    if (family.includes(action.operation)) return true;
    if (action.action_kind === 'shell') {
      const commandText = `${action.operation} ${argumentsJson}`;
      return DESTRUCTIVE_SHELL_PATTERNS.some((pattern) => pattern.test(commandText));
    }
    return false;
  })();

  return {
    action_kind: action.action_kind,
    operation: action.operation,
    tool: action.tool,
    method: action.method,
    workspace: classifyWorkspaceRelation(pathish || action.cwd, workspace, action.cwd || undefined),
    sensitive_path: isSensitivePath(pathish, action.cwd || undefined),
    governance_config: isGovernanceConfigPath(pathish, action.cwd || undefined),
    destructive,
    target: action.target,
    resource: action.resource,
    arguments_json: argumentsJson,
  };
}

function ruleMatches(rule: ProfileRule, facts: ActionFacts): boolean {
  const { match } = rule;
  if (match.action_kinds?.length && !match.action_kinds.includes(facts.action_kind)) return false;
  if (match.operations?.length && !match.operations.includes(facts.operation)) return false;
  if (match.tools?.length && !match.tools.includes(facts.tool)) return false;
  if (match.methods?.length && !match.methods.includes(facts.method)) return false;
  if (match.workspace && match.workspace !== facts.workspace) return false;
  if (typeof match.sensitive_path === 'boolean' && match.sensitive_path !== facts.sensitive_path) return false;
  if (typeof match.governance_config === 'boolean' && match.governance_config !== facts.governance_config) return false;
  if (typeof match.destructive === 'boolean' && match.destructive !== facts.destructive) return false;
  const flags = match.ignore_case ? 'i' : '';
  if (match.target_pattern && !new RegExp(match.target_pattern, flags).test(facts.target || facts.resource)) return false;
  if (match.argument_pattern) {
    // Shell and MCP intent lives in the operation as well as the arguments, so
    // both are offered to the pattern. Otherwise `git push` written as a raw
    // shell string would match while the structured form would not.
    const haystack = `${facts.operation} ${facts.tool} ${facts.arguments_json}`;
    if (!new RegExp(match.argument_pattern, flags).test(haystack)) return false;
  }
  return true;
}

export function evaluateProfile(
  profile: GovernanceProfile,
  action: CanonicalAction,
  workspace?: string,
): ProfileEvaluation {
  const facts = computeActionFacts(action, workspace);
  const matched: ProfileRule[] = profile.rules.filter((rule) => ruleMatches(rule, facts));

  const disposition = matched.reduce<RuntimeDispositionCode>(
    (current, rule) => moreSevere(current, rule.disposition),
    profile.default_disposition,
  );

  return {
    disposition,
    matched_rules: matched.map((rule) => rule.id),
    explanations: matched.map((rule) => `${rule.id}: ${rule.description}`),
    facts,
  };
}

// --- Loading --------------------------------------------------------------

export function profileDirectory(): string {
  const candidates = [
    join(__dirname, '..', '..', 'profiles'),
    join(__dirname, '..', '..', '..', 'profiles'),
    join(process.cwd(), 'profiles'),
  ];
  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }
  throw new Error('SafeLoop profile directory not found.');
}

export function listProfiles(): string[] {
  return readdirSync(profileDirectory())
    .filter((name) => name.endsWith('.profile.json'))
    .map((name) => name.replace(/\.profile\.json$/, ''))
    .sort();
}

const cache = new Map<string, GovernanceProfile>();

export function loadProfile(id: string): GovernanceProfile {
  const cached = cache.get(id);
  if (cached) return cached;

  const path = join(profileDirectory(), `${id}.profile.json`);
  if (!existsSync(path)) {
    throw new Error(`Unknown SafeLoop profile: ${id}. Available: ${listProfiles().join(', ')}`);
  }
  const profile = JSON.parse(readFileSync(path, 'utf8')) as GovernanceProfile;
  validateProfile(profile);
  cache.set(id, profile);
  return profile;
}

export function validateProfile(profile: GovernanceProfile): void {
  if (!profile.id) throw new Error('Profile is missing an id.');
  if (!(profile.default_disposition in SEVERITY)) {
    throw new Error(`Profile ${profile.id} has an invalid default_disposition.`);
  }
  const seen = new Set<string>();
  for (const rule of profile.rules ?? []) {
    if (!rule.id) throw new Error(`Profile ${profile.id} has a rule without an id.`);
    if (seen.has(rule.id)) throw new Error(`Profile ${profile.id} has duplicate rule id: ${rule.id}`);
    seen.add(rule.id);
    if (!(rule.disposition in SEVERITY)) {
      throw new Error(`Profile ${profile.id} rule ${rule.id} has an invalid disposition.`);
    }
    for (const pattern of [rule.match.target_pattern, rule.match.argument_pattern]) {
      if (pattern) {
        try {
          new RegExp(pattern, rule.match.ignore_case ? 'i' : '');
        } catch {
          throw new Error(`Profile ${profile.id} rule ${rule.id} has an invalid regular expression: ${pattern}`);
        }
      }
    }
  }
}

/** Clears the profile cache. Used by tests and by `safeloop daemon reload`. */
export function clearProfileCache(): void {
  cache.clear();
}
