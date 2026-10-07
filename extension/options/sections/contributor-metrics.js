// @ts-check
// Options → Contributor Metrics. Human-only local consent and exact-byte
// preview; issue #345 intentionally has no upload action or collector origin.

import m from '/vendor/mithril/mithril.js';
import {
  CONTRIBUTOR_DISCLOSURE_VERSION, CONTRIBUTOR_SCHEMA_VERSION,
} from '/peerd-runtime/index.js';

/** @typedef {import('./reset-row.js').Send} Send */

export const ContributorMetricsSection = {
  /** @param {{ state: any, attrs: { send: Send } }} vnode */
  oninit(vnode) {
    vnode.state.status = null;
    vnode.state.busy = false;
    vnode.state.error = null;
    vnode.state.copied = false;
    ContributorMetricsSection.refresh(vnode);
  },

  /** @param {{ state: any, attrs: { send: Send } }} vnode */
  async refresh(vnode) {
    try {
      const reply = await vnode.attrs.send({ type: 'contributor/status' });
      vnode.state.status = reply?.ok ? reply.status : null;
      vnode.state.error = reply?.ok ? null : (reply?.error ?? 'status-unavailable');
    } catch (error) {
      vnode.state.error = /** @type {{ message?: string }} */ (error)?.message ?? 'status-unavailable';
    }
    m.redraw();
  },

  /** @param {{ state: any, attrs: { send: Send } }} vnode @param {'enable'|'disable'} action */
  async act(vnode, action) {
    vnode.state.busy = true;
    vnode.state.error = null;
    try {
      const reply = await vnode.attrs.send({ type: `contributor/${action}` });
      if (!reply?.ok) vnode.state.error = reply?.error ?? `${action}-failed`;
      else vnode.state.status = reply.status;
    } catch (error) {
      vnode.state.error = /** @type {{ message?: string }} */ (error)?.message ?? `${action}-failed`;
    } finally {
      vnode.state.busy = false;
      m.redraw();
    }
  },

  /** @param {{ state: any }} vnode */
  async copy(vnode) {
    const bytes = vnode.state.status?.bytes;
    if (typeof bytes !== 'string') return;
    try {
      await navigator.clipboard.writeText(bytes);
      vnode.state.copied = true;
      setTimeout(() => { vnode.state.copied = false; m.redraw(); }, 1200);
    } catch {
      vnode.state.error = '剪贴板访问失败。请直接选择并复制载荷。';
    }
    m.redraw();
  },

  /** @param {{ state: any, attrs: { send: Send } }} vnode */
  view(vnode) {
    const ui = vnode.state;
    const status = ui.status;
    if (!status && !ui.error) return m('p.muted', '正在加载贡献者状态…');
    const enabled = status?.enabled === true;
    return m('.contributor-metrics', [
      m('.provider-card.contributor-disclosure', [
        m('h3', '可选、无内容的贡献'),
        m('p', '没有贡献者指标 peerd 也能完整运行。在你按下下方的“启用”之前不会收集任何内容。'),
        m('h4', '包含'),
        m('ul', [
          m('li', '请求和解析的代码或工具模式，以及经审阅的回退和失败类别。'),
          m('li', '浏览器、扩展版本、渠道、提供者以及已知的模型系列。'),
          m('li', '有界的回合、操作、时长、令牌数，以及可选的“有效/无效”计数。'),
        ]),
        m('h4', '从不包含'),
        m('ul', [
          m('li', 'URL、来源、主机、页面内容、提示词、响应、选择器、搜索词、表单值或文件名。'),
          m('li', '原始错误、凭据、自由文本、时间戳、稳定的用户或设备 ID，或会话、消息、工具和安装 ID。'),
        ]),
        m('p', '有界的本地记录使用同意轮换的不透明令牌，用于重启安全的去重和二元投票分组。这些令牌不包含任何内容或原始标识符，从不出现在载荷预览中，并会在你禁用并清除指标时删除。'),
        m('p', '这项本地基础工作仅限于预览版和开发版。此构建没有上传客户端、端点、定时任务或网络路径。'),
        m('p', '禁用会清除所有本地指标、令牌和反馈。未来被接受的聚合行不会包含任何身份信息，因此无法关联回你，也无法单独删除。任何上传器都需要单独的传输、保留和政策审查，以及当前的披露版本。'),
      ]),

      m('.provider-card', [
        m('.provider-card-main', [
          m('.provider-card-text', [
            m('.provider-card-name', status?.diagnostic
              ? '本地状态需要关注'
              : enabled ? '已在本地启用' : '已禁用'),
            m('.hint', [
              `披露版本 ${status?.disclosureVersion ?? CONTRIBUTOR_DISCLOSURE_VERSION}；`,
              `载荷架构版本 ${CONTRIBUTOR_SCHEMA_VERSION}。`,
            ]),
          ]),
        ]),
        m('.contributor-actions', enabled || status?.diagnostic
          ? m('button.secondary', {
              type: 'button', disabled: ui.busy,
              onclick: () => ContributorMetricsSection.act(vnode, 'disable'),
            }, ui.busy ? '清除中…' : '禁用并清除')
          : m('button', {
              type: 'button', disabled: ui.busy,
              onclick: () => ContributorMetricsSection.act(vnode, 'enable'),
            }, ui.busy ? '启用中…' : '启用贡献者指标')),
      ]),

      ui.error ? m('p.error', ui.error) : null,
      status?.diagnostic
        ? m('.provider-card', [
            m('h3', '只读本地状态'),
            m('p.error', '此构建发现了更新或无效的贡献者指标记录。它没有重写或删除该记录。请更新 peerd，或有意地禁用它并清除。'),
            m('code', status.diagnostic),
          ])
        : null,

      enabled ? m('.provider-card.contributor-preview', [
        m('.contributor-preview-head', [
          m('div', [
            m('h3', '确切的待处理载荷'),
            m('p.hint', `${status.rowCount ?? 0} 行聚合群组。这些是后续上传器将要封存的确切规范字节；此构建无法发送它们。`),
          ]),
          m('button.secondary', {
            type: 'button', disabled: typeof status.bytes !== 'string',
            onclick: () => ContributorMetricsSection.copy(vnode),
          }, ui.copied ? '已复制' : '复制'),
        ]),
        m('textarea.contributor-payload', {
          readonly: true,
          spellcheck: false,
          'aria-label': '确切的待处理贡献者指标载荷',
          value: status.bytes ?? '',
          onclick: (/** @type {MouseEvent & { currentTarget: HTMLTextAreaElement }} */ event) => event.currentTarget.select(),
        }),
      ]) : null,
    ]);
  },
};
