// @ts-check
// Options → Security → API integrations.
//
// DESIGN-18 P1. An API key bound to ONE origin, stored in the SAME encrypted vault as
// your provider keys + git tokens (same class of secret). It is sent to the SW as
// plaintext via runtime.sendMessage; the SW encrypts it with the vault DK before
// persisting under origin:<origin>. It is decrypted only at the egress boundary
// (withApiCredentials), injected ONLY on a same-origin HTTPS request the API actor
// makes, and NEVER shown to the agent. This UI only ever sees the ORIGINS + the header
// NAME (origin-cred/list returns no values).
//
// One exception to "no values", and it is the point of the DPoP option: for a
// proof-of-possession credential the list also returns the `jkt` — the PUBLIC
// thumbprint of the origin's non-extractable keypair (INV-15). It is a hash of a
// public key, not a secret, and the user MUST be able to read it: it is what they
// paste into the authorization server's client registration so the token it issues
// is bound to this device's key. Without a way to save `scheme:'dpop'` and a way to
// read the thumbprint back, the whole proof-of-possession path was unreachable.

import m from '/vendor/mithril/mithril.js';
import { GitCredentialsSection } from './git-credentials.js';

/** The three auth styles a credential can be saved as, in the order shown. */
const SCHEMES = [
  { value: 'bearer', label: 'Bearer 令牌' },
  { value: 'raw', label: '自定义请求头' },
  { value: 'dpop', label: 'DPoP（持有证明）' },
];

export const ApiIntegrationsSection = {
  oninit(/** @type {any} */ vnode) {
    vnode.state.integrations = null;   // Array<{origin, header, scheme?, jkt?}> | null (loading)
    vnode.state.originInput = '';
    vnode.state.keyInput = '';
    vnode.state.headerInput = '';      // only used by the 'raw' scheme
    vnode.state.schemeInput = 'bearer';
    vnode.state.busy = false;
    vnode.state.msg = null;
    ApiIntegrationsSection.load(vnode);
  },

  load(/** @type {any} */ vnode) {
    vnode.attrs.send({ type: 'origin-cred/list' }).then((/** @type {any} */ r) => {
      vnode.state.integrations = r?.ok && Array.isArray(r.integrations) ? r.integrations : [];
      if (r && !r.ok && r.error === 'locked') vnode.state.msg = { ok: false, text: '保险库已锁定 — 先在 peerd 面板中解锁。' };
      m.redraw();
    }).catch(() => { vnode.state.integrations = []; m.redraw(); });
  },

  view: (/** @type {{ attrs: { send: any }, state: any }} */ { attrs: { send }, state: ui }) => {
    const errText = (/** @type {string} */ error) => error === 'locked'
      ? '保险库已锁定 — 先在 peerd 面板中解锁。'
      : error === 'bad-origin' ? '请输入真实的 https 主机，如 api.stripe.com（仅限 https；不支持 localhost 或 IP）。'
      : error === 'bad-key' ? '请粘贴完整的密钥（不含空格）。'
      : error ?? '出了点问题。';

    const save = async () => {
      if (ui.busy) return;
      const origin = ui.originInput.trim();
      const key = ui.keyInput.trim();
      const header = ui.headerInput.trim();
      const scheme = ui.schemeInput;
      ui.msg = null;
      if (!origin) { ui.msg = { ok: false, text: '请输入 API 主机（例如 api.stripe.com）。' }; m.redraw(); return; }
      if (key.length < 8) { ui.msg = { ok: false, text: '请粘贴完整的密钥。' }; m.redraw(); return; }
      if (scheme === 'raw' && !header) { ui.msg = { ok: false, text: '请输入用于发送密钥的请求头名称（例如 X-API-Key）。' }; m.redraw(); return; }
      ui.busy = true; m.redraw();
      // Bearer is the default and sends no `scheme` at all — the same message this
      // form has always sent, so the common case is byte-for-byte unchanged.
      const arg = scheme === 'raw' ? { type: 'origin-cred/set', origin, key, header, scheme: 'raw' }
        : scheme === 'dpop' ? { type: 'origin-cred/set', origin, key, scheme: 'dpop' }
        : { type: 'origin-cred/set', origin, key };
      const r = await send(arg);
      ui.busy = false;
      if (r?.ok) {
        ui.originInput = ''; ui.keyInput = ''; ui.headerInput = ''; ui.schemeInput = 'bearer';
        ui.msg = { ok: true, text: scheme === 'dpop'
          ? `已为 ${r.origin} 保存 — 已在保险库中加密。请在下方用 ${r.origin} 注册密钥指纹。`
          : `已为 ${r.origin} 保存 — 已在保险库中加密。` };
        const lr = await send({ type: 'origin-cred/list' });
        if (lr?.ok) ui.integrations = Array.isArray(lr.integrations) ? lr.integrations : [];
      } else {
        ui.msg = { ok: false, text: errText(r?.error) };
      }
      m.redraw();
    };

    const remove = async (/** @type {string} */ origin) => {
      if (ui.busy) return;
      ui.busy = true; ui.msg = null; m.redraw();
      const r = await send({ type: 'origin-cred/delete', origin });
      ui.busy = false;
      if (r?.ok) {
        ui.integrations = (ui.integrations ?? []).filter((/** @type {any} */ x) => x.origin !== origin);
        ui.msg = { ok: true, text: `已移除 ${origin}。` };
      } else {
        ui.msg = { ok: false, text: errText(r?.error) };
      }
      m.redraw();
    };

    return m('div', [
      m('p', [
        '代理的 ', m('strong', 'API 集成'), ' 的 API 密钥 — 一个源锁定、'
        + '无密钥的 web actor（可通过 ', m('code', 'message_actor("api.host.com", …)'),
        ' 寻址）。每个密钥与您的 API 密钥在同一保险库中加密，仅在该集成发出的'
        + '同源 HTTPS 请求上注入，且 ',
        m('strong', '永远不会显示给代理'),
        '。重定向被拒绝，跨源请求不携带任何内容，因此它无法泄露到其他地方。',
      ]),

      ui.integrations === null
        ? m('p.hint', '加载中…')
        : ui.integrations.length === 0
          ? m('p.hint', '暂无 API 集成。')
          : m('.provider-cards', ui.integrations.map((/** @type {any} */ it) => m('.provider-card', [
              m('.provider-card-main', [
                m('.provider-card-text', [
                  m('span.provider-card-name', it.origin),
                  m('span.key-badge.key-set',
                    { title: it.scheme === 'dpop'
                      ? '持有证明：绑定到 peerd 无法导出的仅限本设备的密钥'
                      : `以 ${it.header || 'Authorization'} 发送` },
                    it.scheme === 'dpop' ? '✓ DPoP · 设备绑定' : `✓ ${it.header || 'Authorization'}`),
                ]),
                m('span', { style: 'margin-left:auto;' },
                  m('button.linkish', { type: 'button', disabled: ui.busy, onclick: () => remove(it.origin) }, '移除')),
              ]),
              // The public thumbprint of this origin's key. Shown ONLY for DPoP, and
              // shown in full because pasting it into the server's client registration
              // is the step that makes the token binding real. Removing the
              // integration retires the key, so this fingerprint doesn't outlive it.
              // The device-bound line is not decoration: a non-extractable key can't
              // be synced or ride a vault export (buildExport never gathers the key
              // store, and the material can't be serialized anyway), so moving to
              // another device means re-registering there — say so before the user is
              // surprised by a 401 on a machine they restored a vault onto.
              it.scheme === 'dpop'
                ? m('p.hint', { style: 'margin:4px 0 0;' }, it.jkt
                  ? ['密钥指纹（', m('code', 'jkt'), '）：', m('code', it.jkt),
                    ' — 请将其注册到 ', it.origin, '。', m('strong', '设备绑定'),
                    '：密钥保留在此设备上 — 它不会同步，也不属于保险库导出的一部分，因此在另一台设备上你需要重新注册一个。']
                  : ['密钥指纹不可用 — 它会在下次请求以下地址时创建：', it.origin, '。'])
                : null,
            ]))),

      m('.settings-divider'),
      m('h3', '添加 API 密钥'),
      m('p.hint', [
        'API 主机 + 您的密钥。', m('strong', 'Bearer 令牌'), ' 是常见的 ',
        m('code', 'Authorization: Bearer <key>'), '。', m('strong', '自定义请求头'),
        ' 会在你指定的请求头中原样发送密钥（例如 ', m('code', 'X-API-Key'), '）。',
        m('strong', 'DPoP'), ' 存储一个 OAuth 令牌，只有搭配由 peerd 在此设备上生成、且 ',
        m('em', '无法读取或导出'),
        ' 的密钥所签署的证明才能使用 — peerd 会向你显示该密钥的公开指纹以便在服务器上注册。'
        + '需要支持 RFC 9449 的服务器。',
      ]),
      m('form.provider-card-form', { onsubmit: (/** @type {any} */ e) => { e.preventDefault(); save(); } }, [
        m('.input-row', [
          m('input', {
            type: 'text', spellcheck: false, autocapitalize: 'none', autocomplete: 'off',
            placeholder: 'api.stripe.com', value: ui.originInput, disabled: ui.busy,
            oninput: (/** @type {any} */ e) => { ui.originInput = e.target.value; },
            style: 'flex:0 0 11rem;',
          }),
          m('input', {
            type: 'password', spellcheck: false, autocomplete: 'off',
            placeholder: '粘贴密钥…', value: ui.keyInput, disabled: ui.busy,
            oninput: (/** @type {any} */ e) => { ui.keyInput = e.target.value; },
          }),
        ]),
        // why margin-top here (not the shared .provider-card-form .input-row, which is
        // margin:0 and is reused by the single-row git section): this form has TWO stacked
        // rows, so the second needs its own vertical gap from the first.
        m('.input-row', { style: 'margin-top:8px;' }, [
          // The auth style, explicit. It used to be INFERRED from whether the header
          // field was blank, which left the strongest option (DPoP) with no way to
          // reach it at all. Same 11rem lead column as the origin field above.
          m('select', {
            value: ui.schemeInput, disabled: ui.busy, style: 'flex:0 0 11rem;',
            onchange: (/** @type {any} */ e) => { ui.schemeInput = e.target.value; },
          }, SCHEMES.map((s) => m('option', { value: s.value }, s.label))),
          m('input', {
            type: 'text', spellcheck: false, autocapitalize: 'none', autocomplete: 'off',
            placeholder: ui.schemeInput === 'raw' ? '请求头名称（例如 X-API-Key）' : '请求头名称（仅限自定义请求头）',
            value: ui.headerInput, disabled: ui.busy || ui.schemeInput !== 'raw',
            oninput: (/** @type {any} */ e) => { ui.headerInput = e.target.value; },
            style: 'flex:1;',
          }),
          m('button', { type: 'submit', disabled: ui.busy || !ui.originInput.trim() || !ui.keyInput.trim() },
            ui.busy ? '…' : '保存'),
        ]),
      ]),
      ui.msg ? m(`p.key-msg${ui.msg.ok ? '.ok' : '.err'}`, ui.msg.text) : null,

      m('p.muted.settings-footer', [
        '存储为 ', m('code', 'origin:<origin>'), ' 在保险库中（仅限 https）。代理'
        + '永远不会持有密钥 — 它仅在出口边界附加，仅限同源。',
      ]),

      // Git credentials fold in here — a git PAT is the same class of secret (a
      // host-bound bearer token, stored git:<host> in the same vault), just for private
      // Git operations across every engine repository. Rendered as a subsection rather than its own nav
      // entry (owner's call). GitCredentialsSection owns its own load/save/list lifecycle.
      m('.settings-divider'),
      m('h3', 'Git 凭据'),
      m(GitCredentialsSection, { send }),

      // DESIGN-19 site clients fold in here too — per-origin derived API clients the
      // web actor builds from observed traffic. Not secrets (they hold no
      // credentials), but same conceptual family (per-origin agent web state), so
      // they live on this page. SiteClientsSection owns its own list/delete lifecycle.
      m('.settings-divider'),
      m('h3', '站点客户端'),
      m(SiteClientsSection, { send }),
    ]);
  },
};

// DESIGN-19 — stored site clients (per-origin derived API clients). Read-only +
// delete: the agent derives + patches them (confirm-gated) via the web actor;
// here the user sees what's stored and can remove any. Shows staleness so a stale
// client is legible. No bodies are ever fetched — list returns metas only.
const fmtAge = (/** @type {number} */ ts) => {
  if (!ts) return '从未';
  const days = Math.floor((Date.now() - ts) / 86_400_000);
  return days <= 0 ? '今天' : days === 1 ? '1 天前' : `${days} 天前`;
};

export const SiteClientsSection = {
  oninit(/** @type {any} */ vnode) {
    vnode.state.clients = null;   // Array | null (loading)
    vnode.state.busy = false;
    vnode.state.msg = null;
    SiteClientsSection.load(vnode);
  },

  load(/** @type {any} */ vnode) {
    vnode.attrs.send({ type: 'site-client/list' }).then((/** @type {any} */ r) => {
      vnode.state.clients = r?.ok && Array.isArray(r.clients) ? r.clients : [];
      m.redraw();
    }).catch(() => { vnode.state.clients = []; m.redraw(); });
  },

  view: (/** @type {{ attrs: { send: any }, state: any }} */ { attrs: { send }, state: ui }) => {
    const remove = async (/** @type {string} */ origin) => {
      if (ui.busy) return;
      ui.busy = true; ui.msg = null; m.redraw();
      const r = await send({ type: 'site-client/delete', origin });
      ui.busy = false;
      if (r?.ok) {
        ui.clients = (ui.clients ?? []).filter((/** @type {any} */ x) => x.origin !== origin);
        ui.msg = { ok: true, text: `已移除 ${origin} 的站点客户端。` };
      } else {
        ui.msg = { ok: false, text: r?.error ?? '无法移除。' };
      }
      m.redraw();
    };

    return m('div', [
      m('p.hint', [
        '代理通过观察你浏览的站点 ', m('strong', '推导'), ' 出的可复用 API 客户端'
        + ' — 这样它就能直接调用 API，而不必重新驱动页面。它们不持有'
        + '任何凭据（你的会话随浏览器走），固定在其源上运行，且 ',
        m('strong', '只是缓存，而非契约'), '（代理会在使用时验证它们）。可在此处移除任意一项。',
      ]),
      ui.clients === null
        ? m('p.hint', '加载中…')
        : ui.clients.length === 0
          ? m('p.hint', '尚无站点客户端 — 代理会在工作时创建它们。')
          : m('.provider-cards', ui.clients.map((/** @type {any} */ c) => m('.provider-card', [
              m('.provider-card-main', [
                m('.provider-card-text', [
                  m('span.provider-card-name', c.origin),
                  m('span.key-badge.key-set', `${c.endpoints} 个端点`),
                  c.recentFailures > 0 ? m('span.key-badge.key-unset', `${c.recentFailures} 次近期失败`) : null,
                ]),
                m('span', { style: 'margin-left:auto;' },
                  m('button.linkish', { type: 'button', disabled: ui.busy, onclick: () => remove(c.origin) }, '移除')),
              ]),
              m('p.hint', { style: 'margin:4px 0 0;' },
                `${c.summary ? `${c.summary} · ` : ''}认证：${c.auth} · 推导于 ${fmtAge(c.derivedAt)} · `
                + `${c.lastVerifiedAt ? `已验证 ${fmtAge(c.lastVerifiedAt)}` : '未验证'} · 经由 ${c.deriver}`),
            ]))),
      ui.msg ? m(`p.key-msg${ui.msg.ok ? '.ok' : '.err'}`, ui.msg.text) : null,
    ]);
  },
};
