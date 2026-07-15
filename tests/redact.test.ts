import { redactSensitive } from '../src/monitor/redact';

describe('redactSensitive', () => {
  it('redacts keys matching sensitive patterns', () => {
    const input = {
      command: 'echo hello',
      apiKey: 'test-key-value',
      token: 'abc-xyz',
      password: 'secret123',
      authorization: 'bearer-test',
      credential: 'my-cred',
      secret: 'top-secret',
    };

    const result = redactSensitive(input);

    expect(result.command).toBe('echo hello');
    expect(result.apiKey).toBe('[redacted]');
    expect(result.token).toBe('[redacted]');
    expect(result.password).toBe('[redacted]');
    expect(result.authorization).toBe('[redacted]');
    expect(result.credential).toBe('[redacted]');
    expect(result.secret).toBe('[redacted]');
  });

  it('does NOT redact legitimate token-count fields like totalTokens', () => {
    const input = {
      totalTokens: 5000,
      inputTokens: 1000,
      outputTokens: 4000,
      tokenCount: 42,
      pricingAvailable: true,
    };

    const result = redactSensitive(input);

    expect(result.totalTokens).toBe(5000);
    expect(result.inputTokens).toBe(1000);
    expect(result.outputTokens).toBe(4000);
    expect(result.tokenCount).toBe(42);
  });

  it('handles api_key and api-key variants', () => {
    const input = {
      api_key: 'key1',
      'api-key': 'key2',
    };

    const result = redactSensitive(input);

    expect(result.api_key).toBe('[redacted]');
    expect(result['api-key']).toBe('[redacted]');
  });

  it('redacts recursively in nested objects', () => {
    const input = {
      level1: {
        token: 'nested-token',
        safe: 'ok',
        level2: {
          password: 'deep-password',
        },
      },
    };

    const result = redactSensitive(input);

    expect(result.level1.token).toBe('[redacted]');
    expect(result.level1.safe).toBe('ok');
    expect(result.level1.level2.password).toBe('[redacted]');
  });

  it('redacts recursively in arrays', () => {
    const input = {
      items: [
        { token: 'arr-token-1', name: 'item1' },
        { token: 'arr-token-2', name: 'item2' },
      ],
    };

    const result = redactSensitive(input);

    expect(result.items[0].token).toBe('[redacted]');
    expect(result.items[0].name).toBe('item1');
    expect(result.items[1].token).toBe('[redacted]');
  });

  it('does not mutate the original object', () => {
    const input = { token: 'original', safe: 'ok' };

    const result = redactSensitive(input);

    expect(input.token).toBe('original');
    expect(result.token).toBe('[redacted]');
    expect(result).not.toBe(input);
  });

  it('handles primitives and null', () => {
    expect(redactSensitive('hello')).toBe('hello');
    expect(redactSensitive(42)).toBe(42);
    expect(redactSensitive(null)).toBe(null);
    expect(redactSensitive(undefined)).toBe(undefined);
  });

  it('handles case-insensitive matching', () => {
    const input = {
      TOKEN: 'upper',
      Token: 'mixed',
      ToKeN: 'weird',
    };

    const result = redactSensitive(input);

    expect(result.TOKEN).toBe('[redacted]');
    expect(result.Token).toBe('[redacted]');
    expect(result.ToKeN).toBe('[redacted]');
  });
});
