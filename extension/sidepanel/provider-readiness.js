// @ts-check
// Compatibility + copy for the composer readiness projection. Older fixtures
// still provide only providers.hasKey; live snapshots include the provider-aware
// composer object.

/** @param {any} state */
export const composerForState = (state) => state?.composer ?? {
  provider: state?.session?.provider ?? state?.providers?.current ?? 'anthropic',
  model: state?.providers?.model ?? '',
  keyless: false,
  credentialReady: !!state?.providers?.hasKey,
  localReady: true,
  canSend: !!state?.providers?.hasKey,
  reason: state?.providers?.hasKey ? null : 'missing-key',
};

/** @param {string} name */
const providerLabel = (name) => (/** @type {Record<string, string>} */ ({
  anthropic: 'Anthropic',
  openrouter: 'OpenRouter',
  openai: 'OpenAI',
  glm: 'Z.ai',
  ollama: 'Ollama',
  'local-webgpu': 'Local WebGPU',
}))[name] ?? '所选提供商';

/** @param {any} composer @param {{ compact?: boolean }} [opts] */
export const composerUnavailableCopy = (composer, { compact = false } = {}) => {
  if (composer?.reason === 'settings-unavailable') {
    return compact
      ? '提供商设置暂时不可用。'
      : '无法加载提供商设置。请重新打开 peerd 重试。';
  }
  if (composer?.reason === 'vault-locked') {
    return compact
      ? '密码库已锁定。解锁后即可发送。'
      : '密码库已锁定。解锁后即可开始对话。';
  }
  if (composer?.reason === 'local-model-not-installed') {
    return compact
      ? '在设置中安装 Local WebGPU 模型后即可发送。'
      : '在设置中安装 Local WebGPU 模型后即可开始对话。';
  }
  if (composer?.reason === 'ollama-no-models') {
    return compact
      ? '拉取一个 Ollama 模型，然后在设置中测试连接。'
      : 'Ollama 已连接但没有任何模型。请拉取一个模型，然后在设置中重新测试。';
  }
  if (composer?.reason === 'ollama-model-missing') {
    return compact
      ? '所选的 Ollama 模型未安装。请选择一个已拉取的模型，或在 Ollama 中拉取它。'
      : '所选的 Ollama 模型未安装。请在上方选择一个已拉取的模型，或在 Ollama 中拉取后重新测试。';
  }
  if (composer?.reason === 'unknown-provider') {
    return compact
      ? '在设置中选择一个提供商后即可发送。'
      : '在设置中选择一个提供商后即可开始对话。';
  }
  const label = providerLabel(composer?.provider);
  return compact
    ? `在设置中为 ${label} 添加 API 密钥后即可发送。`
    : `在设置中为 ${label} 添加 API 密钥后即可开始对话。`;
};

/** @param {any} composer */
export const composerWarningCopy = (composer) => composer?.warning === 'ollama-unreachable'
  ? '无法连接到 Ollama。启动 Ollama 后仍可尝试发送，或在设置中测试连接。'
  : null;
