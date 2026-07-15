/**
 * Server-side metadata redaction for monitor API responses.
 *
 * Recursively redacts keys matching sensitive patterns before data is
 * serialized and sent to the browser. This complements (not replaces)
 * the client-side redaction in ui/main.ts.
 */

const REDACTED = '[redacted]';

/**
 * Exact key names (case-insensitive) that are always redacted.
 */
const EXACT_SENSITIVE_KEYS = new Set([
  'secret', 'token', 'apikey', 'api_key', 'api-key',
  'password', 'credential', 'authorization',
  'client_secret', 'access_token', 'refresh_token',
  'auth_token', 'api_token', 'private_key',
]);

/**
 * Substring patterns for terms unlikely to appear in non-sensitive field names.
 * Note: "token" is intentionally NOT in this list to avoid redacting
 * legitimate fields like "totalTokens", "tokenCount", "inputTokens".
 */
const SUBSTRING_SENSITIVE_RE = /secret|password|credential|authorization/i;

function isSensitiveKey(key: string): boolean {
  const lower = key.toLowerCase();
  if (EXACT_SENSITIVE_KEYS.has(lower)) return true;
  return SUBSTRING_SENSITIVE_RE.test(key);
}

/**
 * Deep-clone and redact sensitive keys from an arbitrary value.
 * Returns a new object/array; does not mutate the input.
 */
export function redactSensitive<T>(value: T): T {
  return redactInternal(value) as T;
}

function redactInternal(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => redactInternal(item));
  }

  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
      if (isSensitiveKey(key)) {
        out[key] = REDACTED;
      } else {
        out[key] = redactInternal(nested);
      }
    }
    return out;
  }

  return value;
}
