// @ts-check
// Custom provider storage — persisted config for user-added OpenAI-compatible
// endpoints (DeepSeek, Together AI, Groq, etc.).
//
// Each custom provider is a small config object stored in chrome.storage.local
// via the KV helper. On SW boot, these are loaded and their adapters are
// registered in the provider registry. The KV key is versioned
// (`custom_providers.v1`) so future schema changes are non-breaking.
//
// Import-free (kv injected) → Bun-unit-testable with fakes.

export const CUSTOM_PROVIDERS_KV_KEY = 'custom_providers.v1';

// Names reserved for built-in adapters — a custom provider may not claim these.
const RESERVED_NAMES = Object.freeze([
  'anthropic', 'openrouter', 'openai', 'ollama', 'local-webgpu',
]);

/**
 * @typedef {Object} CustomProviderConfig
 * @property {string} name               stable provider id (e.g. 'deepseek')
 * @property {string} label              display name (e.g. 'DeepSeek')
 * @property {string} baseUrl            origin + optional path (e.g. 'https://api.deepseek.com')
 * @property {string} vaultSecretName    vault key for the API key
 * @property {string} [defaultModel]     fallback model id when none selected
 * @property {'openai'|'anthropic'} [apiFormat]  wire format; defaults to 'openai'
 */

/**
 * Load the persisted custom provider config list.
 * @param {{ get: (k: string) => Promise<any> }} kv
 * @returns {Promise<CustomProviderConfig[]>}
 */
export const loadCustomProviders = async (kv) => {
  const stored = await kv.get(CUSTOM_PROVIDERS_KV_KEY);
  if (!stored || !Array.isArray(stored.providers)) return [];
  return stored.providers.filter(
    (/** @type {any} */ p) => p && typeof p.name === 'string' && p.name.length > 0,
  );
};

/**
 * Persist the full custom provider config list.
 * @param {{ set: (k: string, v: any) => Promise<any> }} kv
 * @param {CustomProviderConfig[]} providers
 */
export const saveCustomProviders = async (kv, providers) => {
  await kv.set(CUSTOM_PROVIDERS_KV_KEY, { providers });
};

/**
 * Add a custom provider config. Returns false if the name is already taken
 * (by an existing custom provider OR a reserved built-in name).
 * @param {{ get: (k: string) => Promise<any>, set: (k: string, v: any) => Promise<any> }} kv
 * @param {CustomProviderConfig} provider
 * @returns {Promise<boolean>}
 */
export const addCustomProvider = async (kv, provider) => {
  if (RESERVED_NAMES.includes(provider.name)) return false;
  const list = await loadCustomProviders(kv);
  if (list.some((p) => p.name === provider.name)) return false;
  list.push(provider);
  await saveCustomProviders(kv, list);
  return true;
};

/**
 * Remove a custom provider config by name. Returns the removed config, or
 * null if it wasn't found.
 * @param {{ get: (k: string) => Promise<any>, set: (k: string, v: any) => Promise<any> }} kv
 * @param {string} name
 * @returns {Promise<CustomProviderConfig | null>}
 */
export const removeCustomProvider = async (kv, name) => {
  const list = await loadCustomProviders(kv);
  const idx = list.findIndex((p) => p.name === name);
  if (idx === -1) return null;
  const [removed] = list.splice(idx, 1);
  await saveCustomProviders(kv, list);
  return removed;
};

/**
 * Update a custom provider config. Only the provided fields are changed.
 * Returns the updated config, or null if the provider wasn't found.
 * @param {{ get: (k: string) => Promise<any>, set: (k: string, v: any) => Promise<any> }} kv
 * @param {string} name
 * @param {Partial<CustomProviderConfig>} patch
 * @returns {Promise<CustomProviderConfig | null>}
 */
export const updateCustomProvider = async (kv, name, patch) => {
  const list = await loadCustomProviders(kv);
  const entry = list.find((p) => p.name === name);
  if (!entry) return null;
  if (typeof patch.label === 'string') entry.label = patch.label;
  if (typeof patch.baseUrl === 'string') entry.baseUrl = patch.baseUrl;
  if (typeof patch.defaultModel === 'string') entry.defaultModel = patch.defaultModel;
  if (typeof patch.apiFormat === 'string') entry.apiFormat = patch.apiFormat;
  await saveCustomProviders(kv, list);
  return entry;
};

/**
 * Generate a vault secret name for a custom provider. The naming convention
// follows the existing pattern (e.g. 'anthropic_api_key') but prefixed with
// 'custom_' to avoid collisions with built-in secret names.
 * @param {string} name
 * @returns {string}
 */
export const customSecretName = (name) => `custom_${name}_api_key`;

/**
 * Sanitize a user-supplied label into a stable provider id: lowercase,
 * hyphens for non-alphanumerics, collapsed runs, trimmed.
 * @param {string} label
 * @returns {string}
 */
export const sanitizeProviderId = (label) => {
  return String(label || '')
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 64);
};

/**
 * Check whether a name collides with a built-in provider.
 * @param {string} name
 * @returns {boolean}
 */
export const isReservedName = (name) => RESERVED_NAMES.includes(name);

/**
 * Extract the origin from a URL string for egress allowlisting.
 * Returns null for invalid URLs.
 * @param {string} url
 * @returns {string | null}
 */
export const originFromUrl = (url) => {
  try { return new URL(url).origin; }
  catch { return null; }
};

/**
 * Build the set of custom provider origins for the egress allowlist.
 * @param {CustomProviderConfig[]} providers
 * @returns {Set<string>}
 */
export const customProviderOrigins = (providers) => {
  const origins = new Set();
  for (const cp of providers) {
    const o = originFromUrl(cp.baseUrl);
    if (o) origins.add(o);
  }
  return origins;
};
