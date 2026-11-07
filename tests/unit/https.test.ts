import { describe, expect, it } from 'vitest';
import { httpsRedirectUrl } from '../../src/worker/util';

describe('httpsRedirectUrl', () => {
  it('sends plain http on the real site to https, keeping the path and query', () => {
    expect(httpsRedirectUrl('http://nmsusportsforum.com/api/threads?page=2')).toBe('https://nmsusportsforum.com/api/threads?page=2');
    expect(httpsRedirectUrl('http://www.nmsusportsforum.com/api/health')).toBe('https://www.nmsusportsforum.com/api/health');
  });
  it('leaves https and local development alone', () => {
    expect(httpsRedirectUrl('https://nmsusportsforum.com/api/health')).toBeNull();
    expect(httpsRedirectUrl('http://localhost:8787/api/health')).toBeNull();
    expect(httpsRedirectUrl('http://127.0.0.1:8787/api/health')).toBeNull();
  });
});
