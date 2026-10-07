// @ts-check

import m from '/vendor/mithril/mithril.js';
import { describe, it, expect } from '../../framework.js';
import { ContributorMetricsSection } from '/options/sections/contributor-metrics.js';
import { MessageList } from '/sidepanel/components/message-list.js';

const settle = async () => {
  await new Promise((resolve) => setTimeout(resolve, 0));
  m.redraw.sync();
};

/** @param {HTMLElement} root @param {string} label */
const button = (root, label) => /** @type {HTMLButtonElement} */ (
  Array.from(root.querySelectorAll('button')).find((entry) => entry.textContent === label)
);

describe('Contributor Metrics human UI', () => {
  it('shows the full disclosure, explicit enable, and exact read-only bytes', async () => {
    const root = document.createElement('div');
    document.body.appendChild(root);
    /** @type {any[]} */
    const calls = [];
    const exactBytes = '{"schemaVersion":1,"rows":[]}';
    let enabled = false;
    const send = async (/** @type {any} */ message) => {
      calls.push(message);
      if (message.type === 'contributor/enable') enabled = true;
      if (message.type === 'contributor/disable') enabled = false;
      return {
        ok: true,
        status: {
          enabled, disclosureVersion: 1, diagnostic: null,
          rowCount: 0, bytes: enabled ? exactBytes : null,
        },
      };
    };
    m.mount(root, { view: () => m(ContributorMetricsSection, { send }) });
    try {
      await settle();
      expect(root.textContent).toContain('没有贡献者指标 peerd 也能完整运行');
      expect(root.textContent).toContain('包含');
      expect(root.textContent).toContain('从不包含');
      expect(root.textContent).toContain('URL、来源、主机');
      expect(root.textContent).toContain('同意轮换的不透明令牌');
      expect(root.textContent).toContain('仅限于预览版和开发版');
      expect(root.textContent).toContain('无法单独删除');
      expect(root.textContent).toContain('提供者以及已知的模型系列');
      expect(root.textContent).toContain('披露版本 1；载荷架构版本 1');
      expect(button(root, '启用贡献者指标') instanceof HTMLButtonElement).toBe(true);
      button(root, '启用贡献者指标').click();
      await settle();
      const preview = /** @type {HTMLTextAreaElement} */ (root.querySelector('.contributor-payload'));
      expect(preview.readOnly).toBe(true);
      expect(preview.value).toBe(exactBytes);
      expect(root.textContent).toContain('确切规范字节');
      expect(button(root, '禁用并清除') instanceof HTMLButtonElement).toBe(true);
      expect(calls.map((call) => call.type)).toEqual([
        'contributor/status', 'contributor/enable',
      ]);
    } finally {
      m.mount(root, null);
      root.remove();
    }
  });

  it('keeps Disable and clear available for newer or malformed local state', async () => {
    const root = document.createElement('div');
    document.body.appendChild(root);
    /** @type {any[]} */
    const calls = [];
    const send = async (/** @type {any} */ message) => {
      calls.push(message);
      return {
        ok: true,
        status: message.type === 'contributor/disable'
          ? { enabled: false, disclosureVersion: 1, schemaVersion: 1, diagnostic: null }
          : {
              enabled: false, disclosureVersion: 1, schemaVersion: 1,
              diagnostic: 'contributor-state-newer-read-only',
            },
      };
    };
    m.mount(root, { view: () => m(ContributorMetricsSection, { send }) });
    try {
      await settle();
      expect(root.textContent).toContain('本地状态需要关注');
      expect(root.textContent).toContain('只读本地状态');
      expect(button(root, '启用贡献者指标')).toBe(undefined);
      button(root, '禁用并清除').click();
      await settle();
      expect(calls.map((call) => call.type)).toEqual([
        'contributor/status', 'contributor/disable',
      ]);
    } finally {
      m.mount(root, null);
      root.remove();
    }
  });

  it('renders binary transcript-free feedback and sends no arbitrary field', async () => {
    const root = document.createElement('div');
    document.body.appendChild(root);
    const messages = [
      { role: 'user', id: 'user-1', content: 'Finish the task' },
      {
        role: 'assistant', id: 'answer-1', content: 'Finished.',
        stopReason: 'end_turn', toolUses: [],
      },
    ];
    const before = JSON.stringify(messages);
    /** @type {any[]} */
    const calls = [];
    const send = async (/** @type {any} */ message) => {
      calls.push(message);
      return { ok: true, recorded: true, reason: null };
    };
    m.mount(root, {
      view: () => m(MessageList, { messages, sessionId: 'chat-1', send }),
    });
    try {
      await settle();
      const feedback = /** @type {HTMLElement} */ (root.querySelector('.task-feedback'));
      expect(feedback).toBeTruthy();
      expect(feedback.getAttribute('role')).toBe('group');
      expect(feedback.getAttribute('aria-label')).toBe('此回复有用吗？');
      expect(feedback.querySelector('input')).toBe(null);
      expect(feedback.querySelector('textarea')).toBe(null);
      button(feedback, '有用').click();
      await settle();
      expect(calls).toEqual([{
        type: 'contributor/feedback',
        sessionId: 'chat-1',
        messageId: 'answer-1',
        verdict: 'worked',
      }]);
      expect(button(feedback, '有用').getAttribute('aria-pressed')).toBe('true');
      expect(JSON.stringify(messages)).toBe(before);
    } finally {
      m.mount(root, null);
      root.remove();
    }
  });

  it('does not visually acknowledge feedback the host declined', async () => {
    const root = document.createElement('div');
    document.body.appendChild(root);
    const messages = [
      { role: 'user', id: 'user-1', content: 'Finish the task' },
      {
        role: 'assistant', id: 'answer-1', content: 'Finished.',
        stopReason: 'end_turn', toolUses: [],
      },
    ];
    m.mount(root, {
      view: () => m(MessageList, {
        messages,
        sessionId: 'chat-1',
        send: async () => ({ ok: true, recorded: false, reason: 'disabled' }),
      }),
    });
    try {
      await settle();
      const feedback = /** @type {HTMLElement} */ (root.querySelector('.task-feedback'));
      button(feedback, '有用').click();
      await settle();
      expect(button(feedback, '有用').getAttribute('aria-pressed')).toBe('false');
      expect(feedback.textContent).toContain('请在设置中启用贡献者指标以记录反馈');
    } finally {
      m.mount(root, null);
      root.remove();
    }
  });

  it('offers feedback only on each human turn final answer', async () => {
    const root = document.createElement('div');
    document.body.appendChild(root);
    const messages = [
      { role: 'user', id: 'user-1', content: 'First' },
      { role: 'assistant', id: 'step-1', content: 'I will check.', toolUses: [{ id: 'tool-1', name: 'message_actor', input: { await: true } }] },
      { role: 'user', id: 'result-1', content: '', toolResults: [{ tool_use_id: 'tool-1', content: '{}' }] },
      { role: 'assistant', id: 'answer-1', content: 'Done.', stopReason: 'end_turn', toolUses: [] },
      { role: 'user', id: 'user-2', content: 'Second' },
      { role: 'assistant', id: 'answer-2', content: 'Also done.', stopReason: 'end_turn', toolUses: [] },
    ];
    m.mount(root, {
      view: () => m(MessageList, { messages, sessionId: 'chat-1', send: async () => ({ ok: true }) }),
    });
    try {
      await settle();
      const feedback = Array.from(root.querySelectorAll('.task-feedback'));
      expect(feedback.length).toBe(2);
      expect(feedback.map((entry) => entry.closest('.message')?.textContent)).toEqual([
        'peerdDone.这有用吗？有用没用',
        'peerdAlso done.这有用吗？有用没用',
      ]);
    } finally {
      m.mount(root, null);
      root.remove();
    }
  });

  it('attributes a late actor completion to its original human task', async () => {
    const root = document.createElement('div');
    document.body.appendChild(root);
    const messages = [
      { role: 'user', id: 'user-a', content: 'First task' },
      {
        role: 'assistant', id: 'dispatch-a', content: 'Delegating.', stopReason: 'tool_use',
        toolUses: [{ id: 'actor-a', name: 'message_actor', input: {} }],
      },
      { role: 'assistant', id: 'ack-a', content: 'Reply later.', stopReason: 'end_turn', toolUses: [] },
      { role: 'user', id: 'user-b', content: 'Second task' },
      { role: 'assistant', id: 'answer-b', content: 'Second done.', stopReason: 'end_turn', toolUses: [] },
      {
        role: 'user', id: 'reply-a', content: 'Actor replied.', synthetic: true,
        actorReply: { kind: 'web', instanceId: 'web', parentToolUseId: 'actor-a' },
      },
      { role: 'assistant', id: 'answer-a', content: 'First done.', stopReason: 'end_turn', toolUses: [] },
    ];
    m.mount(root, {
      view: () => m(MessageList, { messages, sessionId: 'chat-1', send: async () => ({ ok: true }) }),
    });
    try {
      await settle();
      const feedbackMessages = Array.from(root.querySelectorAll('.task-feedback'))
        .map((entry) => entry.closest('.message')?.textContent ?? '');
      expect(feedbackMessages.length).toBe(2);
      expect(feedbackMessages.some((text) => text.includes('Second done.'))).toBe(true);
      expect(feedbackMessages.some((text) => text.includes('First done.'))).toBe(true);
      const acknowledgement = Array.from(root.querySelectorAll('.message'))
        .find((entry) => entry.textContent?.includes('Reply later.'));
      expect(acknowledgement?.querySelector('.task-feedback')).toBe(null);
    } finally {
      m.mount(root, null);
      root.remove();
    }
  });

  it('withholds feedback from busy and every non-final stop reason', async () => {
    const root = document.createElement('div');
    document.body.appendChild(root);
    try {
      for (const stopReason of ['tool_use', 'incomplete', 'aborted', 'max_tokens', 'max_steps', 'one_shot']) {
        const messages = [
          { role: 'user', id: 'user-1', content: 'Browse' },
          {
            role: 'assistant', id: 'step-1', content: 'Not final.', stopReason,
            toolUses: stopReason === 'tool_use'
              ? [{ id: 'tool-1', name: 'message_actor' }]
              : [],
          },
        ];
        m.mount(root, {
          view: () => m(MessageList, {
            messages, sessionId: 'chat-1', busy: false, send: async () => ({ ok: true }),
          }),
        });
        await settle();
        expect(root.querySelector('.task-feedback')).toBe(null);
      }

      const finalMessages = [
        { role: 'user', id: 'user-1', content: 'Browse' },
        { role: 'assistant', id: 'answer-1', content: 'Done.', stopReason: 'end_turn', toolUses: [] },
      ];
      m.mount(root, {
        view: () => m(MessageList, {
          messages: finalMessages, sessionId: 'chat-1', busy: true,
          send: async () => ({ ok: true }),
        }),
      });
      await settle();
      expect(root.querySelector('.task-feedback')).toBe(null);
    } finally {
      m.mount(root, null);
      root.remove();
    }
  });
});
