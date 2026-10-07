// @ts-check
// Options → Costs — every dollars-and-tokens control in ONE place.
//
// A merge of three surfaces that were scattered across the panel:
// the cumulative usage line (the old Context header), the session
// spend limit (old Agent behavior), and the pricing-override table
// (old Advanced). Live per-turn metering stays in the panel's CostChip
// — this page is the global, between-chats view.

import m from '/vendor/mithril/mithril.js';
import { DEFAULT_PRICING } from '/peerd-provider/index.js';
import { resetRow } from './reset-row.js';

/** @typedef {import('./reset-row.js').Send} Send */

/** @param {number} n */
const fmtUsd = (n) => {
  const v = Number(n) || 0;
  if (v === 0) return '$0.00';
  if (v < 0.01) return `$${v.toFixed(4)}`;
  if (v < 1) return `$${v.toFixed(3)}`;
  return `$${v.toFixed(2)}`;
};

/** @param {number} n */
const fmtTok = (n) => {
  const v = Number(n) || 0;
  if (v < 1000) return String(v);
  if (v < 1_000_000) return `${(v / 1000).toFixed(v < 10_000 ? 1 : 0)}k`;
  return `${(v / 1_000_000).toFixed(1)}M`;
};

export const CostsSection = {
  /** @param {{ state: any, attrs: { send: Send } }} vnode */
  oninit(vnode) {
    vnode.state.usage = null;
    vnode.attrs.send({ type: 'cost/total' }).then((/** @type {any} */ r) => {
      if (r?.ok) vnode.state.usage = { usd: r.usd, tokens: r.tokens, chats: r.chats };
      m.redraw();
    }).catch(() => {});
  },

  /** @param {{ attrs: { state: any, send: Send }, state: any }} vnode */
  view: ({ attrs: { state, send }, state: ui }) => {
    // Cost telemetry (feature 06). spendLimitUsd 0 = no hard limit.
    const spendLimitUsd = Number(state.settings?.spendLimitUsd) || 0;

    return m('div', [
      m('h3', '总用量'),
      m('p', '所有对话的累计 BYOK 用量，在本地计算 '
        + '自内置定价表 — 用量永不离开您的浏览器。'),
      ui.usage
        ? m('.logs-usage', [
            m('span.logs-usage-label', '总用量'),
            m('span.logs-usage-value',
              `${fmtUsd(ui.usage.usd)} · ${fmtTok(ui.usage.tokens)} tok${ui.usage.chats ? ` · ${ui.usage.chats} chat${ui.usage.chats === 1 ? '' : 's'}` : ''}`),
          ])
        : m('p.muted', '加载中…'),

      m('.settings-divider'),
      m('h3', '消费限额'),
      m('p', '可选的每会话消费硬上限。当对话的 '
        + '累计费用超过此金额时，peerd 会在回合中途停止代理。 '
        + '设为 0（或空白）则无限制。'),
      m('div', { style: 'display:flex; gap:8px; align-items:center;' }, [
        m('span', { style: 'opacity:0.7;' }, '$'),
        m('input', {
          type: 'number', min: '0', step: '0.50', inputmode: 'decimal',
          style: 'width:120px;',
          'aria-label': '以美元计的会话消费限额',
          value: spendLimitUsd > 0 ? String(spendLimitUsd) : '',
          placeholder: '无限制',
          onchange: async (/** @type {{ target: HTMLInputElement }} */ e) => {
            const v = Number(e.target.value);
            await send({ type: 'settings/update', patch: { spendLimitUsd: Number.isFinite(v) && v > 0 ? v : 0 } });
            m.redraw();
          },
        }),
        spendLimitUsd > 0
          ? m('span.muted', { style: 'font-size:12px;' }, `每会话 $${spendLimitUsd} 时停止`)
          : m('span.muted', { style: 'font-size:12px;' }, '未设限额'),
      ]),

      m('.settings-divider'),
      m(PricingOverrides, { state, send }),

      resetRow(send, ['spendLimitUsd', 'pricingOverrides']),
    ]);
  },
};

// ---- pricing overrides (cost telemetry, feature 06) ----------------------
//
// The built-in pricing table (peerd-provider/pricing.js) is a snapshot and
// drifts as vendors change prices. This editor lets the user paste a
// corrected rate card per model id WITHOUT waiting on an extension update.
// Overrides merge over the defaults; clearing a field reverts that model
// to the built-in rate. All LOCAL — these rates only feed the client-side
// dollar math; nothing is uploaded.
//
// Kept collapsed by default (most users never touch it). Rates are USD per
// 1,000,000 tokens to match how Anthropic + OpenRouter publish them.
/** @typedef {import('/peerd-provider/pricing.js').ModelRates} ModelRates */

/** @type {[keyof ModelRates, string][]} */
const RATE_FIELDS = [
  ['input', '输入'],
  ['output', '输出'],
  ['cacheRead', '缓存读取'],
  ['cacheWrite', '缓存写入'],
];

const PricingOverrides = {
  /** @param {{ state: any }} vnode */
  oninit(vnode) { vnode.state.open = false; },
  /** @param {{ attrs: { state: any, send: Send }, state: any }} vnode */
  view: ({ attrs: { state, send }, state: ui }) => {
    /** @type {Record<string, Partial<ModelRates>>} */
    const overrides = state.settings?.pricingOverrides ?? {};
    const overrideCount = Object.keys(overrides).length;
    // Show built-in models plus any override-only model ids the user added.
    const modelIds = [...new Set([
      ...Object.keys(DEFAULT_PRICING),
      ...Object.keys(overrides),
    ])];

    /**
     * @param {string} model
     * @param {keyof ModelRates} field
     * @param {string} raw
     */
    const setRate = async (model, field, raw) => {
      const next = { ...overrides };
      const card = { ...(next[model] ?? {}) };
      const v = Number(raw);
      if (raw === '' || !Number.isFinite(v) || v < 0) {
        // Empty/invalid → drop the override for this field (revert to default).
        delete card[field];
      } else {
        card[field] = v;
      }
      if (Object.keys(card).length > 0) next[model] = card;
      else delete next[model];
      await send({ type: 'settings/update', patch: { pricingOverrides: next } });
      m.redraw();
    };

    return m('div', [
      m('h3', { style: 'display:flex; align-items:center; gap:8px;' }, [
        '模型定价',
        overrideCount > 0
          ? m('span.muted', { style: 'font-size:12px; font-weight:400;' }, `(${overrideCount} 个已覆盖)`)
          : null,
      ]),
      m('p', '成本计量器使用的费率，以每 1M 令牌的 USD 计算。覆盖 '
        + '任何值以修正过时定价；留空使用内置 '
        + '默认值。仅本地。'),
      m('button.secondary', {
        type: 'button',
        'aria-expanded': String(ui.open),
        onclick: () => { ui.open = !ui.open; m.redraw(); },
      }, ui.open ? '隐藏定价表' : '编辑定价表'),
      ui.open
        ? m('.pricing-table', { style: 'margin-top:10px; display:flex; flex-direction:column; gap:10px;' },
            modelIds.map((model) => {
              const def = DEFAULT_PRICING[model] ?? {};
              const ovr = overrides[model] ?? {};
              return m('.pricing-row', { key: model, style: 'border:1px solid var(--border, #333); border-radius:6px; padding:8px;' }, [
                m('div', { style: 'font-family:monospace; font-size:12px; margin-bottom:6px;' }, model),
                m('div', { style: 'display:grid; grid-template-columns:repeat(2,1fr); gap:6px;' },
                  RATE_FIELDS.map(([field, label]) =>
                    m('label', { style: 'display:flex; flex-direction:column; font-size:11px; gap:2px;' }, [
                      m('span.muted', label),
                      m('input', {
                        type: 'number', min: '0', step: '0.01', inputmode: 'decimal',
                        style: 'width:100%;',
                        'aria-label': `${model} ${label} 费率，每百万令牌 USD`,
                        value: ovr[field] !== undefined ? String(ovr[field]) : '',
                        placeholder: def[field] !== undefined ? String(def[field]) : '0',
                        onchange: (/** @type {{ target: HTMLInputElement }} */ e) => setRate(model, field, e.target.value),
                      }),
                    ])
                  )),
              ]);
            }))
        : null,
    ]);
  },
};
