// @ts-check
// Options → Activity — the read-only window onto the audit spine.
//
// Ported from the Context view's Activity tab (EVENT_META + detailLine
// + the severity/free-text filters). The agent introspects the same log
// via inspect kind:'audit_log'; this is the human's view. Read-only on purpose
// — the audit log is append-only evidence, not a management surface.

import m from '/vendor/mithril/mithril.js';

/** @typedef {import('./reset-row.js').Send} Send */
/** @typedef {{ id?: string, type: string, when?: number, sessionId?: string, details?: any }} AuditEntry */

// Map audit event types to a short label + a severity class for the dot.
/** @type {Record<string, { label: string, level: string }>} */
const EVENT_META = {
  egress_denied:              { label: '出口已拒绝',         level: 'warn' },
  denylist_hit:               { label: '拒绝列表命中',          level: 'warn' },
  denylist_added:             { label: '拒绝列表模式已添加', level: 'ok' },
  denylist_removed:           { label: '拒绝列表模式已移除', level: 'warn' },
  hook_added:                 { label: '钩子已添加',            level: 'ok' },
  hook_removed:               { label: '钩子已移除',          level: 'warn' },
  hook_enabled:               { label: '钩子已启用',          level: 'ok' },
  hook_disabled:              { label: '钩子已禁用',         level: 'warn' },
  hooks_cleared:              { label: '用户钩子已清除',    level: 'warn' },
  tool_blocked:               { label: '工具已阻止',          level: 'warn' },
  tool_rejected:              { label: '操作已拒绝',       level: 'warn' },
  prompt_injection_suspected: { label: '疑似注入',   level: 'danger' },
  tool_failed:                { label: '工具失败',           level: 'danger' },
  tool_confirmed:             { label: '操作已确认',      level: 'ok' },
  tool_executed:              { label: '工具已运行',              level: 'ok' },
  vault_initialized:          { label: '保险库已创建',         level: 'ok' },
  vault_unlocked:             { label: '保险库已解锁',        level: 'ok' },
  vault_locked:               { label: '保险库已锁定',          level: 'info' },
  provider_added:             { label: '提供者密钥已设置',      level: 'info' },
  mode_changed:               { label: '权限已更改',    level: 'info' },
  session_started:            { label: '会话已开始',       level: 'info' },
  session_ended:              { label: '会话已结束',         level: 'info' },
  auto_memory_suggested:      { label: '内存已建议',      level: 'info' },
  auto_memory_skipped:        { label: '内存提取已跳过', level: 'info' },
  memory_suggestion_approved: { label: '内存建议已批准', level: 'ok' },
  memory_suggestion_dismissed:{ label: '内存建议已忽略', level: 'info' },
  trim_summary_enriched:      { label: '历史摘要已更新', level: 'info' },
  cheap_call_skipped:         { label: '后台调用已跳过', level: 'info' },
  // The origin lock (#255). These are the entries that answer "why did peerd
  // refuse to open that site" - the exact question the learned set makes a user
  // ask - and without a label they rendered as a bare `origin_learned_sensitive`
  // slug with no origin attached. `origin_unlearned_sensitive` is written by the
  // Settings un-learn (#262); labelling it here is harmless before that lands,
  // since unknown types already fall back to a raw-label row.
  origin_learned_sensitive:   { label: '主机可共享浏览器会话', level: 'info' },
  origin_unlearned_sensitive: { label: '已移除已学习主机', level: 'warn' },
  actor_origin_stop:          { label: 'web 助手已停止',     level: 'warn' },
  browser_child_navigation_blocked:
                              { label: '受保护的子导航已阻止', level: 'warn' },
  browser_child_navigation_failed:
                              { label: '子导航控制失败', level: 'warn' },
  browser_child_navigation_unverified:
                              { label: '子目标未验证', level: 'warn' },
  // dweb (preview-only) — the high-signal, user-facing events. Internal
  // mesh/gossip diagnostics carry the dweb_ prefix too and fall back to a
  // raw-label/info row (the `?? { label: e.type, level: 'info' }` below).
  dweb_identity_issued:       { label: 'dweb 身份已发布',   level: 'ok' },
  dweb_room_joined:           { label: '已加入 dweb 房间',     level: 'ok' },
  dweb_room_left:             { label: '已离开 dweb 房间',       level: 'info' },
  dweb_app_installed:         { label: '已安装 dweb 应用',   level: 'ok' },
  dweb_seed_installed:        { label: '已安装公共应用',  level: 'ok' },
  dweb_app_shared:            { label: '已向房间分享应用', level: 'ok' },
  dweb_bridge_join_denied:    { label: 'dweb 房间加入已拒绝',  level: 'warn' },
  dweb_app_install_denied:    { label: 'dweb 应用安装已拒绝', level: 'warn' },
  dweb_peer_muted_by_app:     { label: '已静音 dweb 对端',      level: 'info' },
};

/** @param {number} [ms] */
const fmtTime = (ms) => {
  // why the cast (not `ms ?? 0`): a missing timestamp must stay an
  // Invalid Date (matches the prior runtime), never coerce to the epoch.
  try { return new Date(/** @type {number} */ (ms)).toLocaleString(); }
  catch { return String(ms); }
};

/** @param {unknown} raw */
const browserPolicyDetail = (raw) => {
  const policy = /** @type {any} */ (raw);
  if (!policy || typeof policy !== 'object') return [];
  const reasonLabels = /** @type {Record<string, string>} */ ({
    private_network: '私有网络已阻止',
    cloud_metadata: '云元数据已阻止',
    sensitive_site: '敏感站点已阻止',
    unverified_target: '文档无法验证',
    network_guard_unavailable: '网络防护不可用',
    network_guard_unsupported: '网络防护不受支持',
    network_guard_install_failed: '网络防护失败',
    invalid_url: '地址无效',
    unsupported_scheme: '不支持的地址类型',
    child_guard_failed: '子网络防护失败',
    child_resume_failed: '子导航失败',
    child_destination_unverified: '子目标未验证',
  });
  const outcomeLabels = /** @type {Record<string, string>} */ ({
    not_run: '未运行',
    unverified: '结果未验证',
    page_loaded_not_automated: '页面已加载，未自动化',
  });
  const reason = typeof policy.reason === 'string' ? reasonLabels[policy.reason] : undefined;
  const outcome = typeof policy.outcome === 'string' ? outcomeLabels[policy.outcome] : undefined;
  const bits = [];
  if (reason) bits.push(reason);
  if (policy.stage === 'pre_navigation') bits.push('导航前已停止');
  if (policy.stage === 'committed_origin') bits.push('导航后已停止');
  if (outcome) bits.push(outcome);
  if (policy.child === 'closed') bits.push('子项已关闭');
  if (policy.child === 'left_blank') bits.push('子项留空');
  if (policy.child === 'uncontained') bits.push('子项控制未确认');
  if (policy.guarded === true) bits.push('网络防护已启用');
  if (policy.guarded === false) bits.push('网络防护未确认');
  if (policy.neutralized === true) bits.push('标签页已重置');
  if (policy.neutralized === false) bits.push('标签页重置未确认');
  if (policy.retryable === false) bits.push('请勿重试');
  if (policy.retryable === true) bits.push('可重试');
  return bits;
};

/** @param {AuditEntry} entry */
const detailLine = (entry) => {
  const d = entry.details;
  if (!d || typeof d !== 'object') return '';
  // Keep it compact — tool name + the one or two fields that matter.
  const bits = [];
  if (d.tool) bits.push(d.tool);
  // why: hook audit events carry the hook id in details.id — show it the
  // way denylist events show their pattern.
  if (d.id) bits.push(d.id);
  if (d.gate) bits.push(`gate=${d.gate}`);
  // A learned host is the content of its row. `origin` remains for older audit
  // entries and for exact-origin events such as actor stops.
  if (d.host) bits.push(d.host);
  if (d.origin) bits.push(d.origin);
  if (d.reason) bits.push(d.reason);
  if (d.provider) bits.push(d.provider);
  if (d.primitive) bits.push(d.primitive);
  bits.push(...browserPolicyDetail(d.browserPolicy));
  if (d.answer) bits.push(`answer=${d.answer}`);
  if (d.pattern) bits.push(d.pattern);
  // why: denylist events flag seed provenance — disabling built-in
  // protection should read louder than removing your own pattern.
  if (d.seed === true) bits.push('内置');
  // mode_changed entries: new records carry confirmActions (booleans —
  // check typeof, not truthiness); pre-collapse audit entries carry a
  // tier string. Render both forever — the audit log is append-only.
  if (d.mode) {
    if (typeof d.confirmActions === 'boolean') {
      bits.push(`${d.mode}/${d.confirmActions ? 'confirm' : 'auto'}`);
    } else {
      bits.push(d.tier ? `${d.mode}/${d.tier}` : d.mode);
    }
  }
  // why: an origin-lock row without its origin is unreadable - "site treated as
  // yours" tells you nothing about WHICH site, and that is the whole content of
  // the event. `to` is already narrowed to an origin phrase by the report layer
  // (origin-lock-report.js originPhrase), so no path leaks in here.
  if (d.handoffTo) bits.push(`→ ${d.handoffTo}`);
  else if (d.to) bits.push(`→ ${d.to}`);
  if (d.action) bits.push(d.action);
  if (typeof d.count === 'number') bits.push(`${d.count} 个站点`);
  if (typeof d.durationMs === 'number') bits.push(`${d.durationMs}ms`);
  return bits.join(' · ');
};

export const ActivityView = {
  /** @param {{ state: any, attrs: { send: Send } }} vnode */
  oninit(vnode) {
    vnode.state.entries = null;
    vnode.state.total = 0;
    vnode.state.actLevel = 'all';     // severity filter: all|warn|ok|info
    vnode.state.actQuery = '';        // free-text filter
    vnode.state.error = null;
    ActivityView.refresh(vnode);
  },

  /** @param {{ state: any, attrs: { send: Send } }} vnode */
  refresh(vnode) {
    vnode.attrs.send({ type: 'audit/list' }).then((/** @type {any} */ r) => {
      if (r?.ok) { vnode.state.entries = r.entries; vnode.state.total = r.total; }
      else { vnode.state.error = r?.error ?? '加载日志失败'; }
      m.redraw();
    }).catch((/** @type {unknown} */ e) => {
      vnode.state.error = /** @type {{ message?: string }} */ (e)?.message ?? '加载日志失败';
      m.redraw();
    });
  },

  /** @param {{ state: any, attrs: { send: Send } }} vnode */
  view(vnode) {
    const ui = vnode.state;

    const header = m('div', { style: 'display:flex; align-items:center; gap:8px; margin:0 0 8px;' }, [
      m('p.muted', { style: 'margin:0; font-size:12px;' },
        ui.total ? `${ui.total} 条已记录事件` : ''),
      m('.spacer', { style: 'flex:1;' }),
      m('button.icon', { title: '刷新', onclick: () => ActivityView.refresh(vnode) }, '↻'),
    ]);

    if (ui.error) return m('div', [header, m('p.error', ui.error)]);
    if (ui.entries === null) return m('div', [header, m('p.muted', '加载中…')]);
    if (ui.entries.length === 0) return m('div', [header, m('p.muted', '尚无活动记录。')]);

    // Client-side filters over the already-fetched window: a severity
    // selector + a free-text needle across label / detail / type /
    // sessionId. The fetch itself stays unfiltered so flipping filters
    // is instant.
    const q = ui.actQuery.trim().toLowerCase();
    const shown = ui.entries.filter((/** @type {AuditEntry} */ e) => {
      const meta = EVENT_META[e.type] ?? { label: e.type, level: 'info' };
      if (ui.actLevel === 'warn' && meta.level !== 'warn' && meta.level !== 'danger') return false;
      if (ui.actLevel === 'ok' && meta.level !== 'ok') return false;
      if (ui.actLevel === 'info' && meta.level !== 'info') return false;
      if (!q) return true;
      const hay = `${meta.label} ${detailLine(e)} ${e.type} ${e.sessionId ?? ''}`.toLowerCase();
      return hay.includes(q);
    });

    return m('div', [
      header,
      m('.log-filters', [
        m('select.log-filter-level', {
          'aria-label': '按严重程度筛选',
          value: ui.actLevel,
          onchange: (/** @type {{ target: HTMLSelectElement }} */ e) => { ui.actLevel = e.target.value; },
        }, [
          m('option', { value: 'all' }, '所有事件'),
          m('option', { value: 'warn' }, '问题（已阻止 / 已拒绝 / 已失败）'),
          m('option', { value: 'ok' }, '已运行的操作'),
          m('option', { value: 'info' }, '系统'),
        ]),
        m('input.log-filter-query', {
          type: 'search',
          placeholder: '筛选…（工具、来源、会话）',
          'aria-label': '筛选活动文本',
          value: ui.actQuery,
          oninput: (/** @type {{ target: HTMLInputElement }} */ e) => { ui.actQuery = e.target.value; },
        }),
      ]),
      shown.length === 0
        ? m('p.muted', '没有匹配当前筛选条件的内容。')
        : m('.log-list', shown.map((/** @type {AuditEntry} */ e) => {
            const meta = EVENT_META[e.type] ?? { label: e.type, level: 'info' };
            const detail = detailLine(e);
            return m('.log-row', { key: e.id }, [
              m(`span.log-dot.log-${meta.level}`),
              m('.log-main', [
                m('.log-line', [
                  m('span.log-label', meta.label),
                  detail ? m('span.log-detail', detail) : null,
                ]),
                m('.log-time', fmtTime(e.when)),
              ]),
            ]);
          })),
    ]);
  },
};
