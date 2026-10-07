// @ts-check
// Options → Security → Git credentials.
//
// Per-host bearer tokens for private Git across WebVMs, Apps, and lightweight
// Notebook repositories, stored in the SAME encrypted vault as your provider API keys (a git PAT is the same
// class of secret). The token is sent to the SW as plaintext via
// runtime.sendMessage; the SW encrypts it with the vault DK before persisting.
// It is decrypted only at request time, bound to its host, and NEVER shown to
// the agent or the VM. This UI only ever sees the HOST NAMES (git-cred/list
// returns no values).

import m from '/vendor/mithril/mithril.js';

export const GitCredentialsSection = {
  oninit(/** @type {any} */ vnode) {
    vnode.state.hosts = null;     // string[] | null (loading)
    vnode.state.hostInput = '';
    vnode.state.tokenInput = '';
    vnode.state.busy = false;
    vnode.state.msg = null;       // { ok, text }
    GitCredentialsSection.load(vnode);
  },

  load(/** @type {any} */ vnode) {
    vnode.attrs.send({ type: 'git-cred/list' }).then((/** @type {any} */ r) => {
      vnode.state.hosts = r?.ok && Array.isArray(r.hosts) ? r.hosts : [];
      if (r && !r.ok && r.error === 'locked') vnode.state.msg = { ok: false, text: '保险库已锁定 — 先在 peerd 面板中解锁。' };
      m.redraw();
    }).catch(() => { vnode.state.hosts = []; m.redraw(); });
  },

  view: (/** @type {{ attrs: { send: any }, state: any }} */ { attrs: { send }, state: ui }) => {
    const errText = (/** @type {string} */ error) => error === 'locked'
      ? '保险库已锁定 — 先在 peerd 面板中解锁。'
      : error === 'bad-host' ? '请输入真实的主机，如 github.com（不支持 localhost 或 IP）。'
      : error === 'bad-token' ? '请粘贴完整的令牌（不含空格）。'
      : error ?? '出了点问题。';

    const save = async () => {
      if (ui.busy) return;
      const host = ui.hostInput.trim();
      const token = ui.tokenInput.trim();
      ui.msg = null;
      if (!host) { ui.msg = { ok: false, text: '请输入主机（例如 github.com）。' }; m.redraw(); return; }
      if (token.length < 8) { ui.msg = { ok: false, text: '请粘贴完整的令牌。' }; m.redraw(); return; }
      ui.busy = true; m.redraw();
      try {
        const r = await send({ type: 'git-cred/set', host, token });
        if (r?.ok) {
          ui.hostInput = ''; ui.tokenInput = '';
          ui.msg = { ok: true, text: `已为 ${r.host} 保存：已在保险库中加密。` };
          const lr = await send({ type: 'git-cred/list' });
          if (lr?.ok) ui.hosts = Array.isArray(lr.hosts) ? lr.hosts : [];
        } else {
          ui.msg = { ok: false, text: errText(r?.error) };
        }
      } catch (error) {
        ui.msg = { ok: false, text: /** @type {{message?:string}} */ (error)?.message ?? '无法保存令牌。' };
      } finally {
        ui.busy = false;
        m.redraw();
      }
    };

    const remove = async (/** @type {string} */ host) => {
      if (ui.busy) return;
      ui.busy = true; ui.msg = null; m.redraw();
      try {
        const r = await send({ type: 'git-cred/delete', host });
        if (r?.ok) {
          ui.hosts = (ui.hosts ?? []).filter((/** @type {string} */ h) => h !== host);
          ui.msg = { ok: true, text: `已移除 ${host}。` };
        } else {
          ui.msg = { ok: false, text: errText(r?.error) };
        }
      } catch (error) {
        ui.msg = { ok: false, text: /** @type {{message?:string}} */ (error)?.message ?? '无法移除令牌。' };
      } finally {
        ui.busy = false;
        m.redraw();
      }
    };

    return m('div', [
      m('p', [
        '用于 WebVM、应用、笔记本和 Pod 中私有 GitHub/GitLab 仓库的令牌。每个令牌'
        + '与您的 API 密钥在同一保险库中加密，仅在向该主机发起的克隆、拉取或推送请求时解密，'
        + '绑定到其主机，且 ', m('strong', '永远不会显示给代理或 VM'),
        '。peerd 仅通过 HTTPS 将其发送到该确切主机（重定向被拒绝），'
        + '因此它无法泄露到其他地方。',
      ]),

      // Existing tokens (host names only — values never leave the vault).
      ui.hosts === null
        ? m('p.hint', '加载中…')
        : ui.hosts.length === 0
          ? m('p.hint', '暂无 git 令牌。')
          : m('.provider-cards', ui.hosts.map((/** @type {string} */ host) => m('.provider-card', [
              m('.provider-card-main', [
                m('.provider-card-text', [
                  m('span.provider-card-name', host),
                  m('span.key-badge.key-set', '✓ 令牌已保存'),
                ]),
                m('span', { style: 'margin-left:auto;' },
                  m('button.linkish', { type: 'button', disabled: ui.busy, onclick: () => remove(host) }, '移除')),
              ]),
            ]))),

      m('.settings-divider'),
      m('h3', '添加令牌'),
      m('p.hint', [
        '主机 + 个人访问令牌。尽可能使用 ', m('strong', '细粒度、仓库范围的'),
        ' 令牌。GitHub 细粒度令牌需要 Contents: read 用于克隆/拉取，'
        + 'Contents: read and write 用于推送。对于 GitLab，使用 ', m('code', 'gitlab.com'),
        ' 配合 ', m('code', 'read_repository'), ' 用于克隆/拉取，', m('code', 'write_repository'), ' 用于推送。',
      ]),
      m('form.provider-card-form', { onsubmit: (/** @type {any} */ e) => { e.preventDefault(); save(); } }, [
        m('.input-row', [
          m('input', {
            type: 'text', spellcheck: false, autocapitalize: 'none', autocomplete: 'off',
            'aria-label': 'Git 凭据主机',
            placeholder: 'github.com', value: ui.hostInput, disabled: ui.busy,
            oninput: (/** @type {any} */ e) => { ui.hostInput = e.target.value; },
            style: 'flex:0 0 11rem;',
          }),
          m('input', {
            type: 'password', spellcheck: false, autocomplete: 'off',
            'aria-label': '个人访问令牌',
            placeholder: '粘贴令牌…', value: ui.tokenInput, disabled: ui.busy,
            oninput: (/** @type {any} */ e) => { ui.tokenInput = e.target.value; },
          }),
          m('button', { type: 'submit', disabled: ui.busy || !ui.hostInput.trim() || !ui.tokenInput.trim() },
            ui.busy ? '…' : '保存'),
        ]),
      ]),
      ui.msg ? m(`p.key-msg${ui.msg.ok ? '.ok' : '.err'}`, { role: ui.msg.ok ? 'status' : 'alert', 'aria-live': 'polite' }, ui.msg.text) : null,

      m('p.muted.settings-footer', [
        '存储为 ', m('code', 'git:<host>'), ' 在保险库中。匿名克隆'
        + '（公共仓库）不需要令牌。OAuth 登录已计划；目前请使用 PAT。',
      ]),
    ]);
  },
};
