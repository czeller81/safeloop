import {
  classifyMcpAction,
  segmentActionName,
  MCP_CLASSIFIER_MAX_TOKENS,
} from '../src/runtime/mcpActionClassifier';
import { evaluateProfile, loadProfile, isMcpConsequential } from '../src/runtime/profiles';
import { canonicalizeAction } from '../src/runtime/canonicalAction';

type Args = Record<string, unknown>;
const call = (tool: string, args: Args = {}, operation = 'call_tool') => ({ operation, tool, arguments: args });
const classify = (tool: string, args: Args = {}, operation = 'call_tool') => classifyMcpAction(call(tool, args, operation));

/** Full production path: proposal -> canonicalizeAction -> evaluateProfile. */
function disposition(tool: string, args: Args = {}, profileId = 'coding') {
  const action = canonicalizeAction({ action_kind: 'mcp', operation: 'call_tool', tool, arguments: args, agent_id: 'a' } as never);
  return evaluateProfile(loadProfile(profileId), action, '/tmp/ws').disposition;
}

const PROFILES = ['coding', 'research', 'assistant'] as const;

// ── Destructive corpus: [name, convention, why] ──────────────────────────────
const DESTRUCTIVE: Array<[string, string]> = [
  ['delete_repository', 'snake_case'],
  ['drop_database', 'snake_case'],
  ['wipe_store', 'snake_case'],
  ['destroy_repository', 'snake_case'],
  ['force_push', 'snake_case'],
  ['purge_cache', 'snake_case'],
  ['deleteRepository', 'camelCase'],
  ['deleteRepo', 'camelCase'],
  ['removeUser', 'camelCase'],
  ['dropDatabase', 'camelCase'],
  ['wipeStore', 'camelCase'],
  ['destroyAccount', 'camelCase'],
  ['forcePush', 'camelCase'],
  ['hardDeleteUser', 'camelCase compound'],
  ['softDeleteRepository', 'camelCase compound'],
  ['purgeCache', 'camelCase'],
  ['revokeToken', 'camelCase'],
  ['terminateSession', 'camelCase'],
  ['eraseDataset', 'camelCase'],
  ['purgeBucket', 'camelCase'],
  ['terminateAccount', 'camelCase'],
  ['revokeCredential', 'camelCase'],
  ['DeleteRepository', 'PascalCase'],
  ['DropDatabase', 'PascalCase'],
  ['WipeStore', 'PascalCase'],
  ['DestroyAccount', 'PascalCase'],
  ['ForcePush', 'PascalCase'],
  ['delete-repository', 'kebab-case'],
  ['repo-delete', 'kebab-case object_verb'],
  ['drop-database', 'kebab-case'],
  ['github-deleteRepository', 'kebab + camel'],
  ['DELETE_REPOSITORY', 'SCREAMING_SNAKE'],
  ['DROP_DATABASE', 'SCREAMING_SNAKE'],
  ['FORCE_PUSH', 'SCREAMING_SNAKE'],
  ['github.delete_repo', 'dot namespace'],
  ['github.deleteRepository', 'dot namespace + camel'],
  ['github/DeleteRepository', 'slash namespace + Pascal'],
  ['admin.dropDatabase', 'dot namespace'],
  ['db.drop_database', 'dot namespace'],
  ['users.removeUser', 'dot namespace'],
  ['repo.forcePush', 'dot namespace'],
  ['deleteAPIKey', 'acronym'],
  ['removeSSHKey', 'acronym'],
  ['dropDB', 'acronym'],
  ['wipeS3Bucket', 'acronym + digit'],
  ['destroyVM', 'acronym'],
  ['revokeJWT', 'acronym'],
  ['deleteUser2FA', 'digit boundary'],
  ['removeV2Token', 'digit boundary'],
  ['dropDB2Table', 'digit boundary'],
];

// ── Benign corpus: near-matches that must NOT gate on the name alone ─────────
const BENIGN: Array<[string, string]> = [
  ['weather_delete_status', 'descriptor-terminated'],
  ['deleted_items', 'past participle + descriptor'],
  ['undelete', 'negated verb'],
  ['removed_items', 'past participle'],
  ['drop_down_menu', 'compound noun'],
  ['wipe_counter', 'descriptor-terminated'],
  ['destroyed_count', 'past participle + descriptor'],
  ['delete_preview', 'descriptor-terminated'],
  ['delete_status', 'descriptor-terminated'],
  ['deletion_preview', 'nominalization'],
  ['removal_history', 'nominalization'],
  ['force_multiplier', 'descriptor-terminated'],
  ['push_notification_status', 'descriptor-terminated'],
  ['repository_deleted_at', 'timestamp field'],
  ['user_removed_at', 'timestamp field'],
  ['remove_listener', 'descriptor-terminated'],
  ['list_resources', 'no destructive verb'],
  ['removed_resources', 'past participle'],
  // independent inventions, not from the reviewer's list
  ['deletionAuditReport', 'nominalization + report'],
  ['removalPolicyPreview', 'nominalization + preview'],
  ['purgeScheduleSummary', 'descriptor-terminated'],
  ['revocationHistoryList', 'nominalization + list'],
  ['terminationNoticeBanner', 'nominalization + banner'],
  ['wipeProgressWidget', 'descriptor-terminated'],
  ['destroyRequestCount', 'descriptor-terminated'],
  ['dropEventListeners', 'descriptor-terminated'],
  ['forceFieldTooltip', 'descriptor-terminated'],
  ['eraseAttemptLog', 'descriptor-terminated'],
  ['undeleteHint', 'negated verb + descriptor'],
  ['archivedItemsReport', 'no destructive verb'],
];

// ── Morphology: related words that are not command verbs ─────────────────────
const MORPHOLOGY = ['undelete', 'deleted', 'deletion', 'removed', 'removal', 'destroyed',
  'destruction', 'wiped', 'wipeable', 'droppable', 'forceful'];

describe('MCP action classification', () => {
  describe('tokenizer', () => {
    it.each([
      ['deleteRepository', ['delete', 'repository']],
      ['DropDatabase', ['drop', 'database']],
      ['github.delete_repo', ['github', 'delete', 'repo']],
      ['forcePush', ['force', 'push']],
      ['weather_delete_status', ['weather', 'delete', 'status']],
      ['deleteAPIKey', ['delete', 'api', 'key']],
      ['DELETE_REPOSITORY', ['delete', 'repository']],
      ['repo-delete', ['repo', 'delete']],
    ])('segments %s', (input, expected) => {
      expect(segmentActionName(input)).toEqual(expected);
    });

    it('bounds token count on hostile input', () => {
      expect(segmentActionName('a_'.repeat(5000)).length).toBeLessThanOrEqual(MCP_CLASSIFIER_MAX_TOKENS);
    });
  });

  describe('destructive names are consequential', () => {
    it.each(DESTRUCTIVE)('%s (%s)', (tool) => {
      expect(classify(tool)).toBe(true);
    });

    it.each(DESTRUCTIVE)('%s (%s) gates through the production path', (tool) => {
      for (const id of PROFILES) expect(disposition(tool, {}, id)).toBe('REQUIRE_APPROVAL');
    });
  });

  describe('benign near-matches stay benign', () => {
    it.each(BENIGN)('%s (%s)', (tool) => {
      expect(classify(tool)).toBe(false);
    });

    it.each(BENIGN)('%s (%s) is not approval-gated by name', (tool) => {
      for (const id of PROFILES) expect(disposition(tool, {}, id)).not.toBe('REQUIRE_APPROVAL');
    });
  });

  it.each(MORPHOLOGY)('morphological form %s is not a command verb', (tool) => {
    expect(classify(tool)).toBe(false);
  });

  describe('argument-based danger', () => {
    it.each([
      ['execute', { operation: 'delete_repository' }],
      ['mutate', { action: 'drop_database' }],
      ['admin', { command: 'force_push' }],
      ['run', { nested: { deep: { op: 'wipeStore' } } }],
    ])('dangerous args on tool %s are consequential', (tool, args) => {
      expect(classify(tool, args as Args)).toBe(true);
    });

    it.each([
      ['notify', { message: 'the repository was deleted yesterday' }],
      ['report', { summary: 'deletion history for removed items' }],
      ['search', { query: 'undelete instructions' }],
    ])('descriptive text on tool %s stays benign', (tool, args) => {
      expect(classify(tool, args as Args)).toBe(false);
    });
  });

  describe('evidence precedence', () => {
    it('dangerous name + benign args is consequential', () => expect(classify('deleteRepository', { note: 'ok' })).toBe(true));
    it('benign name + dangerous args is consequential', () => expect(classify('execute', { op: 'drop_database' })).toBe(true));
    it('dangerous name + dangerous args is consequential exactly once', () => {
      expect(classify('deleteRepository', { op: 'drop_database' })).toBe(true);
      // Severity is not double-escalated: still one REQUIRE_APPROVAL, not DENY.
      expect(disposition('deleteRepository', { op: 'drop_database' })).toBe('REQUIRE_APPROVAL');
    });
    it('benign name + benign args is benign', () => expect(classify('list_resources', { page: 2 })).toBe(false));
  });

  describe('ambiguous names - documented decisions', () => {
    // Consequential: a real state mutation is named, object is not a descriptor.
    it.each(['softDelete', 'dropConnection', 'resetPassword', 'disableAccount', 'deleteConfig'])('%s is consequential', (t) => {
      expect(classify(t)).toBe(true);
    });
    // Benign: verb not in the declared vocabulary, or descriptor-terminated.
    it.each(['archiveUser', 'clearCache', 'resetStatus', 'removeListener'])('%s is benign', (t) => {
      expect(classify(t)).toBe(false);
    });
  });

  describe('boundedness and hostile input', () => {
    it.each([
      ['16 KiB name', 'a'.repeat(16384)],
      ['alternating case', 'aB'.repeat(8192)],
      ['underscore run', '_'.repeat(16384)],
      ['leading verb + long tail', `delete${'x'.repeat(16384)}`],
    ])('%s completes quickly and deterministically', (_label, tool) => {
      const started = Date.now();
      const first = classify(tool);
      expect(Date.now() - started).toBeLessThan(1000);
      expect(classify(tool)).toBe(first);
    });

    it.each([
      ['number', 12345],
      ['null', null],
      ['undefined', undefined],
      ['array', ['delete']],
      ['object', { delete: true }],
    ])('non-string tool (%s) does not throw', (_label, tool) => {
      expect(() => classifyMcpAction({ operation: 'call_tool', tool, arguments: {} })).not.toThrow();
      expect(classifyMcpAction({ operation: 'call_tool', tool, arguments: {} })).toBe(false);
    });

    it('bounds argument recursion depth', () => {
      let args: unknown = { v: 'delete_repository' };
      for (let i = 0; i < 200; i += 1) args = { n: args };
      expect(() => classifyMcpAction({ operation: 'call_tool', tool: 't', arguments: args })).not.toThrow();
    });
  });

  describe('unicode - documented ASCII-only vocabulary', () => {
    it('recognizes the ASCII form', () => expect(classify('deleteRepository')).toBe(true));
    // Informational, not a security promise: the vocabulary is ASCII, so a
    // homoglyph or full-width form is not recognized. Such calls remain
    // governed and recorded by mcp.call rather than silently allowed.
    it('does not recognize a Cyrillic homoglyph', () => expect(classify('deletеRepository')).toBe(false));
    it('does not recognize full-width characters', () => expect(classify('ＤｅｌｅｔｅRepository')).toBe(false));
  });

  describe('canonicalization contract', () => {
    it('precomputes the flag before lowercasing and excludes it from the fingerprint', () => {
      const action = canonicalizeAction({ action_kind: 'mcp', operation: 'call_tool', tool: 'deleteRepository', arguments: {}, agent_id: 'a' } as never);
      expect(action.tool).toBe('deleterepository');
      expect(action.mcp_consequential).toBe(true);
      expect(isMcpConsequential(action)).toBe(true);
    });

    it('falls back to classifying separator-delimited canonical names', () => {
      expect(isMcpConsequential({ operation: 'call_tool', tool: 'delete_repository', arguments: {} })).toBe(true);
      expect(isMcpConsequential({ operation: 'call_tool', tool: 'weather_delete_status', arguments: {} })).toBe(false);
    });

    it('ignores generic transport operations but honours explicit ones', () => {
      expect(classify('list_resources', {}, 'call_tool')).toBe(false);
      expect(classify('list_resources', {}, 'delete')).toBe(true);
    });
  });
});
