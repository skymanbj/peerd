// @ts-check
// Options → Behavior — how the agent acts.
//
// Rebuilt on the settings ROW (P1 of the UI redesign). What changed is the
// reading, not the settings: every control that was here is still here, on the
// same route, with the same guards. What moved is where the words live — each
// row now states WHERE YOU STAND in one present-tense line, and the long
// rationale that used to BE the block collapses behind "Why this matters".
//
// Three bands, because eleven equal-weight blocks made a safety guard look like
// a diagnostic toggle. Only SAFETY is raised and ruled (options.css) — a user
// skimming for "what can peerd do to me" should find those four without reading
// a word of copy.
//
// The rationale text below is the SHIPPED prose, moved rather than rewritten: it
// is the part that took real thought, and paraphrasing it during a visual
// redesign is how a page quietly starts lying about its own guarantees.

import m from '/vendor/mithril/mithril.js';
import { listProviders } from '/peerd-provider/index.js';
import { resetRow } from './reset-row.js';
import { settingsRow, settingsBand, toggleSwitch } from '../components/settings-row.js';

/** @typedef {import('./reset-row.js').Send} Send */

export const BehaviorSection = {
  /** @param {{ attrs: { state: any, send: Send }, state: any }} vnode */
  view: ({ attrs: { state, send }, state: ui }) => {
    const s = state.settings ?? {};
    // Which rationales are open. Per-row, remembered while the page is mounted
    // and never persisted — a disclosure is a reading aid, not a preference.
    if (!ui.why) ui.why = new Set();
    const whyOpen = (/** @type {string} */ id) => ui.why.has(id);
    const toggleWhy = (/** @type {string} */ id) => () => {
      if (ui.why.has(id)) ui.why.delete(id); else ui.why.add(id);
      m.redraw();
    };

    /**
     * A row whose control is a switch. Holds the busy-flag dance in ONE place:
     * it was copy-pasted eight times, and a missed `finally` in any copy is a
     * control stuck spinning forever.
     * @param {{ id: string, label: string, on: boolean, busyKey: string,
     *   summary: string, why: string, apply: () => Promise<any>,
     *   badge?: string | null, children?: any }} p
     */
    const toggleRow = ({ id, label, on, busyKey, summary, why, apply, badge = null, children = null }) => {
      const busy = !!ui[busyKey];
      return settingsRow({
        id,
        label,
        pill: busy ? '…' : on ? '开' : '关',
        badge,
        summary: busy ? '保存中…' : summary,
        why,
        open: whyOpen(id),
        onToggleWhy: toggleWhy(id),
        control: toggleSwitch({
          on,
          busy,
          label: `${label} — ${on ? '开' : '关'}`,
          onclick: async () => {
            if (ui[busyKey]) return;
            ui[busyKey] = true; m.redraw();
            try { await apply(); } catch (e) { console.warn(`[options] ${id} toggle failed`, e); }
            finally { ui[busyKey] = false; m.redraw(); }
          },
        }),
        children,
      });
    };

    // ── Safety — changes what peerd MAY DO ───────────────────────────────────
    const confirmsOn = state.session?.permission?.confirmActions === true;
    const webWritesOn = s.confirmWebWrites !== false;
    const schemaOn = s.schemaValidatedReplies === true;
    const hasDebugger = !!globalThis.chrome?.debugger;
    const aaOn = s.advancedAutomationEnabled !== false;

    const safetyRows = [
      toggleRow({
        id: 'confirm-actions',
        label: '操作前确认',
        on: confirmsOn,
        busyKey: 'confirmBusy',
        summary: confirmsOn
          ? 'peerd 在每次副作用操作前会询问 — 点击、输入、导航、运行代码、拉取、写入。'
          : 'peerd 不经询问即点击、输入和导航。内存写入始终需要确认。',
        why: confirmsOn
          ? 'ON — peerd 在每次副作用操作（点击、输入、导航、运行代码、拉取、写入）前会询问您。确认提示会显示在 peerd 面板中，对话旁边。'
          : 'OFF — peerd 不经询问即执行（点击、输入、导航、运行代码和编辑）。这是默认设置：对实时标签页、笔记本或 WebVM 执行操作就是它的意义。内存写入始终需要确认。',
        // why permission/set, not settings/update: mode (Plan/Act) is the
        // ModeSelector's axis, and this toggle must not yank a user out of Plan
        // as a side effect.
        apply: () => send({ type: 'permission/set', confirmActions: !confirmsOn }),
      }),

      settingsRow({
        id: 'web-writes',
        label: '确认发送数据前询问',
        pill: ui.webWriteBusy ? '…' : webWritesOn ? '开' : '关',
        summary: ui.webWriteBusy ? '保存中…' : webWritesOn
          ? '在可能将数据带出浏览器的任何请求前询问。'
          : 'peerd 可以不经询问向任何非拒绝列表主机发送 POST、PUT 和 DELETE。不推荐。',
        why: webWritesOn
          ? 'ON — peerd 在任何可以将 BODY 发送出浏览器的请求（POST/PUT/PATCH/DELETE/OPTIONS）前会询问您 — 无论是网络参与者的 fetch 还是 WebVM 内部（curl 等）。您可以批准单次写入或该对话的所有写入。这是防止提示注入代理通过写入窃取数据的主要防线。（纯读取 — GET/HEAD — 从不受限；拒绝列表是那里的防护。）'
          : 'OFF — peerd 可以不经询问向任何非拒绝列表主机发送 POST/PUT/DELETE 请求，包括在提示注入下。拒绝列表仍会阻止已知敏感站点，但其余所有内容都是开放的。不推荐。',
        open: whyOpen('web-writes'),
        onToggleWhy: toggleWhy('web-writes'),
        control: toggleSwitch({
          on: webWritesOn,
          busy: !!ui.webWriteBusy,
          label: `确认发送数据前询问 — ${webWritesOn ? '开' : '关'}`,
          onclick: async () => {
            if (ui.webWriteBusy) return;
            // Turning it OFF stays a deliberate, risk-acknowledged choice. The
            // shipped dialogue is preserved VERBATIM — it is the reason this row
            // is a switch with a ceremony rather than a plain switch.
            if (webWritesOn && !window.confirm(
              '关闭写入确认？\n\n'
              + '代理将能够不经询问向任何 '
              + '非拒绝列表主机发送数据（POST/PUT/DELETE） — 包括网页或 '
              + '工具输出劫持它的情况（提示注入）。这是防止 '
              + '静默数据窃取的主要防线。\n\n仍要关闭？')) {
              return;
            }
            ui.webWriteBusy = true; m.redraw();
            try {
              await send({ type: 'settings/update', patch: { confirmWebWrites: !webWritesOn } });
            } finally { ui.webWriteBusy = false; m.redraw(); }
          },
        }),
      }),

      toggleRow({
        id: 'schema-replies',
        label: '严格校验 web 助手的回复',
        on: schemaOn,
        busyKey: 'schemaReplyBusy',
        badge: '实验',
        summary: schemaOn
          ? '助手的报告必须符合固定结构；不符合的会被丢弃。'
          : '助手的报告以散文形式返回，标记为不可信 — 是提示，而非壁垒。',
        why: schemaOn
          ? 'ON — 当 web 助手读完一个页面后，它必须以固定结构交回报告，peerd 会在主代理看到之前检查它。不符合的报告会被丢弃，代理只会被告知它不可读。这堵上了页面通过模仿“这是数据，不是指令”的围栏来偷带文本的漏洞。代价是：如果模型偏离格式，你就会丢失该报告并需要重新询问。'
          : 'OFF — web 助手以纯散文形式报告，标记为不可信数据。这种标记对模型是强烈的提示，而非壁垒。开启后会使其成为壁垒，代价是偶尔丢失模型格式错误的报告。实验性。',
        apply: () => send({ type: 'settings/update', patch: { schemaValidatedReplies: !schemaOn } }),
      }),

      // Firefox has no chrome.debugger WebExtension API (the build strips the
      // permission from Firefox manifests) — render the truth instead of a
      // switch that can't do anything.
      hasDebugger
        ? toggleRow({
          id: 'advanced-automation',
          label: '高级自动化',
          on: aaOn,
          busyKey: 'debuggerBusy',
          summary: aaOn
            ? 'peerd 可以驱动阻止脚本的应用 — Gmail、Notion、Slack。Chrome 会显示调试横幅。'
            : '阻止注入自动化的应用保持无法驱动，页面读取会走较慢的路径。',
          why: aaOn
            ? '开。peerd 可以使用 Chrome 调试器驱动阻止注入脚本的应用（Gmail、Notion、Slack）。Chrome 会在 peerd 连接到标签页进行自动化时显示“正在调试此浏览器”横幅；该连接可在操作之间持续存在，直到标签页关闭或您关闭此功能。peerd 无论如何都不会触碰其内置拒绝列表中的站点（银行、健康、密码管理器）。'
            : '关。某些应用（Gmail、Notion、Slack）阻止注入自动化，页面读取会回退到较慢的路径。开启后 peerd 可通过 Chrome 调试器对其进行操作，调试器连接到标签页时会显示可见的“正在调试此浏览器”横幅。拒绝列表始终适用。',
          apply: () => send({ type: 'settings/update', patch: { advancedAutomationEnabled: !aaOn } }),
        })
        : settingsRow({
          id: 'advanced-automation',
          label: '高级自动化',
          pill: '不适用',
          summary: '在此浏览器中不可用 — Firefox 没有 Chrome 调试器 API。',
          why: 'Chrome 调试器 API 在 Firefox WebExtensions 中不存在。peerd 在这里读取页面并使用基于选择器的点击/输入；阻止注入脚本的应用（Gmail、Notion、Slack）可能无法驱动。',
          open: whyOpen('advanced-automation'),
          onToggleWhy: toggleWhy('advanced-automation'),
          control: toggleSwitch({
            on: false,
            disabled: true,
            label: '高级自动化 — 在此浏览器中不可用',
            onclick: () => {},
          }),
        }),
    ];

    // ── Behavior — changes how it works, not what it may do ─────────────────
    const frontDoor = s.frontDoorView === 'home' ? 'home' : 'panel';
    const reasoningEnabled = s.reasoningEnabled !== false;
    const effort = s.reasoningEffort ?? 'medium';
    const arOn = s.autoResumeInterruptedTurns !== false;
    const foOn = s.providerFailoverEnabled !== false;
    const activeProvider = s.providerName || 'anthropic';
    const fallbacks = Array.isArray(s.providerFallbacks) ? s.providerFallbacks : [];
    const otherProviders = listProviders().map((p) => p.name).filter((n) => n !== activeProvider);

    // Preview-only key: absent from store packages' CHANNEL_DEFAULTS, so the
    // row simply doesn't render there. Presence, not typeof: a crafted
    // transfer import can store a non-boolean verbatim, and that must not
    // hide the row on a preview build (the toggle itself heals the value).
    const autoUpdateAvailable = Object.hasOwn(s, 'autoUpdateEnabled');
    const auOn = s.autoUpdateEnabled === true;

    const behaviorRows = [
      settingsRow({
        id: 'front-door',
        label: '工具栏按钮',
        summary: frontDoor === 'panel'
          ? '在侧边面板中打开对话，位于你当前页面的旁边。'
          : '打开整页的主页标签页。主页打开后，按钮会改为拉出面板。',
        why: '键盘快捷键（Mac 上为 Cmd+Shift+P，其他平台为 Alt+Shift+P）始终切换侧边面板，无论你选择哪个默认项。',
        open: whyOpen('front-door'),
        onToggleWhy: toggleWhy('front-door'),
        control: m('select.set-select', {
          id: 'front-door-view',
          'aria-label': '工具栏按钮打开的内容',
          value: frontDoor,
          onchange: async (/** @type {{ target: HTMLSelectElement }} */ e) => {
            await send({ type: 'settings/update', patch: { frontDoorView: e.target.value } });
            m.redraw();
          },
        }, [['panel', '侧边面板'], ['home', '整页主页']]
          .map(([value, label]) => m('option', { value }, label))),
      }),

      toggleRow({
        id: 'reasoning',
        label: '推理',
        on: reasoningEnabled,
        busyKey: 'reasoningBusy',
        summary: reasoningEnabled
          ? `在每次回复上方显示模型的思考过程。力度：${effort}。`
          : '答案直接流式输出，没有可见的推理过程。',
        why: reasoningEnabled
          ? '模型在每次回答前流式输出其推理链，显示为对话中可折叠的“推理”部分。每轮会消耗一些额外的延迟和令牌。'
          : '答案直接流式输出，没有可见的推理过程。启用后可在每次回复上方显示模型的推理链（扩展思维） — 有助于观察代理规划多步骤工作。',
        apply: () => send({ type: 'settings/update', patch: { reasoningEnabled: !reasoningEnabled } }),
        // Effort is a CHILD: it only means anything while reasoning is on.
        // Collapsing hides it and never discards the stored value. ALL FIVE
        // levels stay — the redesign never specified this control's option set,
        // and quietly dropping two would remove capability under cover of a
        // visual change.
        children: reasoningEnabled ? [
          m('.input-row', [
            m('label', { for: 'reasoning-effort' }, '推理力度'),
            m('select', {
              id: 'reasoning-effort',
              value: effort,
              onchange: async (/** @type {{ target: HTMLSelectElement }} */ e) => {
                await send({ type: 'settings/update', patch: { reasoningEffort: e.target.value } });
                m.redraw();
              },
            }, [
              ['max', '最高 — 最深入'],
              ['xhigh', '极高'],
              ['high', '高'],
              ['medium', '中等 — 默认'],
              ['low', '低 — 最快速'],
            ].map(([value, label]) => m('option', { value }, label))),
          ]),
          m('p.hint', '较低的力度 = 较少的前置推理和更早的行动；最深入的力度适合困难任务。仅限 Anthropic 对话 — OpenRouter/Ollama 尚不支持。'),
        ] : null,
      }),

      toggleRow({
        id: 'auto-resume',
        label: '自动恢复中断的回合',
        on: arOn,
        busyKey: 'autoResumeBusy',
        summary: arOn
          ? '在进行中被中断的回合会在你重新打开对话时继续。你自己停止的回合永远不会恢复。'
          : '在进行中被中断的回合会保持冻结，直到你重新发送。',
        why: arOn
          ? '开。如果回合在进行中被中断 — 浏览器回收 peerd 的后台 worker，或模型流中断 — 重新打开对话（或解锁保险库）会从中断处继续。您自己停止的回合永远不会自动恢复。'
          : '关。中断的回合会保持冻结，直到您重新发送。开启后 peerd 会在您重新打开对话时自动恢复中断的回合。',
        apply: () => send({ type: 'settings/update', patch: { autoResumeInterruptedTurns: !arOn } }),
      }),

      ...(autoUpdateAvailable ? [toggleRow({
        id: 'auto-update',
        label: '预览更新检查',
        on: auOn,
        busyKey: 'autoUpdateBusy',
        badge: '预览',
        summary: auOn
          ? '启动时检查并应用或提供更新的预览版本。'
          : '预览更新会等待浏览器自身的定期检查。',
        why: auOn
          ? '开。启动时 peerd 会向浏览器请求发布源中更新的预览版本。在 Chrome 中，当没有对话处于回合中且没有 peerd 界面打开时更新会立即安装；否则会在下次浏览器重启时应用。在 Firefox 中，扩展无法触发自身更新，peerd 会显示“有可用更新”的提示和安装链接，Firefox 自身的每日扩展检查仍会自行安装它。'
          : '关。peerd 会停留在已安装的版本上，直到浏览器自身的定期更新检查获取到新的预览版本。开启后可在启动时检查并立即安装。',
        apply: () => send({ type: 'settings/update', patch: { autoUpdateEnabled: !auOn } }),
      })] : []),

      toggleRow({
        id: 'failover',
        label: '提供者故障转移',
        on: foOn,
        busyKey: 'failoverBusy',
        summary: foOn
          ? (fallbacks.length === 0
            ? '未选择备用，因此暂时不起作用。'
            : `当你的提供者持续不可用时回退到 ${fallbacks.join(', ')}。`)
          : '持续不可用的提供者会以错误结束回合。',
        why: foOn
          ? '开。当您的活跃提供者超过 peerd 的重试仍过载，或返回硬性使用限制（信用额用尽 / 超过限额）时，peerd 会切换到下方的备用提供者并继续回合 — 但仅在任何答案开始流式输出之前。每个备用使用其自己的密钥（或本地守护进程）和默认模型。未选择备用则无效。'
          : '关。保持不可用（或信用额用尽）的提供者会以错误结束回合。开启后选择一个或多个备用提供者，peerd 将切换并继续运行。',
        apply: () => send({ type: 'settings/update', patch: { providerFailoverEnabled: !foOn } }),
        // The fallback picker is only meaningful while failover is on.
        children: foOn ? m('div', [
          m('p.hint', otherProviders.length === 0
            ? '没有注册其他提供者可以故障转移。'
            : '备用提供者按您选择的顺序尝试。每个需要自己的 API 密钥（或运行中的守护进程）。'),
          ...otherProviders.map((name) => {
            const checked = fallbacks.includes(name);
            return m('label', { style: 'display:flex; gap:8px; align-items:center; margin:4px 0;' }, [
              m('input', {
                type: 'checkbox',
                checked,
                disabled: ui.fallbackBusy,
                onchange: async () => {
                  if (ui.fallbackBusy) return;
                  ui.fallbackBusy = true; m.redraw();
                  try {
                    await send({
                      type: 'settings/update',
                      patch: {
                        providerFallbacks: checked
                          ? fallbacks.filter((/** @type {string} */ n) => n !== name)
                          : [...fallbacks, name],
                      },
                    });
                  } finally { ui.fallbackBusy = false; m.redraw(); }
                },
              }),
              m('span', name + (checked ? ` (#${fallbacks.indexOf(name) + 1})` : '')),
            ]);
          }),
        ]) : null,
      }),
    ];

    // ── Experimental & diagnostics ───────────────────────────────────────────
    const pwOn = s.prewalkEnabled === true;
    const engOn = s.enginePrewalkEnabled === true;
    const surface = s.webActorActionSurface === 'code' ? 'code' : 'tools';
    const devMode = !!s.devMode;

    const experimentalRows = [
      toggleRow({
        id: 'prewalk',
        label: 'Prewalk',
        on: pwOn,
        busyKey: 'prewalkBusy',
        badge: '实验',
        summary: pwOn
          ? '目标运行在你的对话模型上规划，然后在更便宜的执行器上继续。'
          : '目标运行全程停留在你的对话模型上。开启可降低开销。',
        why: pwOn
          ? '开。目标运行在你的对话模型上开始规划阶段（探索 → 提交待办清单 → 首个操作），然后把实时上下文交给更便宜的执行器模型完成其余运行。开销下降；计划和进度仍在待办卡片中可见。'
          : '关。目标运行全程停留在你的对话模型上。开启后目标运行会在你的对话模型上规划，然后在首个操作落地后继续在更便宜的执行器模型上运行 — 相同上下文，更低开销。请先在主页 Lab 中做基准测试（基线 vs prewalk）。',
        apply: () => send({ type: 'settings/update', patch: { prewalkEnabled: !pwOn } }),
        children: m('div', [
          m('label', { style: 'display:flex; gap:8px; align-items:center; margin:2px 0 6px;' }, [
            m('input', {
              type: 'checkbox',
              checked: engOn,
              disabled: ui.enginePrewalkBusy,
              onchange: async () => {
                if (ui.enginePrewalkBusy) return;
                ui.enginePrewalkBusy = true; m.redraw();
                try {
                  await send({ type: 'settings/update', patch: { enginePrewalkEnabled: !engOn } });
                } finally { ui.enginePrewalkBusy = false; m.redraw(); }
              },
            }),
            m('span', '同时将 prewalk 应用于引擎参与者（VM / 笔记本 / 应用）'),
          ]),
          m('p.hint', engOn
            ? '开。VM/笔记本/应用参与者在你的对话模型上运行首回合，然后切换到下面的执行器 — 多回合引擎工作的成本更低。'
            : '首回合在你的对话模型上针对真实实例状态进行规划，其余交给更便宜的执行器。请先在主页 Lab 中做基准测试。'),
          (pwOn || engOn) ? [
            m('.input-row', [
              m('label', { for: 'prewalk-executor' }, '执行器模型'),
              m('input', {
                id: 'prewalk-executor',
                type: 'text',
                placeholder: '留空 = 提供者的快速默认模型（例如 Haiku）',
                value: s.prewalkExecutorModel ?? '',
                onchange: async (/** @type {{ target: HTMLInputElement }} */ e) => {
                  await send({ type: 'settings/update', patch: { prewalkExecutorModel: e.target.value } });
                  m.redraw();
                },
              }),
            ]),
            m('p.hint', '与对话使用同一提供者的模型 ID，由目标运行和引擎参与者 prewalk 共享。留空则使用提供者的快速默认模型 — 与 web 参与者所用的模型相同。'),
          ] : null,
        ]),
      }),

      settingsRow({
        id: 'surface',
        label: 'Web 参与者：操作面',
        badge: '模式',
        summary: surface === 'code'
          ? 'web 助手通过编写 JavaScript 驱动页面。两种方式的门控相同。'
          : '每个操作一次工具调用。两种方式的门控相同。',
        why: surface === 'code'
          ? '已选择 — web 参与者在密封的 worker 中针对 Playwright 风格的页面 API 编写简短 JavaScript。相同的页面工具、拒绝列表、确认和审计门控仍在其下运作。预览/开发版从此开始；不支持密封 worker 主机的浏览器会自动回退到工具调用。应用于下一个 web 参与者回合；正在进行的参与者会在其开始时所用的操作面上完成。'
          : '已选择 — web 参与者为每个页面操作（点击、输入、导航）发出一次工具调用。商店包从此开始，而代码操作面仍在收集现场证据。两种模式应用相同的门控。应用于下一个 web 参与者回合；正在进行的参与者会在其开始时所用的操作面上完成。',
        open: whyOpen('surface'),
        onToggleWhy: toggleWhy('surface'),
        control: m('select.set-select', {
          id: 'web-actor-surface',
          'aria-label': 'Web 参与者操作面',
          value: surface,
          onchange: async (/** @type {{ target: HTMLSelectElement }} */ e) => {
            await send({ type: 'settings/update', patch: { webActorActionSurface: e.target.value } });
            m.redraw();
          },
        }, [['tools', '工具调用'], ['code', '代码']]
          .map(([value, label]) => m('option', { value }, label))),
      }),

      toggleRow({
        id: 'dev-mode',
        label: '开发者模式',
        on: devMode,
        busyKey: 'devModeBusy',
        summary: devMode
          ? 'WebVM 包装器的安装和验证输出会在启动时显示在终端中。'
          : 'WebVM 包装器的安装和验证输出不会显示在终端中。',
        why: devMode
          ? '详细 VM 诊断已开启：包装器安装 + 验证输出会在 WebVM 终端启动时显示，标记往返时间会记录在启动日志中。您自己的命令不会被跟踪。在下次 WebVM 重置时生效。'
          : '在终端启动时显示 WebVM 包装器安装 + 验证输出，以及启动日志中的标记计时。当 curl/wget 包装器不工作且您需要查看原因时很有用。默认关闭 — 额外噪音。',
        apply: () => send({ type: 'settings/update', patch: { devMode: !devMode } }),
      }),
    ];

    return m('div', [
      settingsBand({
        name: '安全', subtitle: '改变 peerd 可以做什么', safety: true, rows: safetyRows,
      }),
      settingsBand({
        name: '行为', subtitle: '改变其工作方式，而非它能做什么', rows: behaviorRows,
      }),
      settingsBand({ name: '实验性与诊断', rows: experimentalRows }),

      resetRow(send, [
        'frontDoorView',
        'reasoningEnabled', 'reasoningEffort', 'confirmWebWrites', 'schemaValidatedReplies',
        'advancedAutomationEnabled', 'devMode',
        'autoResumeInterruptedTurns', 'autoUpdateEnabled',
        'providerFailoverEnabled', 'providerFallbacks',
        'prewalkEnabled', 'enginePrewalkEnabled', 'prewalkExecutorModel',
      ]),
    ]);
  },
};
