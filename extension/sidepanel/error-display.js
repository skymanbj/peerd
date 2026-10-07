// @ts-check
// Error display — the PURE mapping of an error code / raw provider message
// to (a) a human-readable line and (b) which Settings section, if any, can
// actually remedy it.
//
// why a standalone module (not inline in chat-view): a component must hold
// no business logic, and this mapping is load-bearing + worth testing on its
// own. Errors reach the UI two ways — the SW's typed codes ("provider-http-
// 429") AND the loop's raw throw text ("Provider 'anthropic' HTTP 429: {…}")
// — so the matcher has to handle both, which is exactly the kind of thing
// that rots silently without a test.

/**
 * Map an error code OR a raw provider message into a clear, human line.
 *
 * @param {unknown} e
 * @returns {string}
 */
export const mapError = (e) => {
  if (typeof e !== 'string' || e.length === 0) return '出了点问题。';
  if (e === 'provider-key-missing') return '还没有 API 密钥 — 在设置中添加。';
  if (e === 'unknown-provider') return '尚未注册提供商。';
  if (e === 'session-not-found') return '轮次中途会话已重置。';
  if (e === 'actor-recovery-pending') return '代理恢复仍在记录中。请稍候片刻，然后再次发送。';
  if (e === 'spend-limit-reached') return '已达消费限额 — 代理已停止。在设置中提高限额以继续。';

  // Hard account limit (out of credit / over a spend or usage cap). The SW's
  // typed mapping emits `provider-usage-limit[:detail]`; the loop's raw throw
  // is the self-explanatory ProviderUsageLimitError message — both land here.
  if (e.startsWith('provider-usage-limit')) {
    const detail = e.slice('provider-usage-limit'.length).replace(/^[:\s]+/, '').trim();
    const suffix = detail ? ` (${detail})` : '';
    return `已达用量/额度上限 — 你的提供商账户额度不足或超出消费/用量上限。请检查提供商的账单与限额，然后重试。${suffix}`;
  }

  const s = e.toLowerCase();
  /** @param {...string} needles */
  const has = (...needles) => needles.some((n) => s.includes(n));

  if (e.startsWith('provider-http-401') || has('http 401', 'authentication_error', 'invalid x-api-key')) {
    return 'API 密钥被拒绝 (401)。请在设置中检查或更新。';
  }
  // Account/credit/quota limits often arrive as 400/403 with a message,
  // not 429 — catch them by content before the generic HTTP fallback.
  if (has('credit balance', 'billing', 'quota', 'insufficient_quota', 'usage limit', 'plan limit')) {
    return '提供商账户限额 — 额度不足或超出用量上限。请检查提供商的账单，然后重试。';
  }
  if (e.startsWith('provider-http-429') || has('http 429', 'rate_limit', 'rate limit')) {
    return '速率受限 (429) — 提供商正在限流，或你的账户已达用量/额度上限。稍后重试；如持续出现，请检查提供商账户。';
  }
  if (e.startsWith('provider-http-529') || has('http 529', 'overloaded')) {
    return '提供商过载 — 请稍后重试。';
  }
  if (e.startsWith('provider-http-')) return `提供商返回错误（${e.slice('provider-http-'.length)}）。`;
  if (has('http 4', 'http 5')) return `提供商错误 — ${e}`;
  return e;
};

/**
 * Which Settings section, if any, can actually fix this error.
 *
 * why this gate: the banner used to offer "Open settings" for EVERY error,
 * which misdirects on the most common ones — a 429/529 throttle, a network
 * blip, or an external billing cap aren't fixable in peerd's Settings, so
 * sending the user there is a dead end. Only key/auth/config (→ providers)
 * and the spend limit (→ costs) live in Settings; for everything else the
 * banner shows the guidance copy alone (mapError already says "wait and
 * retry" / "check your provider billing").
 *
 * @param {unknown} e
 * @returns {{ section: string } | null}  null = no in-app remedy
 */
export const errorSettingsTarget = (e) => {
  if (typeof e !== 'string' || e.length === 0) return null;
  if (e === 'provider-key-missing' || e === 'unknown-provider') return { section: 'providers' };
  if (e === 'spend-limit-reached') return { section: 'costs' };
  const s = e.toLowerCase();
  if (e.startsWith('provider-http-401')
      || s.includes('http 401') || s.includes('authentication_error') || s.includes('invalid x-api-key')) {
    return { section: 'providers' };
  }
  // Transient (429/529/overloaded/network), external billing/usage caps, and
  // generic provider errors: no Settings page fixes them.
  return null;
};
