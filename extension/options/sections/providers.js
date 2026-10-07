// @ts-check
// Options → Providers & models — provider key cards + default model.
//
// Ported verbatim from the panel's settings-view "Providers & models"
// section (the disclosure Section wrapper is dropped; the options shell
// renders the page heading). Each provider gets its own logo card with
// a slick inline key editor (collapsed to a masked badge until you hit
// Replace), plus the default provider+model selectors, the web-actor
// model, and the Ollama GPU-fit recommendation.
//
// The key is sent to the SW as plaintext via runtime.sendMessage; the
// SW encrypts it with the vault DK before persisting. The plaintext
// never lands in chrome.storage and never leaves the SW after the
// encryption step.

import m from '/vendor/mithril/mithril.js';
import {
  KEY_PREFIX,
  OLLAMA_MODEL_TIERS,
  checkApiKeyFormat,
  probeGpuCapability,
  recommendOllamaModel,
} from '/peerd-provider/index.js';
import { resetRow } from './reset-row.js';
import { LocalModelsSection } from './local-models.js';

/** @typedef {import('./reset-row.js').Send} Send */
/** @typedef {{ name: string, label: string, defaultModel?: string, defaultRunnerModel?: string, hasKey?: boolean, keyless?: boolean, liveModels?: boolean, keyPreview?: string, custom?: boolean, baseUrl?: string | null, apiFormat?: string }} ProviderRow */

// ── Preset provider templates ──────────────────────────────────────────
// Common OpenAI-compatible endpoints users can select from when adding a
// custom provider, instead of typing the baseUrl manually. Mirrors Page
// Assist's OAI_API_PROVIDERS but stripped to the endpoints peerd doesn't
// already ship as built-in adapters.
const PROVIDER_PRESETS = Object.freeze([
  { label: '自定义', value: '', baseUrl: '', defaultModel: '' },
  { label: 'DeepSeek', value: 'deepseek', baseUrl: 'https://api.deepseek.com', defaultModel: 'deepseek-chat' },
  { label: 'Fireworks', value: 'fireworks', baseUrl: 'https://api.fireworks.ai/inference/v1', defaultModel: '' },
  { label: 'Novita AI', value: 'novita', baseUrl: 'https://api.novita.ai/v3/openai', defaultModel: '' },
  { label: 'Hugging Face', value: 'huggingface', baseUrl: 'https://router.huggingface.co/v1', defaultModel: '' },
  { label: 'Groq', value: 'groq', baseUrl: 'https://api.groq.com/openai/v1', defaultModel: 'llama-4-scout-17b-16e-instruct' },
  { label: 'Together', value: 'together', baseUrl: 'https://api.together.xyz/v1', defaultModel: '' },
  { label: 'Google AI (Gemini)', value: 'gemini', baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai', defaultModel: 'gemini-2.5-flash' },
  { label: 'Mistral', value: 'mistral', baseUrl: 'https://api.mistral.ai/v1', defaultModel: 'mistral-large-latest' },
  { label: 'SiliconFlow', value: 'siliconflow', baseUrl: 'https://api.siliconflow.cn/v1', defaultModel: '' },
  { label: 'VolcEngine', value: 'volcengine', baseUrl: 'https://ark.cn-beijing.volces.com/api/v3', defaultModel: '' },
  { label: 'TencentCloud', value: 'tencentcloud', baseUrl: 'https://api.lkeap.cloud.tencent.com/v1', defaultModel: '' },
  { label: 'AliBaBaCloud', value: 'alibabacloud', baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1', defaultModel: 'qwen-plus' },
  { label: 'Moonshot', value: 'moonshot', baseUrl: 'https://api.moonshot.ai/v1', defaultModel: 'moonshot-v1-auto' },
  { label: 'xAI', value: 'xai', baseUrl: 'https://api.x.ai/v1', defaultModel: 'grok-4' },
  { label: 'Chutes', value: 'chutes', baseUrl: 'https://llm.chutes.ai/v1', defaultModel: '' },
  { label: 'BigModel (Zhipu)', value: 'zhipu', baseUrl: 'https://open.bigmodel.cn/api/paas/v4', defaultModel: 'glm-4-plus' },
  { label: 'MiniMax', value: 'minimax', baseUrl: 'https://api.minimax.io/v1', defaultModel: '' },
  { label: 'Xiaomi Mimo', value: 'xiaomimimo', baseUrl: 'https://api.xiaomimimo.com/v1', defaultModel: '' },
  { label: 'ModelScope', value: 'modelscope', baseUrl: 'https://api-inference.modelscope.cn/v1', defaultModel: '' },
  { label: 'Anthropic (Claude)', value: 'anthropic-compat', baseUrl: 'https://api.anthropic.com/v1', defaultModel: 'claude-sonnet-4-6', apiFormat: 'anthropic' },
  { label: 'Infinigence AI', value: 'infinigenceai', baseUrl: 'https://cloud.infini-ai.com/maas/v1', defaultModel: '' },
  { label: 'Vercel AI Gateway', value: 'vercel', baseUrl: 'https://ai-gateway.vercel.sh/v1', defaultModel: '' },
  { label: 'LLaMa.cpp', value: 'llamacpp', baseUrl: 'http://localhost:8080/v1', defaultModel: '' },
  { label: 'LM Studio', value: 'lmstudio', baseUrl: 'http://localhost:1234/v1', defaultModel: '' },
  { label: 'Llamafile', value: 'llamafile', baseUrl: 'http://127.0.0.1:8080/v1', defaultModel: '' },
  { label: 'vLLM', value: 'vllm', baseUrl: 'http://localhost:8000/v1', defaultModel: '' },
]);

// ── Provider logos ──────────────────────────────────────────────────────
// Inline SVG marks (no network, no external asset — same privacy posture
// as the rest of peerd). Brand-evocative, not pixel-exact reproductions:
// a coral sunburst for Anthropic, a routing fan-out for OpenRouter, and a
// neutral monogram tile for anything else.
const ANTHROPIC_MARK =
  '<svg viewBox="0 0 32 32" width="26" height="26" role="img" aria-label="Anthropic">'
  + '<rect width="32" height="32" rx="7" fill="#CC785C"/>'
  + '<g stroke="#fff" stroke-width="3" stroke-linecap="round">'
  + '<line x1="16" y1="8" x2="16" y2="24"/><line x1="8" y1="16" x2="24" y2="16"/>'
  + '<line x1="10.3" y1="10.3" x2="21.7" y2="21.7"/><line x1="21.7" y1="10.3" x2="10.3" y2="21.7"/>'
  + '</g></svg>';
const OPENROUTER_MARK =
  '<svg viewBox="0 0 32 32" width="26" height="26" role="img" aria-label="OpenRouter">'
  + '<rect width="32" height="32" rx="7" fill="#6566F1"/>'
  + '<g fill="none" stroke="#fff" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round">'
  + '<path d="M8 16 H15"/><path d="M15 16 L23.5 10.5"/><path d="M15 16 L23.5 21.5"/>'
  + '</g>'
  + '<g fill="#fff"><circle cx="8" cy="16" r="2"/><circle cx="23.5" cy="10.5" r="2"/><circle cx="23.5" cy="21.5" r="2"/></g>'
  + '</svg>';
// Z.ai: a teal tile with a white Z monogram — brand-evocative, not a logo clone.
const ZAI_MARK =
  '<svg viewBox="0 0 32 32" width="26" height="26" role="img" aria-label="Z.ai">'
  + '<rect width="32" height="32" rx="7" fill="#0EA5A4"/>'
  + '<path d="M9 10 H23 L11 22 H23" fill="none" stroke="#fff" stroke-width="2.6"'
  + ' stroke-linecap="round" stroke-linejoin="round"/>'
  + '</svg>';
// Ollama: a minimal llama-head silhouette on a neutral tile — evocative
// of the upstream mark without reproducing it.
const OLLAMA_MARK =
  '<svg viewBox="0 0 32 32" width="26" height="26" role="img" aria-label="Ollama">'
  + '<rect width="32" height="32" rx="7" fill="#3B3B40"/>'
  + '<g fill="none" stroke="#fff" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round">'
  + '<path d="M12 12 V7.5"/><path d="M20 12 V7.5"/>'
  + '<rect x="9" y="10.5" width="14" height="14" rx="6"/>'
  + '</g>'
  + '<g fill="#fff"><circle cx="13.5" cy="17" r="1.5"/><circle cx="18.5" cy="17" r="1.5"/></g>'
  + '</svg>';
// Custom provider: a violet tile with a plus/node mark — a user-added
// OpenAI-compatible endpoint (no brand to reproduce).
const CUSTOM_MARK =
  '<svg viewBox="0 0 32 32" width="26" height="26" role="img" aria-label="Custom provider">'
  + '<rect width="32" height="32" rx="7" fill="#6B4C9A"/>'
  + '<g fill="none" stroke="#fff" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round">'
  + '<path d="M16 8 V24"/><path d="M8 16 H24"/>'
  + '</g>'
  + '<circle cx="16" cy="16" r="3" fill="#fff"/>'
  + '</svg>';

/** @param {string} name @param {boolean} [isCustom] */
const providerLogo = (name, isCustom) => {
  if (name === 'anthropic') return m('span.provider-logo', m.trust(ANTHROPIC_MARK));
  if (name === 'openrouter') return m('span.provider-logo', m.trust(OPENROUTER_MARK));
  if (name === 'glm') return m('span.provider-logo', m.trust(ZAI_MARK));
  if (name === 'ollama') return m('span.provider-logo', m.trust(OLLAMA_MARK));
  if (isCustom) return m('span.provider-logo', m.trust(CUSTOM_MARK));
  return m('span.provider-logo.logo-generic', (String(name)[0] ?? '?').toUpperCase());
};

export const ProvidersSection = {
  /** @param {{ state: any, attrs: { state: any, send: Send } }} vnode */
  oninit(vnode) {
    // Per-provider key entry state — keyed by provider name so every
    // provider has its own independent input / busy / message / editing.
    vnode.state.keyInput = {};      // name -> draft value
    vnode.state.keyBusy = {};       // name -> bool
    vnode.state.keyMsg = {};        // name -> { ok, text }
    vnode.state.keyEditing = {};    // name -> bool (Replace revealed the field)
    vnode.state.providerStatus = null;  // [{ name, label, defaultModel, hasKey }]
    // name -> 'checking' | 'connected' | 'down' — the LIVE reachability of a
    // keyless daemon (Ollama). Drives the badge so green means "actually
    // connected", never just "no key needed".
    vnode.state.connStatus = {};
    // Model dropdown options — fetched lazily from the view (see modelOptionsKey)
    // using the SAME source as the chat picker (models/options).
    vnode.state.modelOptions = null;
    vnode.state.modelOptionsKey = '';
    vnode.state.modelOptionsGeneration = 0;
    vnode.state.probeGeneration = {};
    vnode.state.ollamaHostSave = null;
    vnode.state.ollamaHostSaving = false;
    vnode.state.ollamaHostSaveGeneration = 0;
    vnode.state.providerStatusGeneration = 0;
    // Custom provider add form
    vnode.state.showAddForm = false;
    vnode.state.addFormBusy = false;
    vnode.state.addFormMsg = null;    // { ok, text }
    vnode.state.addLabel = '';
    vnode.state.addBaseUrl = '';
    vnode.state.addApiKey = '';
    vnode.state.addDefaultModel = '';
    vnode.state.addPreset = '';
    vnode.state.addApiFormat = 'openai';
    // Custom provider delete confirmation
    vnode.state.deleteConfirm = {};   // name -> bool (showing confirm?)
    vnode.state.deleteBusy = {};      // name -> bool
    vnode.state.deleteMsg = {};       // name -> { ok, text }
    // Custom provider model list (fetched from /v1/models)
    vnode.state.customModels = {};    // name -> [{ model, label }]
    vnode.state.customModelsLoading = {}; // name -> bool
    vnode.state.customModelSearch = {}; // name -> search query string
    vnode.state.observedConfigRevision = vnode.attrs.state?.providers?.configRevision ?? 0;
    ProvidersSection.loadProviderStatus(vnode);
  },

  // Fetch the /v1/models list for a custom provider and update the UI state.
  // Called automatically when a custom provider card first renders with a key,
  // and on the manual "Refresh models" button.
  /** @param {{ state: any, send: Send }} ctx @param {string} name */
  fetchCustomModels(ctx, name) {
    ctx.state.customModelsLoading[name] = true; m.redraw();
    ctx.send({ type: 'custom-provider/models', name }).then((/** @type {any} */ r) => {
      ctx.state.customModelsLoading[name] = false;
      if (r?.ok) {
        ctx.state.customModels[name] = r.models ?? [];
        ProvidersSection.loadModelOptions(ctx.state, ctx.send);
      } else {
        ctx.state.customModels[name] = [];
      }
      m.redraw();
    }).catch(() => { ctx.state.customModelsLoading[name] = false; m.redraw(); });
  },

  /** @param {{ state: any, attrs: { state: any, send: Send } }} vnode */
  onupdate(vnode) {
    const revision = vnode.attrs.state?.providers?.configRevision ?? 0;
    if (revision !== vnode.state.observedConfigRevision) {
      vnode.state.observedConfigRevision = revision;
      ProvidersSection.loadProviderStatus(vnode);
    }
  },

  // Fetch per-provider key status (which providers have a key stored).
  // Called on mount and after any key save so the badges stay accurate.
  /** @param {{ state: any, attrs: { state: any, send: Send } }} vnode */
  async loadProviderStatus(vnode) {
    const generation = vnode.state.providerStatusGeneration + 1;
    vnode.state.providerStatusGeneration = generation;
    try {
      const r = await vnode.attrs.send({ type: 'provider/status' });
      if (vnode.state.providerStatusGeneration !== generation || !r?.ok) return;
      vnode.state.providerStatus = r.providers;
      m.redraw();
      // Auto-probe keyless providers that expose a live daemon (Ollama): the
      // badge should reflect REAL reachability, not a default-green. Quiet
      // (no card message) so an unused provider doesn't shout a red error on
      // mount; clicking Test still gives the full message.
      for (const p of r.providers) {
        if (p.keyless && p.liveModels) ProvidersSection.probeConnection(vnode, p.name);
      }
    } catch { /* a later revision/focus retries */ }
  },

  // Quietly ping a keyless daemon (provider/test) and record reachability for
  // the badge. The explicit Test button reuses provider/test too, but also
  // surfaces the full message; this path only moves the badge.
  /** @param {{ state: any, attrs: { send: Send } }} vnode @param {string} name */
  probeConnection(vnode, name) {
    const generation = (vnode.state.probeGeneration[name] ?? 0) + 1;
    vnode.state.probeGeneration[name] = generation;
    vnode.state.connStatus[name] = 'checking';
    m.redraw();
    vnode.attrs.send({ type: 'provider/test', provider: name }).then((/** @type {any} */ r) => {
      if (vnode.state.probeGeneration[name] !== generation) return;
      vnode.state.connStatus[name] = r?.ok ? 'connected'
        : r?.reachable && r?.error === 'no-models' ? 'no-models'
          : 'down';
      vnode.state.modelOptionsKey = '';
      m.redraw();
    }).catch(() => {
      if (vnode.state.probeGeneration[name] !== generation) return;
      vnode.state.connStatus[name] = 'down';
      m.redraw();
    });
  },

  // Fetch the Model-dropdown options from the SAME source the chat picker uses
  // (models/options -> buildModelOptions): every configured provider's curated
  // models. Called from the view whenever the provider / curated set / key
  // state changes, so the selector tracks what you've picked.
  /**
   * @param {any} state
   * @param {Send} send
   */
  loadModelOptions(state, send) {
    const generation = ++state.modelOptionsGeneration;
    send({ type: 'models/options' }).then((/** @type {any} */ r) => {
      if (generation !== state.modelOptionsGeneration) return;
      if (r?.ok) { state.modelOptions = r.options ?? []; m.redraw(); }
    }).catch(() => {});
  },

  /** @param {{ attrs: { state: any, send: Send }, state: any }} vnode */
  view: ({ attrs: { state, send }, state: ui }) => {
    // Synthetic vnode for calling loadProviderStatus/probeConnection from
    // within the view (which destructures vnode, so `vnode` is not in scope).
    const _vn = { attrs: { state, send }, state: ui };
    const provider = state.providers ?? { current: 'anthropic', hasKey: false };
    const providerModel = state.settings?.providerModel ?? '';
    const actorExecution = state.capabilities?.actorExecution;
    const actorUnavailable = actorExecution && actorExecution.status !== 'available';

    // Save a key for ONE provider, independently of the others. The paste
    // sanity check is the shared checkApiKeyFormat (peerd-provider) - the
    // onboarding provider step applies the identical rule (§5h).
    /** @param {string} name */
    const saveKey = async (name) => {
      if (ui.keyBusy[name]) return;
      ui.keyMsg[name] = null;
      const check = checkApiKeyFormat(name, ui.keyInput[name]);
      if (!check.ok) {
        ui.keyMsg[name] = { ok: false, text: check.message };
        m.redraw();
        return;
      }
      const value = check.value;
      ui.keyBusy[name] = true;
      m.redraw();
      const reply = await send({ type: 'provider/setKey', provider: name, plaintext: value });
      ui.keyBusy[name] = false;
      if (reply?.ok) {
        ui.keyInput[name] = '';
        ui.keyEditing[name] = false;   // collapse the editor back to the badge
        ui.keyMsg[name] = { ok: true, text: '已保存 — 已在密码库中加密。' };
        // Refresh the badges so this provider flips to "Key saved".
        await ProvidersSection.loadProviderStatus({ attrs: { state, send }, state: ui });
        // Auto-verify so the user never has to click Test (the ask). For
        // OpenRouter the model panel below loads the live catalog — that load
        // IS the verification (and populates the curation list). Bump its
        // reload token BEFORE the redraw so the panel (mounting now the key
        // exists) loads exactly once, not twice. For the others, a 1-token
        // ping confirms in the card.
        if (name === 'openrouter') ui.orReloadToken = (ui.orReloadToken ?? 0) + 1;
        m.redraw();
        if (name !== 'openrouter') await testKey(name);
        // why: custom providers should auto-fetch models after a key is saved,
        // so the user sees the available models immediately instead of having
        // to click "Refresh models" manually.
        const isCustom = (ui.providerStatus ?? []).some((/** @type {ProviderRow} */ pp) => pp.name === name && pp.custom);
        if (isCustom) ProvidersSection.fetchCustomModels({ state: ui, send }, name);
      } else {
        ui.keyMsg[name] = {
          ok: false,
          text: reply?.error === 'locked'
            ? '密码库已锁定 — 请先在 peerd 面板中解锁。'
            : reply?.error ?? '出了点问题。',
        };
      }
      m.redraw();
    };

    // Validate a SAVED key with a 1-token ping on the real provider endpoint,
    // so the tester knows it works before sending a real message. Keyless
    // providers (Ollama) ping the local daemon instead — the SW reports
    // the installed-model count.
    /** @param {string} name */
    const testKey = async (name) => {
      // A blur/change event can race the immediately following Test click.
      // Never let the test route observe the old persisted host.
      while (name === 'ollama' && ui.ollamaHostSave) {
        await ui.ollamaHostSave.catch(() => {});
      }
      if (ui.keyBusy[name]) return;
      const generation = (ui.probeGeneration[name] ?? 0) + 1;
      ui.probeGeneration[name] = generation;
      ui.keyBusy[name] = true; ui.keyMsg[name] = null; m.redraw();
      const reply = await send({ type: 'provider/test', provider: name });
      ui.keyBusy[name] = false;
      if (ui.probeGeneration[name] !== generation) { m.redraw(); return; }
      // Keep the badge in sync with an explicit Test (keyless daemons only — the
      // badge for keyed providers tracks hasKey, not live reachability).
      ui.connStatus[name] = reply?.ok ? 'connected'
        : reply?.reachable && reply?.error === 'no-models' ? 'no-models'
          : 'down';
      ui.keyMsg[name] = reply?.ok
        ? {
            ok: true,
            text: typeof reply.models === 'number'
              ? `✓ 已连接 — Ollama 正在运行（已安装 ${reply.models} 个模型）。`
              : '✓ 已连接 — 密钥有效。',
          }
        : {
            ok: false,
            text: reply?.error === 'invalid-key' ? '提供商拒绝了密钥 (401)。请仔细检查。'
              : reply?.error === 'no-key' ? '此提供商尚未保存密钥。'
              : reply?.error === 'locked' ? '密码库已锁定 — 请先在 peerd 面板中解锁。'
              : reply?.error === 'no-models' ? 'Ollama 正在运行，但未安装任何模型。可使用以下命令获取：ollama pull qwen3:8b'
              : name === 'ollama' && reply?.error === 'unreachable'
                ? '无法访问 Ollama。可使用以下命令启动：ollama serve'
              : `无法访问提供商：${reply?.error ?? '未知错误'}。`,
          };
      if (name === 'ollama' && (reply?.ok || reply?.reachable)) ui.modelOptionsKey = '';
      m.redraw();
    };

    // Providers for the keys manager + default selector. Falls back to
    // the known names while the provider/status fetch is in flight.
    /** @type {ProviderRow[]} */
    const providerRows = ui.providerStatus ?? [
      { name: 'anthropic',  label: 'Anthropic',  hasKey: provider.current === 'anthropic'  && provider.hasKey },
      { name: 'openrouter', label: 'OpenRouter', hasKey: provider.current === 'openrouter' && provider.hasKey },
      { name: 'openai',     label: 'OpenAI', hasKey: provider.current === 'openai' && provider.hasKey },
      { name: 'glm',        label: 'Z.ai',       hasKey: provider.current === 'glm'        && provider.hasKey },
      { name: 'ollama',     label: 'Ollama', hasKey: true, keyless: true },
    ];
    /** @param {string} name */
    const keyPlaceholder = (name) => KEY_PREFIX[name]
      ? `${KEY_PREFIX[name]}...`
      // why: providers without a stable sk- prefix (Z.ai GLM keys are shaped
      // `id.secret`) get a neutral hint rather than a misleading `sk-...`.
      : '你的 API 密钥';
    const settingsProviderName = state.settings?.providerName ?? '';
    const localWebGpuAvailable = state.capabilities?.localWebGpuHost?.status === 'available';
    // why NOT localWebGpuAvailable here: that flag is a HOST fact, not readiness.
    // It reports only that an offscreen document can be created, so it is true on
    // every Chrome regardless of GPU or whether the on-device model was ever
    // downloaded. models/options is the readiness signal: model-catalog drops
    // local-webgpu until it is resident, so membership there means a first turn
    // would actually run. Matches ensureActiveProvider, which binds a new chat on
    // localModelState.available(); Settings must not name a default the SW would
    // refuse to bind.
    const localWebGpuReady = (ui.modelOptions ?? [])
      .some((/** @type {any} */ o) => o.provider === 'local-webgpu');
    // why: A provider is usable when it has its required key, the on-device model
    // is resident, or a keyless daemon is reachable. Keep an explicitly chosen
    // Ollama usable through a transient outage so its warning does not replace
    // the configured default controls. A confirmed no-models result still blocks.
    /** @param {ProviderRow} p */
    const isUsable = (p) => (!p.keyless && !!p.hasKey)
      || (p.name === 'local-webgpu' && localWebGpuReady)
      || (!!p.keyless && ui.connStatus[p.name] === 'connected')
      || (p.name === 'ollama'
        && settingsProviderName === p.name
        && ui.connStatus[p.name] !== 'no-models');
    const firstUsable = providerRows.find(isUsable);
    const anyUsable = !!firstUsable || ((ui.modelOptions ?? []).length > 0);
    // The provider the block edits. HONOR an explicit choice as-is — even one
    // with no key yet: the "No key set" hint below says so honestly, whereas
    // silently switching would desync the <select> from the persisted
    // providerName (and start fresh chats on a different provider than shown).
    // Only when NOTHING is explicitly chosen do we pick the first usable
    // provider — so a fresh OpenRouter/Ollama user sees THAT, not the Anthropic
    // fallback resolveActiveProvider returns for an empty providerName. The
    // modelOptions[0] fallback covers the brief window where a daemon probe is
    // still in flight (so it never momentarily reads as Anthropic).
    const selectableProviderRows = providerRows.filter((p) =>
      p.name !== 'local-webgpu'
        || localWebGpuAvailable);
    const effectiveProvider =
      (settingsProviderName && selectableProviderRows.some((p) => p.name === settingsProviderName))
        ? settingsProviderName
        : (firstUsable?.name ?? (ui.modelOptions ?? [])[0]?.provider ?? provider.current);
    const defaultProvRow = providerRows.find((p) => p.name === effectiveProvider);
    const providerRunnerDefault = defaultProvRow?.defaultRunnerModel ?? provider.defaultRunnerModel ?? 'claude-haiku-4-5';
    const localRunnerCapable = localWebGpuAvailable;
    // Keep the Model selector populated from the chat-picker source; re-fetch
    // when the active provider, the curated OpenRouter set, or key-state changes.
    const providerStatusKey = providerRows
      .map((p) => `${p.name}:${p.hasKey ? 1 : 0}:${ui.connStatus[p.name] ?? ''}`)
      .join(',');
    const moKey = `${effectiveProvider}|${providerStatusKey}|${state.settings?.ollamaHost ?? ''}|${(state.settings?.openrouterModels ?? []).join(',')}`;
    if (moKey !== ui.modelOptionsKey) {
      ui.modelOptionsKey = moKey;
      ProvidersSection.loadModelOptions(ui, send);
    }
    const modelOpts = (ui.modelOptions ?? []).filter((/** @type {any} */ o) => o.provider === effectiveProvider);

    // One provider per card: logo, name, key status, and a slick inline
    // key editor that stays collapsed to the masked badge until you hit
    // Replace — no permanent "paste a new key" field cluttering the row.
    // Keyless providers (Ollama) get a "no key needed" badge and only the
    // Test button — there is no key to save or replace.
    /** @param {ProviderRow} p */
    const renderProviderCard = (p) => {
      const editing = !!ui.keyEditing[p.name];
      const busy = !!ui.keyBusy[p.name] || (p.name === 'ollama' && ui.ollamaHostSaving);
      const msg = ui.keyMsg[p.name];
      const draft = ui.keyInput[p.name] ?? '';
      const showForm = !p.keyless && (editing || !p.hasKey);
      return m('.provider-card', [
        m('.provider-card-main', [
          providerLogo(p.name, p.custom),
          m('.provider-card-text', [
            m('span.provider-card-name', p.label),
            p.custom && p.baseUrl
              ? m('span.provider-card-url', p.baseUrl)
              : null,
            p.custom && p.apiFormat === 'anthropic'
              ? m('span.key-badge.key-local', 'Anthropic 格式')
              : null,
            p.keyless
              // Keyless local daemon (Ollama): green is EARNED by a live probe,
              // not given for free. Neutral until we've confirmed it answers.
              ? (ui.connStatus[p.name] === 'connected'
                  ? m('span.key-badge.key-set', '✓ 已连接')
                  : ui.connStatus[p.name] === 'no-models'
                    ? m('span.key-badge.key-local', '已连接，无模型')
                  : ui.connStatus[p.name] === 'checking'
                    ? m('span.key-badge.key-local', '检查中…')
                    : ui.connStatus[p.name] === 'down'
                      ? m('span.key-badge.key-local', '无法访问')
                    : m('span.key-badge.key-local', '本地 — 无需密钥'))
              : p.hasKey
                ? m('span.key-badge.key-set', p.keyPreview ? `✓ ${p.keyPreview}` : '✓ 密钥已保存')
                : m('span.key-badge.key-unset', '未设置密钥'),
          ]),
          ((p.hasKey || p.keyless) && !editing)
            ? m('span', { style: 'margin-left:auto;display:inline-flex;gap:10px;' }, [
                m('button.linkish', {
                  type: 'button',
                  disabled: busy,
                  onclick: () => testKey(p.name),
                }, busy ? '…' : '测试'),
                p.keyless ? null : m('button.linkish', {
                  type: 'button',
                  onclick: () => { ui.keyEditing[p.name] = true; ui.keyMsg[p.name] = null; m.redraw(); },
                }, '替换'),
              ])
            : null,
          // Custom providers can be removed entirely (config + optional key).
          p.custom
            ? m('span', { style: 'margin-left:auto;display:inline-flex;gap:10px;' }, [
                ui.deleteConfirm[p.name]
                  ? m('span.delete-confirm-group', [
                      m('button.linkish.delete-link', {
                        type: 'button',
                        disabled: !!ui.deleteBusy[p.name],
                        onclick: async () => {
                          ui.deleteBusy[p.name] = true; m.redraw();
                          const r = await send({ type: 'custom-provider/remove', name: p.name, deleteKey: true });
                          ui.deleteBusy[p.name] = false;
                          if (r?.ok) {
                            ui.deleteConfirm[p.name] = false;
                            ProvidersSection.loadProviderStatus(_vn);
                          } else {
                            ui.deleteMsg[p.name] = { ok: false, text: r?.error ?? '移除失败。' };
                          }
                          m.redraw();
                        },
                      }, ui.deleteBusy[p.name] ? '…' : '是，移除'),
                      m('button.linkish', {
                        type: 'button',
                        disabled: !!ui.deleteBusy[p.name],
                        onclick: () => { ui.deleteConfirm[p.name] = false; m.redraw(); },
                      }, '取消'),
                    ])
                  : m('button.linkish.delete-link', {
                      type: 'button',
                      onclick: () => { ui.deleteConfirm[p.name] = true; m.redraw(); },
                    }, '删除'),
              ])
            : null,
        ]),
        showForm
          ? m('form.provider-card-form', { onsubmit: (/** @type {Event} */ e) => { e.preventDefault(); saveKey(p.name); } }, [
              m('.input-row', [
                m('input', {
                  type: 'password',
                  autocomplete: 'off',
                  spellcheck: false,
                  placeholder: keyPlaceholder(p.name),
                  value: draft,
                  disabled: busy,
                  // why: focus the field the instant Replace reveals it.
                  oncreate: editing ? (/** @type {{ dom: HTMLInputElement }} */ vn) => vn.dom.focus() : undefined,
                  oninput: (/** @type {{ target: HTMLInputElement }} */ e) => { ui.keyInput[p.name] = e.target.value; },
                }),
                m('button', { type: 'submit', disabled: busy || !draft.trim() },
                  busy ? '…' : p.hasKey ? '替换' : '保存'),
                editing
                  ? m('button.secondary', {
                      type: 'button',
                      disabled: busy,
                      onclick: () => {
                        ui.keyEditing[p.name] = false;
                        ui.keyInput[p.name] = '';
                        ui.keyMsg[p.name] = null;
                        m.redraw();
                      },
                    }, '取消')
                  : null,
              ]),
            ])
          : null,
        // Card-level message (Save OR Test) — shows whether the form is open or
        // collapsed (Test runs while the card is collapsed).
        msg ? m(`p.key-msg${msg.ok ? '.ok' : '.err'}`, msg.text) : null,
        ui.deleteMsg[p.name]
          ? m(`p.key-msg${ui.deleteMsg[p.name].ok ? '.ok' : '.err'}`, ui.deleteMsg[p.name].text)
          : null,
        // Custom provider: show model list fetched from /v1/models.
        // Auto-fetches on first render when the provider has a key;
        // the refresh button lets the user re-fetch after adding models on the provider side.
        // Search bar + clickable chips (click to set as default model).
        p.custom && p.hasKey
          ? m('.custom-models-section', {
              oncreate: () => {
                if (!ui.customModels[p.name] && !ui.customModelsLoading[p.name]) {
                  ProvidersSection.fetchCustomModels({ state: ui, send }, p.name);
                }
              },
            }, [
              m('.custom-models-header', [
                m('button.linkish', {
                  type: 'button',
                  disabled: !!ui.customModelsLoading[p.name],
                  onclick: () => ProvidersSection.fetchCustomModels({ state: ui, send }, p.name),
                }, ui.customModelsLoading[p.name] ? '加载中…' : '刷新模型'),
                Array.isArray(ui.customModels[p.name]) && ui.customModels[p.name].length > 0
                  ? m('span.custom-model-count', `${ui.customModels[p.name].length} 个模型`)
                  : null,
              ]),
              Array.isArray(ui.customModels[p.name]) && ui.customModels[p.name].length > 0
                ? [
                    m('input.custom-model-search', {
                      type: 'search',
                      spellcheck: false,
                      placeholder: '搜索模型…',
                      value: ui.customModelSearch[p.name] ?? '',
                      oninput: (/** @type {{ target: HTMLInputElement }} */ e) => {
                        ui.customModelSearch[p.name] = e.target.value;
                        m.redraw();
                      },
                    }),
                    m('.custom-model-list', ui.customModels[p.name]
                      .filter((/** @type {any} */ mdl) => {
                        const q = (ui.customModelSearch[p.name] ?? '').toLowerCase();
                        if (!q) return true;
                        const id = (mdl.model ?? mdl.id ?? '').toLowerCase();
                        const lbl = (mdl.label ?? mdl.name ?? '').toLowerCase();
                        return id.includes(q) || lbl.includes(q);
                      })
                      .map((/** @type {any} */ mdl) => {
                        const id = mdl.model ?? mdl.id ?? '';
                        const isDefault = (state.settings?.providerModel ?? '') === id
                          && (state.settings?.providerName ?? '') === p.name;
                        return m('span.custom-model-chip', {
                          class: isDefault ? 'is-default' : '',
                          title: isDefault ? '当前默认模型' : `点击将 "${id}" 设为默认模型`,
                          onclick: async () => {
                            if (!isDefault) {
                              await send({ type: 'settings/update', patch: { providerName: p.name, providerModel: id } });
                              m.redraw();
                            }
                          },
                        }, id);
                      })),
                    m('p.hint', '点击模型可将其设为默认。'),
                  ]
                : null,
            ])
          : null,
        p.name === 'ollama' ? [
          m('.input-row', [
            m('label', { for: 'ollama-host' }, 'Ollama 主机'),
            m('input', {
              id: 'ollama-host',
              type: 'text',
              spellcheck: false,
              disabled: ui.ollamaHostSaving,
              placeholder: 'http://localhost:11434',
              value: state.settings?.ollamaHost ?? '',
              onchange: async (/** @type {{ target: HTMLInputElement }} */ e) => {
                const value = e.target.value.trim();
                const generation = ++ui.ollamaHostSaveGeneration;
                ui.ollamaHostSaving = true;
                m.redraw();
                const save = (async () => {
                  const reply = value
                    ? await send({ type: 'settings/update', patch: { ollamaHost: value } })
                    : await send({ type: 'settings/reset', keys: ['ollamaHost'] });
                  if (generation !== ui.ollamaHostSaveGeneration) return;
                  if (!reply?.ok) {
                    ui.keyMsg.ollama = { ok: false, text: '请输入完整的 http:// 或 https:// Ollama URL。' };
                    return;
                  }
                  ui.keyMsg.ollama = null;
                  ui.modelOptionsKey = '';
                  ProvidersSection.probeConnection({ state: ui, attrs: { send } }, 'ollama');
                })();
                ui.ollamaHostSave = save;
                try { await save; }
                finally {
                  if (generation === ui.ollamaHostSaveGeneration) {
                    ui.ollamaHostSaving = false;
                    ui.ollamaHostSave = null;
                  }
                  m.redraw();
                }
              },
            }),
          ]),
          m('p.hint', [
            '留空表示 ', m('code', 'http://localhost:11434'),
            '，或输入远程守护进程的地址。仅限纯 HTTP 时只有 ',
            m('code', '11434'), ' 可访问；HTTPS 前端的主机可使用任何端口。',
          ]),
        ] : null,
      ]);
    };

    return m('div', [
      m('p', '自带密钥 — 每个提供商独立设置；每个密钥'
        + '独立存储并在密码库中加密。OpenRouter 是一个'
        + '兼容 OpenAI 的网关，可访问多个厂商的模型。Z.ai 通过'
        + '直接的 OpenAI 兼容端点提供其 GLM 模型（GLM-5.2，…）。'
        + 'Ollama 在您控制的守护进程上运行模型：无需密钥，'
        + '没有按令牌计费的 API 成本。使用 localhost 可将推理保留在本机。'),
      // The on-device WebGPU model is a full provider now — its card hosts the
      // hardware-test → download → ready flow inline (the old split-out
      // "On-device models" section is folded in here), with a status-driven
      // badge instead of a meaningless key form.
      m('.provider-cards', providerRows.map((p) =>
        p.name === 'local-webgpu'
          ? m(LocalModelsSection, {
              state,
              send,
              logo: providerLogo('local-webgpu'),
              label: p.label,
              onReady: () => { ui.modelOptionsKey = ''; m.redraw(); },
            })
          : renderProviderCard(p))),

      // Add custom OpenAI-compatible provider
      m('.custom-provider-add', [
        ui.showAddForm
          ? m('form.custom-provider-form', {
              onsubmit: (/** @type {Event} */ e) => {
                e.preventDefault();
                if (ui.addFormBusy) return;
                ui.addFormBusy = true; ui.addFormMsg = null; m.redraw();
                send({
                  type: 'custom-provider/add',
                  label: ui.addLabel,
                  baseUrl: ui.addBaseUrl,
                  apiKey: ui.addApiKey,
                  defaultModel: ui.addDefaultModel,
                  apiFormat: ui.addApiFormat || 'openai',
                }).then((/** @type {any} */ r) => {
                  ui.addFormBusy = false;
                  if (r?.ok) {
                    ui.showAddForm = false;
                    ui.addLabel = ''; ui.addBaseUrl = ''; ui.addApiKey = ''; ui.addDefaultModel = '';
                    ui.addPreset = ''; ui.addApiFormat = 'openai'; ui.addFormMsg = null;
                    ProvidersSection.loadProviderStatus(_vn);
                    // why: auto-fetch models for the newly added custom provider
                    // so the user sees available models immediately.
                    const newName = r.provider?.name;
                    if (newName) ProvidersSection.fetchCustomModels({ state: ui, send }, newName);
                  } else {
                    const errMap = {
                      'label-required': '请输入提供商名称。',
                      'base-url-required': '请输入 API 基础 URL。',
                      'invalid-url': '这看起来不是有效的 URL。',
                      'url-must-be-http(s)': 'URL 必须以 http:// 或 https:// 开头。',
                      'reserved-name': '该名称为内置提供商保留。',
                      'name-already-used': '同名提供商已存在。',
                      'invalid-label': '该名称生成了空 ID — 请尝试不同的标签。',
                      locked: '密码库已锁定 — 请先在 peerd 面板中解锁。',
                    };
                    ui.addFormMsg = { ok: false, text: errMap[r?.error] ?? r?.error ?? '出了点问题。' };
                  }
                  m.redraw();
                }).catch(() => {
                  ui.addFormBusy = false;
                  ui.addFormMsg = { ok: false, text: '网络错误。' };
                  m.redraw();
                });
              },
            }, [
              m('.input-row', [
                m('label', { for: 'cp-preset' }, '预设'),
                m('select', {
                  id: 'cp-preset',
                  value: ui.addPreset ?? '',
                  disabled: ui.addFormBusy,
                  onchange: (/** @type {{ target: HTMLSelectElement }} */ e) => {
                    const preset = PROVIDER_PRESETS.find((p) => p.value === e.target.value);
                    ui.addPreset = e.target.value;
                    if (preset && preset.value) {
                      if (!ui.addLabel || PROVIDER_PRESETS.some((p) => p.label === ui.addLabel)) {
                        ui.addLabel = preset.label;
                      }
                      ui.addBaseUrl = preset.baseUrl;
                      ui.addDefaultModel = preset.defaultModel;
                      ui.addApiFormat = preset.apiFormat || 'openai';
                    }
                    m.redraw();
                  },
                }, PROVIDER_PRESETS.map((p) =>
                  m('option', { value: p.value }, p.value
                    ? (p.apiFormat === 'anthropic'
                      ? `${p.label} (Anthropic 格式)`
                      : p.label)
                    : p.label))),
              ]),
              m('.input-row', [
                m('label', { for: 'cp-label' }, '名称'),
                m('input', {
                  id: 'cp-label', type: 'text', spellcheck: false,
                  placeholder: '例如 DeepSeek、Together、Groq',
                  value: ui.addLabel,
                  disabled: ui.addFormBusy,
                  oninput: (/** @type {{ target: HTMLInputElement }} */ e) => { ui.addLabel = e.target.value; },
                }),
              ]),
              m('.input-row', [
                m('label', { for: 'cp-baseurl' }, '基础 URL'),
                m('input', {
                  id: 'cp-baseurl', type: 'url', spellcheck: false,
                  placeholder: 'https://api.deepseek.com',
                  value: ui.addBaseUrl,
                  disabled: ui.addFormBusy,
                  oninput: (/** @type {{ target: HTMLInputElement }} */ e) => { ui.addBaseUrl = e.target.value; },
                }),
              ]),
              m('.input-row', [
                m('label', { for: 'cp-apiformat' }, 'API 格式'),
                m('select', {
                  id: 'cp-apiformat',
                  value: ui.addApiFormat ?? 'openai',
                  disabled: ui.addFormBusy,
                  onchange: (/** @type {{ target: HTMLSelectElement }} */ e) => { ui.addApiFormat = e.target.value; },
                }, [
                  m('option', { value: 'openai' }, 'OpenAI 兼容 (/v1/chat/completions)'),
                  m('option', { value: 'anthropic' }, 'Anthropic 兼容 (/v1/messages)'),
                ]),
              ]),
              m('.input-row', [
                m('label', { for: 'cp-apikey' }, 'API 密钥'),
                m('input', {
                  id: 'cp-apikey', type: 'password', autocomplete: 'off', spellcheck: false,
                  placeholder: 'sk-...',
                  value: ui.addApiKey,
                  disabled: ui.addFormBusy,
                  oninput: (/** @type {{ target: HTMLInputElement }} */ e) => { ui.addApiKey = e.target.value; },
                }),
              ]),
              m('.input-row', [
                m('label', { for: 'cp-model' }, '默认模型'),
                m('input', {
                  id: 'cp-model', type: 'text', spellcheck: false,
                  placeholder: '可选 — 例如 deepseek-chat',
                  value: ui.addDefaultModel,
                  disabled: ui.addFormBusy,
                  oninput: (/** @type {{ target: HTMLInputElement }} */ e) => { ui.addDefaultModel = e.target.value; },
                }),
              ]),
              m('.custom-provider-form-actions', [
                m('button', { type: 'submit', disabled: ui.addFormBusy || !ui.addLabel.trim() || !ui.addBaseUrl.trim() },
                  ui.addFormBusy ? '添加中…' : '添加提供商'),
                m('button.secondary', {
                  type: 'button',
                  disabled: ui.addFormBusy,
                  onclick: () => {
                    ui.showAddForm = false;
                    ui.addFormMsg = null;
                    ui.addPreset = '';
                    m.redraw();
                  },
                }, '取消'),
              ]),
              ui.addFormMsg
                ? m(`p.key-msg${ui.addFormMsg.ok ? '.ok' : '.err'}`, ui.addFormMsg.text)
                : null,
            ])
          : m('button.secondary.add-custom-btn', {
              type: 'button',
              onclick: () => { ui.showAddForm = true; m.redraw(); },
            }, '+ 添加自定义提供商（OpenAI 兼容）'),
        m('p.hint', [
          '添加任何兼容 OpenAI 的端点（DeepSeek、Together、Groq、Mistral 等）。',
          '将使用提供商的 /v1/models 端点来发现可用模型。',
        ]),
      ]),

      // OpenRouter model curation — only once a key is saved (the gateway has
      // hundreds of models, so the user checks which ones the chat picker
      // offers). Reload token bumps after a key save so a replaced key
      // re-verifies + re-lists.
      (providerRows.find((p) => p.name === 'openrouter')?.hasKey)
        ? [m('.settings-divider'), m(OpenRouterModels, { state, send, reloadToken: ui.orReloadToken ?? 0 })]
        : null,

      // Gated: until ANY provider is usable (a key saved, or a reachable Ollama),
      // this whole block stays out — no Anthropic-by-default selectors on a
      // fresh install. It appears + becomes configurable the moment you connect
      // one, bound to that provider (effectiveProvider), not a keyless guess.
      // Render nothing until provider status has loaded, so an established user
      // never flashes the empty-state during the initial fetch.
      ui.providerStatus === null ? null : anyUsable ? [
        m('.settings-divider'),
        m('h3', '新对话的默认模型'),
        m('p', '新对话使用的提供商 + 模型。如果'
          + '有多个提供商的密钥，还可以在每个对话中'
          + '通过消息框上方的选择器切换模型。已有对话保持不变。'),
        m('.input-row', [
          m('label', { for: 'provider' }, '提供商'),
          m('select', {
            id: 'provider',
            value: effectiveProvider,
            onchange: async (/** @type {{ target: HTMLSelectElement }} */ e) => {
              // Reset the model override on switch so the new provider's
              // default applies until the user picks one.
              await send({ type: 'settings/update', patch: { providerName: e.target.value, providerModel: '' } });
              m.redraw();
            },
          }, selectableProviderRows.map((p) => m('option', { value: p.name }, p.label))),
        ]),
        m('.input-row', [
          m('label', { for: 'model' }, '模型'),
          m('select', {
            id: 'model',
            value: providerModel,
            onchange: async (/** @type {{ target: HTMLSelectElement }} */ e) => {
              await send({ type: 'settings/update', patch: { providerModel: e.target.value } });
              m.redraw();
            },
          }, [
            // Blank = the provider's own default model.
            m('option', { value: '' }, `默认 — ${defaultProvRow?.defaultModel ?? '提供商默认'}`),
            ...modelOpts.map((/** @type {any} */ o) => m('option', { value: o.model }, o.label)),
            // Keep a current custom/legacy id selectable even if it isn't curated.
            (providerModel && !modelOpts.some((/** @type {any} */ o) => o.model === providerModel))
              ? m('option', { value: providerModel }, `${providerModel}（自定义）`)
              : null,
          ]),
        ]),
        m('p.hint', effectiveProvider === 'openrouter'
          ? ['从上面精选的模型中选择，或', m('strong', '默认'), ' 使用网关默认值。']
          : effectiveProvider === 'ollama'
            ? ['你在 Ollama 中拉取的模型会显示在这里，或', m('strong', '默认'), ' 使用提供商默认值。']
            : ['选择一个模型，或', m('strong', '默认'), ' 使用提供商默认值。']),
        (defaultProvRow && !defaultProvRow.hasKey)
          ? m('p.error.hint', `尚未为 ${defaultProvRow.label} 设置密钥 — 请在上方添加，否则在其上新建的对话将失败。`)
          : null,
        // "Which local model fits this machine?" — only meaningful when
        // local inference is the selected provider.
        effectiveProvider === 'ollama'
          ? [
              m('.settings-divider'),
              m(OllamaRecommendation, { send }),
            ]
          : null,
        m('.input-row', [
          m('label', { for: 'runner-model' }, 'Web 代理模型'),
          m('input', {
            id: 'runner-model',
            'aria-describedby': actorUnavailable ? 'runner-model-hint runner-model-status' : 'runner-model-hint',
            type: 'text',
            spellcheck: false,
            // Blank is an automatic policy, not a fixed provider model: an
            // installed Local WebGPU runner wins, then the provider fast model.
            placeholder: '自动',
            value: state.settings?.runnerModel ?? '',
            onchange: async (/** @type {{ target: HTMLInputElement }} */ e) => {
              await send({ type: 'settings/update', patch: { runnerModel: e.target.value } });
              m.redraw();
            },
          }),
        ]),
        m('p.hint', { id: 'runner-model-hint' }, [
          'Web 代理 — peerd 的页面阅读器和操作器 — 运行在一个快速、便宜的',
          '模型上。留空表示自动：',
          ...(localRunnerCapable
            ? ['当其模型已安装时使用本地 WebGPU；否则使用 ']
            : ['使用 ']),
          m('code', providerRunnerDefault),
          '，在 ', m('strong', defaultProvRow?.label ?? '此提供商'),
          '。输入模型 ID 可将 Web 代理固定到该模型。',
        ]),
        actorUnavailable
          ? m('p.hint', { id: 'runner-model-status' }, actorExecution.status === 'temporarily_unavailable'
              ? '代理工作已暂停。您现在可以设置此项；它将在代理执行恢复后生效。'
              : '此浏览器无法运行代理。您仍然可以为能够运行的浏览器保存此设置。')
          : null,
        resetRow(send, ['providerName', 'providerModel', 'runnerModel']),

        m('p.muted.settings-footer', [
          '默认模型：', m('code', defaultProvRow?.defaultModel ?? '提供商默认'),
          '。所有流量通过 ', m('code', 'safeFetch'),
          ' 经过硬编码的提供商白名单。',
        ]),
      ] : [
        m('.settings-divider'),
        m('h3', '新对话的默认模型'),
        m('p.muted', '在上方为提供商添加 API 密钥 — 或启动本地 '
          + 'Ollama 守护进程 — 然后就可以在此选择默认模型和 '
          + '新对话的 Web 代理模型。在连接提供商之前不做任何假设。'),
      ],
    ]);
  },
};

// ---- Ollama: GPU capability → model recommendation ------------------------
//
// Rendered when Ollama is the selected provider. The probe
// (navigator.gpu adapter limits + deviceMemory/hardwareConcurrency) only
// works in a document context — exactly where this component lives; the
// SW never runs it. The recommendation logic itself is pure
// (peerd-provider/ollama-recommend.js) and bun-tested.

const OllamaRecommendation = {
  /** @param {{ state: any }} vnode */
  oninit(vnode) {
    vnode.state.loading = true;
    vnode.state.rec = null;
    vnode.state.applied = false;
    probeGpuCapability()
      .then((cap) => { vnode.state.rec = recommendOllamaModel(cap); })
      .catch(() => { vnode.state.rec = null; })
      .finally(() => { vnode.state.loading = false; m.redraw(); });
  },
  /** @param {{ attrs: { send: Send }, state: any }} vnode */
  view: ({ attrs: { send }, state: ui }) => {
    const rec = ui.rec;
    // Smallest tier = the safe suggestion when the machine is unreadable.
    const smallest = OLLAMA_MODEL_TIERS[OLLAMA_MODEL_TIERS.length - 1];
    /** @param {string} model */
    const pullHint = (model) => m('p', { style: 'margin:6px 0;' }, [
      '获取方式：', m('code', `ollama pull ${model}`),
    ]);
    /** @param {string} model */
    const useButton = (model) => m('button.secondary', {
      type: 'button',
      style: 'font-size:12px;',
      disabled: ui.applied,
      onclick: async () => {
        await send({ type: 'settings/update', patch: { providerModel: model } });
        ui.applied = true;
        m.redraw();
      },
    }, ui.applied ? '✓ 已设为默认模型' : '设为默认模型');

    return m('.ollama-recommend', [
      m('h3', '推荐的本地模型'),
      ui.loading
        ? m('p.hint', '正在评估本机性能…')
        : !rec || rec.confidence === 'none'
          // No capability signals at all (no WebGPU, no deviceMemory) —
          // suggest the smallest tier rather than nothing.
          ? [
              m('p', [
                '此浏览器未暴露硬件信号（WebGPU 不可用），peerd 无法评估此机器。',
                m('code', smallest.model),
                `（${smallest.sizeClass} 级）是一个安全的起点。`,
              ]),
              pullHint(smallest.model),
              useButton(smallest.model),
            ]
          : rec.model
            ? [
                m('p', [
                  `基于 ${rec.signals.includes('webgpu') ? '此机器的 GPU 限制' : '粗略的浏览器信号'}，`,
                  m('strong', rec.label),
                  `（${rec.sizeClass} 级，约 ${rec.q4SizeGB} GB 下载）在此应能良好运行。`,
                ]),
                rec.confidence === 'low'
                  ? m('p.hint', '此处 WebGPU 不可用，因此这是保守估计 — 更大的机器可能可以运行更大的级别。')
                  : null,
                pullHint(rec.model),
                useButton(rec.model),
              ]
            : [
                // Signals exist but even the smallest tier doesn't fit.
                m('p', [
                  '此机器对于本地推理来说太小 — 但 ',
                  m('code', smallest.model),
                  `（${smallest.sizeClass} 级）用于轻度使用或许仍可运行。`,
                ]),
                pullHint(smallest.model),
              ],
    ]);
  },
};

// ---- OpenRouter: curate which models the chat picker offers --------------
//
// OpenRouter is a gateway to hundreds of models — far too many for a chat
// dropdown. So Settings is where the user picks the ones they want: a search
// box over the LIVE catalog plus checkboxes; the checked ids persist to
// settings.openrouterModels and become the chat picker's OpenRouter options.
// The catalog load doubles as key verification (a 401/403 → "rejected"), which
// is why saving an OpenRouter key auto-(re)loads this panel — no Test click.

// How many of the curated "popular" seed to show before the user searches.
const OPENROUTER_PREVIEW_COUNT = 20;

/** @typedef {{ model: string, label: string }} OpenRouterModel */

const OpenRouterModels = {
  /** @param {{ state: any, attrs: { reloadToken?: number, send: Send, state?: any } }} vnode */
  oninit(vnode) {
    vnode.state.loading = true;
    vnode.state.error = null;
    vnode.state.models = null;        // full live catalog [{ model, label, ... }]
    vnode.state.popular = [];         // curated seed ids
    vnode.state.query = '';
    vnode.state.selected = null;      // working Set of chosen ids (seeded once)
    vnode.state.loadedToken = vnode.attrs.reloadToken ?? 0;
    OpenRouterModels.load(vnode);
  },
  /** @param {{ state: any, attrs: { reloadToken?: number, send: Send, state?: any } }} vnode */
  onupdate(vnode) {
    // A key save bumps reloadToken — re-verify + re-list against the new key.
    if ((vnode.attrs.reloadToken ?? 0) !== vnode.state.loadedToken) {
      vnode.state.loadedToken = vnode.attrs.reloadToken ?? 0;
      OpenRouterModels.load(vnode);
    }
  },
  /** @param {{ state: any, attrs: { send: Send, state?: any } }} vnode */
  load(vnode) {
    vnode.state.loading = true;
    vnode.state.error = null;
    m.redraw();
    vnode.attrs.send({ type: 'openrouter/models' }).then((/** @type {any} */ r) => {
      vnode.state.loading = false;
      if (r?.ok) {
        vnode.state.models = r.models ?? [];
        vnode.state.popular = r.popular ?? [];
        // Seed the working selection from saved settings the FIRST time we
        // have data; later toggles own it (and persist on each change).
        if (vnode.state.selected === null) {
          const saved = vnode.attrs.state?.settings?.openrouterModels ?? [];
          vnode.state.selected = new Set(saved);
        }
      } else {
        vnode.state.error = r?.error === 'invalid-key'
          ? 'OpenRouter 拒绝了密钥 — 请在上方仔细检查。'
          : `无法访问 OpenRouter：${r?.error ?? '未知错误'}。`;
      }
      m.redraw();
    }).catch(() => {
      vnode.state.loading = false;
      vnode.state.error = '无法访问 OpenRouter。';
      m.redraw();
    });
  },
  /**
   * @param {{ state: any, attrs: { send: Send } }} vnode
   * @param {string} id
   */
  toggle(vnode, id) {
    const sel = vnode.state.selected;
    if (sel.has(id)) sel.delete(id);
    else sel.add(id);
    // Persist immediately — the chat picker reads settings.openrouterModels.
    vnode.attrs.send({ type: 'settings/update', patch: { openrouterModels: [...sel] } });
    m.redraw();
  },
  /** @param {{ state: any, attrs: { send: Send } }} vnode */
  view(vnode) {
    const ui = vnode.state;
    if (ui.loading && !ui.models) {
      return m('.or-models', m('p.hint', '正在验证密钥并加载模型…'));
    }
    if (ui.error) return m('.or-models', m('p.error.hint', ui.error));
    /** @type {OpenRouterModel[]} */
    const all = ui.models ?? [];
    if (all.length === 0) return null;
    /** @type {Set<string>} */
    const sel = ui.selected ?? new Set();
    const q = ui.query.trim().toLowerCase();

    // Default view (no search): the curated popular seed intersected with the
    // live catalog, plus any already-selected models outside the seed so a
    // custom pick stays visible. Searching filters the FULL catalog.
    /** @type {OpenRouterModel[]} */
    let shown;
    if (q) {
      shown = all
        .filter((mdl) => mdl.model.toLowerCase().includes(q) || mdl.label.toLowerCase().includes(q))
        .slice(0, 100);
    } else {
      const liveById = new Map(all.map((mdl) => [mdl.model, mdl]));
      /** @type {Set<string>} */
      const popularSet = new Set(ui.popular);
      const seed = ui.popular.filter((/** @type {string} */ id) => liveById.has(id)).map((/** @type {string} */ id) => liveById.get(id))
        .slice(0, OPENROUTER_PREVIEW_COUNT);
      const extra = all.filter((mdl) => sel.has(mdl.model) && !popularSet.has(mdl.model));
      shown = [...seed, ...extra];
    }

    return m('.or-models', [
      m('h3', '可用的 OpenRouter 模型'),
      m('p.hint', [
        '选择聊天选择器提供的模型。',
        m('strong', `已选择 ${sel.size} 个`),
        ` · OpenRouter 上共 ${all.length} 个可用。`,
      ]),
      m('input.or-search', {
        type: 'search',
        spellcheck: false,
        placeholder: `搜索 ${all.length} 个模型…`,
        value: ui.query,
        oninput: (/** @type {{ target: HTMLInputElement }} */ e) => { ui.query = e.target.value; m.redraw(); },
      }),
      m('.or-model-list', shown.map((mdl) =>
        m('label.or-model-row', { key: mdl.model }, [
          m('input', {
            type: 'checkbox',
            checked: sel.has(mdl.model),
            onchange: () => OpenRouterModels.toggle(vnode, mdl.model),
          }),
          m('span.or-model-name', mdl.label),
          m('code.or-model-id', mdl.model),
        ]))),
      (!q && all.length > shown.length)
        ? m('p.hint', `显示 ${shown.length} 个热门 — 搜索可从全部 ${all.length} 个中选择。`)
        : null,
    ]);
  },
};
