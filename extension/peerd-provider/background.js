// @ts-check
// Background-only provider surface. UI-only capability probes, recommendation
// helpers, and key-format controls stay out of the MV3 worker's cold graph.

export {
  callModel, listProviders, listProviderModels, providerModelContextWindow,
  // custom-provider support: register/unregister dynamically, validate names
  // against the full set, and tell a user-added adapter apart from a built-in.
  registerProvider, unregisterProvider,
  listProviderNames, isCustomProvider, customProviderBaseUrl,
} from './registry.js';
export { makeOpenAiCompatAdapter } from './adapters/openai-compat.js';
export {
  CUSTOM_PROVIDERS_KV_KEY,
  loadCustomProviders, saveCustomProviders,
  addCustomProvider, removeCustomProvider, updateCustomProvider,
  customSecretName, sanitizeProviderId, isReservedName,
  originFromUrl, customProviderOrigins,
} from './custom-providers.js';
export { resolveRunnerTarget } from './runner-model.js';
export {
  ProviderHttpError, ProviderKeyMissingError, ProviderUsageLimitError,
  UnknownProviderError,
} from './errors.js';
export { shouldFailover, planFailoverChain } from './failover.js';
export { anthropicAdapter } from './adapters/anthropic.js';
export { listOpenRouterModels, OPENROUTER_POPULAR } from './adapters/openrouter.js';
export {
  LOCAL_MODEL_ID, setLocalGenerate, setLocalModelInfo,
} from './adapters/local-webgpu.js';
export { localModelSpec } from './local-model-capability.js';
export { costOf, hasPricing } from './pricing.js';
export { contextWindowFor } from './context-window.js';
