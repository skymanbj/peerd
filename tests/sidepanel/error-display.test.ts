import { describe, test, expect } from 'bun:test';
import { mapError, errorSettingsTarget } from '../../extension/sidepanel/error-display.js';

// The error banner reads BOTH the SW's typed codes ("provider-http-429") and
// the loop's raw throw text ("Provider 'anthropic' HTTP 429: {…}"). mapError
// turns either into human copy; errorSettingsTarget decides whether the
// "Open settings" button is even useful (the bug: it used to show for every
// error, misdirecting on transient/billing faults Settings can't fix).

describe('mapError', () => {
  test('non-string / empty → generic', () => {
    expect(mapError(null)).toBe('出了点问题。');
    expect(mapError('')).toBe('出了点问题。');
  });

  test('typed codes', () => {
    expect(mapError('provider-key-missing')).toMatch(/在设置中添加/);
    expect(mapError('spend-limit-reached')).toMatch(/已达消费限额/);
    expect(mapError('provider-usage-limit')).toMatch(/已达用量\/额度上限/);
    expect(mapError('provider-usage-limit:over cap')).toMatch(/\(over cap\)/);
    expect(mapError('actor-recovery-pending')).toMatch(/请稍候片刻，然后再次发送/);
  });

  test('raw provider throw text is matched, not dumped', () => {
    expect(mapError("Provider 'anthropic' HTTP 429: {...}")).toMatch(/速率受限/);
    expect(mapError('Provider HTTP 529: overloaded')).toMatch(/提供商过载/);
    expect(mapError('authentication_error: invalid x-api-key')).toMatch(/密钥被拒绝/);
    expect(mapError('Your credit balance is too low')).toMatch(/账户限额/);
  });
});

describe('errorSettingsTarget — only when Settings can fix it', () => {
  test('key/auth/config → providers', () => {
    expect(errorSettingsTarget('provider-key-missing')).toEqual({ section: 'providers' });
    expect(errorSettingsTarget('unknown-provider')).toEqual({ section: 'providers' });
    expect(errorSettingsTarget('provider-http-401')).toEqual({ section: 'providers' });
    expect(errorSettingsTarget("Provider 'anthropic' HTTP 401: authentication_error")).toEqual({ section: 'providers' });
  });

  test('spend limit → costs (where the setting lives)', () => {
    expect(errorSettingsTarget('spend-limit-reached')).toEqual({ section: 'costs' });
  });

  test('transient / external faults → null (no in-app remedy, no misdirection)', () => {
    expect(errorSettingsTarget('provider-http-429')).toBeNull();
    expect(errorSettingsTarget('provider-http-529')).toBeNull();
    expect(errorSettingsTarget("Provider 'anthropic' HTTP 429: rate_limit")).toBeNull();
    expect(errorSettingsTarget('provider-usage-limit')).toBeNull();
    expect(errorSettingsTarget('Your credit balance is too low')).toBeNull();
    expect(errorSettingsTarget('session-not-found')).toBeNull();
    expect(errorSettingsTarget('')).toBeNull();
    expect(errorSettingsTarget(null)).toBeNull();
  });
});
