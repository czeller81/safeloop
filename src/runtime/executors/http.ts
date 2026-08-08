/**
 * Managed HTTP executor.
 *
 * SafeLoop is not a firewall and does not intercept sockets. This executor
 * governs HTTP requests *routed through it*; a process that opens its own
 * connection is outside the boundary and needs external controls. That limit is
 * stated plainly in docs/THREAT_MODEL.md.
 *
 * What it does provide: a structured representation of the request so policy
 * can distinguish a public GET from an authenticated mutation, and evidence
 * that records the request shape without recording the credential.
 */

import { createHash } from 'crypto';
import { redactAndBound, redactSecrets } from '../redaction';
import {
  ExecutorArgumentError,
  optionalString,
  type ExecutorContext,
  type ExecutorOutcome,
  type ManagedExecutorPlugin,
} from './types';

export type HttpOperation = 'read' | 'write' | 'authenticated_mutation' | 'external_communication';

export type HttpFetch = (
  url: string,
  init: { method: string; headers: Record<string, string>; body?: string; signal?: AbortSignal },
) => Promise<{ status: number; statusText?: string; headers?: Record<string, string>; text(): Promise<string> }>;

export interface HttpExecutorOptions {
  /** Injectable so tests never make real network calls. */
  fetchImpl?: HttpFetch;
}

/** Classify a request without needing the agent to self-report honestly. */
export function classifyHttpOperation(method: string, hasCredential: boolean): HttpOperation {
  const upper = (method || 'GET').toUpperCase();
  if (upper === 'GET' || upper === 'HEAD' || upper === 'OPTIONS') return 'read';
  return hasCredential ? 'authenticated_mutation' : 'write';
}

/**
 * Describe a request for evidence: host and path in the clear, query and body
 * as hashes, credentials as a reference only. An audit trail should show that
 * a token was used without becoming a place the token can be read.
 */
export function describeHttpRequest(url: string, method: string, body: string | undefined, credentialRef: string | undefined) {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new ExecutorArgumentError(`invalid URL: ${url}`);
  }
  return {
    method: (method || 'GET').toUpperCase(),
    scheme: parsed.protocol.replace(':', ''),
    host: parsed.hostname,
    port: parsed.port || (parsed.protocol === 'https:' ? '443' : '80'),
    path: parsed.pathname,
    query_fingerprint: parsed.search
      ? `sha256:${createHash('sha256').update(parsed.search).digest('hex')}`
      : undefined,
    body_hash: body ? `sha256:${createHash('sha256').update(body).digest('hex')}` : undefined,
    body_bytes: body ? Buffer.byteLength(body) : 0,
    credential_reference: credentialRef,
  };
}

const defaultFetch: HttpFetch = async (url, init) => {
  const response = await fetch(url, init as RequestInit);
  return {
    status: response.status,
    statusText: response.statusText,
    headers: Object.fromEntries(response.headers.entries()),
    text: () => response.text(),
  };
};

export function createHttpExecutor(options: HttpExecutorOptions = {}): ManagedExecutorPlugin {
  const fetchImpl = options.fetchImpl ?? defaultFetch;

  return {
    kind: 'http',

    async execute(context: ExecutorContext): Promise<ExecutorOutcome> {
      const { action } = context;
      const url = action.resource || action.target;
      if (!url) throw new ExecutorArgumentError('http actions require a "resource" URL');

      const method = (action.method || 'GET').toUpperCase();
      const body = optionalString(action.arguments, 'body');
      const credentialRef = optionalString(action.arguments, 'credential_reference');
      const headers = (action.arguments.headers ?? {}) as Record<string, string>;

      if (Object.keys(headers).some((name) => /^(authorization|cookie|x-api-key)$/i.test(name))) {
        throw new ExecutorArgumentError(
          'raw credentials must not be passed in headers; use "credential_reference" so the secret stays out of the action fingerprint and the ledger',
        );
      }

      const descriptor = describeHttpRequest(url, method, body, credentialRef);
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), context.timeoutMs);

      try {
        const response = await fetchImpl(url, { method, headers, body, signal: controller.signal });
        const text = await response.text();
        return {
          status: response.status >= 200 && response.status < 400 ? 'EXECUTED' : 'FAILED',
          exit_code: response.status,
          stdout: redactAndBound(text, context.maxOutputBytes),
          detail: { ...descriptor, response_status: response.status, response_status_text: response.statusText },
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const aborted = /abort/i.test(message);
        return {
          status: aborted ? 'TIMED_OUT' : 'FAILED',
          stderr: redactSecrets(message),
          detail: { ...descriptor, error: redactSecrets(message) },
        };
      } finally {
        clearTimeout(timer);
      }
    },
  };
}
