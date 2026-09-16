/**
 * What request logging retains.
 *
 * logger.ts states the policy plainly: health data must never reach the logs,
 * because a log line is retained longer, replicated further and read by more
 * people than a database row. The `redact` list enforces that for headers and
 * body fields, but it works on known paths — and pino-http's default request
 * serializer logged `url` with its query string attached, which redaction cannot
 * see into.
 *
 * The concrete leak: `GET /api/nutrition/search?q=…` wrote the user's own food
 * search term to the log on every search. Verified against a running build
 * before being fixed here.
 */
import { describe, expect, it } from 'vitest';
import { serializeRequest } from '../../src/logger.js';

describe('serializeRequest', () => {
  it('strips the query string from the path', () => {
    const serialized = serializeRequest({
      id: 1,
      method: 'GET',
      url: '/api/nutrition/search?q=chicken%20shawarma',
      headers: {},
    });

    expect(serialized.path).toBe('/api/nutrition/search');
    expect(JSON.stringify(serialized)).not.toContain('chicken');
  });

  it('retains nothing resembling a query, under any key', () => {
    const serialized = serializeRequest({
      id: 1,
      method: 'GET',
      url: '/api/overview?date=2026-09-16&token=would-be-a-credential',
      headers: { host: 'api.example.test' },
    });

    // Asserted over the whole serialized object rather than a named field, so
    // adding a field that happens to carry the query string fails here.
    const dumped = JSON.stringify(serialized);
    expect(dumped).not.toContain('token');
    expect(dumped).not.toContain('would-be-a-credential');
    expect(dumped).not.toContain('2026-09-16');
    expect(dumped).not.toContain('?');
  });

  it('keeps what tracing a request actually needs', () => {
    const serialized = serializeRequest({
      id: 7,
      method: 'POST',
      url: '/api/body-composition/entry',
      headers: { 'user-agent': 'test-agent' },
    });

    expect(serialized).toMatchObject({
      id: 7,
      method: 'POST',
      path: '/api/body-composition/entry',
      headers: { 'user-agent': 'test-agent' },
    });
  });

  it('passes headers through for redact to handle, rather than dropping them', () => {
    // The authorization header must reach the logger, because that is where the
    // `redact` path replaces it. Stripping it here instead would work but would
    // put the rule in two places.
    const serialized = serializeRequest({
      id: 1,
      method: 'GET',
      url: '/api/users/me',
      headers: { authorization: 'Bearer token' },
    });

    expect(serialized.headers).toEqual({ authorization: 'Bearer token' });
  });

  it('survives a request with no url', () => {
    expect(serializeRequest({ id: 1, method: 'GET', headers: {} }).path).toBeUndefined();
  });
});
