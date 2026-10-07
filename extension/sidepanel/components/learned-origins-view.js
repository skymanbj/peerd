// @ts-check
// Settings → Learned sites: the hosts peerd LEARNED may carry the user's session
// on, and the only place one can be un-learned.
//
// why its own nav entry, next to the denylist rather than inside it: the two are
// opposites worth reading together (the denylist is sites the user BANNED peerd
// from; this is sites peerd decided are theirs), but the denylist page is ~164
// seed patterns tall — appending to it put this below the fold, and an un-learn
// control the user cannot find is the exact problem this view exists to fix.
//
// The distinction the copy has to carry: un-learning does NOT make a site
// unprotected in general. A learned host is a guess; the curated shared-doc
// list and a stored credential are not, and those two keep protecting a site
// whatever this list says. Otherwise a user would "clear" a row and reasonably
// expect roaming access to a site that still refuses one.
//
// Follows DenylistView's shape deliberately (self-fetch over the SW route, no
// optimistic edits, an armed inline confirm before anything destructive, the
// same `p.key-msg` outcome banner) so the two security pages behave alike.

import m from '/vendor/mithril/mithril.js';

/** How a learned reason reads to a person. */
const REASON_COPY = {
  'password-field': 'peerd 读取的页面上有登录表单',
  'confirmed-write': '你批准了 peerd 向其发送数据',
};

/**
 * @typedef {Object} LearnedState
 * @property {Array<{ host: string, reason: string }>|null} origins  null = loading
 * @property {{ ok: boolean, text: string }|null} note
 * @property {string|null} confirm    origin with an armed forget confirm
 * @property {boolean} confirmAll     the clear-everything confirm is armed
 * @property {boolean} busy
 */

/** @typedef {(msg: object) => Promise<any>} Send */
/** @typedef {{ state: LearnedState, attrs: { send: Send } }} LearnedVnode */

/** Restore keyboard focus after Mithril has replaced an inline control. */
const focusAfterRender = (/** @type {'heading'|'trigger'|'confirm'|'trigger-all'|'confirm-all'} */ role, /** @type {string|null} */ host = null) => {
  requestAnimationFrame(() => {
    const controls = [...document.querySelectorAll(`.learned-sites [data-learned-role="${role}"]`)];
    const target = host
      ? controls.find((element) => /** @type {HTMLElement} */ (element).dataset.learnedHost === host)
      : controls[0];
    /** @type {HTMLElement | undefined} */ (target)?.focus();
  });
};

export const LearnedOriginsView = {
  /** @param {LearnedVnode} vnode */
  oninit(vnode) {
    vnode.state.origins = null;
    vnode.state.note = null;
    vnode.state.confirm = null;
    vnode.state.confirmAll = false;
    vnode.state.busy = false;
    LearnedOriginsView.refresh(vnode);
  },

  /** @param {LearnedVnode} vnode */
  refresh(vnode) {
    return vnode.attrs.send({ type: 'learned/list' }).then((r) => {
      vnode.state.origins = r?.ok ? (r.origins ?? []) : (vnode.state.origins ?? []);
      if (!r?.ok) vnode.state.note = { ok: false, text: r?.error ?? '加载已学习站点失败' };
      m.redraw();
    }).catch((e) => {
      vnode.state.origins = vnode.state.origins ?? [];
      vnode.state.note = { ok: false, text: /** @type {{ message?: string }} */ (e)?.message ?? '加载已学习站点失败' };
      m.redraw();
    });
  },

  /**
   * One mutation round-trip: send, banner the outcome, re-fetch.
   * @param {LearnedVnode} vnode
   * @param {{ type: string, host?: string }} msg
   * @param {string | ((reply: any) => string)} okText  a function when the copy
   *   depends on the reply (Forget all reports how many it actually forgot).
   */
  act(vnode, msg, okText) {
    const ui = vnode.state;
    if (ui.busy) return Promise.resolve(null);
    ui.busy = true; ui.note = null; m.redraw();
    return vnode.attrs.send(msg).then(async (r) => {
      ui.busy = false;
      // `not-learned` means THIS VIEW IS STALE — another tab, or the panel, already
      // removed the row. So it re-fetches like the success path does: an earlier
      // draft said "reloading" while refreshing only on success, which left the
      // phantom row on screen with its confirm still armed underneath a message
      // saying the row was gone.
      const stale = r?.error === 'not-learned';
      ui.note = r?.ok
        ? { ok: true, text: typeof okText === 'function' ? okText(r) : okText }
        : { ok: false, text: stale
          ? '该站点已在别处被移除 — 已刷新列表。'
          : r?.error ?? '操作失败。' };
      if (r?.ok || stale) {
        ui.confirm = null;
        ui.confirmAll = false;
        await LearnedOriginsView.refresh(vnode);
      }
      m.redraw();
      if (r?.ok) focusAfterRender('heading');
      else if (stale) focusAfterRender(ui.origins?.length ? 'trigger' : 'heading');
      else focusAfterRender(msg.type === 'learned/clear' ? 'confirm-all' : 'confirm', /** @type {any} */ (msg).host ?? null);
      return r;
    }).catch((e) => {
      ui.busy = false;
      ui.note = { ok: false, text: /** @type {{ message?: string }} */ (e)?.message ?? '操作失败。' };
      m.redraw();
      focusAfterRender(msg.type === 'learned/clear' ? 'confirm-all' : 'confirm', /** @type {any} */ (msg).host ?? null);
      return null;
    });
  },

  /** @param {LearnedVnode} vnode */
  view({ state: ui, attrs }) {
    const vnode = { state: ui, attrs };
    const rows = ui.origins;

    return m('div.learned-sites', [
      m('h3', { tabindex: -1, 'data-learned-role': 'heading' }, '可能共享你浏览器会话的主机'),
      m('p', 'peerd 通过日常使用学习这些主机。浏览开放网络的助手不允许访问它们。'
        + '它会改为将工作交给绑定到该确切站点的助手。如果猜测有误，请在此移除主机。'),
      m('p.hint', '每个条目涵盖此主机在所有端口及其子域上的访问。'),
      m('p.hint', '移除主机并不会使其失去保护：位于 peerd 内置共享文档列表上的站点，'
        + '或你已为其存储密钥的站点，无论如何都保持受保护。peerd 下次在那里'
        + '读取到登录表单时也可能再次学习到同一主机。'),

      // `p.key-msg.ok` / `.err` — the same banner DenylistView and HooksView use.
      // (A bare `.ok` has no rule in either stylesheet this page links, so the
      // success case rendered as ordinary body text, indistinguishable from the
      // explanatory copy above it.)
      ui.note ? m(`p.key-msg${ui.note.ok ? '.ok' : '.err'}`, {
        role: ui.note.ok ? 'status' : 'alert',
        'aria-live': ui.note.ok ? 'polite' : 'assertive',
      }, ui.note.text) : null,

      rows === null
        ? m('p.muted', '加载中…')
        : rows.length === 0
          ? m('p.muted', '尚未学习任何内容。')
          : m('div', [
            // The rows get their OWN container so this outer array stays a
            // constant two children (list, then the Forget-all block) while the
            // list length changes underneath.
            //
            // why no keys on the rows: keyed and unkeyed siblings cannot be
            // mixed — Mithril throws on the mix, and during development that
            // threw mid-redraw and stranded the whole block on "Loading…" while
            // the SW already held two learned hosts. The list is re-fetched
            // wholesale after every mutation, so keys would buy nothing here.
            m('div', rows.map(({ host, reason }) => m('div', {
              style: 'display:flex; align-items:center; gap:8px; padding:6px 0; flex-wrap:wrap;',
            }, [
              m('span', { style: 'flex:1; min-width:220px;' }, [
                m('code', host),
                m('span.hint', { style: 'display:block;' },
                  REASON_COPY[/** @type {keyof REASON_COPY} */ (reason)] ?? reason),
              ]),
              ui.confirm === host
                ? m('span', { style: 'display:flex; gap:6px; align-items:center;' }, [
                  m('span.hint', '移除此已学习主机？'),
                  m('button.secondary', {
                    type: 'button',
                    disabled: ui.busy,
                    'data-learned-role': 'confirm',
                    'data-learned-host': host,
                    'aria-label': `确认移除已学习主机 ${host}`,
                    onclick: () => LearnedOriginsView.act(
                      vnode, { type: 'learned/forget', host }, `已移除 ${host}。`,
                    ),
                  }, ui.busy ? '…' : '移除'),
                  m('button.secondary', {
                    type: 'button',
                    disabled: ui.busy,
                    'aria-label': `保留已学习主机 ${host}`,
                    onclick: () => {
                      ui.confirm = null; m.redraw();
                      focusAfterRender('trigger', host);
                    },
                  }, '保留'),
                ])
                : m('button.secondary', {
                  type: 'button',
                  disabled: ui.busy,
                  'data-learned-role': 'trigger',
                  'data-learned-host': host,
                  'aria-label': `移除已学习主机 ${host}`,
                  onclick: () => {
                    ui.confirm = host; ui.note = null; m.redraw();
                    focusAfterRender('confirm', host);
                  },
                }, '移除'),
            ]))),
            m('div', { style: 'margin-top:12px;' }, [
              ui.confirmAll
                ? m('span', { style: 'display:flex; gap:6px; align-items:center; flex-wrap:wrap;' }, [
                  m('span.hint', `忘记全部 ${rows.length} 个已学习站点？`),
                  m('button.secondary', {
                    type: 'button',
                    disabled: ui.busy,
                    'data-learned-role': 'confirm-all',
                    'aria-label': '确认忘记所有已学习主机',
                    onclick: () => LearnedOriginsView.act(
                      vnode, { type: 'learned/clear' },
                      // Report what it actually forgot: "cleared" alone cannot be
                      // told apart from a clear that found nothing to do.
                      (r) => `已忘记 ${r?.forgotten ?? 0} 个已学习站点。`,
                    ),
                  }, ui.busy ? '…' : '全部忘记'),
                  m('button.secondary', {
                    type: 'button',
                    disabled: ui.busy,
                    onclick: () => {
                      ui.confirmAll = false; m.redraw();
                      focusAfterRender('trigger-all');
                    },
                  }, '取消'),
                ])
                : m('button.secondary', {
                  type: 'button',
                  disabled: ui.busy,
                  'data-learned-role': 'trigger-all',
                  onclick: () => {
                    ui.confirmAll = true; ui.note = null; m.redraw();
                    focusAfterRender('confirm-all');
                  },
                }, '全部忘记'),
            ]),
          ]),
    ]);
  },
};
