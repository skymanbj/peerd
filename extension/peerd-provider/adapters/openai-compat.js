// @ts-check
// OpenAI-compatible adapter factory.
//
// Produces a provider adapter for any endpoint that speaks the OpenAI
// /v1/chat/completions wire format (DeepSeek, Together AI, Groq, Mistral,
// local llama.cpp, etc.). Each custom provider gets its OWN adapter
// instance with its own name, baseUrl, and vault secret — distinct from
// the built-in OpenAI direct adapter (api.openai.com) and the OpenRouter
// gateway.
//
// Reuses the same format layer (to-openai.js / from-openai.js) as the
// OpenAI, OpenRouter, and Ollama adapters. Same DI contract: safeFetch
// + getSecret injected; this module never imports peerd-egress.
//
// The factory returns a frozen adapter descriptor ready for
// registerProvider() — the registry and SW treat it the same as any
// other adapter, with one extra `custom: true` flag so the UI can
// distinguish user-added providers from built-in ones.

import { toOpenAiBody } from '../format/to-openai.js';
import { fromOpenAiStream } from '../format/from-openai.js';
import { toAnthropicBody } from '../format/to-anthropic.js';
import { fromAnthropicStream } from '../format/from-anthropic.js';
import { fetchModelWindow } from '../model-window.js';
import { abortableSleep, fetchInitialResponseWithRetry } from '../connect-timeout.js';
import {
  ProviderError,
  ProviderHttpError,
  ProviderKeyMissingError,
  ProviderUsageLimitError,
} from '../errors.js';
import { isUsageLimitResponse, apiErrorMessage } from '../error-classify.js';

const CONNECT_TIMEOUT_MS = 45_000;
const MAX_RATE_LIMIT_RETRIES = 3;
const DEFAULT_BACKOFF_MS = 2000;
const MAX_BACKOFF_MS = 60_000;

/**
 * @typedef {import('../types.js').InternalMessage} InternalMessage
 * @typedef {import('../format/from-anthropic.js').ProviderEvent} ProviderEvent
 */

/**
 * Factory: build an adapter for an OpenAI-compatible endpoint.
 *
 * @param {Object} config
 * @param {string} config.name       stable provider id (e.g. 'deepseek')
 * @param {string} config.label      display name (e.g. 'DeepSeek')
 * @param {string} config.baseUrl    origin + optional path (e.g. 'https://api.deepseek.com')
 * @param {string} config.vaultSecretName  vault key for the API key
 * @param {string} [config.defaultModel]   fallback model id when none selected
 * @param {'openai'|'anthropic'} [config.apiFormat] wire format; defaults to 'openai'
 * @returns {import('../registry.js').Adapter & { custom: true, baseUrl: string, apiFormat: string }}
 */
export const makeOpenAiCompatAdapter = ({ name, label, baseUrl, vaultSecretName, defaultModel, apiFormat = 'openai' }) => {
  const origin = baseUrl.replace(/\/+$/, '');
  const isAnthropicFormat = apiFormat === 'anthropic';
  let ENDPOINT;
  let MODELS_ENDPOINT;
  try {
    const u = new URL(origin);
    const hasPath = u.pathname !== '/' && u.pathname !== '';
    if (isAnthropicFormat) {
      ENDPOINT = `${origin}/v1/messages`;
      MODELS_ENDPOINT = `${origin}/v1/models`;
    } else if (hasPath) {
      ENDPOINT = `${origin}/chat/completions`;
      MODELS_ENDPOINT = `${origin}/models`;
    } else {
      ENDPOINT = `${origin}/v1/chat/completions`;
      MODELS_ENDPOINT = `${origin}/v1/models`;
    }
  } catch {
    ENDPOINT = isAnthropicFormat ? `${origin}/v1/messages` : `${origin}/v1/chat/completions`;
    MODELS_ENDPOINT = `${origin}/v1/models`;
  }
  const model = defaultModel || 'unknown';

  /**
   * Call the custom /v1/chat/completions endpoint and stream events back.
   * Mirrors the OpenAI adapter's signature and retry logic.
   *
   * @param {Object} args
   * @param {readonly InternalMessage[]} args.messages
   * @param {string} args.system
   * @param {string} [args.model]
   * @param {number} [args.maxTokens]
   * @param {ReadonlyArray<{ name: string, description: string, schema: object }>} [args.tools]
   * @param {(name: string) => Promise<string | null>} args.getSecret
   * @param {(resource: string | URL | Request, init?: RequestInit) => Promise<Response>} args.safeFetch
   * @param {AbortSignal} [args.signal]
   * @param {(ms: number, signal?: AbortSignal) => Promise<void>} [args._sleep]
   * @returns {AsyncGenerator<ProviderEvent>}
   */
  async function* call(args) {
    const {
      messages, system,
      model: selectedModel = model,
      maxTokens,
      tools,
      reasoning,
      getSecret, safeFetch,
      signal,
      _sleep = abortableSleep,
    } = args;

    const apiKey = await getSecret(vaultSecretName);
    if (!apiKey) throw new ProviderKeyMissingError(name);

    const body = isAnthropicFormat
      ? toAnthropicBody({ model: selectedModel, system, messages, tools, maxTokens, reasoning })
      : toOpenAiBody({ model: selectedModel, system, messages, tools, maxTokens });
    /** @type {Record<string, string>} */
    const headers = { 'content-type': 'application/json' };
    if (isAnthropicFormat) {
      headers['x-api-key'] = apiKey;
      headers['anthropic-version'] = '2023-06-01';
      headers['anthropic-dangerous-direct-browser-access'] = 'true';
    } else {
      headers.authorization = `Bearer ${apiKey}`;
    }
    const requestInit = {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal,
    };

    for (let attempt = 1; ; attempt++) {
      const res = await fetchInitialResponseWithRetry(safeFetch, ENDPOINT, requestInit, {
        stopSignal: signal,
        timeoutMs: CONNECT_TIMEOUT_MS,
        onTimeout: (ms) => new ProviderError(name, `the API did not respond within ${ms / 1000}s — it may be unreachable or down. Try again.`),
        sleepFn: _sleep,
      });
      if (res.ok) {
        if (!res.body) {
          throw new ProviderError(name, 'response has no body (streaming requires it)');
        }
        if (isAnthropicFormat) {
          yield* fromAnthropicStream(res.body);
        } else {
          yield* fromOpenAiStream(res.body, { provider: name });
        }
        return;
      }
      let bodyText = '';
      try { bodyText = await res.text(); }
      catch { bodyText = ''; }
      if (isUsageLimitResponse(res.status, bodyText)) {
        throw new ProviderUsageLimitError(name, {
          status: res.status,
          detail: apiErrorMessage(bodyText),
        });
      }
      const retryable = res.status === 429 || res.status === 500
        || res.status === 503 || res.status === 529;
      if (retryable && attempt <= MAX_RATE_LIMIT_RETRIES) {
        const waitMs = computeBackoffMs(res.headers, attempt);
        yield { type: 'rate-limit-pause', retryAfterMs: waitMs, attempt };
        await _sleep(waitMs, signal);
        continue;
      }
      throw new ProviderHttpError(name, res.status, bodyText.slice(0, 1024) || '<no body>');
    }
  }

  /**
   * Live model inventory from GET /v1/models. Best-effort: returns an
   * empty array (not an error) if the endpoint doesn't support /v1/models.
   *
   * @param {Object} deps
   * @param {(resource: string | URL | Request, init?: RequestInit) => Promise<Response>} deps.safeFetch
   * @param {(name: string) => Promise<string | null>} [deps.getSecret]
   * @param {AbortSignal} [deps.signal]
   * @returns {Promise<Array<{ model: string, label: string }>>}
   */
  const listModels = async ({ safeFetch, getSecret, signal } = /** @type {any} */ ({})) => {
    /** @type {Record<string, string>} */
    const headers = { 'content-type': 'application/json' };
    let apiKey = null;
    if (typeof getSecret === 'function') {
      try { apiKey = await getSecret(vaultSecretName); } catch { apiKey = null; }
    }
    if (apiKey) {
      if (isAnthropicFormat) {
        headers['x-api-key'] = apiKey;
        headers['anthropic-version'] = '2023-06-01';
        headers['anthropic-dangerous-direct-browser-access'] = 'true';
      } else {
        headers.authorization = `Bearer ${apiKey}`;
      }
    }

    let res;
    try {
      res = await safeFetch(MODELS_ENDPOINT, { method: 'GET', headers, signal });
    } catch {
      // Network error (endpoint unreachable) — return empty, not a throw,
      // so the picker degrades quietly instead of blocking.
      return [];
    }
    if (!res.ok) {
      // 404 = endpoint doesn't support /v1/models — not an error condition.
      // 401/403 = bad key — surface via empty list; the Test button gives the
      // full message. All other statuses: silent degrade.
      return [];
    }
    let data;
    try { data = await res.json(); }
    catch { return []; }
    /** @type {any[]} */
    const models = Array.isArray(data?.data) ? data.data : [];
    return models
      .filter((entry) => typeof entry?.id === 'string' && entry.id.length > 0)
      .map((entry) => ({
        model: entry.id,
        label: (typeof entry.name === 'string' && entry.name.length) ? entry.name : entry.id,
      }))
      .sort((a, b) => a.label.localeCompare(b.label));
  };

  /**
   * Live per-model context window. Most /v1/models endpoints don't carry
   * context_length, so this returns null and the caller falls back to its
   * static table. Best-effort by construction.
   *
   * @param {Object} args
   * @param {string} args.model
   * @param {(name: string) => Promise<string | null>} [args.getSecret]
   * @param {(resource: string | URL | Request, init?: RequestInit) => Promise<Response>} args.safeFetch
   * @param {AbortSignal} [args.signal]
   * @returns {Promise<number | null>}
   */
  const contextWindow = async ({ model: _model, getSecret, safeFetch, signal }) => {
    let apiKey = null;
    try { apiKey = getSecret ? await getSecret(vaultSecretName) : null; }
    catch { apiKey = null; }
    if (!apiKey) return null;
    /** @type {Record<string, string>} */
    const headers = { 'content-type': 'application/json' };
    if (isAnthropicFormat) {
      headers['x-api-key'] = apiKey;
      headers['anthropic-version'] = '2023-06-01';
      headers['anthropic-dangerous-direct-browser-access'] = 'true';
    } else {
      headers.authorization = `Bearer ${apiKey}`;
    }
    return fetchModelWindow({
      safeFetch,
      url: MODELS_ENDPOINT,
      init: { method: 'GET', headers },
      // why null: most /v1/models endpoints carry no context_length field.
      // A present model yields no number, so the static default is used.
      extract: () => null,
      signal,
    });
  };

  /**
   * @param {Headers} headers
   * @param {number} attempt   1-indexed
   * @returns {number}         milliseconds to wait, clamped to MAX_BACKOFF_MS
   */
  const computeBackoffMs = (headers, attempt) => {
    const retryAfter = headers.get('retry-after');
    if (retryAfter) {
      const secs = Number(retryAfter);
      if (Number.isFinite(secs) && secs >= 0) {
        return Math.min(secs * 1000 + 250, MAX_BACKOFF_MS);
      }
    }
    return Math.min(DEFAULT_BACKOFF_MS * (2 ** (attempt - 1)), MAX_BACKOFF_MS);
  };

  // why Object.freeze: the adapter descriptor is immutable — the registry
  // stores a reference, not a copy, so mutation would leak across callers.
  return Object.freeze({
    name,
    label,
    endpoint: ENDPOINT,
    defaultModel: model,
    defaultRunnerModel: model,
    vaultSecretName,
    call,
    listModels,
    contextWindow,
    // why: marks this as a user-added provider (not a built-in adapter).
    // The UI uses this to render Delete and to skip the provider from
    // built-in-specific affordances (e.g. the OpenRouter curation panel).
    custom: true,
    // why: allows buildModelOptions and routes to dynamic list models
    liveModels: true,
    // why: the original baseUrl is preserved so the Settings UI can display
    // and edit it, and the SW can rebuild the egress allowlist from it.
    baseUrl: origin,
    // why: the wire format is preserved so the SW can rebuild the adapter
    // with the correct format on restart.
    apiFormat,
  });
};
