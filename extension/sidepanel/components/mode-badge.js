// @ts-check
// Plan/Act mode UI.
//
//   ModeSelector  — the PLAN/ACT permission selector (Feature 03). Plan =
//                   read-only; Act = writes allowed, with a single
//                   "Confirm actions" toggle controlling whether each
//                   non-read action asks first (the 2026-06-12 tier
//                   collapse — the old suggest/full-auto endpoints kept,
//                   the auto-edit middle removed). Interactive: clicking
//                   flips mode / the toggle mid-session via the SW.
//   EffortDial    — the reasoning-effort selector (Anthropic
//                   output_config.effort). Lives in the mode row by owner
//                   call: "act sooner vs think deeper" is a per-task dial,
//                   so it belongs where turns happen, not buried in
//                   Settings. Writes the GLOBAL settings.reasoningEffort
//                   (the same value the Settings page edits — one source
//                   of truth); the SW snapshots settings at turn start, so
//                   a change applies from the next message.

import m from '/vendor/mithril/mithril.js';

/**
 * Typed message sender — posts to the SW and resolves with its reply.
 * @typedef {(msg: object) => Promise<any>} Send
 */

const MODE_LABEL = { plan: '计划', act: '执行' };

/**
 * The Plan/Act control. A mode toggle (Plan ⇄ Act) plus a confirm-actions
 * toggle. Always visible in the top bar; reflects state.session.
 * permission and drives `permission/set` on change — the SAME route the
 * Settings "Confirm before actions" toggle uses, so there is exactly one
 * source of truth for the confirm setting. Keyboard-operable (native
 * buttons); honors prefers-reduced-motion via CSS (the pill transitions
 * are CSS-driven, gated globally in styles.css).
 *
 * attrs:
 *   permission { mode, confirmActions }  — current, from SW state
 *   send                                 — typed message sender returning a Promise
 */
export const ModeSelector = {
  /**
   * @param {{ attrs: {
   *   permission?: { mode?: string, confirmActions?: boolean } | null,
   *   send: Send,
   * } }} vnode
   */
  view: ({ attrs: { permission, send } }) => {
    const mode = permission?.mode === 'act' ? 'act' : 'plan';
    // why: fail toward "confirms on" in the RENDER too — if the SW state
    // hasn't arrived yet, show the cautious reading the policy would
    // actually enforce rather than promising autonomy.
    const confirms = permission?.confirmActions !== false;
    const isAct = mode === 'act';

    /** @param {string} next */
    const setMode = (next) => send({ type: 'permission/set', mode: next });
    /** @param {boolean} next */
    const setConfirm = (next) => send({ type: 'permission/set', confirmActions: next });

    return m('.planact', { role: 'group', 'aria-label': '代理权限模式' }, [
      // Mode toggle. Two buttons so the active one is obvious and each is
      // a real focus target; aria-pressed announces the state.
      m('.planact-modes', [
        m('button.planact-mode', {
          class: mode === 'plan' ? 'is-active' : '',
          'aria-pressed': String(mode === 'plan'),
          title: '计划 — 只读 + 导航。代理可以查看和加载 URL，但不能执行操作。',
          onclick: () => mode !== 'plan' && setMode('plan'),
        }, MODE_LABEL.plan),
        m('button.planact-mode', {
          class: mode === 'act' ? 'is-active' : '',
          'aria-pressed': String(mode === 'act'),
          title: '执行 — 允许写入。"确认"控制每个操作是否先询问。',
          onclick: () => mode !== 'act' && setMode('act'),
        }, MODE_LABEL.act),
      ]),
      // Confirm-actions toggle — only meaningful in Act (Plan blocks
      // instead of confirming). Rendered disabled in Plan so the layout
      // doesn't jump and the user sees the setting their Act will resume
      // in. Same state as the Settings "Confirm before actions" toggle.
      m('button.planact-confirm', {
        class: confirms ? 'is-on' : '',
        disabled: !isAct,
        'aria-pressed': String(confirms),
        title: !isAct
          ? '切换到执行模式以更改确认设置'
          : confirms
            ? '确认操作：开 — 每个非读取操作在运行前都会询问'
            : '确认操作：关 — 代理无需询问即可运行，直到你停止',
        onclick: () => setConfirm(!confirms),
      }, confirms ? '确认：开' : '确认：关'),
    ]);
  },
};

/**
 * Goal toggle. The mode-row entry point for goal mode (loop/goal-runner.js),
 * and — while a run is live — its STATE light. Three faces:
 *
 *   off      "Goal"           click arms the next message as a goal
 *   armed    "Goal: on"       click disarms (the send consumes the arm)
 *   running  "Goal · turn N"  the toggle STAYS lit for the whole run —
 *                             armed hands off to running when the run's
 *                             goal/state arrives, so launching a goal never
 *                             reads as the switch "turning itself off".
 *                             Click stops the run (same route as the
 *                             GoalBar's Stop).
 *
 * why sticky: the original one-shot arm untoggled on send, which read as
 * "did it even start?" — the control now mirrors the run's actual lifecycle
 * (owner direction 2026-07-15). Same pill family + accent as the planact
 * controls.
 *
 * attrs:
 *   armed     — whether the next send is armed to launch a goal run
 *   run       — this chat's live goal-run state (state.goalRuns[sid]) or null
 *   disabled  — no API key yet (the send it arms can't fire)
 *   onToggle  — flip handler; receives the next armed boolean
 *   onStop    — stop the live run (only consulted while running)
 */
export const GoalToggle = {
  /**
   * @param {{ attrs: {
   *   armed?: boolean,
   *   run?: { active?: boolean, iteration?: number } | null,
   *   disabled?: boolean,
   *   onToggle: (next: boolean) => void,
   *   onStop?: () => void,
   * } }} vnode
   */
  view: ({ attrs: { armed, run, disabled, onToggle, onStop } }) => {
    const running = !!run?.active;
    const on = running || !!armed;
    const label = running
      ? `目标 · 第 ${run?.iteration ?? '…'} 轮`
      : on ? '目标：开' : '目标';
    return m('button.goal-toggle', {
      class: [on ? 'is-on' : '', running ? 'is-running' : ''].filter(Boolean).join(' '),
      disabled: !!disabled && !running,
      'aria-pressed': String(on),
      // While running the click STOPS the run — put that in the accessible
      // name (the visible label is just "Goal · turn N"; aria-pressed alone
      // doesn't convey "clicking stops it").
      'aria-label': running ? `目标运行进行中，第 ${run?.iteration ?? ''} 轮 — 激活以停止` : undefined,
      title: running
        ? '此对话中有目标运行进行中 — 代理将持续执行轮次直到'
          + '完成。点击停止运行。'
        : on
          ? '目标已就绪 — 你的下一条消息将启动自主运行：代理'
            + '将持续执行轮次，无需逐个操作确认，直到'
            + '目标达成或你停止。点击取消就绪。'
          : '目标 — 就绪下一条消息作为自主目标运行：代理将持续'
            + '执行轮次，无需逐个操作确认，直到完成或你停止。',
      onclick: () => (running ? onStop?.() : onToggle(!on)),
    }, label);
  },
};

const EFFORT_LEVELS = ['low', 'medium', 'high', 'xhigh', 'max'];

/**
 * Reasoning-effort dial. A compact pill select matching the planact
 * controls; 'medium' is the build default (owner call 2026-06-12 — long
 * invisible deliberation reads as a hang in a browser harness; raise the
 * dial for hard tasks).
 *
 * attrs:
 *   settings  — current settings from SW state (reads reasoningEffort)
 *   send      — typed message sender returning a Promise
 */
export const EffortDial = {
  /**
   * @param {{ attrs: {
   *   settings?: { reasoningEffort?: string } | null,
   *   send: Send,
   * } }} vnode
   */
  view: ({ attrs: { settings, send } }) => {
    const effort = settings?.reasoningEffort;
    const current = effort !== undefined && EFFORT_LEVELS.includes(effort)
      ? effort
      : 'medium';
    return m('select.effort-dial', {
      'aria-label': '推理力度',
      title: '推理力度 — 代理在行动前思考多久。\n'
        + '低 = 更早可见行动；高 = 对困难任务更深入思考。\n'
        + '从下一条消息开始生效。',
      value: current,
      onchange: (/** @type {Event} */ e) => send({ type: 'settings/update',
        patch: { reasoningEffort: /** @type {HTMLSelectElement} */ (e.target).value } }),
    }, EFFORT_LEVELS.map((level) =>
      m('option', { value: level }, level === 'low' ? '力度：低' : level === 'medium' ? '力度：中' : level === 'high' ? '力度：高' : level === 'xhigh' ? '力度：极高' : '力度：最大')));
  },
};
