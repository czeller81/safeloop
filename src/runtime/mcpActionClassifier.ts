/**
 * MCP consequential-action classification.
 *
 * Phase 6.2 matched dangerous verbs as bare substrings, so `weather_delete_status`
 * was approval-gated because it contains "delete". Phase 6.3 replaced that with
 * whole-token matching, which removed the false positives but classified the tool
 * name *after* `canonicalizeAction` had lowercased it - collapsing `deleteRepository`
 * into `deleterepository` and losing every camelCase boundary. Common destructive
 * names were then missed entirely.
 *
 * The order here is the fix: segment the ORIGINAL string, then lowercase the
 * tokens, then classify. Segmentation never sees a pre-lowercased name, so
 * camelCase, PascalCase, and acronym boundaries survive; classification never
 * sees raw text, so substring collisions cannot occur.
 *
 * Matching is exact token equality against a closed vocabulary. There is
 * deliberately no stemming and no prefix matching: `deletion`, `deleted`,
 * `droppable`, and `undelete` are simply not in the vocabulary, so morphological
 * forms are non-actions by construction rather than by a suffix blocklist.
 */

/** Longest input the classifier will inspect. Bounds work on untrusted names. */
export const MCP_CLASSIFIER_MAX_INPUT = 4096;
/** Maximum tokens considered from one name. */
export const MCP_CLASSIFIER_MAX_TOKENS = 64;
/**
 * Maximum characters kept per token. No vocabulary word exceeds ~12 characters,
 * so truncating a longer token cannot change its classification - it was never
 * going to match - while keeping worst-case work linear and small.
 */
export const MCP_CLASSIFIER_MAX_TOKEN_LENGTH = 32;

/**
 * Destructive and state-mutating primary verbs.
 *
 * The first group is SafeLoop's own destructive vocabulary, taken from
 * DESTRUCTIVE_OPERATIONS in profiles.ts (filesystem delete/overwrite/truncate,
 * git force_push/reset_hard/clean/branch_delete/remote_remove/tag_delete).
 * The second group is the downstream-effect vocabulary the `mcp.consequential`
 * rule has always described: tools that "write, send, deploy, or delete".
 */
const DESTRUCTIVE_VERBS: ReadonlySet<string> = new Set([
  // SafeLoop destructive semantics
  'delete', 'remove', 'overwrite', 'truncate', 'force', 'reset', 'clean',
  // downstream destruction with no SafeLoop-side undo
  'drop', 'destroy', 'wipe', 'purge', 'erase', 'revoke', 'terminate', 'disable',
  // consequential mutation (Phase 6.3 vocabulary, preserved)
  'write', 'send', 'deploy', 'publish', 'create', 'update', 'execute',
]);

/** Qualifiers that make a following verb an action even mid-name (`hard delete`). */
const DESTRUCTIVE_QUALIFIERS: ReadonlySet<string> = new Set([
  'hard', 'soft', 'force', 'permanent', 'permanently', 'bulk', 'mass', 'recursive', 'cascade',
]);

/**
 * Trailing nouns that make a name a reporting/UI surface rather than a command.
 * Deliberately narrow: only words that describe or display. Legitimate objects
 * (`config`, `policy`, `token`, `account`) are NOT here, so `delete_config`
 * stays consequential.
 */
const DESCRIPTOR_NOUNS: ReadonlySet<string> = new Set([
  'status', 'statuses', 'state', 'preview', 'history', 'count', 'counts', 'counter', 'counters',
  'list', 'listing', 'listings', 'log', 'logs', 'report', 'reports', 'summary', 'summaries',
  'audit', 'menu', 'menus', 'notification', 'notifications', 'multiplier', 'multipliers',
  'listener', 'listeners', 'items', 'records', 'resources', 'at', 'timestamp', 'info',
  'help', 'hint', 'widget', 'button', 'icon', 'banner', 'tooltip', 'placeholder',
  'progress', 'schedule', 'view', 'views', 'length', 'lengths',
]);

/**
 * Descriptor-like words that are also common real resources. In primary command
 * position, `deleteStatus` is a command targeting a status resource; it is not a
 * status page describing deletion. This deliberately stays smaller than
 * DESCRIPTOR_NOUNS so UI/report words such as `preview`, `listener`, and
 * `count` keep their false-positive protection.
 */
const DESCRIPTOR_TARGET_NOUNS: ReadonlySet<string> = new Set([
  'status', 'statuses', 'state', 'history', 'view', 'views',
]);

const REPORTING_CONTEXT_TOKENS: ReadonlySet<string> = new Set([
  'progress', 'schedule', 'preview', 'status', 'report', 'summary',
]);

function hasReportingContext(tokens: string[], verbIndex: number): boolean {
  for (let i = verbIndex + 1; i < tokens.length - 1; i += 1) {
    if (REPORTING_CONTEXT_TOKENS.has(tokens[i])) return true;
  }
  return false;
}

/** Transport verbs that carry no intent; the tool name decides instead. */
const GENERIC_TRANSPORT_OPERATIONS: ReadonlySet<string> = new Set([
  'call_tool', 'call', 'calltool', 'invoke', 'tools/call', 'run', 'execute_tool', 'dispatch',
]);

const isUpper = (c: string): boolean => c >= 'A' && c <= 'Z';
const isLower = (c: string): boolean => c >= 'a' && c <= 'z';
const isDigit = (c: string): boolean => c >= '0' && c <= '9';
const isAlnum = (c: string): boolean => isUpper(c) || isLower(c) || isDigit(c);

/**
 * Split an identifier into word tokens, preserving case boundaries.
 *
 * Linear single pass, no regex, so a hostile name cannot trigger catastrophic
 * backtracking. Splits on non-alphanumerics and on:
 *   - lower/digit -> Upper            (`deleteRepo`  -> delete | Repo)
 *   - Upper run   -> Upper+lower      (`deleteAPIKey` -> delete | API | Key)
 *   - letter      -> digit and back   (`dropDB2Table` -> drop | DB2 | Table)
 *
 * Non-ASCII characters are treated as separators: the vocabulary is ASCII, so a
 * homoglyph cannot spell a destructive verb. See the Unicode note in
 * docs/POLICY_LIFECYCLE.md.
 */
export function segmentActionName(value: string): string[] {
  if (typeof value !== 'string' || !value) return [];
  const input = value.length > MCP_CLASSIFIER_MAX_INPUT ? value.slice(0, MCP_CLASSIFIER_MAX_INPUT) : value;
  const tokens: string[] = [];
  let current = '';
  const flush = (): void => {
    // The cap is checked here, not only in the loop guard: the final flush
    // after the loop would otherwise be able to push one token past the bound.
    if (current && tokens.length < MCP_CLASSIFIER_MAX_TOKENS) tokens.push(current.toLowerCase());
    current = '';
  };
  for (let i = 0; i < input.length && tokens.length < MCP_CLASSIFIER_MAX_TOKENS; i += 1) {
    const c = input[i];
    if (!isAlnum(c)) { flush(); continue; }
    if (!current) { current = c; continue; }
    const prev = current[current.length - 1];
    const next = i + 1 < input.length ? input[i + 1] : '';
    const lowerOrDigitToUpper = (isLower(prev) || isDigit(prev)) && isUpper(c);
    const acronymToWord = isUpper(prev) && isUpper(c) && isLower(next);
    // Any letter -> digit boundary, not just UPPER -> digit. Requiring an
    // uppercase predecessor meant a digit immediately following a lowercase
    // verb was absorbed into it: `delete2FADevice` segmented as
    // delete2 | fa | device, losing `delete` entirely. `deleteUser2FA` only
    // worked because the `U` split first, which is why the Phase 6.4 digit
    // corpus passed while the verb-adjacent digit shape did not.
    const letterToDigit = !isDigit(prev) && isDigit(c);
    if (lowerOrDigitToUpper || acronymToWord || letterToDigit) { flush(); current = c; continue; }
    if (current.length < MCP_CLASSIFIER_MAX_TOKEN_LENGTH) current += c;
  }
  flush();
  return tokens;
}

/** Strip a namespace prefix: everything before the last `.` or `/` separator. */
function actionSegment(value: string): string {
  if (typeof value !== 'string') return '';
  const bounded = value.length > MCP_CLASSIFIER_MAX_INPUT ? value.slice(0, MCP_CLASSIFIER_MAX_INPUT) : value;
  let cut = -1;
  for (let i = 0; i < bounded.length; i += 1) {
    const c = bounded[i];
    if (c === '.' || c === '/' || c === ':' || c === '\\') cut = i;
  }
  return cut >= 0 ? bounded.slice(cut + 1) : bounded;
}

/**
 * Does this name express a consequential action?
 *
 * A destructive verb counts only in an action position:
 *   - first token                       (`deleteRepository`, `drop_database`)
 *   - last token                        (`repo-delete`, `softDelete`)
 *   - second token                      (`github-deleteRepository`)
 *   - immediately after a qualifier      (`hardDeleteUser`, `force push`)
 *
 * A trailing descriptor noun vetoes all of the above, because such a name
 * reports on an action rather than performing one (`weather_delete_status`,
 * `drop_down_menu`, `force_multiplier`). The veto is applied first and wins,
 * which is what keeps the Phase 6.3 false-positive fix intact.
 */
export function namesConsequentialAction(value: string): boolean {
  const tokens = segmentActionName(actionSegment(value));
  if (!tokens.length) return false;
  const descriptorTerminated = DESCRIPTOR_NOUNS.has(tokens[tokens.length - 1]);
  for (let i = 0; i < tokens.length; i += 1) {
    if (!DESTRUCTIVE_VERBS.has(tokens[i])) continue;
    const isFirst = i === 0;
    const isSecond = i === 1;
    const isLast = i === tokens.length - 1;
    const afterQualifier = i > 0 && DESTRUCTIVE_QUALIFIERS.has(tokens[i - 1]);
    if (descriptorTerminated) {
      const descriptorTargetCommand =
        DESCRIPTOR_TARGET_NOUNS.has(tokens[tokens.length - 1]) &&
        !isLast &&
        (isFirst || afterQualifier) &&
        !hasReportingContext(tokens, i);
      if (!descriptorTargetCommand) continue;
      return true;
    }
    if (isFirst || isSecond || isLast || afterQualifier) return true;
  }
  return false;
}

/** String argument values are judged by the same rule; keys and structure are not. */
function argumentsNameConsequentialAction(value: unknown, depth = 0): boolean {
  if (depth > 8) return false;
  if (typeof value === 'string') return namesConsequentialAction(value);
  if (Array.isArray(value)) return value.some((entry) => argumentsNameConsequentialAction(entry, depth + 1));
  if (value && typeof value === 'object') {
    return Object.values(value as Record<string, unknown>).some((entry) => argumentsNameConsequentialAction(entry, depth + 1));
  }
  return false;
}

/**
 * Classify an MCP call. Evidence combines by OR: a consequential tool name or a
 * consequential argument value is independently sufficient, matching the
 * existing `mcp.consequential` rule, which raises one REQUIRE_APPROVAL either
 * way and never escalates further for having two signals.
 *
 * Pass the ORIGINAL proposal strings. Passing an already-lowercased canonical
 * name still works for separator-delimited names; it just cannot recover
 * camelCase boundaries that were already destroyed.
 */
export function classifyMcpAction(input: { operation?: unknown; tool?: unknown; arguments?: unknown }): boolean {
  const operation = typeof input.operation === 'string' ? input.operation : '';
  const tool = typeof input.tool === 'string' ? input.tool : '';
  const operationIsGeneric = GENERIC_TRANSPORT_OPERATIONS.has(operation.toLowerCase().trim());
  return (!operationIsGeneric && namesConsequentialAction(operation))
    || namesConsequentialAction(tool)
    || argumentsNameConsequentialAction(input.arguments);
}
