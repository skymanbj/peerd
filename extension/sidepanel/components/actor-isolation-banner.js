// @ts-check

import m from '/vendor/mithril/mithril.js';

/** @typedef {(msg: object) => Promise<any>} Send */

// Persistent capability failure. It is not dismissible because hiding it would
// leave both the user and model with a false picture of what peerd can do.
export const ActorIsolationBanner = {
  /** @param {{ state: { retrying?: boolean, retryFailed?: boolean, retryRequested?: boolean, recoveryAnnounced?: boolean, recoveryDismissed?: boolean }, attrs: { capability?: { status?: string, reason?: string|null, retryable?: boolean }, send: Send } }} vnode */
  view(vnode) {
    const { capability, send } = vnode.attrs;
    if (!capability) return null;
    if (capability.status === 'available') {
      if (!vnode.state.retryRequested || vnode.state.recoveryDismissed) return null;
      const focusRecovery = (/** @type {{ dom: HTMLElement }} */ recoveryVnode) => {
        if (vnode.state.recoveryAnnounced) return;
        vnode.state.recoveryAnnounced = true;
        recoveryVnode.dom.focus();
      };
      return m('.actor-isolation-banner.is-recovered', {
        tabindex: '-1',
        oncreate: focusRecovery,
        onupdate: focusRecovery,
        onblur: () => {
          vnode.state.recoveryDismissed = true;
          m.redraw();
        },
      }, m('.actor-isolation-copy', [
        m('strong', '参与者工作已就绪'),
        m('span', '隔离的工作器已恢复可用。'),
      ]));
    }
    const temporary = capability.status === 'temporarily_unavailable';
    const retrying = vnode.state.retrying === true;
    const retryFailed = vnode.state.retryFailed === true;
    const retry = async () => {
      if (vnode.state.retrying === true) return;
      vnode.state.retrying = true;
      vnode.state.retryFailed = false;
      vnode.state.retryRequested = true;
      vnode.state.recoveryAnnounced = false;
      vnode.state.recoveryDismissed = false;
      // why: render the busy and disabled state before a fast worker probe can
      // resolve, so repeated clicks and assistive technology see the transition.
      m.redraw.sync();
      try {
        const response = await send({ type: 'actor-isolation/retry' });
        if (response?.capability && capability) Object.assign(capability, response.capability);
        else vnode.state.retryFailed = true;
      }
      catch { vnode.state.retryFailed = true; }
      finally { vnode.state.retrying = false; m.redraw(); }
    };
    return m('.actor-isolation-banner', {
      role: 'status',
      'aria-live': 'polite',
      'aria-atomic': 'true',
      'aria-busy': String(retrying),
    }, [
      m('.actor-isolation-copy', [
        m('strong', temporary
          ? retryFailed ? '参与者工作仍处于暂停状态' : '参与者工作已暂停'
          : '参与者不可用'),
        m('span', temporary
          ? retryFailed
            ? '无法恢复参与者执行。请稍后重试。如果持续失败，请重启浏览器，然后使用“重试”。'
            : '由于无法确认隔离状态，参与者执行已暂停。重试参与者请求前请先使用“重试”。'
          : '此浏览器无法创建参与者所需的隔离工作器。参与者请求将不会运行。'),
      ]),
      temporary && capability.retryable
        ? m('button.secondary', {
            type: 'button',
            disabled: retrying,
            onclick: retry,
          }, retrying ? '正在重试参与者工作器…' : '重试')
        : null,
    ]);
  },
};
