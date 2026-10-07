// @ts-check
// Options → Decentralized web (preview packages only).
//
// Ported from the panel's dweb section. DWEB_ENABLED is a build-time
// literal: the store package's copy of channel-config.js has it false, the
// options shell never registers this route or nav entry, the dwebEnabled
// key doesn't exist in CHANNEL_DEFAULTS, and the module behind loadDweb()
// isn't even in that artifact — this file is structurally dead code
// there. loadDweb() from /shared/dweb-loader.js is the ONE sanctioned
// path to the module (packaging/check-dweb-boundary.ts enforces it).

import m from '/vendor/mithril/mithril.js';
import { loadDweb } from '/shared/dweb-loader.js';
import { DWEB_ENABLED } from '/shared/channel-config.js';
import { openHome } from '/shared/open-home.js';
import { resetRow } from './reset-row.js';

/** @typedef {import('./reset-row.js').Send} Send */

export const DwebSection = {
  /** @param {{ attrs?: { loadStatus?: () => Promise<any> }, state: any }} vnode */
  oninit(vnode) {
    vnode.state.dwebStatus = null;             // { available, phase, did }
    vnode.state.dwebBusy = false;
    vnode.state.dwebError = null;
    vnode.state.dwebStopIncomplete = false;
    if (DWEB_ENABLED) {
      const loadStatus = vnode.attrs?.loadStatus
        ?? (() => loadDweb().then((client) => client.getStatus()));
      loadStatus()
        .then((s) => { vnode.state.dwebStatus = s; m.redraw(); })
        .catch(() => {});
    }
  },

  /** @param {{ attrs: { state: any, send: Send }, state: any }} vnode */
  view: ({ attrs: { state, send }, state: ui }) => {
    // Preview-only key; undefined (and unrenderable) on store packages.
    const dwebEnabled = !!state.settings?.dwebEnabled;

    return m('div', [
      m('.dweb-banner', [
        m('strong', 'Dweb 预览。'),
        '这是研究级别。协议可能变更；数据格式'
        + '可能演进。Dweb 流量按标签页选择性启用。',
      ]),
      m('p', '您正在使用启用了 dweb 预览的 peerd。'
        + '核心扩展与商店发布的 peerd 相同 — '
        + '仅此 dweb 覆盖层是预览版。'),
      m('h3', '参与 dweb'),
      m('p', dwebEnabled
        ? '开 — 此 peerd 可以与其他 peerd 实例加入 dweb 房间'
          + '（通过 WebRTC 的 N 对端房间）并运行可以聊天和共享'
          + '数据的 dwapp。连接在对端之间端到端；'
          + '会合节点仅中继不透明的握手，且房间'
          + '在它离开后仍能工作。关闭此功能以停止所有 dweb'
          + '活动。'
        : '关。启用后允许此 peerd 通过 WebRTC 与其他 peerd '
          + '实例加入 dweb 房间并运行点对点 dwapp。（在'
          + '预览包中 dweb 默认开启；您关闭了它。）'
          + '在您明确加入房间之前，不会连接任何地方。'),
      m('div', { style: 'display:flex; gap:8px; align-items:center;' }, [
        m('button.secondary', {
          type: 'button',
          disabled: ui.dwebBusy,
          onclick: async () => {
            if (ui.dwebBusy) return;
            const targetEnabled = ui.dwebStopIncomplete ? false : !dwebEnabled;
            ui.dwebBusy = true;
            ui.dwebError = null;
            try {
              const reply = await send({ type: 'settings/update', patch: { dwebEnabled: targetEnabled } });
              if (reply?.ok) {
                ui.dwebStopIncomplete = false;
              } else if (!targetEnabled && reply?.settings?.dwebEnabled === false) {
                ui.dwebStopIncomplete = true;
                ui.dwebError = 'dweb 已设为关闭，但实时网络无法停止。请重启 peerd 或重试。';
              } else {
                ui.dwebError = `无法更新 dweb：${reply?.error ?? '未知错误'}。请重试。`;
              }
            } catch {
              ui.dwebError = ui.dwebStopIncomplete
                ? 'dweb 已设为关闭，但实时网络无法停止。请重启 peerd 或重试。'
                : '无法确认 dweb 更改。请重试。';
            } finally {
              ui.dwebBusy = false;
              m.redraw();
            }
          },
        }, ui.dwebBusy ? '…' : ui.dwebStopIncomplete
          ? '重试停止 dweb'
          : dwebEnabled ? '禁用 dweb' : '启用 dweb'),
      ]),
      ui.dwebError ? m('p.error', { role: 'alert' }, ui.dwebError) : null,
      ui.dwebStatus ? m('p.hint', [
        `协议阶段 ${ui.dwebStatus.phase ?? '—'}。`,
        ui.dwebStatus.did
          ? ['对端身份：', m('code', ui.dwebStatus.did), '。',
            m('a', { href: '#!/transfer' }, '备份或恢复此身份。')]
          : '身份存储在保险库中，在首次加入房间时创建。',
      ]) : null,

      // The dweb AGENT — the mesh-operator actor. Nested under the network
      // toggle (no network, no agent) and OPT-IN: an agent peers can wake is a
      // posture the user chooses. Rendering follows the dependent-toggle idiom
      // (behavior.js failover picker).
      dwebEnabled ? m('div', { style: 'margin-top:14px; border-top:1px solid var(--hairline, #2a2a2a); padding-top:14px;' }, [
        m('h3', 'dweb 代理'),
        m('p', '一个专用的隔离代理，为您运作网格：它'
          + '持有 dweb 工具（发现、分享、安装、阻止），维护'
          + '对端和发布者的账本，并监控发送到'
          + '您代理的消息 — 仅显示重要内容。它在自己的'
          + 'worker 中无密钥运行，永远不会被入站消息驱动，'
          + '仅在您确认后安装或分享。'),
        m('button.secondary', {
          type: 'button',
          onclick: async () => {
            await send({ type: 'settings/update', patch: { dwebAgentEnabled: !state.settings?.dwebAgentEnabled } });
            m.redraw();
          },
        }, state.settings?.dwebAgentEnabled ? '禁用 dweb 代理' : '启用 dweb 代理'),
        state.settings?.dwebAgentEnabled
          ? m('p.hint', '开 — 您的代理可在对话中以“dweb”寻址（message_actor），并在解锁后加入代理收件箱。')
          : m('p.hint', '关 — 网格工具在启用前不可用（它们在此代理上，而非聊天代理）。'),
      ]) : null,

      // commons — the Phase 1 north-star dwapp — now lives in the Library as
      // a pre-loaded, dweb-tagged app (not a button here). Point there.
      dwebEnabled ? m('div', { style: 'margin-top:14px; border-top:1px solid var(--hairline, #2a2a2a); padding-top:14px;' }, [
        m('h3', 'commons — dweb 演示'),
        m('p', '一个共享房间，有众人聊天和私人的'
          + '点对点一对一聊天。它预装在您的'
          + '库中，标记为“dweb” — 在那里打开。要尝试，在'
          + '两个配置文件（或两台机器）中打开并加入相同的房间代码。'),
        m('button.secondary', { type: 'button', onclick: () => openHome('library') }, '打开库'),
      ]) : null,

      resetRow(send, ['dwebEnabled', 'dwebAgentEnabled']),
    ]);
  },
};
