// @ts-check
// Top-level App component.
//
// Dispatches between views based on attrs.view (passed in from the
// router). All components are pure projections of attrs — no internal
// mutable state beyond UI-ephemeral concerns like "is this input
// focused" (which the DOM tracks for us anyway).

import m from '/vendor/mithril/mithril.js';
import { VaultGate } from './vault-gate.js';
import { ChatView } from './chat-view.js';
import { SessionsView } from './sessions-view.js';
import { ActorIsolationBanner } from './actor-isolation-banner.js';
import { openOptions } from '/shared/open-options.js';
import { openHome } from '/shared/open-home.js';
import { CHANNEL } from '/shared/channel-config.js';

/** @typedef {import('../chat-reducer.js').ChatState} ChatState */
/** @typedef {(msg: object) => Promise<any>} Send */
/** @typedef {Record<string, ((...args: any[]) => any) | undefined>} UiActions */

// Icon from the redesign mono-stroke set (sprite in sidepanel.html). why a
// helper: every chrome glyph is now one drawn symbol referenced by id, so the
// stroke inherits currentColor + theme for free and renders identically across
// platforms (the old unicode glyphs did not).
/** @param {string} name @param {number} [size] */
const icon = (name, size = 16) =>
  m('svg.ic', { width: size, height: size, viewBox: '0 0 24 24', 'aria-hidden': 'true' },
    m('use', { href: `#ic-${name}` }));

export const App = {
  /**
   * @param {{ attrs: {
   *   state: ChatState, send: Send, voiceManager: any,
   *   uiActions: UiActions, view: string, optionsActive: boolean,
   *   activeTabStatus?: 'none'|'unknown'|'web'|'protected_private'|'protected_sensitive',
   * } }} vnode
   */
  view: ({ attrs }) => {
    const { state, send, voiceManager, uiActions, view, optionsActive, activeTabStatus } = attrs;
    const unlocked = state.vault.initialized && !state.vault.locked;
    // First-run onboarding is a HOME-page blocker (home.js), not a side-panel
    // route — the panel is reached by popping it from an onboarded home.

    // why: ONE app-shell with a stable `.body` at position 1. The header
    // sits at position 0 and is `null` until unlocked — so the lock /
    // sign-up screen has no header logo at all (the big "manifest" hero
    // logo in the vault gate is the only brand mark there). When the
    // vault unlocks, the TopBar mounts FRESH, which makes its wordmark
    // type itself in with the same intro animation as the hero. Keeping
    // `.body` at a fixed position means the unlock transition patches it
    // in place instead of tearing it down and flashing.
    // Confirmation prompt overlay. Present only when confirmations are
    // enabled (Settings) AND a non-read action is waiting on the user.
    const confirm = unlocked && state.pendingConfirm
      ? m(ConfirmModal, { prompt: state.pendingConfirm, uiActions })
      : null;

    // Transient system notices (e.g. /init progress). Dismissible; no
    // animation so prefers-reduced-motion is respected by default.
    const notices = unlocked && state.notices?.length
      ? m(NoticeBar, { notices: state.notices, uiActions })
      : null;
    const actorIsolation = unlocked
      ? m(ActorIsolationBanner, { capability: state.capabilities?.actorExecution, send })
      : null;

    return m('div', { class: 'app-shell' }, [
      unlocked ? m(TopBar, { state, send, optionsActive }) : null,
      notices,
      actorIsolation,
      m('.body', unlocked
        ? [
            view === 'chat'   ? m(ChatView, { state, send, voiceManager, uiActions, surface: 'sidepanel', activeTabStatus })
            : view === 'chats'  ? m(SessionsView, { state, send })
            : m(PlaceholderView, { label: '未知视图' }),
          ]
        : m(VaultGate, { state, send })),
      confirm,
    ]);
  },
};

/**
 * Inline brand wordmark — five colored blocks matching peerd.ai. The
 * blocks abut (no gap); outer corners are rounded via CSS. The
 * letters are lowercase mono and inherit white from `.block`. Same
 * construction as the website's hero/nav wordmark, scaled down to
 * fit the side-panel top bar (22px blocks by default).
 *
 * `aria-label="peerd"` so screen readers announce the brand without
 * spelling out the per-letter spans.
 *
 * On first mount it plays the two-phase "manifest" intro from peerd.ai:
 * the letters type out left-to-right behind a terminal cursor, then the
 * blocks colorize. Pure CSS, runs once — the router now diffs the header in
 * place across /chat↔/chats (Root is one shared component), so this node is
 * never recreated on a tab switch and the intro doesn't replay.
 *
 * It also HANDS OFF to the options page: driven by the explicit
 * `optionsActive` state (is the options tab foregrounded), it plays a
 * reverse-order "self-delete" (`.wordmark--exit`) when you open Settings and
 * renders back in (`.wordmark--enter`) when you leave — so the brand appears
 * to shift to the full-tab page rather than be duplicated. A closure
 * component holds the phase so an unrelated redraw never restarts the
 * animation; only a real optionsActive transition does. Respects
 * prefers-reduced-motion (the CSS collapses every phase to the final state).
 */
const Wordmark = () => {
  /** @type {boolean|undefined} */
  let prevActive;          // undefined until the first view
  let phase = 'intro';     // intro | exit | enter | gone
  return {
    /** @param {{ attrs: { optionsActive?: boolean } }} vnode */
    view: ({ attrs }) => {
      const active = !!attrs.optionsActive;
      if (prevActive === undefined) phase = active ? 'gone' : 'intro';
      else if (active !== prevActive) phase = active ? 'exit' : 'enter';
      // else: unchanged since last redraw — keep phase so the CSS animation
      // for it isn't interrupted by an unrelated redraw.
      prevActive = active;
      return m(`.wordmark.wordmark--${phase}`, { 'aria-label': 'peerd', role: 'img' }, [
        m('.block.b-p',  'p'),
        m('.block.b-e',  'e'),
        m('.block.b-e2', 'e'),
        m('.block.b-r',  'r'),
        m('.block.b-d',  'd'),
        // Terminal cursor that leads the typing in phase 1, then fades out
        // before the colorize phase. Decorative — hidden from a11y tree.
        m('.wordmark-cursor', { 'aria-hidden': 'true' }),
      ]);
    },
  };
};

const TopBar = {
  /** @param {{ attrs: { state: ChatState, send: Send, optionsActive: boolean } }} vnode */
  view: ({ attrs: { state, send, optionsActive } }) => {
    const unlocked = state.vault.initialized && !state.vault.locked;
    return m('.topbar', [
      // Brand cluster: the preview badge sits inline to the RIGHT of the
      // wordmark, vertically centered (keeps the top bar thin). The hand-off
      // animation still drives both — the wordmark self-deletes and the
      // badge slides out together.
      m('.topbar-brand', [
        m(Wordmark, { optionsActive }),
        // Channel indicator (§12): the preview package wears a small badge so
        // nobody has to guess which peerd they're in ("why doesn't peerd
        // have the dweb" — because it's the store package). CHANNEL is a
        // build-time literal; this node is dead code in store artifacts.
        CHANNEL === 'preview'
          ? m('span.channel-badge', {
              class: optionsActive ? 'is-exiting' : '',
              title: 'peerd 预览版 — dweb 预览包',
            }, '预览')
          : null,
      ]),
      // Spacer BEFORE the actions: brand hugs the left edge, the action icons
      // right-align (owner call, 2026-06-12).
      m('.spacer'),
      unlocked ? m('.topbar-actions', [
        // Watch mode: bring the agent's tab to the foreground and follow it, so
        // you see the real page it's driving. Opt-in inverse of no-focus-steal;
        // active state + tooltip carry the meaning (the top bar is icon-only).
        m('button.icon', {
          class: state.settings?.watchAgentTab ? 'is-active' : '',
          'aria-label': '观察代理的标签页',
          title: state.settings?.watchAgentTab
            ? '正在观察代理的标签页 — 点击停止跟随'
            : '观察代理的标签页（将其置于前台并跟随）',
          'aria-pressed': state.settings?.watchAgentTab ? 'true' : 'false',
          onclick: () => send({ type: 'settings/update', patch: { watchAgentTab: !state.settings?.watchAgentTab } }),
        }, icon('target')),
        m('button.icon', {
          'aria-label': '对话列表',
          title: '对话列表',
          onclick: () => m.route.set(
            m.route.get() === '/chats' ? '/chat' : '/chats'),
        }, icon('menu')),
        m('button.icon', {
          'aria-label': '新对话',
          title: '新对话',
          onclick: async () => {
            await send({ type: 'session/reset' });
            m.route.set('/chat');
          },
        }, icon('plus')),
        // Home — opens the full-tab HOME page (a primary surface, distinct from
        // Settings; focus-or-create so it doesn't pile up duplicate tabs).
        m('button.icon', {
          'aria-label': '主页',
          title: '主页',
          onclick: () => openHome(),
        }, icon('home')),
        // why: settings + context (memory/activity/denylist/skills/hooks)
        // moved to the full-tab options page — the panel is the pure
        // conversation surface. One ⚙ replaces the old ▤/⚙ pair;
        // openOptions() focuses an existing options tab via
        // runtime.openOptionsPage rather than opening duplicates.
        // §5g: manual lock, back in the panel too - stepping away happens
        // wherever you are, and a lock you have to open another surface to
        // reach is a lock that doesn't get used. Same route as the Home
        // rail's; the SW pushes locked state and the panel flips to the gate.
        m('button.icon', {
          'aria-label': '锁定密码库',
          title: '锁定密码库',
          onclick: () => send({ type: 'vault/lock' }),
        }, icon('lock')),
        m('button.icon', {
          'aria-label': '设置',
          title: '设置',
          onclick: () => openOptions(),
        }, icon('set')),
        // Close the panel. The toolbar action OPENS peerd (the side panel by
        // default, or Home via the frontDoorView setting) — only Chrome's
        // native action-click toggle ever closes it — so the panel keeps its
        // own dismiss; this reuses the SW's sidepanel/close (disable+re-arm;
        // Chrome-only, no-op on Firefox's sidebar).
        m('button.icon', {
          'aria-label': '关闭面板',
          title: '关闭面板',
          onclick: () => send({ type: 'sidepanel/close' }),
        }, icon('x')),
      ]) : null,
    ]);
  },
};

const PlaceholderView = {
  /** @param {{ attrs: { label: string } }} vnode */
  view: ({ attrs: { label } }) => m('.placeholder', `${label} — 即将推出`),
};

// Transient system-notice banner (e.g. /init progress). Each notice is
// dismissible. role=status + aria-live=polite so a screen reader
// announces it without stealing focus. No transition — reduced-motion
// safe by construction.
// Exported so the full-page home renders the SAME system-notice bar (DESIGN-12
// equality) — /init progress and the grant-debugger nudge must be visible
// wherever the user is, not just the side panel.
/**
 * @typedef {{ id: number, text?: string, action?: { kind?: string, label?: string, url?: string } | null }} Notice
 */

export const NoticeBar = {
  /** @param {{ attrs: { notices?: Notice[], uiActions?: UiActions } }} vnode */
  view: ({ attrs: { notices, uiActions } }) => {
    // open-tab notices render as a PROMINENT card in the chat (chat-view's
    // OpenTabCards), not this thin top bar — so skip them here. If nothing else
    // remains, render nothing (no empty bar).
    const visible = (notices ?? []).filter((n) => n.action?.kind !== 'open-tab');
    if (!visible.length) return null;
    return m('.notice-bar', { role: 'status', 'aria-live': 'polite' },
      visible.map((n) => m('.notice', { key: n.id }, [
        m('span.notice-text', n.text),
        // Optional one-click action (e.g. "Turn on advanced automation",
        // which flips the advancedAutomationEnabled setting — the debugger
        // permission itself is required at install; Chrome forbids
        // optional `debugger`).
        n.action?.kind === 'grant-debugger'
          ? m('button.notice-action', {
              type: 'button',
              onclick: () => uiActions?.requestDebugger?.(n.id),
            }, n.action.label ?? '启用')
          : null,
        // open-url: the SW attaches an https link (e.g. the preview
        // update's XPI - background/update-check.js). The click IS the user
        // gesture the target flow needs, so no SW round-trip: open the tab
        // from here. https only, checked again at render (defense in depth -
        // the SW already validates the feed's link).
        n.action?.kind === 'open-url' && n.action.url?.startsWith('https://')
          ? m('button.notice-action', {
              type: 'button',
              onclick: () => { window.open(n.action?.url, '_blank', 'noopener'); },
            }, n.action.label ?? '打开')
          : null,
        m('button.notice-dismiss', {
          type: 'button',
          'aria-label': '关闭通知',
          onclick: () => uiActions?.dismissNotice?.(n.id),
        }, '×'),
      ])));
  },
};

// Confirmation prompt. Shown when the Plan/Act policy decides a non-read
// action needs the user's approval (Act mode with confirmActions ON — any
// non-read action), OR for a persistent code or memory write (the always-on
// lethal-trifecta gates, which render the exact proposed contents). Three answers map to
// the ConfirmAnswer union the dispatcher expects: yes_once / yes_session
// / no. Reuses the .peerd-modal styling.
/** @type {Record<string, string>} */
const ACTION_CLASS_LABEL = {
  workspace_write: '工作区写入',
  shell: '代码执行',
  external: '外部副作用',
};

// The session button says WHAT a standing grant covers (UI redesign §4d): the
// noun comes from the action class the prompt already carries, and the scope
// line mirrors confirm-grant-key.js - origin present → the grant is bound to
// that origin; absent → it really does cover any site this chat touches. A
// user who reads "for session" as "for this site" approves once and stops
// being asked everywhere; the label was the only place to catch that.
/** @type {Readonly<Record<string, string>>} */
const ACTION_CLASS_GRANT_NOUN = Object.freeze({
  workspace_write: '写入',
  shell: '代码运行',
  external: '操作',
});
/** @param {ConfirmPrompt} prompt */
const sessionGrantNoun = (prompt) => (prompt.actionClass ? ACTION_CLASS_GRANT_NOUN[prompt.actionClass] : undefined)
  ?? (prompt.kind === 'web_write' ? '写入' : '操作');
/** @param {string[]} origins */
const sessionGrantScope = (origins) => `此对话，${origins.length ? '此站点' : '任意站点'}`;

/** @type {Readonly<Record<string, string>>} */
const SITE_AUTH_LABEL = Object.freeze({
  session: '观察到已登录的浏览器会话',
  bearer: '观察到令牌认证；此客户端不存储任何凭据',
  none: '未观察到认证',
  unknown: '无法确定认证方式',
});

/** @type {Readonly<Record<string, string>>} */
const SITE_DERIVER_LABEL = Object.freeze({
  probe: '通过探测站点学习',
  'capture-cdp': '从观察到的站点请求中学习',
  'capture-tap': '从观察到的站点请求中学习',
});

/**
 * The confirmation is the authority boundary, so opening it must move keyboard
 * and screen-reader attention into the dialog and keep it there until answered.
 * @param {(answer: string) => void} answer
 * @param {{ returnFocus?: HTMLElement | null }} state
 */
const confirmationDialogAttrs = (answer, state) => {
  /** @param {{ dom: Element }} vnode */
  const oncreate = ({ dom }) => {
    state.returnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const dialog = /** @type {HTMLElement} */ (dom);
    const reject = /** @type {HTMLElement | null} */ (dialog.querySelector('[data-confirm-reject]'));
    (reject ?? dialog).focus();
  };
  /** @param {KeyboardEvent} event */
  const onkeydown = (event) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      answer('no');
      return;
    }
    if (event.key !== 'Tab') return;
    const dialog = /** @type {HTMLElement} */ (event.currentTarget);
    const controls = /** @type {HTMLElement[]} */ ([...dialog.querySelectorAll('button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])')]);
    if (!controls.length) return;
    const first = controls[0];
    const last = controls[controls.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };
  return {
    role: 'dialog',
    'aria-modal': 'true',
    'aria-labelledby': 'peerd-confirm-title',
    tabindex: -1,
    oncreate,
    onkeydown,
    onremove: () => state.returnFocus?.focus(),
  };
};

/**
 * A pending confirmation prompt broadcast by the SW dispatcher.
 * @typedef {Object} ConfirmPrompt
 * @property {string} id
 * @property {string} [kind]
 * @property {{
 *   op: string, header?: string, addedLines?: number, removedLines?: number,
 *   body?: string, prevBody?: string, bodyBytesBefore?: number, bodyBytesAfter?: number,
 *   dossier?: { origin?: string, summary?: string, endpoints?: Array<{ method?: string, path?: string }>, auth?: string, deriver?: string },
 *   endpointDelta?: { added?: number, removed?: number },
 * }} [proposal]
 * @property {string} [actionClass]
 * @property {string} [sideEffect]
 * @property {string} [summary]
 * @property {string} [note]   why this call is being confirmed when the reason
 *   is something other than the ordinary Plan/Act policy, such as a UGC-zone
 *   override or a repeat after an unknown outcome. Plain prose, rendered verbatim.
 * @property {string} [lifecycleTarget] immutable target bound to an
 *   unknown-outcome repeat approval; never derived from the current live tab
 * @property {boolean} [oneShot] this approval cannot read or create a standing
 *   session grant; used for exact unknown-outcome repeats
 * @property {boolean} [ephemeral]  this answer cannot become a standing grant —
 *   DESIGN-17 downgrades an actor's yes_session to yes_once. Set by the SW so
 *   the card does not offer a button that would do nothing.
 * @property {string} [tool]
 * @property {string | null} [sessionId] exact execution session
 * @property {string | null} [ownerSessionId] root chat that owns the prompt
 * @property {string | null} [dispatchId] exact tool dispatch being approved
 * @property {string[]} [origins]
 * @property {'passkey'|'sso'} [method]   login only: the sign-in method the
 *   `login` tool derived from the page (ground truth, not a model argument).
 * @property {string | null} [provider]   login only: the SSO provider name for a
 *   'sso' method (e.g. 'Google'); null/absent for a passkey.
 * @property {boolean} [verified]   login only: the DESTINATION was proven a known
 *   IdP (an href/formAction host passing isKnownIdp). false for a recognized-name-
 *   only sso — the card must then NOT vouch for where the button leads.
 * @property {string | null} [idpOrigin] login only: the exact system-derived IdP
 *   origin authorized by a verified SSO confirmation.
 * @property {number} [raisedAt]  when the coordinator raised the prompt - the
 *   90s hint times against this so replayed prompts share the real deadline.
 */

/**
 * @typedef {Object} ConfirmModalState
 * @property {HTMLElement | null} [returnFocus]
 * @property {string} [hintPromptId]
 * @property {boolean} [showTimeoutHint]
 * @property {ReturnType<typeof setTimeout>} [timeoutHintTimer]
 */
// Exported so the full-page home renders the SAME permission prompt (DESIGN-12
// full equality) — a confirm broadcast must be answerable on whichever surface
// is open, not just the side panel.
// The 90-second hint (§4e): a quiet line before the 120s auto-deny - NOT a
// countdown, which would turn a security decision into a timed exam. Timed
// from raisedAt so a late-joining surface (replay) hints on the same clock.
// why armed per PROMPT ID, not oninit: the modal is mounted unkeyed and the
// reducer overwrites pendingConfirm in place, so a second prompt can replace
// the first without a remount - it must get its own timer on its own clock,
// never inherit the previous prompt's.
/** @param {ConfirmModalState} state @param {ConfirmPrompt} prompt */
const armTimeoutHint = (state, prompt) => {
  if (state.hintPromptId === prompt.id) return;
  state.hintPromptId = prompt.id;
  if (state.timeoutHintTimer) clearTimeout(state.timeoutHintTimer);
  const raisedAt = typeof prompt.raisedAt === 'number' ? prompt.raisedAt : Date.now();
  const delay = Math.max(0, raisedAt + 90_000 - Date.now());
  state.showTimeoutHint = delay === 0;
  state.timeoutHintTimer = setTimeout(() => {
    state.showTimeoutHint = true;
    m.redraw();
  }, delay);
};

export const ConfirmModal = {
  /** @param {{ state: ConfirmModalState }} vnode */
  onremove(vnode) {
    if (vnode.state.timeoutHintTimer) clearTimeout(vnode.state.timeoutHintTimer);
  },
  /** @param {{ attrs: { prompt: ConfirmPrompt, uiActions?: UiActions }, state: ConfirmModalState }} vnode */
  view: (vnode) => {
    const { prompt, uiActions } = vnode.attrs;
    const dialogState = /** @type {ConfirmModalState} */ (vnode.state);
    armTimeoutHint(dialogState, prompt);
    const timeoutHint = dialogState.showTimeoutHint
      ? m('p.muted.confirm-timeout-hint', { role: 'status' }, '未作答视为拒绝。')
      : null;
    /** @param {string} a */
    const answer = (a) => uiActions?.confirmAnswer?.(prompt, a);
    const origins = Array.isArray(prompt.origins) ? prompt.origins.filter(Boolean) : [];
    const lifecycleTarget = typeof prompt.lifecycleTarget === 'string'
      && prompt.lifecycleTarget.length > 0
      ? prompt.lifecycleTarget
      : null;

    // Login consent — its own render path, because a sign-in is the highest-stakes
    // confirm we show and it needs a distinctive, obvious card. The real origin is
    // the HERO (the anti-phishing anchor the user checks); the method/provider come
    // from the login tool's ground-truth classifier (never a model string), so the
    // card cannot be spoofed. No "Allow for session" — every login is fresh consent.
    if (prompt.kind === 'login') {
      const origin = origins[0] || '';
      let host = origin;
      try { host = new URL(origin).host || origin; } catch { /* malformed → show the raw origin */ }
      // The origin is the anti-phishing HERO — it must never be BLANK on an approvable
      // card. The tool guarantees an https origin, but the modal is shared, so guard
      // defensively: label a blank origin and DISABLE the primary action (nothing to
      // approve without a verified destination to name).
      const blankOrigin = !host;
      if (!host) host = '未验证的站点';
      const isPasskey = prompt.method === 'passkey';
      const provider = prompt.provider ? String(prompt.provider) : '';
      // An UNVERIFIED sso: peerd took origin-named consent but could NOT prove the
      // button leads to a known IdP. Soften the copy — keep the origin hero, but do
      // not vouch for the destination.
      const unverified = prompt.method === 'sso' && prompt.verified === false;
      const idpOrigin = prompt.method === 'sso' && prompt.verified === true
        ? String(prompt.idpOrigin ?? '')
        : '';
      let idpHost = '';
      try { idpHost = new URL(idpOrigin).host; } catch { /* malformed means no approvable verified destination */ }
      const missingVerifiedDestination = prompt.method === 'sso' && prompt.verified === true && !idpHost;
      return m('.peerd-modal-backdrop', [
        m('.peerd-modal.confirm-modal.login-modal', confirmationDialogAttrs(answer, dialogState), [
          m('h3#peerd-confirm-title', '批准登录'),
          m('.login-hero', [
            m('.badge', icon('lock', 18)),
            m('.ht', [
              m('.scheme', 'peerd 正在为你登录'),
              m('.host', host),
            ]),
          ]),
          m('.login-method', [
            m('.mic', icon(isPasskey ? 'key' : 'globe', 15)),
            isPasskey
              ? '使用通行密钥继续'
              : unverified
                ? `使用 ${provider || '你的提供商'} 继续 — peerd 无法验证其指向`
                : `使用 ${provider || '你的提供商'} 继续`,
          ]),
          idpHost ? m('.login-destination', [
            m('span', '提供商页面'),
            m('strong', idpHost),
          ]) : null,
          m('.login-reassure', [
            m('.ok', icon('check', 15)),
            m('span', unverified
              ? `peerd 永远不会看到你的密码，且无法确认此按钮的目标 — 只有在你信任 ${host} 时才继续。登录由你自己完成。`
              : `peerd 永远不会看到你的密码。登录由你自己完成 — 使用你的设备${provider ? ` 或 ${provider}` : ''}。`),
          ]),
          timeoutHint,
          m('.peerd-modal-actions', [
            m('button.secondary', { type: 'button', 'data-confirm-reject': '', onclick: () => answer('no') }, '取消'),
            m('button', {
              type: 'button',
              disabled: blankOrigin || missingVerifiedDestination,
              onclick: () => { if (!blankOrigin && !missingVerifiedDestination) answer('yes_once'); },
            }, '允许登录'),
          ]),
        ]),
      ]);
    }
    // why: persistent writes render the exact proposed bytes so the user
    // approves the executable or remembered contents, not a summary of them.
    const isMemory = prompt.kind === 'memory_write' && prompt.proposal;
    const isSiteClient = prompt.kind === 'site_client_write' && prompt.proposal;
    // why non-null in either branch: both are only truthy when
    // prompt.proposal exists, so reads of `p` there are always defined.
    const p = /** @type {NonNullable<ConfirmPrompt['proposal']>} */ (prompt.proposal);
    // For non-memory prompts, prefer the Plan/Act policy's action class for
    // the wording; fall back to the raw sideEffect for older prompts.
    const kind = (prompt.actionClass ? ACTION_CLASS_LABEL[prompt.actionClass] : undefined)
      ?? (prompt.sideEffect === 'mutate_external' ? '外部副作用' : '页面');
    return m('.peerd-modal-backdrop', [
      m('.peerd-modal.confirm-modal', confirmationDialogAttrs(answer, dialogState), [
        m('h3#peerd-confirm-title', isMemory ? '确认记忆写入' : isSiteClient ? '确认站点客户端' : '确认操作'),
        isMemory
          ? [
              m('p.muted', { style: 'margin:0 0 8px;' },
                `代理要${p.op === 'delete' ? '删除' : '写入'} ${p.header} (+${p.addedLines}/−${p.removedLines} 行)。此内容将跨会话保留。`),
              // why: a scrollable, labelled preview of the body that will
              // be saved. Reduced-motion safe (no animation); plain pre.
              m('pre.confirm-summary',
                { style: 'max-height:240px; overflow:auto; white-space:pre-wrap;',
                  'aria-label': '建议的记忆内容' },
                p.op === 'delete' ? '(这将删除该文档)' : (p.body || '(空)')),
            ]
          : isSiteClient
            ? p.op === 'delete'
              ? [
                  m('p.muted', { style: 'margin:0 0 8px;' },
                    `代理要删除 ${p.dossier?.origin || origins[0] || '此站点'} 的已保存站点客户端。`),
                  m('pre.confirm-summary', { 'aria-label': '站点客户端删除' },
                    '(这将删除已保存的可运行模块和档案)'),
                ]
              : [
                  m('p.muted', { style: 'margin:0 0 8px;' },
                    p.op === 'update'
                      ? `代理要更新跨会话保留的可运行 JavaScript。端点变化 +${p.endpointDelta?.added ?? 0}/-${p.endpointDelta?.removed ?? 0}。`
                      : `代理要创建跨会话保留的可运行 JavaScript，声明了 ${p.dossier?.endpoints?.length ?? 0} 个端点。`),
                  m('.site-client-dossier', [
                    m('strong', '用途'),
                    m('p', p.dossier?.summary || '(未提供用途)'),
                    m('strong', '访问'),
                    m('p', `${SITE_AUTH_LABEL[p.dossier?.auth ?? ''] || '认证方式无法识别'}；${SITE_DERIVER_LABEL[p.dossier?.deriver ?? ''] || '学习方式无法识别'}`),
                    m('strong', '端点'),
                    m('pre.confirm-summary', { 'aria-label': '建议的站点客户端端点' },
                      p.dossier?.endpoints?.length
                        ? p.dossier.endpoints.map((endpoint) => `${endpoint.method || '?'} ${endpoint.path || '?'}`).join('\n')
                        : '(未声明端点)'),
                  ]),
                  p.op === 'update'
                    ? [
                        m('strong', '现有的可运行 JavaScript'),
                        m('pre.confirm-summary',
                          { style: 'max-height:160px; overflow:auto; white-space:pre-wrap;',
                            'aria-label': '现有的站点客户端代码' },
                          p.prevBody || '(空)'),
                      ]
                    : null,
                  m('strong', p.op === 'update' ? '建议的可运行 JavaScript' : '可运行 JavaScript'),
                  m('pre.confirm-summary',
                    { style: 'max-height:240px; overflow:auto; white-space:pre-wrap;',
                      'aria-label': '建议的站点客户端代码' },
                    p.body || '(空)'),
                ]
            : prompt.tool === 'a2a_contact' || prompt.tool === 'a2a_reply'
            ? [
                m('p.muted', { style: 'margin:0 0 8px;' },
                  prompt.tool === 'a2a_reply'
                    ? '你的 dweb 代理想要在网格上回复此对等节点，继续你们的对话。"本会话允许"将允许它在此线程上持续回复（可通过屏蔽对等节点来撤销）。'
                    : '你的 dweb 代理想要首次在网格上向此对等节点发送消息。"本会话允许"将将其添加为已批准的联系人（可通过屏蔽对等节点来撤销）。'),
              ]
            : [
              m('p.muted', { style: 'margin:0 0 8px;' },
                `代理要执行${kind}操作。`),
              // why: an optional one-sentence reason, shown only when the
              // confirm was forced by something OTHER than the ordinary
              // Plan/Act policy — today the #242 UGC-zone rule. It sits ABOVE
              // the call summary because it is the part the user has to weigh;
              // the summary is the detail. Absent → the card renders exactly as
              // it always has.
              prompt.note
                ? m('p.muted', { style: 'margin:0 0 8px;' }, prompt.note)
                : null,
              lifecycleTarget
                ? m('.lifecycle-confirm-target', {
                    'aria-label': '未知结果重复批准',
                  }, [
                    m('span', '确切目标'),
                    m('code', lifecycleTarget),
                    m('span', '操作'),
                    m('code', prompt.tool || '未知工具'),
                  ])
                : null,
              m('pre.confirm-summary', prompt.summary ?? prompt.tool),
            ],
        origins.length
          ? m('p.muted', { style: 'font-size:12px;' }, `作用于: ${origins.join(', ')}`)
          : null,
        // The absence is explained, not offered (§4d): when a helper raised the
        // prompt the session button is correctly hidden - but hidden SILENTLY,
        // the user cannot tell a missing option from a missing feature.
        // "content", not the design's "pages": ephemeral covers EVERY actor
        // kind - a Notebook or VM helper is steered by instance output, not
        // pages - and the sentence must stay true for all of them.
        prompt.ephemeral
          ? m('p.muted.confirm-ephemeral-note',
              '这是由助手发起的，而助手可能被其读取的内容操纵 — 因此只能批准一次。')
          : null,
        timeoutHint,
        m('.peerd-modal-actions', [
          m('button.secondary', { type: 'button', 'data-confirm-reject': '', onclick: () => answer('no') }, '拒绝'),
          // why prompt.ephemeral hides it rather than disabling it: an actor's
          // yes_session is downgraded to yes_once server-side (DESIGN-17 — an
          // actor can be steered by untrusted output across turns, so a standing
          // grant would silence the next prompt). Offering the button anyway
          // gives the user a control that reads as "stop asking me" and does
          // nothing — worse than not offering it, because they stop looking for
          // another way out. The quiet line above the actions says WHY it is
          // missing. a2a keeps the legacy label: its grant is peer-scoped and
          // the body copy explains it by that name. A oneShot lifecycle
          // confirm never offers a standing grant either.
          isMemory || isSiteClient || prompt.ephemeral || prompt.oneShot
            ? null
            : prompt.tool === 'a2a_contact' || prompt.tool === 'a2a_reply'
              ? m('button.secondary', { type: 'button', onclick: () => answer('yes_session') }, '本会话允许')
              : m('button.secondary.confirm-session-grant', { type: 'button', onclick: () => answer('yes_session') }, [
                  `允许所有${sessionGrantNoun(prompt)}`,
                  m('span.confirm-grant-scope', sessionGrantScope(origins)),
                ]),
          m('button', {
            type: 'button',
            class: prompt.oneShot ? 'lifecycle-confirm-allow' : '',
            onclick: () => answer('yes_once'),
          },
            isMemory ? '保存' : isSiteClient ? (p.op === 'delete' ? '删除客户端' : '保存客户端') : '仅本次允许'),
        ]),
      ]),
    ]);
  },
};
