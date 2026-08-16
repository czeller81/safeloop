import { classifyMcpAction, segmentActionName, MCP_CLASSIFIER_MAX_TOKENS } from '../src/runtime/mcpActionClassifier';
import { canonicalizeAction } from '../src/runtime/canonicalAction';
import { evaluateProfile, loadProfile } from '../src/runtime/profiles';

type Args = Record<string, unknown>;
type MatrixRow = {
  tool: string;
  tokens: string[];
  category: string;
  consequential: boolean;
  disposition: 'REQUIRE_APPROVAL' | 'ALLOW_WITH_WARNING';
  reason: string;
};

const PROFILES = ['coding', 'research', 'assistant'] as const;
const classify = (tool: string, args: Args = {}, operation = 'call_tool') =>
  classifyMcpAction({ operation, tool, arguments: args });

function disposition(tool: string, args: Args = {}, profileId = 'coding') {
  const action = canonicalizeAction({ action_kind: 'mcp', operation: 'call_tool', tool, arguments: args, agent_id: 'a' } as never);
  return evaluateProfile(loadProfile(profileId), action, '/tmp/ws').disposition;
}

const MATRIX: MatrixRow[] = [
  // destructive command + descriptor-like target
  { tool: 'deleteStatus', tokens: ['delete', 'status'], category: 'descriptor-target command', consequential: true, disposition: 'REQUIRE_APPROVAL', reason: 'delete is a primary command verb and status is the target resource' },
  { tool: 'deleteState', tokens: ['delete', 'state'], category: 'descriptor-target command', consequential: true, disposition: 'REQUIRE_APPROVAL', reason: 'state is a target object when delete is the first token' },
  { tool: 'deleteHistory', tokens: ['delete', 'history'], category: 'descriptor-target command', consequential: true, disposition: 'REQUIRE_APPROVAL', reason: 'history can be the destructive target, not only a report surface' },
  { tool: 'destroyState', tokens: ['destroy', 'state'], category: 'descriptor-target command', consequential: true, disposition: 'REQUIRE_APPROVAL', reason: 'destroy is an exact destructive verb in primary command position' },
  { tool: 'destroyStatus', tokens: ['destroy', 'status'], category: 'descriptor-target command', consequential: true, disposition: 'REQUIRE_APPROVAL', reason: 'status target does not neutralize destroy' },
  { tool: 'purgeHistory', tokens: ['purge', 'history'], category: 'descriptor-target command', consequential: true, disposition: 'REQUIRE_APPROVAL', reason: 'purge history is a common destructive maintenance operation' },
  { tool: 'removeHistory', tokens: ['remove', 'history'], category: 'descriptor-target command', consequential: true, disposition: 'REQUIRE_APPROVAL', reason: 'remove is a command verb and history is its object' },
  { tool: 'wipeState', tokens: ['wipe', 'state'], category: 'descriptor-target command', consequential: true, disposition: 'REQUIRE_APPROVAL', reason: 'wipe state destroys stored state' },
  { tool: 'truncateHistory', tokens: ['truncate', 'history'], category: 'descriptor-target command', consequential: true, disposition: 'REQUIRE_APPROVAL', reason: 'truncate is an exact destructive verb' },
  { tool: 'delete_status', tokens: ['delete', 'status'], category: 'ambiguous command form', consequential: true, disposition: 'REQUIRE_APPROVAL', reason: 'separator-delimited verb_object shape is ambiguous, so SafeLoop chooses conservative approval' },

  // destructive command + multi-token target
  { tool: 'deleteUserStatus', tokens: ['delete', 'user', 'status'], category: 'multi-token descriptor target', consequential: true, disposition: 'REQUIRE_APPROVAL', reason: 'final descriptor is part of the target, not a veto' },
  { tool: 'deleteDeploymentState', tokens: ['delete', 'deployment', 'state'], category: 'multi-token descriptor target', consequential: true, disposition: 'REQUIRE_APPROVAL', reason: 'deployment state is a target object' },
  { tool: 'deleteAccountHistory', tokens: ['delete', 'account', 'history'], category: 'multi-token descriptor target', consequential: true, disposition: 'REQUIRE_APPROVAL', reason: 'account history is the destructive target' },
  { tool: 'removeUserHistory', tokens: ['remove', 'user', 'history'], category: 'multi-token descriptor target', consequential: true, disposition: 'REQUIRE_APPROVAL', reason: 'user history is the object of remove' },
  { tool: 'destroyDeploymentState', tokens: ['destroy', 'deployment', 'state'], category: 'multi-token descriptor target', consequential: true, disposition: 'REQUIRE_APPROVAL', reason: 'state target remains consequential' },
  { tool: 'purgeAuditHistory', tokens: ['purge', 'audit', 'history'], category: 'multi-token descriptor target', consequential: true, disposition: 'REQUIRE_APPROVAL', reason: 'audit history purge is destructive' },
  { tool: 'disableAccountState', tokens: ['disable', 'account', 'state'], category: 'multi-token descriptor target', consequential: true, disposition: 'REQUIRE_APPROVAL', reason: 'disable command against account state is consequential' },
  { tool: 'resetCredentialStatus', tokens: ['reset', 'credential', 'status'], category: 'multi-token descriptor target', consequential: true, disposition: 'REQUIRE_APPROVAL', reason: 'reset command against credential status is consequential' },
  { tool: 'revokeAccessStatus', tokens: ['revoke', 'access', 'status'], category: 'multi-token descriptor target', consequential: true, disposition: 'REQUIRE_APPROVAL', reason: 'revoke access status changes authorization state' },
  { tool: 'terminateWorkerStatus', tokens: ['terminate', 'worker', 'status'], category: 'multi-token descriptor target', consequential: true, disposition: 'REQUIRE_APPROVAL', reason: 'terminate command remains consequential' },
  { tool: 'resetSecurityState', tokens: ['reset', 'security', 'state'], category: 'additional descriptor-target command', consequential: true, disposition: 'REQUIRE_APPROVAL', reason: 'additional invented case for state target' },
  { tool: 'wipeRecoveryState', tokens: ['wipe', 'recovery', 'state'], category: 'additional descriptor-target command', consequential: true, disposition: 'REQUIRE_APPROVAL', reason: 'additional invented case for state target' },
  { tool: 'truncateAuditHistory', tokens: ['truncate', 'audit', 'history'], category: 'additional descriptor-target command', consequential: true, disposition: 'REQUIRE_APPROVAL', reason: 'additional invented case for history target' },
  { tool: 'revokeMembershipStatus', tokens: ['revoke', 'membership', 'status'], category: 'additional descriptor-target command', consequential: true, disposition: 'REQUIRE_APPROVAL', reason: 'additional invented case for status target' },

  // namespace form
  { tool: 'admin.deleteStatus', tokens: ['admin', 'delete', 'status'], category: 'namespaced descriptor target', consequential: true, disposition: 'REQUIRE_APPROVAL', reason: 'namespace is stripped before command grammar' },
  { tool: 'users/deleteUserStatus', tokens: ['users', 'delete', 'user', 'status'], category: 'namespaced descriptor target', consequential: true, disposition: 'REQUIRE_APPROVAL', reason: 'slash namespace is stripped before command grammar' },
  { tool: 'deploy.destroyDeploymentState', tokens: ['deploy', 'destroy', 'deployment', 'state'], category: 'namespaced descriptor target', consequential: true, disposition: 'REQUIRE_APPROVAL', reason: 'dot namespace does not hide command shape' },
  { tool: 'audit.purgeHistory', tokens: ['audit', 'purge', 'history'], category: 'namespaced descriptor target', consequential: true, disposition: 'REQUIRE_APPROVAL', reason: 'dot namespace does not hide purge history' },
  { tool: 'auth.disableAccountState', tokens: ['auth', 'disable', 'account', 'state'], category: 'namespaced descriptor target', consequential: true, disposition: 'REQUIRE_APPROVAL', reason: 'dot namespace does not hide disable account state' },
  { tool: 'security.resetCredentialStatus', tokens: ['security', 'reset', 'credential', 'status'], category: 'namespaced descriptor target', consequential: true, disposition: 'REQUIRE_APPROVAL', reason: 'dot namespace does not hide reset credential status' },

  // digit target interaction
  { tool: 'delete2FAStatus', tokens: ['delete', '2', 'fa', 'status'], category: 'digit descriptor target', consequential: true, disposition: 'REQUIRE_APPROVAL', reason: 'digit boundary preserves delete and status is target' },
  { tool: 'delete2FAState', tokens: ['delete', '2', 'fa', 'state'], category: 'digit descriptor target', consequential: true, disposition: 'REQUIRE_APPROVAL', reason: 'digit boundary preserves delete and state is target' },
  { tool: 'removeV2History', tokens: ['remove', 'v', '2', 'history'], category: 'digit descriptor target', consequential: true, disposition: 'REQUIRE_APPROVAL', reason: 'version token does not swallow remove' },
  { tool: 'destroyV3State', tokens: ['destroy', 'v', '3', 'state'], category: 'digit descriptor target', consequential: true, disposition: 'REQUIRE_APPROVAL', reason: 'version token does not swallow destroy' },
  { tool: 'purgeS3History', tokens: ['purge', 's', '3', 'history'], category: 'digit descriptor target', consequential: true, disposition: 'REQUIRE_APPROVAL', reason: 'S3 token does not neutralize purge history' },
  { tool: 'disable2FAStatus', tokens: ['disable', '2', 'fa', 'status'], category: 'digit descriptor target', consequential: true, disposition: 'REQUIRE_APPROVAL', reason: 'disable remains the command verb' },
  { tool: 'resetV2CredentialStatus', tokens: ['reset', 'v', '2', 'credential', 'status'], category: 'digit descriptor target', consequential: true, disposition: 'REQUIRE_APPROVAL', reason: 'reset remains the command verb' },

  // reporting noun form / past-tense descriptive form / benign UI/report name
  { tool: 'deletionStatus', tokens: ['deletion', 'status'], category: 'reporting noun form', consequential: false, disposition: 'ALLOW_WITH_WARNING', reason: 'deletion is not the exact command verb delete' },
  { tool: 'deletionStatusReport', tokens: ['deletion', 'status', 'report'], category: 'reporting noun form', consequential: false, disposition: 'ALLOW_WITH_WARNING', reason: 'reporting noun phrase' },
  { tool: 'deletedItemStatus', tokens: ['deleted', 'item', 'status'], category: 'past-tense descriptive form', consequential: false, disposition: 'ALLOW_WITH_WARNING', reason: 'deleted is not delete' },
  { tool: 'removedItems', tokens: ['removed', 'items'], category: 'past-tense descriptive form', consequential: false, disposition: 'ALLOW_WITH_WARNING', reason: 'removed is not remove' },
  { tool: 'removalHistory', tokens: ['removal', 'history'], category: 'reporting noun form', consequential: false, disposition: 'ALLOW_WITH_WARNING', reason: 'removal is a noun, not command verb remove' },
  { tool: 'destroyedState', tokens: ['destroyed', 'state'], category: 'past-tense descriptive form', consequential: false, disposition: 'ALLOW_WITH_WARNING', reason: 'destroyed is not destroy' },
  { tool: 'destructionHistory', tokens: ['destruction', 'history'], category: 'reporting noun form', consequential: false, disposition: 'ALLOW_WITH_WARNING', reason: 'destruction is a noun, not command verb destroy' },
  { tool: 'wipeProgress', tokens: ['wipe', 'progress'], category: 'benign progress/reporting name', consequential: false, disposition: 'ALLOW_WITH_WARNING', reason: 'progress is a reporting descriptor, not a target noun' },
  { tool: 'wipeProgressView', tokens: ['wipe', 'progress', 'view'], category: 'benign progress/reporting name', consequential: false, disposition: 'ALLOW_WITH_WARNING', reason: 'progress view is a reporting surface' },
  { tool: 'purgeSchedule', tokens: ['purge', 'schedule'], category: 'benign schedule/reporting name', consequential: false, disposition: 'ALLOW_WITH_WARNING', reason: 'schedule is a reporting descriptor, not a target noun' },
  { tool: 'purgeScheduleView', tokens: ['purge', 'schedule', 'view'], category: 'benign schedule/reporting name', consequential: false, disposition: 'ALLOW_WITH_WARNING', reason: 'schedule view is a reporting surface' },
  { tool: 'truncatePreview', tokens: ['truncate', 'preview'], category: 'benign preview/reporting name', consequential: false, disposition: 'ALLOW_WITH_WARNING', reason: 'preview remains a reporting descriptor, not a target noun' },
  { tool: 'truncatePreviewLength', tokens: ['truncate', 'preview', 'length'], category: 'benign preview/reporting name', consequential: false, disposition: 'ALLOW_WITH_WARNING', reason: 'preview length is a reporting/display property' },
  { tool: 'revocationHistory', tokens: ['revocation', 'history'], category: 'reporting noun form', consequential: false, disposition: 'ALLOW_WITH_WARNING', reason: 'revocation is a noun, not revoke' },
  { tool: 'terminationStatus', tokens: ['termination', 'status'], category: 'reporting noun form', consequential: false, disposition: 'ALLOW_WITH_WARNING', reason: 'termination is a noun, not terminate' },
  { tool: 'forceMultiplier', tokens: ['force', 'multiplier'], category: 'benign UI/report name', consequential: false, disposition: 'ALLOW_WITH_WARNING', reason: 'multiplier remains a reporting descriptor' },
  { tool: 'weather_delete_status', tokens: ['weather', 'delete', 'status'], category: 'reporting surface', consequential: false, disposition: 'ALLOW_WITH_WARNING', reason: 'delete is not in primary command position and trailing status veto still applies' },
  { tool: 'repository_deleted_at', tokens: ['repository', 'deleted', 'at'], category: 'timestamp/reporting surface', consequential: false, disposition: 'ALLOW_WITH_WARNING', reason: 'deleted_at is descriptive metadata' },
  { tool: 'user_removed_at', tokens: ['user', 'removed', 'at'], category: 'timestamp/reporting surface', consequential: false, disposition: 'ALLOW_WITH_WARNING', reason: 'removed_at is descriptive metadata' },
  { tool: 'remove_listener', tokens: ['remove', 'listener'], category: 'benign UI/report name', consequential: false, disposition: 'ALLOW_WITH_WARNING', reason: 'listener remains a reporting/API descriptor, not a destructive target noun' },
  { tool: 'drop_down_menu', tokens: ['drop', 'down', 'menu'], category: 'benign UI/report name', consequential: false, disposition: 'ALLOW_WITH_WARNING', reason: 'drop-down menu is UI terminology' },
  { tool: 'resetStatusPreview', tokens: ['reset', 'status', 'preview'], category: 'benign preview/reporting name', consequential: false, disposition: 'ALLOW_WITH_WARNING', reason: 'preview remains a reporting descriptor' },
  { tool: 'terminationHistoryReport', tokens: ['termination', 'history', 'report'], category: 'reporting noun form', consequential: false, disposition: 'ALLOW_WITH_WARNING', reason: 'reporting noun phrase' },
  { tool: 'revocationStatusView', tokens: ['revocation', 'status', 'view'], category: 'reporting noun form', consequential: false, disposition: 'ALLOW_WITH_WARNING', reason: 'reporting noun phrase' },
];

describe('MCP descriptor-target classification', () => {
  it.each(MATRIX)('$tool ($category): $reason', ({ tool, tokens, consequential }) => {
    expect(segmentActionName(tool)).toEqual(tokens);
    expect(classify(tool)).toBe(consequential);
  });

  it.each(MATRIX)('$tool has expected production disposition', ({ tool, consequential }) => {
    for (const id of PROFILES) {
      const expected = consequential ? 'REQUIRE_APPROVAL' : 'ALLOW_WITH_WARNING';
      expect(disposition(tool, {}, id)).toBe(expected);
    }
  });

  it('keeps descriptor-target evidence out of the fingerprint', () => {
    const action = canonicalizeAction({ action_kind: 'mcp', operation: 'call_tool', tool: 'deleteStatus', arguments: {}, agent_id: 'a' } as never);
    expect(action.mcp_consequential).toBe(true);
  });

  describe('argument-based descriptor target matching', () => {
    it.each([
      ['executeTask', { action: 'deleteStatus' }],
      ['mutate', { operation: 'destroyState' }],
      ['admin', { command: 'purgeHistory' }],
      ['generic', { nested: { action: 'disableAccountState' } }],
    ])('dangerous args on %s are consequential', (tool, args) => expect(classify(tool, args as Args)).toBe(true));

    it.each([
      ['notify', { message: 'deletion status report' }],
      ['label', { label: 'removal history' }],
      ['summary', { text: 'destroyed state summary' }],
      ['help', { help: 'wipe progress view' }],
    ])('descriptive args on %s stay benign', (tool, args) => expect(classify(tool, args as Args)).toBe(false));
  });

  describe('boundedness with descriptor-heavy input', () => {
    it.each([
      ['16 KiB descriptor name', 'deleteStatus'.repeat(1500)],
      ['64 KiB mixed descriptor input', 'deleteStatus_stateHistory_'.repeat(3000)],
      ['many descriptor tokens', 'status_'.repeat(5000)],
      ['long camelCase descriptor input', 'deleteUserStatus'.repeat(2000)],
      ['long digit/case descriptor input', 'delete2FAStatus'.repeat(2000)],
    ])('%s completes quickly and deterministically', (_label, tool) => {
      const started = Date.now();
      const first = classify(tool);
      expect(Date.now() - started).toBeLessThan(1000);
      expect(classify(tool)).toBe(first);
      expect(segmentActionName(tool).length).toBeLessThanOrEqual(MCP_CLASSIFIER_MAX_TOKENS);
    });

    it('bounds deep and wide arguments', () => {
      const wide = Array.from({ length: 50000 }, () => 'deletion status report');
      expect(() => classifyMcpAction({ operation: 'call_tool', tool: 'notify', arguments: wide })).not.toThrow();
      let deep: unknown = { value: 'deleteStatus' };
      for (let i = 0; i < 200; i += 1) deep = { nested: deep };
      expect(() => classifyMcpAction({ operation: 'call_tool', tool: 'notify', arguments: deep })).not.toThrow();
    });
  });
});
