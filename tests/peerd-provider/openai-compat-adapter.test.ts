import { describe, test, expect } from 'bun:test';
import { makeOpenAiCompatAdapter } from '../../extension/peerd-provider/adapters/openai-compat.js';

describe('makeOpenAiCompatAdapter endpoint concatenation', () => {
  test('concatenates endpoints correctly for root baseUrl', () => {
    const adapter = makeOpenAiCompatAdapter({
      name: 'deepseek',
      label: 'DeepSeek',
      baseUrl: 'https://api.deepseek.com',
      vaultSecretName: 'custom_deepseek_api_key',
    });

    expect(adapter.endpoint).toBe('https://api.deepseek.com/v1/chat/completions');
    expect(adapter.baseUrl).toBe('https://api.deepseek.com');
  });

  test('concatenates endpoints correctly for baseUrl with trailing slash', () => {
    const adapter = makeOpenAiCompatAdapter({
      name: 'deepseek',
      label: 'DeepSeek',
      baseUrl: 'https://api.deepseek.com/',
      vaultSecretName: 'custom_deepseek_api_key',
    });

    expect(adapter.endpoint).toBe('https://api.deepseek.com/v1/chat/completions');
    expect(adapter.baseUrl).toBe('https://api.deepseek.com');
  });

  test('concatenates endpoints correctly for baseUrl with /v1 path', () => {
    const adapter = makeOpenAiCompatAdapter({
      name: 'openai-proxy',
      label: 'OpenAI Proxy',
      baseUrl: 'https://api.openai-proxy.com/v1',
      vaultSecretName: 'custom_openai-proxy_api_key',
    });

    expect(adapter.endpoint).toBe('https://api.openai-proxy.com/v1/chat/completions');
    expect(adapter.baseUrl).toBe('https://api.openai-proxy.com/v1');
  });

  test('concatenates endpoints correctly for baseUrl with /v2 path (like Spark)', () => {
    const adapter = makeOpenAiCompatAdapter({
      name: 'spark',
      label: 'Spark',
      baseUrl: 'https://maas-api.cn-huabei-1.xf-yun.com/v2',
      vaultSecretName: 'custom_spark_api_key',
    });

    expect(adapter.endpoint).toBe('https://maas-api.cn-huabei-1.xf-yun.com/v2/chat/completions');
    expect(adapter.baseUrl).toBe('https://maas-api.cn-huabei-1.xf-yun.com/v2');
  });

  test('concatenates endpoints correctly for baseUrl with custom gateway path', () => {
    const adapter = makeOpenAiCompatAdapter({
      name: 'my-gateway',
      label: 'My Gateway',
      baseUrl: 'https://my-gateway.internal/api/v1',
      vaultSecretName: 'custom_my-gateway_api_key',
    });

    expect(adapter.endpoint).toBe('https://my-gateway.internal/api/v1/chat/completions');
    expect(adapter.baseUrl).toBe('https://my-gateway.internal/api/v1');
  });
});
