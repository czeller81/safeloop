import { isMcpConsequential, evaluateProfile, loadProfile } from '../src/runtime/profiles';
import { canonicalizeAction } from '../src/runtime/canonicalAction';

const call = (tool: string, args: Record<string, unknown> = {}, operation = 'call_tool') =>
  ({ action_kind: 'mcp' as const, operation, tool, arguments: args, agent_id: 'a' });

function disposition(tool: string, args: Record<string, unknown> = {}, profileId = 'coding') {
  return evaluateProfile(loadProfile(profileId), canonicalizeAction(call(tool, args) as never), '/tmp/ws').disposition;
}

describe('MCP consequential matching precision', () => {
  const dangerous: Array<[string, Record<string, unknown>]> = [
    ['delete_repository', {}],
    ['DELETE_REPOSITORY', {}],
    ['github.delete_repo', {}],
    ['github/delete_repo', {}],
    ['soft_delete', {}],
    ['publish_release', {}],
    ['send_email', {}],
    ['deploy_service', {}],
    ['execute_query', {}],
    ['write_file', {}],
    ['update_record', {}],
    ['remove_user', {}],
    ['create_bucket', {}],
    ['run_task', { operation: 'delete' }],
    ['run_task', { steps: ['delete'] }],
    ['run_task', { nested: { action: 'deploy_service' } }],
  ];
  it.each(dangerous)('classifies %s as consequential', (tool, args) => {
    expect(isMcpConsequential(call(tool, args))).toBe(true);
  });

  const benign: Array<[string, Record<string, unknown>]> = [
    ['list_resources', {}],
    ['weather_delete_status', {}],
    ['deleted_items', {}],
    ['undelete', {}],
    ['undeleted_records', {}],
    ['createdby_lookup', {}],
    ['get_updates_summary', {}],
    ['removal_policy_report', {}],
    ['executive_summary', {}],
    ['read_document', {}],
    ['search_index', {}],
    ['status', {}],
    ['fetch_deletion_audit_log', {}],
    ['list_tools', { description: 'this tool can delete things elsewhere' }],
  ];
  it.each(benign)('does not classify %s as consequential', (tool, args) => {
    expect(isMcpConsequential(call(tool, args))).toBe(false);
  });

  it('regression: weather_delete_status is not approval-gated by substring collision', () => {
    for (const id of ['coding', 'research', 'assistant']) {
      expect(disposition('weather_delete_status', {}, id)).not.toBe('REQUIRE_APPROVAL');
      expect(disposition('list_resources', {}, id)).not.toBe('REQUIRE_APPROVAL');
    }
  });

  it('keeps genuinely destructive MCP calls gated', () => {
    for (const id of ['coding', 'research', 'assistant']) {
      expect(disposition('delete_repository', { repository: 'prod' }, id)).toBe('REQUIRE_APPROVAL');
      expect(disposition('deploy_service', {}, id)).toBe('REQUIRE_APPROVAL');
    }
  });

  // Documented limitation, asserted so it cannot regress silently.
  // canonicalizeAction lowercases tool names for case-insensitive matching, so
  // camelCase collapses to one token ('deleteRepository' -> 'deleterepository')
  // and is no longer segmentable. Splitting a collapsed token by prefix would
  // re-gate benign names like 'deleteditems', which is the false-positive class
  // this change exists to remove. Such calls remain governed and recorded by
  // mcp.call (ALLOW_WITH_WARNING); they are not silently allowed.
  it('does not segment camelCase tool names after case-insensitive canonicalization', () => {
    expect(isMcpConsequential(call('deleteRepository'))).toBe(true);
    // ...but the canonical form the evaluator actually sees is collapsed:
    expect(disposition('deleteRepository')).toBe('ALLOW_WITH_WARNING');
    // separator-delimited forms, which MCP servers use, are detected:
    expect(disposition('delete_repository')).toBe('REQUIRE_APPROVAL');
    expect(disposition('DELETE_REPOSITORY')).toBe('REQUIRE_APPROVAL');
    expect(disposition('github.delete_repo')).toBe('REQUIRE_APPROVAL');
  });

  it('ignores generic transport operations but honours explicit ones', () => {
    expect(isMcpConsequential({ operation: 'call_tool', tool: 'list_resources', arguments: {} })).toBe(false);
    expect(isMcpConsequential({ operation: 'delete', tool: 'list_resources', arguments: {} })).toBe(true);
  });
});
