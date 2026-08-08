/**
 * Output redaction for evidence and the ledger.
 *
 * Executed commands routinely print tokens, keys, and connection strings. The
 * ledger is an audit record that outlives the session, so captured output is
 * redacted on the way in, not on the way out — an unredacted secret that
 * reaches the ledger has already leaked.
 *
 * This is a best-effort filter over known secret shapes. It is not a guarantee
 * that no secret can ever reach evidence, which is why the managed executors
 * also bound how much output they capture at all.
 */

const PATTERNS: ReadonlyArray<[RegExp, string]> = [
  [/-----BEGIN (?:[A-Z ]+ )?PRIVATE KEY-----[\s\S]*?-----END (?:[A-Z ]+ )?PRIVATE KEY-----/g, '[REDACTED private key]'],
  [/\bsk-[A-Za-z0-9_-]{16,}\b/g, '[REDACTED api key]'],
  [/\bgh[pousr]_[A-Za-z0-9]{16,}\b/g, '[REDACTED github token]'],
  [/\bxox[baprs]-[A-Za-z0-9-]{10,}\b/g, '[REDACTED slack token]'],
  [/\bAKIA[0-9A-Z]{16}\b/g, '[REDACTED aws access key id]'],
  [/\bey[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g, '[REDACTED jwt]'],
  [/\bssh-(?:rsa|ed25519|dss) [A-Za-z0-9+/=]{40,}/g, '[REDACTED ssh public key]'],
  [/\b[a-zA-Z][a-zA-Z0-9+.-]*:\/\/[^\s:@/]+:[^\s@/]+@/g, '[REDACTED credential]@'],
  [/((?:password|passwd|secret|token|api[_-]?key|access[_-]?key|client[_-]?secret)\s*[=:]\s*)("?)[^\s"',;]{6,}\2/gi, '$1[REDACTED]'],
];

export function redactSecrets(text: string): string {
  if (!text) return text;
  let output = text;
  for (const [pattern, replacement] of PATTERNS) {
    output = output.replace(pattern, replacement);
  }
  return output;
}

/**
 * Bound captured output so a runaway command cannot fill the ledger. Truncation
 * is explicit in the text so an auditor knows the record is partial.
 */
export function boundOutput(text: string, maxBytes: number): string {
  if (!text) return text;
  const buffer = Buffer.from(text, 'utf8');
  if (buffer.byteLength <= maxBytes) return text;
  const kept = buffer.subarray(0, maxBytes).toString('utf8');
  return `${kept}\n…[truncated ${buffer.byteLength - maxBytes} bytes]`;
}

export function redactAndBound(text: string, maxBytes: number): string {
  return boundOutput(redactSecrets(text ?? ''), maxBytes);
}

/** Environment variables that must never be recorded even as names+values. */
const SENSITIVE_ENV = /(SECRET|TOKEN|PASSWORD|PASSWD|KEY|CREDENTIAL|AUTH)/i;

/** Record only the *names* of environment variables, and mask sensitive ones. */
export function describeEnvironment(env: Record<string, string> | undefined): string[] {
  if (!env) return [];
  return Object.keys(env)
    .sort()
    .map((name) => (SENSITIVE_ENV.test(name) ? `${name}=[REDACTED]` : name));
}
