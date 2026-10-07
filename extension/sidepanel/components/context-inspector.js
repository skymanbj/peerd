// @ts-check
// Context inspector — "what did the model actually see this turn?"
//
// A modal over the chat rendering the SW's live per-session snapshot
// ring: one entry per model call (orchestrator turns AND delegated
// actor/actor calls), each showing the shaped request — clipped
// system prompt, message roster, tool names, params. This is the
// debugging view for the two hardest bug classes peerd has: compaction
// surprises ("why did it forget?") and fence regressions ("what
// exactly entered the context?").
//
// Dev-facing by design: the OPEN affordance is devMode-gated in the
// chat view (the normal user never sees actor plumbing), and the modal
// says plainly that the ring is SW-memory only — an empty list after a
// browser restart means "nothing captured yet", not "nothing ran".

import m from '/vendor/mithril/mithril.js';

/** @param {number} when */
const timeOf = (when) => new Date(when).toLocaleTimeString();

/** One snapshot as a collapsible block. */
const Snapshot = {
  /** @param {{ attrs: { snap: Record<string, any> } }} vnode */
  view: ({ attrs: { snap } }) => m('details.ctx-snap', [
    m('summary.ctx-snap-summary', [
      m('span.ctx-snap-label', snap.label),
      m('span.ctx-snap-meta',
        `${snap.provider}/${snap.model} · ${snap.messages.length} 条消息`
        + `${snap.droppedMessages ? ` (+${snap.droppedMessages} 条较早消息已丢弃)` : ''}`
        + ` · 系统提示词 ${Math.round((snap.systemChars ?? 0) / 1000)}k 字符 · ${timeOf(snap.when)}`),
    ]),
    m('.ctx-snap-body', [
      snap.tools?.length
        ? m('.ctx-snap-tools', `工具：${snap.tools.join(', ')}`)
        : null,
      m('details.ctx-snap-system', [
        m('summary', '系统提示词（已裁剪）'),
        m('pre.ctx-pre', snap.system),
      ]),
      snap.messages.map((/** @type {Record<string, any>} */ msg, /** @type {number} */ i) =>
        m('.ctx-msg', { key: i }, [
          m('span.ctx-msg-role', msg.role),
          msg.content ? m('pre.ctx-pre', msg.content) : null,
          (msg.toolUses ?? []).map((/** @type {Record<string, any>} */ u) =>
            m('.ctx-msg-tool', `→ ${u.name} ${u.input}`)),
          (msg.toolResults ?? []).map((/** @type {Record<string, any>} */ r) =>
            m(`.ctx-msg-result${r.is_error ? '.failed' : ''}`, [
              m('span.ctx-msg-role', r.is_error ? '结果（错误）' : '结果'),
              m('pre.ctx-pre', r.content),
            ])),
        ])),
    ]),
  ]),
};

/**
 * @typedef {{ snapshots: Array<Record<string, any>> | null, error?: string | null, onClose: () => void }} ContextInspectorAttrs
 */
export const ContextInspector = {
  /** @param {{ attrs: ContextInspectorAttrs }} vnode */
  view: ({ attrs: { snapshots, error = null, onClose } }) => m('.peerd-modal-backdrop', { onclick: onClose },
    m('.peerd-modal.context-inspector', { onclick: (/** @type {Event} */ e) => e.stopPropagation() }, [
      m('.ctx-header', [
        m('span.ctx-title', '上下文检查器'),
        m('span.ctx-subtitle', '每次模型调用携带的内容，最新的在前'),
        m('.spacer'),
        m('button.ctx-close', { onclick: onClose, title: '关闭' }, '✕'),
      ]),
      snapshots === null
        ? m('.ctx-empty', '加载中…')
        : error
          ? m('.ctx-empty', `无法读取快照：${error}`)
          : snapshots.length === 0
          ? m('.ctx-empty',
              '此对话无实时快照。环形缓冲仅存储 Service Worker 内存中最近的模型调用 — 浏览器重启或 worker 被回收后会清空。发送消息后重新打开。')
          : [...snapshots].reverse().map((snap) => m(Snapshot, { snap, key: snap.seq })),
    ])),
};
