// @ts-check
// background/routes/providers.js — provider key + model routes.
//
// The routes here close over no reassigned module state (session/setModel
// and the local-model/* routes, which mutate activeSession / localModelAvailable,
// stay inline in the SW). Bodies are byte-identical to the originals; deps
// injected; imports none. See routes/vault.js for the pattern and
// tests/meta/sw-routes-wiring.test.ts for the wiring guarantee.
//
// Custom provider routes (custom-provider/*) manage user-added OpenAI-
// compatible endpoints: add, remove, update, test, and list models.

/**
 * @param {Record<string, any>} deps
 * @returns {Record<string, (msg?: any) => Promise<any>>}
 */
export const makeProviderRoutes = (deps) => {
  const {
    vault, auditLog, pushState, settingsStore,
    listProviders, liveProviderModels, listProviderModels, listOpenRouterModels, OPENROUTER_POPULAR,
    callModel, getSecret, safeFetch, secretNameForProvider, maskKey, buildModelOptions,
    onProviderConfigChanged, ensureSettingsReady, hydrateLocalModelAvailability,
    ProviderHttpError, ProviderKeyMissingError, VaultLockedError,
    // custom provider management
    addCustomProvider, removeCustomProvider, updateCustomProvider, loadCustomProviders,
    customSecretName, sanitizeProviderId, isReservedName, customProviderOrigins,
    makeOpenAiCompatAdapter, registerProvider, unregisterProvider,
    isCustomProvider, customProviderBaseUrl,
    // allowlist rebuild
    rebuildUserEndpoints,
    // kv for custom provider persistence (separate from settings)
    kv,
  } = deps;
  const awaitSettings = async () => {
    if (!ensureSettingsReady) return true;
    try { await ensureSettingsReady(); return true; }
    catch { return false; }
  };

  return {
    // Validate a saved provider key with a minimal 1-token ping on the REAL
    // endpoint, so an onboarding tester learns the key works BEFORE sending a real
    // message (instead of hitting a 401 on the first turn). The adapter's
    // connect-timeout applies, so the test itself can't hang.
    'provider/test': async ({ provider }) => {
      if (!(await awaitSettings())) return { ok: false, error: 'settings-unavailable' };
      const adapter = listProviders().find((/** @type {any} */ p) => p.name === provider);
      // Keyless local provider (Ollama): "does the daemon answer" is the
      // meaningful test, not a model turn — /api/tags responds instantly
      // and doesn't load a multi-GB model into memory just for a ping.
      if (adapter?.keyless && adapter.liveModels) {
        try {
          // ollamaHost (issue #104): test the daemon the user actually configured.
          const models = await liveProviderModels(provider, { force: true });
          pushState();
          if (!Array.isArray(models)) return { ok: false, error: 'unreachable' };
          auditLog.append({ type: 'provider_validated', details: { provider } }).catch(() => {});
          const count = models?.length ?? 0;
          return count > 0
            ? { ok: true, reachable: true, models: count }
            : { ok: false, reachable: true, error: 'no-models', models: 0 };
        } catch (e) {
          return { ok: false, error: /** @type {{ message?: string }} */ (e)?.message ?? 'unreachable' };
        }
      }
      // A keyless provider with NO live inventory (local-webgpu) has no daemon to
      // ping — its readiness is "is the model downloaded?", surfaced by its own
      // card (local-model/status), not this 1-token probe. Bail cleanly instead
      // of falling through to the key path and lying with a "no-key" error.
      if (adapter?.keyless) return { ok: false, error: 'no-live-test' };
      let key;
      try { key = await vault.getSecret(secretNameForProvider(provider)); }
      catch { return { ok: false, error: 'locked' }; }
      if (!key) return { ok: false, error: 'no-key' };
      try {
        // A custom provider may be saved with no default model — its adapter's
        // defaultModel is the literal 'unknown'. Probe its live inventory and
        // use the first model so the 1-token test can actually run.
        let testModel = adapter?.defaultModel;
        if ((!testModel || testModel === 'unknown') && adapter?.liveModels && typeof listProviderModels === 'function') {
          try {
            const list = await listProviderModels(provider, { safeFetch, getSecret });
            if (list && list.length > 0) testModel = list[0].model;
          } catch { /* ignore — fall through to the default */ }
        }
        const gen = callModel({
          provider,
          model: testModel,
          messages: [{ role: 'user', content: 'hi' }],
          system: '',
          maxTokens: 1,
          getSecret,
          safeFetch,
        });
        // First yielded event (or a clean finish) means the key authenticated.
        // A 401/invalid key THROWS (ProviderHttpError) on first iteration.
        for await (const ev of gen) {
          if (ev?.type === 'error') return { ok: false, error: ev.error ?? 'test-failed' };
          break;
        }
        auditLog.append({ type: 'provider_validated', details: { provider } }).catch(() => {});
        return { ok: true };
      } catch (e) {
        // why cast: the provider error classes arrive via the `any` deps bag,
        // so instanceof can't narrow `e` — read .status/.message off a view.
        const ev = /** @type {{ status?: number, message?: string }} */ (e);
        if (e instanceof ProviderHttpError) return { ok: false, error: ev.status === 401 ? 'invalid-key' : `http-${ev.status}` };
        if (e instanceof ProviderKeyMissingError) return { ok: false, error: 'no-key' };
        return { ok: false, error: ev?.message ?? 'test-failed' };
      }
    },

    'provider/status': async () => {
      const providers = [];
      for (const p of listProviders()) {
        // Keyless (local) providers: no vault lookup — hasKey is true so
        // selectors treat them as usable; `keyless` lets the Settings card
        // render "no key needed" instead of a key form.
        if (p.keyless) {
          providers.push({
            name: p.name, label: p.label, defaultModel: p.defaultModel,
            defaultRunnerModel: p.defaultRunnerModel,
            hasKey: true, keyless: true, keyPreview: null,
            // liveModels marks a daemon the card can probe (Ollama /api/tags) —
            // so the badge can read "connected" only when it actually answers,
            // never default-green.
            liveModels: !!p.liveModels,
            custom: false,
            baseUrl: null,
            apiFormat: p.apiFormat || 'openai',
          });
          continue;
        }
        let key = null;
        try { key = await vault.getSecret(p.vaultSecretName); }
        catch { key = null; }
        providers.push({
          name: p.name, label: p.label, defaultModel: p.defaultModel,
          defaultRunnerModel: p.defaultRunnerModel,
          hasKey: !!key,
          keyless: false,
          liveModels: !!p.liveModels,
          // Masked preview so the user can verify the RIGHT key is stored and
          // isn't whitespace-padded (a frequent cause of provider 401s),
          // without exposing the secret.
          keyPreview: key ? maskKey(key) : null,
          // why: marks user-added custom providers so the UI can render
          // Delete and skip provider-specific affordances.
          custom: !!isCustomProvider?.(p.name),
          // why: the base URL of a custom provider so the UI can display it.
          baseUrl: customProviderBaseUrl?.(p.name) ?? null,
          // why: the wire format of a custom provider so the UI can display it.
          apiFormat: p.apiFormat || 'openai',
        });
      }
      return { ok: true, providers };
    },

    // Per-chat model options + the selected value. With a sessionId, scoped to
    // that session's provider (model-only mid-session switch); without, the full
    // cross-provider set for a fresh chat. `sessionProvider` is non-null only in
    // the locked (mid-session) case, so the UI knows which write to make.
    'models/options': async ({ sessionId = null } = {}) => {
      if (!(await awaitSettings())) return { ok: false, error: 'settings-unavailable' };
      await hydrateLocalModelAvailability?.().catch(() => false);
      const { options, selected, sessionProvider } = await buildModelOptions({ sessionId });
      return { ok: true, options, selected, sessionProvider };
    },

    // OpenRouter live catalog for the Settings model-curation picker. Doubles as
    // the key-verify probe: a 200 with models means the saved key authenticates
    // (a 401/403 throws ProviderHttpError → surfaced as a verify failure). The
    // `popular` seed is the default-shown subset before the user searches.
    'openrouter/models': async () => {
      try {
        const models = await listOpenRouterModels({ safeFetch, getSecret });
        return { ok: true, models, popular: OPENROUTER_POPULAR };
      } catch (e) {
        const ev = /** @type {{ status?: number, message?: string }} */ (e);
        const status = e instanceof ProviderHttpError ? ev.status : null;
        return {
          ok: false,
          status,
          error: status === 401 || status === 403 ? 'invalid-key' : (ev?.message ?? 'unreachable'),
        };
      }
    },

    'provider/setKey': async ({ provider, plaintext, activate = true }) => {
      if (!(await awaitSettings())) return { ok: false, error: 'settings-unavailable' };
      try {
        const adapter = listProviders().find((/** @type {any} */ p) => p.name === provider);
        if (!adapter) return { ok: false, error: 'unknown-provider' };
        // Local providers have no key — refuse instead of vaulting a value
        // nothing will ever read.
        if (adapter.keyless) return { ok: false, error: 'keyless-provider' };
        // why: trim server-side too. A pasted key often carries a trailing
        // newline/space; stored verbatim it reaches the provider as a malformed
        // `x-api-key` → a 401 "invalid key" (not a clean "key missing"). Strip
        // ALL surrounding whitespace so any save path (incl. legacy/untrimmed)
        // persists a clean key.
        const key = typeof plaintext === 'string' ? plaintext.trim() : '';
        if (key.length < 8) return { ok: false, error: 'key-too-short' };
        await vault.setSecret(adapter.vaultSecretName, key);
        onProviderConfigChanged?.();
        auditLog.append({ type: 'provider_added', details: { provider } }).catch(() => {});
        // Auto-activate the provider you just configured if the current
        // selection isn't usable yet — so a fresh install (empty default
        // providerName, no key) becomes ready the moment ANY provider is keyed,
        // with no separate "select provider" step. Never override an
        // already-usable selection (an explicit keyless pick, or a provider that
        // already has a key). Clear providerModel so the new provider's default
        // model applies (mirrors the Settings provider <select>).
        const activeName = settingsStore.get().providerName;
        // Onboarding verifies a candidate after vaulting it but before making
        // it active. Its explicit activate:false prevents this convenience
        // auto-switch from defeating that verify-before-switch contract.
        if (activate !== false && provider !== activeName) {
          const active = listProviders().find((/** @type {any} */ p) => p.name === activeName);
          let activeUsable = !!active?.keyless;
          if (!activeUsable && active?.vaultSecretName) {
            try { activeUsable = !!(await vault.getSecret(active.vaultSecretName)); }
            catch { activeUsable = false; }
          }
          if (!activeUsable) await settingsStore.update({ providerName: provider, providerModel: '' });
        }
        // Push fresh state so UI flips its "no key" affordance.
        pushState();
        return { ok: true };
      } catch (e) {
        if (e instanceof VaultLockedError) return { ok: false, error: 'locked' };
        throw e;
      }
    },

    // ── Custom provider management ───────────────────────────────────────
    // User-added OpenAI-compatible endpoints (DeepSeek, Together, Groq, etc.).
    // These routes manage the persisted config, register/unregister adapters,
    // update the egress allowlist, and store API keys in the vault.

    // Add a new custom provider. Validates the config, generates a stable
    // name, stores the API key, registers the adapter, and updates the
    // allowlist. Returns the generated provider config.
    'custom-provider/add': async ({ label, baseUrl, apiKey, defaultModel, apiFormat }) => {
      if (!(await awaitSettings())) return { ok: false, error: 'settings-unavailable' };
      try {
        if (typeof label !== 'string' || !label.trim()) return { ok: false, error: 'label-required' };
        if (typeof baseUrl !== 'string' || !baseUrl.trim()) return { ok: false, error: 'base-url-required' };
        // Validate baseUrl as http(s) URL
        let normalizedUrl;
        try {
          const u = new URL(baseUrl.trim());
          if (u.protocol !== 'http:' && u.protocol !== 'https:') return { ok: false, error: 'url-must-be-http(s)' };
          normalizedUrl = u.href.replace(/\/+$/, '');
        } catch { return { ok: false, error: 'invalid-url' }; }

        const name = sanitizeProviderId(label);
        if (!name) return { ok: false, error: 'invalid-label' };
        if (isReservedName(name)) return { ok: false, error: 'reserved-name' };

        // Check for name collision with existing providers
        if (listProviders().some((/** @type {any} */ p) => p.name === name)) {
          return { ok: false, error: 'name-already-used' };
        }

        const vaultSecret = customSecretName(name);
        const config = {
          name,
          label: label.trim().slice(0, 100),
          baseUrl: normalizedUrl,
          defaultModel: typeof defaultModel === 'string' ? defaultModel.trim().slice(0, 200) : '',
          vaultSecretName: vaultSecret,
          apiFormat: apiFormat === 'anthropic' ? 'anthropic' : 'openai',
        };

        // Persist config to KV (separate from settings, under its own key)
        await addCustomProvider(kv, config);

        // Save the API key to vault (if provided)
        if (typeof apiKey === 'string' && apiKey.trim().length >= 8) {
          try { await vault.setSecret(vaultSecret, apiKey.trim()); }
          catch (e) {
            if (e instanceof VaultLockedError) return { ok: false, error: 'locked' };
            throw e;
          }
        }

        // Register the adapter in the provider registry
        const adapter = makeOpenAiCompatAdapter({
          name: config.name,
          label: config.label,
          baseUrl: config.baseUrl,
          vaultSecretName: config.vaultSecretName,
          defaultModel: config.defaultModel || undefined,
          apiFormat: config.apiFormat,
        });
        registerProvider(adapter);

        // Rebuild the egress allowlist
        rebuildUserEndpoints();
        onProviderConfigChanged?.();

        // Auto-activate if no usable provider is selected
        const activeName = settingsStore.get().providerName;
        if (!activeName || !listProviders().some((/** @type {any} */ p) => p.name === activeName)) {
          await settingsStore.update({ providerName: name, providerModel: '' });
        }

        auditLog.append({ type: 'custom_provider_added', details: { name } }).catch(() => {});
        pushState();
        return { ok: true, provider: config };
      } catch (e) {
        if (e instanceof VaultLockedError) return { ok: false, error: 'locked' };
        throw e;
      }
    },

    // Remove a custom provider by name. Unregisters the adapter, removes
    // from persisted config, optionally deletes the vault secret, and
    // rebuilds the allowlist.
    'custom-provider/remove': async ({ name, deleteKey }) => {
      if (!(await awaitSettings())) return { ok: false, error: 'settings-unavailable' };
      if (typeof name !== 'string' || !name) return { ok: false, error: 'name-required' };
      if (!isCustomProvider(name)) return { ok: false, error: 'not-custom-provider' };

      // Remove from persisted config
      const removed = await removeCustomProvider(kv, name);
      if (!removed) return { ok: false, error: 'not-found' };

      // Unregister the adapter
      unregisterProvider(name);
      onProviderConfigChanged?.();

      // Optionally delete the vault secret
      if (deleteKey) {
        try { await vault.deleteSecret(removed.vaultSecretName); }
        catch { /* best-effort */ }
      }

      // Rebuild the egress allowlist
      rebuildUserEndpoints();

      // If the removed provider was the active selection, reset to the
      // first usable provider
      const activeName = settingsStore.get().providerName;
      if (activeName === name) {
        const remaining = listProviders();
        let next = remaining.find((/** @type {any} */ p) => !p.keyless);
        if (!next) next = remaining[0];
        if (next) {
          await settingsStore.update({ providerName: next.name, providerModel: '' });
        } else {
          await settingsStore.update({ providerName: '', providerModel: '' });
        }
      }

      // Also clean up from providerFallbacks if listed
      const fallbacks = settingsStore.get().providerFallbacks ?? [];
      if (fallbacks.includes(name)) {
        await settingsStore.update({ providerFallbacks: fallbacks.filter((/** @type {string} */ n) => n !== name) });
      }

      auditLog.append({ type: 'custom_provider_removed', details: { name } }).catch(() => {});
      pushState();
      return { ok: true };
    },

    // Update a custom provider's config. Re-registers the adapter with
    // new params and updates the allowlist if baseUrl changed.
    'custom-provider/update': async ({ name, label, baseUrl, defaultModel, apiFormat }) => {
      if (!(await awaitSettings())) return { ok: false, error: 'settings-unavailable' };
      if (typeof name !== 'string' || !name) return { ok: false, error: 'name-required' };
      if (!isCustomProvider(name)) return { ok: false, error: 'not-custom-provider' };

      // Validate baseUrl if provided
      let normalizedUrl;
      if (typeof baseUrl === 'string' && baseUrl.trim()) {
        try {
          const u = new URL(baseUrl.trim());
          if (u.protocol !== 'http:' && u.protocol !== 'https:') return { ok: false, error: 'url-must-be-http(s)' };
          normalizedUrl = u.href.replace(/\/+$/, '');
        } catch { return { ok: false, error: 'invalid-url' }; }
      }

      const patch = {};
      if (typeof label === 'string' && label.trim()) patch.label = label.trim().slice(0, 100);
      if (normalizedUrl) patch.baseUrl = normalizedUrl;
      if (typeof defaultModel === 'string') patch.defaultModel = defaultModel.trim().slice(0, 200);
      if (typeof apiFormat === 'string' && (apiFormat === 'openai' || apiFormat === 'anthropic')) patch.apiFormat = apiFormat;

      const updated = await updateCustomProvider(kv, name, patch);
      if (!updated) return { ok: false, error: 'not-found' };

      // Re-register the adapter with updated config
      unregisterProvider(name);
      const adapter = makeOpenAiCompatAdapter({
        name: updated.name,
        label: updated.label,
        baseUrl: updated.baseUrl,
        vaultSecretName: updated.vaultSecretName,
        defaultModel: updated.defaultModel || undefined,
        apiFormat: updated.apiFormat,
      });
      registerProvider(adapter);
      onProviderConfigChanged?.();

      // Rebuild the egress allowlist (baseUrl may have changed)
      rebuildUserEndpoints();

      pushState();
      return { ok: true, provider: updated };
    },

    // List models from a custom provider's /v1/models endpoint.
    // Returns the model list or an error if the endpoint is unreachable.
    'custom-provider/models': async ({ name }) => {
      if (typeof name !== 'string' || !name) return { ok: false, error: 'name-required' };
      if (!isCustomProvider(name)) return { ok: false, error: 'not-custom-provider' };

      const adapter = listProviders().find((/** @type {any} */ p) => p.name === name);
      if (!adapter?.liveModels) return { ok: false, error: 'no-live-inventory' };

      try {
        const models = await listProviderModels(name, { safeFetch, getSecret });
        return { ok: true, models: models ?? [] };
      } catch (e) {
        const ev = /** @type {{ status?: number, message?: string }} */ (e);
        return { ok: false, error: ev?.message ?? 'unreachable' };
      }
    },
  };
};
