// @ts-check
// Options → Memory — the agent's durable AGENTS.md memory, in one place.
//
// Ported from the Context view's Memory pane (user/project/subtree doc
// editors, the /init draft button, the pending auto-memory suggestions
// queue), PLUS the auto-memory on/off toggle relocated from the old
// "Agent behavior" section — the switch lives next to the queue it
// feeds. The USER can read and edit docs directly (origin:'user' →
// saved without a confirmation round-trip; the trifecta gate is for
// agent writes), see each scope's line count against the always-loaded
// budget, create a user note, run /init, and delete.
//
// /init starts an agent flow whose progress notes and draft-confirmation
// modal ride the PANEL port — the copy here says so honestly: open the
// peerd panel and watch the chat for the draft.

import m from '/vendor/mithril/mithril.js';
import { countLines, ALWAYS_LOADED_LINE_BUDGET } from '/peerd-runtime/index.js';
import { resetRow } from './reset-row.js';

/** @typedef {import('./reset-row.js').Send} Send */
/** @typedef {{ id?: string, kind: string, body?: string, workspace?: string, subpath?: string }} MemoryDoc */

export const MemoryView = {
  /** @param {{ state: any, attrs: { send: Send } }} vnode */
  oninit(vnode) {
    vnode.state.memoryDocs = null;
    vnode.state.suggestions = null;   // pending auto-memory suggestions
    vnode.state.memNote = null;       // { ok, text } banner for memory actions
    vnode.state.memBusy = false;
    MemoryView.refresh(vnode);
  },

  /** @param {{ state: any, attrs: { send: Send } }} vnode */
  refresh(vnode) {
    vnode.attrs.send({ type: 'memory/export' }).then((/** @type {any} */ r) => {
      if (r?.ok) vnode.state.memoryDocs = orderDocs(r.payload?.docs ?? []);
      else { vnode.state.memoryDocs = []; vnode.state.memNote = { ok: false, text: r?.error ?? '加载内存失败' }; }
      m.redraw();
    }).catch(() => { vnode.state.memoryDocs = []; m.redraw(); });
    // Pending auto-memory suggestions — the strip at the top of the
    // page (the count also feeds the badge on the Memory nav entry).
    vnode.attrs.send({ type: 'memory/suggestions' }).then((/** @type {any} */ r) => {
      vnode.state.suggestions = r?.ok ? (r.suggestions ?? []) : [];
      m.redraw();
    }).catch(() => { vnode.state.suggestions = []; m.redraw(); });
  },

  /** @param {{ state: any, attrs: { state: any, send: Send, onSuggestionsChanged?: () => void } }} vnode */
  view(vnode) {
    const { state, send, onSuggestionsChanged } = vnode.attrs;
    const ui = vnode.state;
    const reload = () => MemoryView.refresh(vnode);

    // Run a one-shot memory action (init / new note / delete-all /
    // approve / dismiss), with a shared busy flag + result banner, then
    // refresh the doc list. onSuggestionsChanged keeps the options-nav
    // badge honest after approve/dismiss (the shell owns that count).
    /**
     * @param {{ type: string } & Record<string, any>} msg
     * @param {string} okText
     */
    const act = async (msg, okText) => {
      if (ui.memBusy) return;
      ui.memBusy = true; ui.memNote = null; m.redraw();
      const r = await send(msg);
      ui.memBusy = false;
      ui.memNote = r?.ok ? { ok: true, text: okText } : { ok: false, text: r?.error ?? '操作失败。' };
      if (r?.ok) { reload(); onSuggestionsChanged?.(); }
      m.redraw();
    };

    const docs = ui.memoryDocs;
    const hasUserDoc = Array.isArray(docs) && docs.some((/** @type {MemoryDoc} */ d) => d.kind === 'user');
    const suggestions = ui.suggestions ?? [];
    // Auto-memory defaults ON — absence of the key must not read as off.
    const autoMemoryOn = state?.settings?.autoMemoryEnabled !== false;

    return m('.memory-pane', [
      m('p.muted', { style: 'font-size:12px; margin:0 0 10px;' }, [
        '持久化 ', m('code', 'AGENTS.md'), ' 内存，加载到每个提示中。 ',
        `用户 + 项目范围始终加载（≤${ALWAYS_LOADED_LINE_BUDGET} 行/每个）； `,
        '子树笔记按需加载。您在这里的编辑直接保存 — 无需确认。',
      ]),

      // Pending auto-memory suggestions. Proposed when a chat wraps up;
      // NOTHING is written until you approve a note here.
      suggestions.length > 0 ? m('.memory-suggestions', [
        m('p.muted', { style: 'font-size:12px; margin:0 0 6px;' },
          `在结束近期对话时提出 — 批准以添加到您的用户内存，忽略以丢弃。未经您的确认不会保存任何内容。`),
        // why the wrapper div: keyed vnodes must not share a fragment
        // with the unkeyed intro paragraph (Mithril all-or-none rule).
        m('div', suggestions.map((/** @type {any} */ s) => m('.memory-suggestion', { key: s.id }, [
          m('.memory-suggestion-text', s.text),
          m('.memory-suggestion-meta', [
            s.sessionTitle ? m('span.muted', `来自“${s.sessionTitle}”`) : m('span'),
            m('.spacer'),
            m('button', {
              disabled: ui.memBusy,
              'aria-label': `批准建议：${s.text}`,
              onclick: () => act({ type: 'memory/suggestions/approve', id: s.id }, '已添加到用户内存。'),
            }, '批准'),
            m('button.secondary', {
              disabled: ui.memBusy,
              'aria-label': `忽略建议：${s.text}`,
              onclick: () => act({ type: 'memory/suggestions/dismiss', id: s.id }, '建议已忽略。'),
            }, '忽略'),
          ]),
        ]))),
      ]) : null,

      m('.memory-actions', [
        m('button.secondary', {
          disabled: ui.memBusy,
          title: '扫描活跃工作区并起草项目 AGENTS.md — 草稿会在 peerd 面板中等待您确认，请先打开面板',
          onclick: () => act({ type: 'memory/init' },
            '/init 已启动 — 打开 peerd 面板并在对话中查看待确认的草稿。'),
        }, '起草项目记忆 (/init)'),
        hasUserDoc ? null : m('button.secondary', {
          disabled: ui.memBusy,
          onclick: () => act(
            { type: 'memory/write', scope: { kind: 'user' }, body: '# User memory\n\n- ' },
            '已创建用户笔记 — 在下方编辑。'),
        }, '新建用户笔记'),
        m('.spacer'),
        (Array.isArray(docs) && docs.length > 0) ? m('button.linkish.danger-text', {
          disabled: ui.memBusy,
          onclick: () => {
            if (ui.memConfirmWipe) {
              act({ type: 'memory/deleteAll' }, '已删除所有内存。');
              ui.memConfirmWipe = false;
            } else { ui.memConfirmWipe = true; m.redraw(); }
          },
        }, ui.memConfirmWipe ? '再次点击以删除全部' : '删除全部') : null,
      ]),

      ui.memNote ? m(`p.key-msg${ui.memNote.ok ? '.ok' : '.err'}`, ui.memNote.text) : null,

      docs === null
        ? m('p.muted', '加载中…')
        : docs.length === 0
          ? m('.memory-empty', m('p.muted',
              '还没有内存。运行 /init 从活跃工作区起草项目笔记，'
              + '在上方添加用户笔记，或直接告诉 peerd 在对话中“记住”某事。'))
          : docs.map((/** @type {MemoryDoc} */ d) => m(MemoryDocCard, { key: d.id, doc: d, send, onChanged: reload })),

      // Auto-memory toggle — relocated from "Agent behavior": the
      // switch belongs next to the suggestion queue it feeds.
      m('.settings-divider'),
      m('h3', '自动记忆'),
      m('p', autoMemoryOn
        ? '开。当对话结束时（您归档或在真实对话后切换），peerd 会进行一次小型后台模型调用，提出关于您和您正在进行的工作的持久化笔记。提案会显示在上方等待您批准 — 未经批准永不保存。调用遵守会话消费限额（成本页）。'
        : '关。peerd 不会从已完成的对话中提出内存笔记。您仍可以要求它记住事项，或在此页面直接编辑内存。'),
      m('div', { style: 'display:flex; gap:8px; align-items:center;' }, [
        m('button.secondary', {
          type: 'button',
          disabled: ui.autoMemoryBusy,
          onclick: async () => {
            if (ui.autoMemoryBusy) return;
            ui.autoMemoryBusy = true;
            await send({ type: 'settings/update', patch: { autoMemoryEnabled: !autoMemoryOn } });
            ui.autoMemoryBusy = false;
            m.redraw();
          },
        }, ui.autoMemoryBusy ? '…' : autoMemoryOn ? '禁用自动记忆' : '启用自动记忆'),
      ]),
      resetRow(send, ['autoMemoryEnabled']),
    ]);
  },
};

// Sort docs into a stable, human-sensible order: user first, then project,
// then subtree (deepest-pathed last), then anything else — so the always-
// loaded scopes sit at the top.
/** @type {Record<string, number>} */
const SCOPE_ORDER = { user: 0, project: 1, subtree: 2 };
/** @param {MemoryDoc[]} docs */
const orderDocs = (docs) => [...docs].sort((a, b) => {
  const ra = SCOPE_ORDER[a.kind] ?? 9;
  const rb = SCOPE_ORDER[b.kind] ?? 9;
  if (ra !== rb) return ra - rb;
  return String(a.subpath ?? '').localeCompare(String(b.subpath ?? ''));
});

// User + project docs are loaded into EVERY prompt, so they share the
// line budget. Subtree docs load on demand and don't.
/** @param {MemoryDoc} d */
const isAlwaysLoaded = (d) => d.kind === 'user' || d.kind === 'project';

/** @param {MemoryDoc} d */
const scopeLabel = (d) => {
  if (d.kind === 'user') return '用户 · 全局';
  if (d.kind === 'project') return `项目 · ${d.workspace || '—'}`;
  if (d.kind === 'subtree') return `子树 · ${d.workspace || ''}${d.subpath ? `/${d.subpath}` : ''}`;
  return `${d.kind}${d.subpath ? ` · ${d.subpath}` : ''}`;
};

// One editable AGENTS.md doc. Keyed by doc.id so the instance (and its
// in-progress draft) survives list refreshes; after a save the parent
// re-fetches and doc.body matches the draft, so it reads as not-dirty.
const MemoryDocCard = {
  /** @param {{ state: any, attrs: { doc: MemoryDoc } }} vnode */
  oninit(vnode) {
    vnode.state.draft = vnode.attrs.doc.body ?? '';
    vnode.state.busy = false;
    vnode.state.msg = null;
    vnode.state.confirmDelete = false;
  },
  /** @param {{ attrs: { doc: MemoryDoc, send: Send, onChanged?: () => void }, state: any }} vnode */
  view: ({ attrs: { doc, send, onChanged }, state: ui }) => {
    const dirty = ui.draft !== (doc.body ?? '');
    const lines = countLines(ui.draft);
    const budgeted = isAlwaysLoaded(doc);
    const over = budgeted && lines > ALWAYS_LOADED_LINE_BUDGET;
    const scope = { kind: doc.kind, workspace: doc.workspace, subpath: doc.subpath };

    const save = async () => {
      if (ui.busy || !dirty) return;
      ui.busy = true; ui.msg = null; m.redraw();
      const r = await send({ type: 'memory/write', scope, body: ui.draft });
      ui.busy = false;
      ui.msg = r?.ok ? { ok: true, text: '已保存。' } : { ok: false, text: r?.error ?? '保存失败。' };
      if (r?.ok) onChanged?.();
      m.redraw();
    };

    const del = async () => {
      ui.busy = true; ui.msg = null; m.redraw();
      const r = await send({ type: 'memory/delete', scope });
      ui.busy = false;
      if (r?.ok) { onChanged?.(); }
      else { ui.msg = { ok: false, text: r?.error ?? '删除失败。' }; m.redraw(); }
    };

    return m('.memory-card', [
      m('.memory-card-head', [
        m('span.memory-scope', scopeLabel(doc)),
        m('.spacer'),
        m(`span.memory-lines${over ? '.is-over' : ''}`,
          budgeted ? `${lines} / ${ALWAYS_LOADED_LINE_BUDGET} 行` : `${lines} 行 · 按需加载`),
      ]),
      m('textarea.memory-editor', {
        value: ui.draft,
        spellcheck: false,
        // why: grow with content but cap so a long doc doesn't take over
        // the whole pane — the textarea scrolls past the cap.
        rows: Math.min(24, Math.max(5, lines + 1)),
        disabled: ui.busy,
        oninput: (/** @type {{ target: HTMLTextAreaElement }} */ e) => { ui.draft = e.target.value; },
      }),
      over ? m('p.memory-warn',
        `超过 ${ALWAYS_LOADED_LINE_BUDGET} 行始终加载预算 — 请缩减，否则加载器将截断此范围。`) : null,
      m('.memory-card-actions', [
        m('button', { disabled: ui.busy || !dirty, onclick: save }, ui.busy ? '…' : '保存'),
        dirty ? m('button.secondary', {
          disabled: ui.busy,
          onclick: () => { ui.draft = doc.body ?? ''; ui.msg = null; },
        }, '还原') : null,
        m('.spacer'),
        ui.confirmDelete
          ? m('span.memory-confirm', [
              m('span.muted', { style: 'font-size:12px;' }, '删除此范围？'),
              m('button.linkish.danger-text', { disabled: ui.busy, onclick: del }, '是'),
              m('button.linkish', { disabled: ui.busy, onclick: () => { ui.confirmDelete = false; } }, '否'),
            ])
          : m('button.linkish.danger-text', { disabled: ui.busy, onclick: () => { ui.confirmDelete = true; } }, '删除'),
      ]),
      ui.msg ? m(`p.key-msg${ui.msg.ok ? '.ok' : '.err'}`, ui.msg.text) : null,
    ]);
  },
};
