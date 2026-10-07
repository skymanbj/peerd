// @ts-check

import m from '/vendor/mithril/mithril.js';
import { describe, it, expect } from '../../framework.js';
import { ActorIsolationBanner } from '/sidepanel/components/actor-isolation-banner.js';
import { MessageList } from '/sidepanel/components/message-list.js';

const flush = async () => {
  await new Promise((resolve) => setTimeout(resolve, 0));
  m.redraw.sync();
};

describe('sidepanel actor isolation UX', () => {
  it('shows a persistent polite status and offers retry only for a temporary host failure', async () => {
    /** @type {Array<Record<string, unknown>>} */
    const sent = [];
    const root = document.createElement('div');
    document.body.appendChild(root);
    m.mount(root, {
      view: () => m(ActorIsolationBanner, {
        capability: { status: 'temporarily_unavailable', reason: 'worker import failed', retryable: true },
        send: async (/** @type {Record<string, unknown>} */ message) => { sent.push(message); },
      }),
    });
    try {
      await flush();
      expect(root.querySelector('[role="status"][aria-live="polite"]')).toBeTruthy();
      expect(root.textContent).toContain('重试参与者请求前请先使用“重试”');
      expect(root.textContent).toContain('无法确认隔离状态');
      expect(root.textContent.includes('worker import failed')).toBe(false);
      const retry = /** @type {HTMLButtonElement} */ (root.querySelector('button'));
      retry.click();
      expect(sent).toEqual([{ type: 'actor-isolation/retry' }]);
      const busy = /** @type {HTMLElement} */ (root.querySelector('.actor-isolation-banner'));
      const busyButton = /** @type {HTMLButtonElement} */ (busy.querySelector('button'));
      expect(busy.getAttribute('aria-busy')).toBe('true');
      expect(busyButton.disabled).toBe(true);
      expect(busyButton.textContent).toContain('正在重试参与者工作器');
    } finally { m.mount(root, null); root.remove(); }
  });

  it('announces a failed retry without exposing transport details', async () => {
    const root = document.createElement('div');
    document.body.appendChild(root);
    m.mount(root, {
      view: () => m(ActorIsolationBanner, {
        capability: { status: 'temporarily_unavailable', reason: 'private worker stack', retryable: true },
        send: async () => { throw new Error('private runtime messaging failure'); },
      }),
    });
    try {
      await flush();
      /** @type {HTMLButtonElement} */ (root.querySelector('button')).click();
      await flush();
      expect(root.textContent).toContain('参与者工作仍处于暂停状态');
      expect(root.textContent).toContain('无法恢复参与者执行');
      expect(root.textContent.includes('private runtime messaging failure')).toBe(false);
      expect(root.textContent.includes('private worker stack')).toBe(false);
    } finally { m.mount(root, null); root.remove(); }
  });

  it('does not offer a retry when the browser cannot provide actor isolation', async () => {
    const root = document.createElement('div');
    document.body.appendChild(root);
    m.mount(root, {
      view: () => m(ActorIsolationBanner, {
        capability: { status: 'unsupported', reason: 'missing worker API', retryable: false },
        send: async () => {},
      }),
    });
    try {
      await flush();
      expect(root.textContent).toContain('参与者不可用');
      expect(root.querySelector('button')).toBe(null);
      expect(root.textContent.includes('missing worker API')).toBe(false);
    } finally { m.mount(root, null); root.remove(); }
  });

  it('moves focus to a recovery status after retry succeeds', async () => {
    /** @type {{ status: string, reason: string|null, retryable: boolean }} */
    const capability = { status: 'temporarily_unavailable', reason: 'worker failed', retryable: true };
    const root = document.createElement('div');
    document.body.appendChild(root);
    m.mount(root, {
      view: () => m(ActorIsolationBanner, {
        capability,
        send: async () => ({
          ok: true,
          capability: { status: 'available', reason: null, retryable: false },
        }),
      }),
    });
    try {
      await flush();
      /** @type {HTMLButtonElement} */ (root.querySelector('button')).click();
      await flush();
      const recovered = /** @type {HTMLElement} */ (root.querySelector('.actor-isolation-banner.is-recovered'));
      expect(recovered).toBeTruthy();
      expect(recovered.textContent).toContain('参与者工作已就绪');
      expect(document.activeElement).toBe(recovered);
    } finally { m.mount(root, null); root.remove(); }
  });

  it('renders a failed message_actor call as an accessible Not run disclosure', async () => {
    const root = document.createElement('div');
    document.body.appendChild(root);
    m.mount(root, { view: () => m(MessageList, { messages: [
      { role: 'assistant', id: 'a1', content: '', toolUses: [{ id: 't1', name: 'message_actor', input: { to: 'web', message: 'click submit' } }] },
      { role: 'user', id: 'u1', content: '', toolResults: [{
        tool_use_id: 't1', is_error: true,
        actorTerminal: true, actorOutcomeKnown: true, actorPerformed: false,
        content: 'actor_isolation_unavailable: Actors were not run',
      }] },
    ] }) });
    try {
      await flush();
      const toggle = /** @type {HTMLButtonElement} */ (root.querySelector('.tool-actor > button.tool-call-header'));
      expect(toggle).toBeTruthy();
      expect(toggle.getAttribute('aria-expanded')).toBe('false');
      expect(toggle.textContent).toContain('未运行');
      toggle.click();
      await flush();
      expect(toggle.getAttribute('aria-expanded')).toBe('true');
      expect(root.textContent).toContain('未启动任何参与者工作。重试前请检查该请求。');
      expect(root.textContent.includes('actor_isolation_unavailable')).toBe(false);
      expect(root.textContent.includes('cannot provide the required isolated worker')).toBe(false);
      expect(root.textContent.includes('Do not retry automatically')).toBe(false);
      expect(root.textContent.includes('reply will arrive')).toBe(false);
    } finally { m.mount(root, null); root.remove(); }
  });

  it('labels a post-start bound actor failure Outcome unknown, never Not run', async () => {
    const root = document.createElement('div');
    document.body.appendChild(root);
    m.mount(root, { view: () => m(MessageList, {
      messages: [
        { role: 'assistant', id: 'a-unknown', content: '', toolUses: [{ id: 't-unknown', name: 'message_actor', input: { to: 'web', message: 'submit it' } }] },
        { role: 'user', id: 'u-unknown', content: '', toolResults: [{
          tool_use_id: 't-unknown', is_error: false,
          actorCorrelationId: 'unknown-correlation', content: 'Message delivered.',
        }] },
        {
          role: 'user', id: 'reply-unknown', synthetic: true,
          actorReply: { kind: 'web', instanceId: 'web', failed: true, outcomeKnown: false },
          content: 'The web actor did not complete cleanly. Its outcome is unknown. Do not retry automatically:\n\n<untrusted_web_content>peerd cannot confirm whether the previous request ran before the background host restarted. Check whether the requested action completed before trying again.</untrusted_web_content>',
        },
      ],
      actors: {
        't-unknown': {
          kind: 'web', instanceId: 'web', streaming: false,
          actorCorrelationId: 'unknown-correlation',
          error: 'the actor worker stopped after execution began; the outcome is unknown',
          outcomeKnown: false,
        },
      },
    }) });
    try {
      await flush();
      const card = /** @type {HTMLButtonElement} */ (root.querySelector('.tool-actor > button.tool-call-header'));
      const replyRole = root.querySelector('.message-actor-reply .role');
      expect(card.textContent).toContain('结果未知');
      expect(card.textContent.includes('未运行')).toBe(false);
      expect(replyRole?.textContent).toContain('结果未知');
      expect(replyRole?.textContent?.includes('未运行')).toBe(false);
      const reply = root.querySelector('.message-actor-reply');
      expect(reply?.getAttribute('role')).toBe(null);
      expect(reply?.getAttribute('aria-live')).toBe(null);
      expect(root.querySelector('.actor-recovery-announcement')).toBe(null);
      expect(root.textContent).toContain('peerd 无法确认参与者是否已运行或完成');
      expect(root.textContent).toContain('重试前请检查目标');
      expect(root.textContent.includes('Do not retry automatically')).toBe(false);
    } finally { m.mount(root, null); root.remove(); }
  });

  it('renders a historical queued recovery receipt without reannouncing it', async () => {
    const root = document.createElement('div');
    document.body.appendChild(root);
    m.mount(root, { view: () => m(MessageList, {
      messages: [{
        role: 'user', id: 'actor-recovery:chat-1:app-1:1', synthetic: true,
        actorReply: {
          kind: 'app', instanceId: 'app-1', name: 'orders', failed: true,
          outcomeKnown: true, performed: false,
        },
        content: 'The app actor orders (app-1) could not complete your request:\n\n<untrusted_web_content>The background host restarted before this actor request was dispatched. It was not run. Re-issue it if it still matters.</untrusted_web_content>',
      }],
    }) });
    try {
      await flush();
      const reply = root.querySelector('.message-actor-reply');
      expect(reply).toBeTruthy();
      expect(reply?.querySelector('.role')?.textContent).toContain('未运行');
      expect(reply?.querySelector('.role')?.textContent?.includes('failed')).toBe(false);
      expect(reply?.getAttribute('role')).toBe(null);
      expect(reply?.getAttribute('aria-live')).toBe(null);
      expect(root.querySelectorAll('[role="status"]').length).toBe(0);
      expect(root.textContent).toContain('未启动任何参与者工作。重试前请检查该请求。');
      expect(root.textContent.includes('before this actor request was dispatched')).toBe(false);
    } finally { m.mount(root, null); root.remove(); }
  });

  it('announces newly arriving recovery receipts once, but not after remounting history', async () => {
    const root = document.createElement('div');
    document.body.appendChild(root);
    /** @type {any[]} */
    const messages = [{ role: 'user', id: 'human-1', content: 'status?', when: 1 }];
    const component = { view: () => m(MessageList, { sessionId: 'chat-live', messages }) };
    m.mount(root, component);
    try {
      await flush();
      expect(root.querySelector('.actor-recovery-announcement')).toBe(null);
      messages.push({
        role: 'user', id: 'actor-recovery:chat-live:queued-1', synthetic: true,
        actorReply: {
          kind: 'app', instanceId: 'app-1', failed: true,
          outcomeKnown: true, performed: false,
        },
        content: 'The app actor did not run the request:\n\n<untrusted_web_content>The request was not run.</untrusted_web_content>',
      });
      m.redraw.sync();
      const status = root.querySelector('.actor-recovery-announcement[role="status"]');
      expect(status?.getAttribute('aria-live')).toBe('polite');
      expect(status?.getAttribute('aria-atomic')).toBe('true');
      expect(status?.textContent).toContain('参与者请求未运行');
      expect(root.querySelectorAll('[role="status"]').length).toBe(1);

      m.mount(root, null);
      m.mount(root, component);
      await flush();
      expect(root.querySelector('.actor-recovery-announcement')).toBe(null);
      expect(root.querySelectorAll('[role="status"]').length).toBe(0);
    } finally { m.mount(root, null); root.remove(); }
  });

  it('announces a receipt first encountered after an empty chat without repeating it', async () => {
    const root = document.createElement('div');
    document.body.appendChild(root);
    const seenRecoveryIdsBySession = new Map();
    let sessionId = 'chat-empty';
    /** @type {any[]} */
    let messages = [];
    const component = {
      view: () => messages.length === 0
        ? m('p', 'empty chat')
        : m(MessageList, {
          sessionId, messages, announceOnMount: true, seenRecoveryIdsBySession,
        }),
    };
    m.mount(root, component);
    try {
      await flush();
      sessionId = 'chat-recovery';
      messages = [{
        role: 'user', id: 'actor-recovery:chat-recovery:started-1', synthetic: true,
        actorReply: { kind: 'web', instanceId: 'web', failed: true, outcomeKnown: false },
        content: 'The web actor outcome is unknown.',
      }];
      m.redraw.sync();
      expect(root.querySelector('.actor-recovery-announcement')?.textContent)
        .toContain('参与者结果未知');

      sessionId = 'chat-empty';
      messages = [];
      m.redraw.sync();
      sessionId = 'chat-recovery';
      messages = [{
        role: 'user', id: 'actor-recovery:chat-recovery:started-1', synthetic: true,
        actorReply: { kind: 'web', instanceId: 'web', failed: true, outcomeKnown: false },
        content: 'The web actor outcome is unknown.',
      }];
      m.redraw.sync();
      expect(root.querySelector('.actor-recovery-announcement')).toBe(null);
    } finally { m.mount(root, null); root.remove(); }
  });

  it('announces a recovery receipt first encountered after switching chats only once', async () => {
    const root = document.createElement('div');
    document.body.appendChild(root);
    let sessionId = 'chat-a';
    /** @type {any[]} */
    let messages = [{ role: 'user', id: 'human-a', content: 'status?', when: 1 }];
    const component = { view: () => m(MessageList, { sessionId, messages }) };
    m.mount(root, component);
    try {
      await flush();
      expect(root.querySelector('.actor-recovery-announcement')).toBe(null);

      sessionId = 'chat-b';
      messages = [{
        role: 'user', id: 'actor-recovery:chat-b:started-1', synthetic: true,
        actorReply: {
          kind: 'web', instanceId: 'web', failed: true, outcomeKnown: false,
        },
        content: 'The web actor did not complete cleanly. Its outcome is unknown.',
      }];
      m.redraw.sync();
      expect(root.querySelector('.actor-recovery-announcement')?.textContent)
        .toContain('参与者结果未知');

      sessionId = 'chat-a';
      messages = [{ role: 'user', id: 'human-a', content: 'status?', when: 1 }];
      m.redraw.sync();
      expect(root.querySelector('.actor-recovery-announcement')).toBe(null);

      sessionId = 'chat-b';
      messages = [{
        role: 'user', id: 'actor-recovery:chat-b:started-1', synthetic: true,
        actorReply: {
          kind: 'web', instanceId: 'web', failed: true, outcomeKnown: false,
        },
        content: 'The web actor did not complete cleanly. Its outcome is unknown.',
      }];
      m.redraw.sync();
      expect(root.querySelector('.actor-recovery-announcement')).toBe(null);
    } finally { m.mount(root, null); root.remove(); }
  });

  it('restarts the clear timer when recovery announcements overlap', async () => {
    const root = document.createElement('div');
    document.body.appendChild(root);
    /** @type {any[]} */
    const messages = [{ role: 'user', id: 'human-1', content: 'status?', when: 1 }];
    m.mount(root, { view: () => m(MessageList, { sessionId: 'chat-live', messages }) });
    try {
      await flush();
      messages.push({
        role: 'user', id: 'actor-recovery:chat-live:started-1', synthetic: true,
        actorReply: {
          kind: 'web', instanceId: 'web', failed: true, outcomeKnown: false,
        },
        content: 'The web actor did not complete cleanly. Its outcome is unknown.',
      });
      m.redraw.sync();
      expect(root.querySelector('.actor-recovery-announcement')?.textContent)
        .toContain('参与者结果未知');

      messages.push({
        role: 'user', id: 'actor-recovery:chat-live:queued-2', synthetic: true,
        actorReply: {
          kind: 'app', instanceId: 'app-1', failed: true,
          outcomeKnown: true, performed: false,
        },
        content: 'The app actor did not run the request.',
      });
      m.redraw.sync();
      expect(root.querySelector('.actor-recovery-announcement')?.textContent)
        .toContain('参与者请求未运行');

      await new Promise((resolve) => setTimeout(resolve, 1_100));
      m.redraw.sync();
      expect(root.querySelector('.actor-recovery-announcement')).toBe(null);
    } finally { m.mount(root, null); root.remove(); }
  });

  it('keeps a historical awaited message_actor warning visible but out of a live region', async () => {
    const root = document.createElement('div');
    document.body.appendChild(root);
    m.mount(root, { view: () => m(MessageList, {
      messages: [
        {
          role: 'assistant', id: 'a-awaited-unknown', content: '',
          toolUses: [{
            id: 't-awaited-unknown', name: 'message_actor',
            input: { to: 'web', message: 'submit it', await: true },
          }],
        },
        {
          role: 'user', id: 'u-awaited-unknown', content: '',
          toolResults: [{
            tool_use_id: 't-awaited-unknown', is_error: true,
            actorCorrelationId: 'awaited-unknown-correlation', actorTerminal: true,
            actorOutcomeKnown: false, actorPerformed: true,
            content: 'Actor execution did not complete. Its outcome is unknown. Do not retry automatically.',
          }],
        },
      ],
      actors: {
        't-awaited-unknown': {
          kind: 'web', instanceId: 'web', streaming: false,
          actorCorrelationId: 'awaited-unknown-correlation',
          error: 'the actor host stopped; the outcome is unknown',
          outcomeKnown: false,
        },
      },
    }) });
    try {
      await flush();
      const toggle = /** @type {HTMLButtonElement} */ (root.querySelector('.tool-actor > button.tool-call-header'));
      expect(toggle.textContent).toContain('结果未知');
      expect(root.querySelector('.actor-unknown-announcement')).toBe(null);
      expect(root.querySelector('.actor-recovery-announcement')).toBe(null);
      expect(root.querySelectorAll('[role="status"]').length).toBe(0);
      expect(root.textContent.includes('Do not retry automatically')).toBe(false);
    } finally { m.mount(root, null); root.remove(); }
  });

  it('announces a newly arriving awaited actor unknown outcome once', async () => {
    const root = document.createElement('div');
    document.body.appendChild(root);
    /** @type {any[]} */
    const messages = [{
      role: 'assistant', id: 'a-awaited-live', content: '',
      toolUses: [{
        id: 't-awaited-live', name: 'message_actor',
        input: { to: 'web', message: 'submit it', await: true },
      }],
    }];
    m.mount(root, { view: () => m(MessageList, { sessionId: 'chat-live', messages }) });
    try {
      await flush();
      messages.push({
        role: 'user', id: 'u-awaited-live', content: '',
        toolResults: [{
          tool_use_id: 't-awaited-live', is_error: true,
          content: 'Actor execution did not complete. Its outcome is unknown.',
        }],
      });
      m.redraw.sync();
      const status = root.querySelector('.actor-recovery-announcement[role="status"]');
      expect(status?.getAttribute('aria-live')).toBe('polite');
      expect(status?.textContent).toContain('参与者结果未知');
      expect(root.querySelectorAll('[role="status"]').length).toBe(1);
      m.redraw.sync();
      expect(root.querySelectorAll('[role="status"]').length).toBe(1);
    } finally { m.mount(root, null); root.remove(); }
  });

  it('describes a historical success as accepted, not delivered', async () => {
    const root = document.createElement('div');
    document.body.appendChild(root);
    m.mount(root, { view: () => m(MessageList, { messages: [
      { role: 'assistant', id: 'a2', content: '', toolUses: [{ id: 't2', name: 'message_actor', input: { to: 'web', message: 'read it' } }] },
      { role: 'user', id: 'u2', content: '', toolResults: [{ tool_use_id: 't2', is_error: false, content: 'Message delivered to the web actor.' }] },
    ] }) });
    try {
      await flush();
      /** @type {HTMLButtonElement} */ (root.querySelector('.tool-actor > button.tool-call-header')).click();
      await flush();
      expect(root.textContent).toContain('请求已接受；请查看后续消息');
      expect(root.textContent.includes('reply delivered')).toBe(false);
    } finally { m.mount(root, null); root.remove(); }
  });

  it('renders actor_create as a keyboard-operable disclosure', async () => {
    const root = document.createElement('div');
    document.body.appendChild(root);
    m.mount(root, { view: () => m(MessageList, { messages: [
      { role: 'assistant', id: 'a3', content: '', toolUses: [{ id: 't3', name: 'actor_create', input: { task: 'check it' } }] },
      { role: 'user', id: 'u3', content: '', toolResults: [{ tool_use_id: 't3', is_error: true, content: 'not run' }] },
    ] }) });
    try {
      await flush();
      const toggle = /** @type {HTMLButtonElement} */ (root.querySelector('.tool-actor > button.tool-call-header'));
      expect(toggle).toBeTruthy();
      expect(toggle.getAttribute('aria-expanded')).toBe('false');
      toggle.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      toggle.click();
      await flush();
      expect(toggle.getAttribute('aria-expanded')).toBe('true');
    } finally { m.mount(root, null); root.remove(); }
  });

  it('labels a sync actor_create post-start failure Outcome unknown', async () => {
    const root = document.createElement('div');
    document.body.appendChild(root);
    m.mount(root, { view: () => m(MessageList, { messages: [
      { role: 'assistant', id: 'a4', content: '', toolUses: [{ id: 't4', name: 'actor_create', input: { task: 'change it' } }] },
      {
        role: 'user', id: 'u4', content: '',
        toolResults: [{
          tool_use_id: 't4', is_error: true,
          content: 'Actor execution did not complete. Its outcome is unknown. Do not retry automatically.',
        }],
      },
    ] }) });
    try {
      await flush();
      const toggle = /** @type {HTMLButtonElement} */ (root.querySelector('.tool-actor > button.tool-call-header'));
      expect(toggle.textContent).toContain('结果未知');
      expect(toggle.textContent.includes('done')).toBe(false);
      expect(toggle.title === '未运行').toBe(false);
      expect(root.querySelector('.actor-unknown-announcement')).toBe(null);
      expect(root.querySelector('.actor-recovery-announcement')).toBe(null);
      expect(root.querySelectorAll('[role="status"]').length).toBe(0);
      toggle.click();
      await flush();
      const body = root.querySelector('.tool-actor .actor-body');
      expect(body?.textContent).toContain('重试前请检查目标');
      expect(body?.textContent?.includes('Do not retry automatically')).toBe(false);
    } finally { m.mount(root, null); root.remove(); }
  });
});
