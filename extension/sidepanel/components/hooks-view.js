// @ts-check
// Hooks view — the Context tab over the pre/post tool-use hook registry.
//
// Surface for feature 10's policy chokepoint: every tool call flows
// through the hook runner, so WHICH hooks exist and whether they're on
// is security-relevant state the user could previously only infer from
// the audit trail. This tab lists the merged population the dispatcher
// actually consumes (built-in code hooks + user config hooks), with
// provenance made explicit:
//
//   - BUILT-IN hooks are trusted in-tree code registered at boot. They
//     cannot be disabled or removed from config — the egress-allowlist
//     pre-hook is the always-on floor of the lethal-trifecta defense,
//     and a UI switch that could turn it off would be a security hole,
//     not a feature. The row says "always on" and shows the reason
//     instead of hiding the missing control.
//   - USER hooks are serializable records the user authored. They can
//     be toggled and removed here; every mutation is audited by the SW
//     (same discipline as denylist edits).
//
// Like SkillsView (the pattern this tab follows), the view is a pure
// projection of its own fetched list — hooks aren't on the global
// pushState payload (no reason to ship the registry on every state
// tick). It re-fetches after every mutation; the SW is the source of
// truth, no optimistic local edits.

import m from '/vendor/mithril/mithril.js';

/**
 * One hook record from `hooks/list`.
 * @typedef {Object} HookRecord
 * @property {string} id
 * @property {'pre-tool-use'|'post-tool-use'|string} event
 * @property {number} [order]
 * @property {boolean} enabled
 * @property {boolean} isDefault
 * @property {string} [kind]
 * @property {string} [match]
 * @property {string} [doc]
 */

/**
 * Component-local state for HooksView.
 * @typedef {Object} HooksState
 * @property {HookRecord[]|null} hooks
 * @property {{ ok: boolean, text: string }|null} note
 * @property {string|null} confirmRemove   hook id pending the remove confirm
 * @property {boolean} addOpen
 * @property {string} addText
 * @property {boolean} busy
 */

/** @typedef {(msg: object) => Promise<any>} Send */
/** @typedef {{ state: HooksState, attrs: { send: Send } }} HooksVnode */

// Stable, human-sensible order: pre-hooks before post-hooks (mirroring
// when they fire around a tool call), then the runner's own ordering
// (order asc, id) so the list reads as "what runs, in what sequence".
/** @param {HookRecord[]} hooks */
export const orderHooks = (hooks) => [...hooks].sort((a, b) =>
  (a.event === b.event ? 0 : a.event === 'pre-tool-use' ? -1 : 1)
  || (a.order ?? 100) - (b.order ?? 100)
  || String(a.id).localeCompare(String(b.id)));

// Authoring placeholder — the declarative (no-code) shape from
// peerd-runtime/tools/hooks/compile.js, which works under any CSP.
const ADD_PLACEHOLDER = [
  '---',
  'id: block-typed-secrets',
  'event: pre-tool-use',
  'match: type',
  'rule:',
  '  matchArg: text',
  '  pattern: sk-[a-zA-Z0-9]{20,}',
  '  reason: looks like an API key',
  '---',
  'Block the type tool from typing anything that looks like a secret.',
].join('\n');

export const HooksView = {
  /** @param {HooksVnode} vnode */
  oninit(vnode) {
    vnode.state.hooks = null;         // null = loading; [] = none
    vnode.state.note = null;          // { ok, text } action banner
    vnode.state.confirmRemove = null; // hook id pending the remove confirm
    vnode.state.addOpen = false;
    vnode.state.addText = '';
    vnode.state.busy = false;
    HooksView.refresh(vnode);
  },

  /** @param {HooksVnode} vnode */
  refresh(vnode) {
    vnode.attrs.send({ type: 'hooks/list' }).then((r) => {
      vnode.state.hooks = r?.ok ? orderHooks(r.hooks) : [];
      if (!r?.ok) vnode.state.note = { ok: false, text: r?.error ?? '加载钩子失败' };
      m.redraw();
    }).catch((e) => {
      vnode.state.hooks = [];
      vnode.state.note = { ok: false, text: /** @type {{ message?: string }} */ (e)?.message ?? '加载钩子失败' };
      m.redraw();
    });
  },

  // One mutation round-trip: send, banner the outcome, re-fetch on
  // success. Returns the response so callers (the add form) can chain.
  /**
   * @param {HooksVnode} vnode
   * @param {object} msg
   * @param {string} okText
   */
  act(vnode, msg, okText) {
    const ui = vnode.state;
    if (ui.busy) return Promise.resolve(null);
    ui.busy = true; ui.note = null;
    return vnode.attrs.send(msg).then((r) => {
      ui.busy = false;
      ui.note = r?.ok ? { ok: true, text: okText } : { ok: false, text: r?.error ?? '操作失败。' };
      if (r?.ok) { ui.confirmRemove = null; HooksView.refresh(vnode); }
      m.redraw();
      return r;
    }).catch((e) => {
      ui.busy = false;
      ui.note = { ok: false, text: /** @type {{ message?: string }} */ (e)?.message ?? '操作失败。' };
      m.redraw();
      return null;
    });
  },

  /** @param {HooksVnode} vnode */
  view({ state: ui, attrs }) {
    const vnode = { state: ui, attrs };
    const hooks = ui.hooks;

    return m('.hooks-pane', [
      m('p.muted', { style: 'font-size:12px; margin:0 0 8px;' },
        '策略钩子在每次工具调用时运行 — 前置钩子可以阻止或',
        + '重写它，后置钩子观察结果。内置钩子是',
        + '代码且始终开启（出口允许列表是安全底线）；',
        + '您自己的钩子可以切换或移除。每次更改都会被审计。'),

      m('.hooks-actions', [
        m('button.secondary', {
          onclick: () => { ui.addOpen = !ui.addOpen; ui.note = null; },
        }, ui.addOpen ? '取消' : '添加钩子…'),
        m('.spacer'),
      ]),

      ui.addOpen ? m('form.hook-add', {
        onsubmit: (/** @type {Event} */ e) => {
          e.preventDefault();
          if (!ui.addText.trim() || ui.busy) return;
          HooksView.act(vnode, { type: 'hooks/save', markdown: ui.addText }, '钩子已保存。')
            .then((r) => {
              if (r?.ok) { ui.addOpen = false; ui.addText = ''; m.redraw(); }
            });
        },
      }, [
        m('textarea.hook-add-editor', {
          rows: 10,
          spellcheck: false,
          placeholder: ADD_PLACEHOLDER,
          'aria-label': '钩子 Markdown',
          value: ui.addText,
          oninput: (/** @type {Event} */ e) => { ui.addText = /** @type {HTMLTextAreaElement} */ (e.target).value; },
        }),
        m('p.muted', { style: 'font-size:11px; margin:0;' },
          '带有前置元数据（id、event、match、可选声明性',
          + '规则块）的 Markdown — .peerd/hooks/*.md 格式。编译错误会显示在此处。'),
        m('button', { type: 'submit', disabled: ui.busy || !ui.addText.trim() },
          ui.busy ? '保存中…' : '保存钩子'),
      ]) : null,

      ui.note ? m(`p.key-msg${ui.note.ok ? '.ok' : '.err'}`, ui.note.text) : null,

      hooks === null
        ? m('p.muted', '加载中…')
        : hooks.length === 0
          ? m('p.muted', '未注册钩子。')
          : m('.hook-list', hooks.map((h) => hookRow(vnode, h))),
    ]);
  },
};

/**
 * @param {HooksVnode} vnode
 * @param {HookRecord} h
 */
const hookRow = (vnode, h) => {
  const ui = vnode.state;
  return m('.hook-row', { key: h.id, class: h.enabled ? '' : 'is-off' }, [
    m('.hook-main', [
      m('.hook-line', [
        m('code.hook-name', h.id),
        m('span.hook-badge.hook-phase',
          { title: h.event === 'pre-tool-use'
              ? '在工具执行前运行 — 可以阻止或重写调用'
              : '在工具执行后运行 — 仅观察' },
          h.event === 'pre-tool-use' ? '前置' : '后置'),
        m('span.hook-badge', { title: h.isDefault
            ? '内置：受信任的树内代码，启动时注册'
            : `您的配置（${h.kind}）` },
          h.isDefault ? '内置' : '用户'),
        m('code.hook-match', { title: '工具名称匹配' }, h.match ?? '*'),
      ]),
      h.doc ? m('p.hook-doc', h.doc) : null,
    ]),
    m('.hook-controls', h.isDefault
      // Built-ins: visibly NOT disableable. The doc line above carries
      // the per-hook reason; the title repeats it on the control itself.
      ? m('span.hook-lock', {
          title: `内置代码钩子 — 非用户配置。${h.id === 'egress-allowlist'
              ? '出口允许列表是始终开启的安全底线；没有关闭开关。'
              : '无法在此处禁用或移除。'}`,
        }, '始终开启')
      : [
          m('label.hook-toggle', [
            m('input', {
              type: 'checkbox',
              checked: h.enabled,
              disabled: ui.busy,
              'aria-label': `启用 ${h.id}`,
              onchange: (/** @type {Event} */ e) => HooksView.act(vnode,
                { type: 'hooks/toggle', id: h.id, enabled: /** @type {HTMLInputElement} */ (e.target).checked },
                `${/** @type {HTMLInputElement} */ (e.target).checked ? '已启用' : '已禁用'} ${h.id}。`),
            }),
            h.enabled ? '开' : '关',
          ]),
          ui.confirmRemove === h.id
            ? m('span.hook-confirm', [
                m('button.linkish.danger-text', {
                  disabled: ui.busy,
                  onclick: () => HooksView.act(vnode,
                    { type: 'hooks/remove', id: h.id }, `已移除 ${h.id}。`),
                }, '移除？'),
                m('button.linkish', {
                  'aria-label': '取消移除',
                  onclick: () => { ui.confirmRemove = null; },
                }, '✕'),
              ])
            : m('button.linkish.hook-x', {
                'aria-label': `移除 ${h.id}`,
                title: '移除此钩子',
                disabled: ui.busy,
                onclick: () => { ui.confirmRemove = h.id; },
              }, '×'),
        ]),
  ]);
};
