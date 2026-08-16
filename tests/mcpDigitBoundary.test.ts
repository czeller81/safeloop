import { classifyMcpAction, segmentActionName, MCP_CLASSIFIER_MAX_TOKENS } from '../src/runtime/mcpActionClassifier';
import { evaluateProfile, loadProfile } from '../src/runtime/profiles';
import { canonicalizeAction } from '../src/runtime/canonicalAction';

type Args = Record<string, unknown>;
const classify = (tool: string, args: Args = {}, operation = 'call_tool') => classifyMcpAction({ operation, tool, arguments: args });
const PROFILES = ['coding', 'research', 'assistant'] as const;

function disposition(tool: string, args: Args = {}, profileId = 'coding') {
  const action = canonicalizeAction({ action_kind: 'mcp', operation: 'call_tool', tool, arguments: args, agent_id: 'a' } as never);
  return evaluateProfile(loadProfile(profileId), action, '/tmp/ws').disposition;
}

describe('MCP digit-boundary segmentation', () => {
  /*
   * The lexical invariant this whole suite exists to protect: a destructive
   * verb immediately followed by a digit must survive as its own token.
   * Phase 6.4 split only on UPPER -> digit, so `delete2FADevice` became
   * delete2 | fa | device and the action verb vanished.
   */
  describe('tokenizer invariant: the verb survives an adjacent digit', () => {
    it.each([
      ['delete2FADevice', 'delete'],
      ['remove2FADevice', 'remove'],
      ['drop2FATable', 'drop'],
      ['revoke2FAToken', 'revoke'],
      ['destroyV2Resource', 'destroy'],
      ['wipeS3Bucket', 'wipe'],
      ['truncateV3Table', 'truncate'],
    ])('%s keeps %s as an independent leading token', (name, verb) => {
      const tokens = segmentActionName(name);
      expect(tokens[0]).toBe(verb);
      expect(tokens).not.toContain(`${verb}2`);
      expect(tokens).not.toContain(`${verb}3`);
    });

    it.each([
      ['delete2FADevice', ['delete', '2', 'fa', 'device']],
      ['remove2FADevice', ['remove', '2', 'fa', 'device']],
      ['drop2FATable', ['drop', '2', 'fa', 'table']],
      ['DELETE_2FA_DEVICE', ['delete', '2', 'fa', 'device']],
      ['deleteUser2FA', ['delete', 'user', '2', 'fa']],
      ['dropDB2Table', ['drop', 'db', '2', 'table']],
    ])('segments %s deterministically', (name, expected) => {
      expect(segmentActionName(name)).toEqual(expected);
      expect(segmentActionName(name)).toEqual(segmentActionName(name));
    });
  });

  const DIGIT_DESTRUCTIVE = [
    'delete2FADevice', 'remove2FADevice', 'drop2FATable', 'delete2FAKey', 'revoke2FAToken',
    'disable2FADevice', 'reset2FACredential', 'destroyV2Resource', 'wipeS3Bucket', 'dropDB2Table',
    'terminateV2Session', 'purgeS3Object', 'overwriteV2Config', 'truncateV3Table', 'forceV2Push',
  ];
  it.each(DIGIT_DESTRUCTIVE)('%s is consequential', (tool) => expect(classify(tool)).toBe(true));
  it.each(DIGIT_DESTRUCTIVE)('%s gates through the production path', (tool) => {
    for (const id of PROFILES) expect(disposition(tool, {}, id)).toBe('REQUIRE_APPROVAL');
  });

  const DIGIT_BENIGN = [
    'delete2FAStatus', 'delete2FAReport', 'remove2FAListener', 'drop2FAMenu', 'wipe2FACounter',
    'destroyV2History', 'force2FAMultiplier', 'reset2FAStatus', 'revoke2FAPreview', 'removed2FAItems',
    'deleted2FADevicesReport', 'remove2FAHistory', 'dropV2Preview', 'wipeS3Report', 'destroyV2Count',
  ];
  it.each(DIGIT_BENIGN)('%s stays benign', (tool) => expect(classify(tool)).toBe(false));
  it.each(DIGIT_BENIGN)('%s is not approval-gated by name', (tool) => {
    for (const id of PROFILES) expect(disposition(tool, {}, id)).not.toBe('REQUIRE_APPROVAL');
  });

  // A digit alone must never imply destruction.
  it.each(['listUsers2', 'getV2Config', 'fetchS3Metadata', 'readV3Schema', 'search2FADocs', 'exportV2Report'])(
    'digit-containing benign name %s stays benign', (tool) => expect(classify(tool)).toBe(false),
  );

  it.each(['deleteUser2', 'removeAccount3', 'dropSchema2', 'wipeVolume4', 'destroyVM2', 'terminateJob10',
    'deleteV2User', 'removeV3Account', 'dropDB2', 'wipeS3'])('numeric identifier %s stays recognizable', (tool) => {
    expect(classify(tool)).toBe(true);
  });

  it.each(['auth.delete2FADevice', 'auth/delete2FADevice', 'auth-delete2FADevice',
    'security.remove2FADevice', 'db.drop2FATable', 'repo.forceV2Push', 'aws.wipeS3Bucket'])(
    'namespaced digit-led %s is consequential', (tool) => expect(classify(tool)).toBe(true),
  );

  it.each(['Delete2FADevice', 'Remove2FADevice', 'Drop2FATable',
    'DELETE_2FA_DEVICE', 'REMOVE_2FA_DEVICE', 'DROP_2FA_TABLE'])(
    'Pascal/SCREAMING digit-led %s is consequential', (tool) => expect(classify(tool)).toBe(true),
  );

  describe('argument matching with digit-led names', () => {
    it.each([
      ['exec', { operation: 'delete2FADevice' }],
      ['exec', { action: 'drop2FATable' }],
      ['exec', { command: 'remove2FADevice' }],
      ['exec', { nested: { operation: 'wipeS3Bucket' } }],
    ])('dangerous args %# are consequential', (tool, args) => expect(classify(tool, args as Args)).toBe(true));

    it.each([
      ['notify', { message: '2FA device deletion status' }],
      ['notify', { label: 'deleted 2FA devices report' }],
      ['notify', { help: 'how to undelete a 2FA device' }],
    ])('descriptive text %# stays benign', (tool, args) => expect(classify(tool, args as Args)).toBe(false));
  });

  describe('no substring regression', () => {
    it.each(['weather_delete_status', 'deleted_items', 'undelete', 'removed_items', 'drop_down_menu',
      'wipe_counter', 'destroyed_count', 'delete_preview', 'delete_status', 'deletion_preview',
      'removal_history', 'force_multiplier', 'push_notification_status', 'repository_deleted_at',
      'user_removed_at', 'remove_listener', 'list_resources', 'removed_resources'])(
      '%s remains benign', (tool) => expect(classify(tool)).toBe(false),
    );

    it.each(['delete_repository', 'deleteRepository', 'dropDatabase', 'wipeStore', 'destroyAccount',
      'forcePush', 'DeleteRepository', 'repo-delete', 'github.delete_repo', 'deleteAPIKey',
      'removeSSHKey', 'dropDB', 'destroyVM', 'revokeJWT', 'removeV2Token'])(
      '%s remains consequential', (tool) => expect(classify(tool)).toBe(true),
    );
  });

  describe('boundedness', () => {
    it.each([
      ['16 KiB name', 'a'.repeat(16384)],
      ['alternating digit/case', 'a1B2'.repeat(4096)],
      ['long digit run', `delete${'1'.repeat(16384)}`],
      ['acronym/digit transitions', 'A1B2C3'.repeat(2731)],
      ['underscore flood', '_'.repeat(16384)],
      ['digit-led repeated verb', 'delete2FA'.repeat(2000)],
    ])('%s completes quickly and deterministically', (_label, tool) => {
      const started = Date.now();
      const first = classify(tool);
      expect(Date.now() - started).toBeLessThan(1000);
      expect(classify(tool)).toBe(first);
    });

    it('never exceeds the documented token cap, including the final token', () => {
      for (const pattern of ['a1', 'a_', '1a', 'aB', 'A1']) {
        expect(segmentActionName(pattern.repeat(500)).length).toBeLessThanOrEqual(MCP_CLASSIFIER_MAX_TOKENS);
      }
    });

    it.each([['number', 12345], ['null', null], ['undefined', undefined], ['array', ['delete2FADevice']]])(
      'non-string tool (%s) returns false without throwing', (_label, tool) => {
        expect(() => classifyMcpAction({ operation: 'call_tool', tool, arguments: {} })).not.toThrow();
        expect(classifyMcpAction({ operation: 'call_tool', tool, arguments: {} })).toBe(false);
      },
    );
  });

  describe('descriptor veto is unchanged by this pass', () => {
    // Documented Phase 6.4 behavior, re-asserted so the tokenizer fix cannot
    // have silently broadened or narrowed the veto.
    it.each(['deleteStatus', 'destroyState', 'removeHistory', 'resetStatus'])(
      '%s remains benign (descriptor-terminated)', (tool) => expect(classify(tool)).toBe(false),
    );
    // Conservative over-gating retained deliberately: adding these objects to
    // the veto would make dropView / deleteView / dropMaterializedView benign.
    it.each(['dropDownOptions', 'purgeScheduleView', 'truncatePreviewLength'])(
      '%s remains conservatively consequential', (tool) => expect(classify(tool)).toBe(true),
    );
    it.each(['dropView', 'deleteView', 'dropMaterializedView'])(
      '%s stays consequential, which is why the veto was not broadened', (tool) => expect(classify(tool)).toBe(true),
    );
  });
});
