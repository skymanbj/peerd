// @ts-check
// The Lab — the home page's model-testing bench. Pit two CONFIGS head-to-head on
// the same real web tasks (the actual agent loop, tools, and gates — not a mock).
//
// A config is a PAIR of models, because that's what actually runs a task:
//   • the MAIN model — the chat agent that plans + orchestrates
//   • the WEB ACTOR model — the actor that reads/acts on pages
// Both are configurable per side, so you can compare e.g. "cloud main + cloud
// web actor" vs "fully on-device (local main + local web actor)" — and the cost
// is honest: a fully-local config reads $0 total.
//
// Brand rule: monochrome; pass/fail by glyph (✓/✗) + the lone semantic red.
// The engine (eval/eval-engine.js) owns the SW port + run loop; this is the view.
//
// NB: a run takes over the agent session (session/reset) + drives a hidden window.

import m from '/vendor/mithril/mithril.js';
import browser from '/vendor/browser-polyfill.js';
import { openOptions } from '/shared/open-options.js';
import { t } from './locale.js';
import { createEvalEngine } from '../eval/eval-engine.js';
import { SUITES } from '../eval/tasks.js';

/** @typedef {import('../options/sections/reset-row.js').Send} Send */
/** @typedef {{ value: string, model: string, provider: string, providerLabel: string, label: string }} ModelOption */
/**
 * @typedef {object} EvalUi
 * @property {boolean} loaded
 * @property {string} warn
 * @property {boolean} running
 * @property {any} progress
 * @property {string} suiteId
 * @property {boolean} showTabs
 * @property {boolean} goalRuns
 * @property {boolean} showTasks
 * @property {string} mainA
 * @property {string} runnerA
 * @property {string} mainB
 * @property {string} runnerB
 * @property {ModelOption[]} allOptions
 * @property {ModelOption[]} cloudOptions
 * @property {string | null} localLabel
 * @property {any} ab
 * @property {any} single
 * @property {string[]} log
 */

// Module-level singleton: ONE SW port for the session; run state survives tab switches.
/** @type {any} */
let engine = null;
/** @type {EvalUi} */
const ui = {
  loaded: false, warn: '', running: false, progress: null,
  suiteId: 'simple', showTabs: false, goalRuns: false, showTasks: false,
  mainA: '', runnerA: '', mainB: '', runnerB: '',
  allOptions: [], cloudOptions: [], localLabel: null,
  ab: null, single: null, log: [],
};

/** @param {string} s */
const pushLog = (s) => { ui.log.push(s); if (ui.log.length > 240) ui.log = ui.log.slice(-240); m.redraw(); };
const ensureEngine = () => (engine ??= createEvalEngine({ browser, log: pushLog, onProgress: () => {} }));

// Main-model select values are 'provider::model' (from models/options); split them.
/** @param {string} val */
const parseMain = (val) => { const i = String(val).indexOf('::'); return i < 0 ? { provider: '', model: String(val) } : { provider: val.slice(0, i), model: val.slice(i + 2) }; };
/** @param {'A' | 'B'} side */
const configFor = (side) => {
  const { provider, model } = parseMain(side === 'A' ? ui.mainA : ui.mainB);
  return { mainProvider: provider, mainModel: model, runnerCfg: side === 'A' ? ui.runnerA : ui.runnerB, goal: ui.goalRuns };
};

async function loadModels() {
  const e = ensureEngine();
  const [opts, ls, ps] = await Promise.all([e.modelsOptions(), e.localStatus(), e.providerStatus()]);
  ui.allOptions = opts || [];                                                    // MAIN selects: every model (incl. local once downloaded)
  ui.cloudOptions = ui.allOptions.filter((o) => o.provider !== 'local-webgpu');  // RUNNER selects: cloud ids + the 'local' sentinel
  ui.localLabel = (ls?.available || ls?.downloaded) ? (ls.label || t('本地模型', 'Local model')) : null;
  const hasKey = Array.isArray(ps?.providers) ? ps.providers.some((/** @type {any} */ p) => p.hasKey) : !!ps?.providers?.hasKey;
  ui.warn = (!ps?.ok || !hasKey) ? t('未检测到提供者密钥（或保险库已锁定）。请在设置中添加密钥 + 解锁，然后重新打开实验室。', 'No provider key detected (or the vault is locked). Add a key + unlock in Settings, then reopen the Lab.') : '';
  // Defaults: A = a cloud pair (cloud main + the real WEB ACTOR default, Haiku); B =
  // on-device where possible (local main + local web actor) so the headline comparison
  // is cloud-vs-local.
  const firstCloud = ui.cloudOptions[0];
  const localMain = ui.allOptions.find((o) => o.provider === 'local-webgpu');
  // The web actor's TRUE default model is the active provider's defaultRunnerModel
  // (Haiku on OpenRouter/Anthropic) — resolved from provider/status, NOT a /haiku/
  // guess over the user's curated list. That id often isn't in the curated set (an
  // OR user commonly curates only their main model), so surface it as a selectable
  // option; otherwise the <select> falls back to GLM and misrepresents what runs.
  const providers = Array.isArray(ps?.providers) ? ps.providers : [];
  const activeProv = providers.find((/** @type {any} */ p) => p.name === firstCloud?.provider)
    ?? providers.find((/** @type {any} */ p) => p.hasKey && p.name !== 'local-webgpu');
  const webActorDefault = activeProv?.defaultRunnerModel || '';
  if (webActorDefault && !ui.cloudOptions.some((o) => o.model === webActorDefault)) {
    ui.cloudOptions = [
      { value: `${activeProv.name}::${webActorDefault}`, model: webActorDefault, provider: activeProv.name, providerLabel: activeProv.label ?? activeProv.name, label: `${webActorDefault} ${t('（网络参与者默认）', '(web actor default)')}` },
      ...ui.cloudOptions,
    ];
  }
  if (!ui.mainA) ui.mainA = firstCloud?.value ?? ui.allOptions[0]?.value ?? '';
  if (!ui.runnerA) ui.runnerA = webActorDefault || (ui.cloudOptions[0]?.model ?? '');
  if (!ui.mainB) ui.mainB = localMain?.value ?? ui.mainA;
  if (!ui.runnerB) ui.runnerB = ui.localLabel ? 'local' : (webActorDefault || ui.runnerA);
  ui.loaded = true;
  m.redraw();
}

const mainOptionEls = () => ui.allOptions.map((o) => m('option', { value: o.value }, `${o.providerLabel} · ${o.label}`));
const runnerOptionEls = () => [
  ...ui.cloudOptions.map((o) => m('option', { value: o.model }, `${o.providerLabel} · ${o.label}`)),
  ui.localLabel ? m('option', { value: 'local' }, `${t('本地', 'local')} · ${ui.localLabel}`) : null,
];

async function runAB() {
  if (ui.running) return;
  ui.running = true; ui.ab = null; ui.single = null; ui.log = []; ui.progress = null; m.redraw();
  try {
    ui.ab = await ensureEngine().runAB(configFor('A'), configFor('B'), ui.suiteId, ui.showTabs, (/** @type {any} */ p) => { ui.progress = p; m.redraw(); });
  } catch (e) { pushLog(`A/B aborted: ${/** @type {{ message?: string }} */ (e)?.message ?? e}`); }
  finally { ui.running = false; ui.progress = null; m.redraw(); }
}

async function runSingle() {
  if (ui.running) return;
  ui.running = true; ui.ab = null; ui.single = null; ui.log = []; ui.progress = null; m.redraw();
  try {
    ui.single = await ensureEngine().runOne(configFor('A'), ui.suiteId, ui.showTabs, (/** @type {any} */ p) => { ui.progress = p; m.redraw(); });
  } catch (err) { pushLog(`run aborted: ${/** @type {{ message?: string }} */ (err)?.message ?? err}`); }
  finally { ui.running = false; ui.progress = null; m.redraw(); }
}

// Baseline vs prewalk — the SAME config (side A's pair), both legs as goal
// runs; the only variable is the prewalk handoff. This is THE gate for
// flipping prewalkEnabled on by default: it must hold pass rate while
// cutting $ and time (compare stencil.so/blog/prewalk's receipts).
async function runPrewalkAB() {
  if (ui.running) return;
  ui.running = true; ui.ab = null; ui.single = null; ui.log = []; ui.progress = null; m.redraw();
  try {
    const base = { ...configFor('A'), goal: true };
    ui.ab = await ensureEngine().runAB(
      { ...base, prewalk: false },
      { ...base, prewalk: true },
      ui.suiteId, ui.showTabs,
      (/** @type {any} */ p) => { ui.progress = p; m.redraw(); },
    );
  } catch (e) { pushLog(`prewalk A/B aborted: ${/** @type {{ message?: string }} */ (e)?.message ?? e}`); }
  finally { ui.running = false; ui.progress = null; m.redraw(); }
}

// Engine-actor A/B — side A's config, both legs NORMAL turns (not goal), on the
// engine-actor suite; the only variable is enginePrewalk. The gate for flipping
// enginePrewalkEnabled on: pass rate holds while runner-$ (the engine actor's
// spend) drops. Forces the engine-actor suite so there's multi-turn actor work
// to swap on.
async function runEnginePrewalkAB() {
  if (ui.running) return;
  ui.running = true; ui.ab = null; ui.single = null; ui.log = []; ui.progress = null;
  const suiteId = 'engine-actor';
  m.redraw();
  try {
    // Force normal turns (not goal) whatever the 'goal runs' checkbox says — this
    // A/B isolates the engine-actor swap on plain message_actor turns, per the
    // contract note above. (runPrewalkAB is the goal-run counterpart.)
    const base = { ...configFor('A'), goal: false };
    ui.ab = await ensureEngine().runAB(
      { ...base, enginePrewalk: false },
      { ...base, enginePrewalk: true },
      suiteId, ui.showTabs,
      (/** @type {any} */ p) => { ui.progress = p; m.redraw(); },
    );
  } catch (e) { pushLog(`engine-actor A/B aborted: ${/** @type {{ message?: string }} */ (e)?.message ?? e}`); }
  finally { ui.running = false; ui.progress = null; m.redraw(); }
}

/** @param {number} ms */
const secs = (ms) => `${(ms / 1000).toFixed(1)}s`;
/** @param {number} [n] */
const usd = (n) => `$${(n ?? 0).toFixed(5)}`;
/** @param {number} [n] */
const runnerUsd = (n) => ((n ?? 0) > 0 ? usd(n) : t('免费', 'free')); // local runner reads "free"
/** @param {string} id */
const shortModel = (id) => String(id).replace(/^[a-z-]+\//, '').replace(/-\d{8}$/, ''); // strip provider/ + date
/** @param {{ mainModel: string, runnerCfg: string, goal?: boolean, prewalk?: boolean, enginePrewalk?: boolean }} cfg */
const pairLabel = (cfg) => `${shortModel(cfg.mainModel)} / ${cfg.runnerCfg === 'local' ? t('本地', 'local') : shortModel(cfg.runnerCfg)}`
  + `${cfg.goal ? ` · ${t('目标', 'goal')}` : ''}${cfg.prewalk ? ` · ${t('预走', 'prewalk')}` : ''}${cfg.enginePrewalk ? ` · ${t('引擎预走', 'engine-prewalk')}` : ''}`;

/** @param {{ a: any, b: any, delta: any }} result */
function abBoard({ a, b, delta }) {
  /**
   * @param {string} label
   * @param {string | number} av
   * @param {string | number} bv
   * @param {string} [dv]
   */
  const row = (label, av, bv, dv) => m('.eval-row', [
    m('.eval-cell.lab', label), m('.eval-cell', String(av)), m('.eval-cell', String(bv)), m('.eval-cell.delta', dv ?? ''),
  ]);
  return m('.eval-board', [
    m('.eval-row.head', [m('.eval-cell.lab', t('主模型 / 运行器', 'main / runner')), m('.eval-cell', `A · ${pairLabel(a.config)}`), m('.eval-cell', `B · ${pairLabel(b.config)}`), m('.eval-cell.delta', 'Δ')]),
    row(t('通过率', 'pass rate'), `${a.card.passRate}% (${a.card.passed}/${a.card.total})`, `${b.card.passRate}% (${b.card.passed}/${b.card.total})`, `${delta.passRateDelta >= 0 ? '+' : ''}${delta.passRateDelta}%`),
    row(t('平均延迟', 'avg latency'), secs(a.card.avgDurationMs), secs(b.card.avgDurationMs)),
    row(t('运行器令牌', 'runner tokens'), a.card.avgRunnerTokens, b.card.avgRunnerTokens),
    row(t('运行器 $/任务', 'runner $/task'), runnerUsd(a.card.avgRunnerCostUsd), runnerUsd(b.card.avgRunnerCostUsd)),
    row(t('主模型 $/任务', 'main $/task'), usd(a.card.avgCostUsd), usd(b.card.avgCostUsd)),
    row(t('总计 $/任务', 'total $/task'), usd(a.card.avgTotalCostUsd), usd(b.card.avgTotalCostUsd)),
    delta.regressions.length
      ? m('p.error.eval-verdict', `${t('B 未通过（A 通过）：', 'B failed these (A passed): ')}${delta.regressions.join(', ')}`)
      : m('p.eval-ok.eval-verdict', t('✓ B 在 A 通过的每个任务上与 A 匹配', '✓ B matched A on every task A passed')),
    delta.fixes.length ? m('p.muted.eval-verdict', `${t('B 修复（A 失败）：', 'B fixed (A had failed): ')}${delta.fixes.join(', ')}`) : null,
  ]);
}

/** @param {{ config: any, card: any }} result */
function singleBoard({ config, card }) {
  return m('.eval-board', [
    m('.eval-row.head', [m('.eval-cell.lab', pairLabel(config)), m('.eval-cell', `${card.passRate}% (${card.passed}/${card.total})`), m('.eval-cell', secs(card.avgDurationMs)), m('.eval-cell.delta', '')]),
    m('p.muted.eval-verdict', `${t('运行器', 'runner')} ${card.avgRunnerTokens} tok (${runnerUsd(card.avgRunnerCostUsd)}) · ${t('主模型', 'main')} ${usd(card.avgCostUsd)} · ${t('总计', 'total')} ${usd(card.avgTotalCostUsd)}/${t('任务', 'task')} · ${card.avgSteps} ${t('平均步骤', 'avg steps')}`),
  ]);
}

/** @param {'A' | 'B'} side */
const pairCol = (side) => m('.eval-pair', [
  m('.eval-pair-head', side),
  m('label.eval-field', [t('主模型', 'main model'), m('select', { value: side === 'A' ? ui.mainA : ui.mainB, disabled: ui.running, onchange: (/** @type {{ target: HTMLSelectElement }} */ e) => { ui[side === 'A' ? 'mainA' : 'mainB'] = e.target.value; } }, mainOptionEls())]),
  m('label.eval-field', [t('网络参与者', 'web actor'), m('select', { value: side === 'A' ? ui.runnerA : ui.runnerB, disabled: ui.running, onchange: (/** @type {{ target: HTMLSelectElement }} */ e) => { ui[side === 'A' ? 'runnerA' : 'runnerB'] = e.target.value; } }, runnerOptionEls())]),
]);

// The selected suite (the id is a free string in state; SUITES is keyed).
const suite = () => SUITES[/** @type {keyof typeof SUITES} */ (ui.suiteId)];

// Suites the home Lab can actually run. The web-actor suite uses the __FIXTURE__
// sentinel that ONLY eval/runner.js (the CDP bench, fed by a local fixture server)
// substitutes — the home Lab's eval-engine has no fixture server, so those tasks
// would all-fail here. Hide any suite whose tasks carry the sentinel (self-
// maintaining: a new fixture suite is filtered automatically). why detect the
// sentinel, not the id: keeps the two surfaces from drifting.
const usesFixture = (/** @type {any} */ s) => (s.tasks ?? []).some((/** @type {any} */ t) =>
  String(t.startUrl ?? '').includes('__FIXTURE__') || String(t.prompt ?? '').includes('__FIXTURE__'));
const labSuites = Object.values(SUITES).filter((/** @type {any} */ s) => !usesFixture(s));

export const EvalSection = {
  oninit() { if (!ui.loaded) loadModels().catch(() => {}); },
  view() {
    return m('div.eval-lab', [
      m('h2', t('实验室', 'Lab')),
      m('p.muted', [t('在真实网络任务上对比两个模型配置 — 与实时对话使用的代理循环、工具和门控相同。每个配置是一对：一个 ', 'Pit two model configs head-to-head on real web tasks — the same agent loop, tools, and gates a live chat uses. Each config is a pair: a '),
        m('strong', t('主', 'main')), t(' 模型（规划 + 编排）和一个 ', ' model (plans + orchestrates) and a '), m('strong', t('网络参与者', 'web actor')), t('（读取/操作页面）。', ' (reads/acts on pages). '),
        m('a.eval-link', { href: '#', onclick: (/** @type {Event} */ e) => { e.preventDefault(); openOptions('providers'); } }, t('配置模型 →', 'Configure models →'))]),
      ui.warn ? m('p.error', ui.warn) : null,
      m('p.eval-note', t('运行会接管代理会话（您当前的对话将重置）并驱动一个隐藏的浏览器窗口 — 运行期间请勿开始新对话。', 'A run takes over the agent session (your current chat resets) and drives a hidden browser window — don\'t start a chat while it runs.')),
      m('.eval-controls', [
        m('label.eval-field', [t('任务集', 'suite'), m('select', { value: ui.suiteId, disabled: ui.running, onchange: (/** @type {{ target: HTMLSelectElement }} */ e) => { ui.suiteId = e.target.value; } },
          labSuites.map((/** @type {any} */ s) => m('option', { value: s.id }, `${s.label} · ${s.tasks.length} ${t('个任务', 'tasks')}`)))]),
        m('label.eval-check', {
          title: t('关闭：代理在隐藏的后台窗口中运行。开启：可观察的可见窗口（其自己的标签栏）— 两种方式都不会获取焦点。', 'Off: the agent runs in a hidden, background window. On: a visible window (its own tab bar) you can watch — it never takes focus either way.'),
        }, [m('input', { type: 'checkbox', checked: ui.showTabs, disabled: ui.running, onchange: (/** @type {{ target: HTMLInputElement }} */ e) => { ui.showTabs = e.target.checked; } }), t('显示标签页', 'show tabs')]),
        m('label.eval-check', {
          title: t('将每个任务作为自主目标运行（规划 → 待办清单 → 循环直到 complete_goal），而不是单次对话轮次。每个任务更慢；用于检验预走 A/B 所测量的目标循环。', 'Run every task as an autonomous GOAL run (plan → todo checklist → turns until complete_goal) instead of a single chat turn. Slower per task; exercises the goal loop the prewalk A/B measures.'),
        }, [m('input', { type: 'checkbox', checked: ui.goalRuns, disabled: ui.running, onchange: (/** @type {{ target: HTMLInputElement }} */ e) => { ui.goalRuns = e.target.checked; } }), t('目标运行', 'goal runs')]),
      ]),
      m('.eval-pairs', [pairCol('A'), m('.eval-pair-vs', t('对', 'vs')), pairCol('B')]),
      m('.eval-controls', [
        m('button.eval-btn.primary', { disabled: ui.running || !ui.mainA || !ui.mainB, onclick: runAB }, t('运行 A/B', 'Run A/B')),
        m('button.eval-btn', { disabled: ui.running || !ui.mainA, onclick: runSingle }, t('仅运行 A', 'Run A only')),
        m('button.eval-btn', {
          disabled: ui.running || !ui.mainA,
          title: t('A 侧配置，两段目标运行：基线 vs 预走（在主模型上规划，在首个落地动作时把实时上下文交给廉价执行器）。开启预走设置的闸门：通过率须保持，同时 $ 和时间下降。', 'Side A\'s config, two legs of goal runs: baseline vs prewalk (plan on the main model, hand the live context to a cheap executor at the first landed action). The gate for turning the prewalk setting on: pass rate must hold while $ and time drop.'),
          onclick: runPrewalkAB,
        }, t('运行预走 A/B', 'Run prewalk A/B')),
        m('button.eval-btn', {
          disabled: ui.running || !ui.mainA,
          title: t('A 侧配置，在引擎参与者任务集上（多轮 VM/Notebook 工作）：基线 vs 引擎预走（VM/Notebook/App 参与者在主模型上运行第 1 轮，然后切换到廉价执行器）。开启引擎参与者预走的闸门：通过率保持，同时运行器 $（参与者的开销）下降。', 'Side A\'s config on the engine-actor suite (multi-turn VM/Notebook work): baseline vs engine-prewalk (VM/Notebook/App actors run turn 1 on the main model, then swap to the cheap executor). The gate for turning engine-actor prewalk on: pass rate holds while the runner-$ (the actor\'s spend) drops.'),
          onclick: runEnginePrewalkAB,
        }, t('运行引擎 A/B', 'Run engine A/B')),
      ]),
      m('button.eval-disclosure', { onclick: () => { ui.showTasks = !ui.showTasks; } },
        `${ui.showTasks ? '▾' : '▸'} ${t('这', 'exactly what the')} ${suite()?.tasks.length ?? 0} ${t('个 ', '')}${ui.suiteId} ${t('任务具体运行什么', 'tasks run')}`),
      ui.showTasks ? m('.eval-tasks', (suite()?.tasks ?? []).map((/** @type {any} */ task) =>
        m('.eval-task', [
          m('span.eval-task-title', task.title),
          m('span.eval-task-prompt', task.prompt),
          m('span.eval-task-url', task.startUrl || t('无网页（计算/代理任务）', 'no web page (compute / agent task)')),
        ]))) : null,
      ui.running ? m('p.eval-running', ui.progress ? `${t('运行', 'running')} ${ui.progress.id} — ${ui.progress.index + 1}/${ui.progress.total}…` : t('启动中…', 'starting…')) : null,
      ui.ab ? abBoard(ui.ab) : null,
      ui.single ? singleBoard(ui.single) : null,
      ui.log.length ? m('pre.eval-log', ui.log.join('\n')) : null,
    ]);
  },
};
