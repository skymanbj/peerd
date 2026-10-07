// @ts-check
// Sessions view — list of chat sessions; click to switch.
//
// Lives at /chats. The list is fetched on mount via `session/list`.
// Per-row actions (switch, archive) re-fetch after success.
//
// V1 surface:
//   - "+ New chat" at the top (session/reset → route to /chat)
//   - List rows: title, time-ago, message count, model badge
//   - Per-row "×" archive action
//   - Empty + loading + error states

import m from '/vendor/mithril/mithril.js';
import browser from '/vendor/browser-polyfill.js';

/**
 * One session summary row from `session/list`.
 * @typedef {Object} SessionSummary
 * @property {string} sessionId
 * @property {string} [title]
 * @property {number} lastMessageAt
 * @property {number} messageCount
 * @property {boolean} [archived]
 * @property {string} [model]
 * @property {boolean} [hasCustomSystemPrompt]
 * @property {string} [toolManifestLabel]
 */

/**
 * Component-local state for SessionsView.
 * @typedef {Object} SessionsState
 * @property {SessionSummary[]|null} sessions
 * @property {boolean} loading
 * @property {string|null} error
 */

/** @param {object} msg */
const send = (msg) => /** @type {Promise<any>} */ (browser.runtime.sendMessage(msg));

// Fetch the session list and write the result into the shared `ui`
// object the view reads from. Triggers a redraw at the end so callers
// don't have to remember.
/** @param {SessionsState} ui */
const loadList = async (ui) => {
  ui.loading = true;
  ui.error = null;
  m.redraw();
  try {
    const reply = await send({ type: 'session/list' });
    if (reply?.ok) {
      ui.sessions = reply.sessions;
    } else {
      ui.error = reply?.error ?? '无法加载对话。';
    }
  } catch (e) {
    ui.error = /** @type {{ message?: string }} */ (e)?.message ?? '无法加载对话。';
  } finally {
    ui.loading = false;
    m.redraw();
  }
};

export const SessionsView = {
  /** @param {{ state: SessionsState }} vnode */
  oninit(vnode) {
    vnode.state.sessions = null;
    vnode.state.loading = true;
    vnode.state.error = null;
    loadList(vnode.state);
  },

  /**
   * @param {{
   *   attrs: { state: { session?: { sessionId?: string } | null }, onNavigateToChat?: () => void },
   *   state: SessionsState,
   * }} vnode
   */
  view: ({ attrs: { state, onNavigateToChat }, state: ui }) => {
    const activeSessionId = state.session?.sessionId ?? null;
    const visible = (ui.sessions ?? []).filter((s) => !s.archived);

    // After switching/creating a chat, go to the chat view. The side panel is
    // routed (m.route → /chat); the home SPA isn't, so it passes a callback that
    // flips its activeView. why a param, not a host probe: keeps this component
    // pure + host-agnostic — it's mounted in BOTH surfaces now.
    const goToChat = onNavigateToChat || (() => m.route.set('/chat'));

    const newChat = async () => {
      await send({ type: 'session/reset' });
      goToChat();
    };

    return m('.sessions-view', [
      m('.sessions-toolbar', [
        m('h2', '对话'),
        m('.spacer'),
        m('button', { onclick: newChat }, '+ 新对话'),
      ]),

      ui.loading
        ? m('.placeholder', '加载中…')
        : ui.error
        ? m('.placeholder', m('p.error', ui.error))
        : visible.length === 0
        ? m('.placeholder', m('div', [
            m('p', '还没有对话。'),
            m('p.muted', '开始你的第一次对话。'),
            m('button', { onclick: newChat }, '新对话'),
          ]))
        : m('ul.sessions-list', visible.map((s) =>
            m(SessionRow, {
              key: s.sessionId,
              session: s,
              active: s.sessionId === activeSessionId,
              onSwitch: async () => {
                await send({ type: 'session/switch', sessionId: s.sessionId });
                goToChat();
              },
              onArchive: async () => {
                await send({ type: 'session/archive', sessionId: s.sessionId });
                await loadList(ui);
              },
            })
          )),
    ]);
  },
};

const SessionRow = {
  /**
   * @param {{ attrs: {
   *   session: SessionSummary,
   *   active: boolean,
   *   onSwitch: () => void,
   *   onArchive: () => void,
   * } }} vnode
   */
  view: ({ attrs: { session, active, onSwitch, onArchive } }) => {
    const title = session.title ?? '未命名对话';
    return m(`li.session-row${active ? '.active' : ''}`, [
      m('button.session-main', { onclick: onSwitch }, [
        m('.session-title', title),
        m('.session-meta', [
          m('span', formatRelative(session.lastMessageAt)),
          m('span', '·'),
          m('span', `${session.messageCount} 条消息`),
          session.model ? [m('span', '·'), m('code', session.model)] : null,
          // /system presence badge — monochrome chip; the instructions
          // themselves are viewable in-chat via the /system command.
          session.hasCustomSystemPrompt ? [
            m('span', '·'),
            m('span.session-sys-badge', {
              title: '此对话有自定义会话指令 (/system)',
            }, '/system'),
          ] : null,
          // /tools manifest badge — same monochrome chip; the label says
          // WHICH manifest ('research', 'custom (3 tools)').
          session.toolManifestLabel ? [
            m('span', '·'),
            m('span.session-sys-badge', {
              title: `此对话暴露了缩减的工具集 (/tools ${session.toolManifestLabel})`,
            }, `/tools ${session.toolManifestLabel}`),
          ] : null,
        ]),
      ]),
      m('button.session-archive', {
        title: '归档',
        onclick: (/** @type {Event} */ e) => { e.stopPropagation(); onArchive(); },
      }, '×'),
    ]);
  },
};

/** @param {number} when ms since epoch */
const formatRelative = (when) => {
  const diffMs = Date.now() - when;
  const secs = Math.round(diffMs / 1000);
  if (secs < 60) return '刚刚';
  const mins = Math.round(secs / 60);
  if (mins < 60) return `${mins} 分钟前`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours} 小时前`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days} 天前`;
  return new Date(when).toLocaleDateString();
};
