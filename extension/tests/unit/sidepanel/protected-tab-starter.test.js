// @ts-check

import { describe, it, expect } from '../../framework.js';
import { promptsFor } from '/sidepanel/components/chat-view.js';
import { eventBelongsToSidepanelWindow, focusBrowserTab } from '/sidepanel/tab-context.js';

/** @param {'none'|'unknown'|'web'|'protected_private'|'protected_sensitive'} status */
const browsePrompt = (status) => promptsFor({
  surface: 'sidepanel',
  activeTabStatus: status,
}).find((prompt) => prompt.type === 'web');

describe('sidepanel protected-tab starter', () => {
  it('offers summarize only for a verified public page', () => {
    const prompt = browsePrompt('web');
    expect(prompt?.label).toBe('总结');
    expect(prompt?.text).toBe('总结当前页面。');
  });

  it('replaces private and sensitive page work with a disabled policy receipt', () => {
    const privatePage = browsePrompt('protected_private');
    const sensitivePage = browsePrompt('protected_sensitive');
    expect(privatePage?.label).toBe('受保护');
    expect(privatePage?.blocked).toBe(true);
    expect(privatePage?.text).toContain('私有网络页面');
    expect(sensitivePage?.label).toBe('受保护');
    expect(sensitivePage?.blocked).toBe(true);
    expect(sensitivePage?.text).toContain('敏感页面');
  });

  it('keeps the generic browse starter when policy status is unavailable', () => {
    const prompt = browsePrompt('unknown');
    expect(prompt?.label).toBe('浏览');
    expect(prompt?.text.includes('current page')).toBe(false);
  });

  it('ignores active-tab events from another browser window', () => {
    expect(eventBelongsToSidepanelWindow(4, 9)).toBe(false);
    expect(eventBelongsToSidepanelWindow(4, 4)).toBe(true);
    expect(eventBelongsToSidepanelWindow(null, 9)).toBe(true);
  });

  it('activates a protected tab and focuses its current window', async () => {
    /** @type {Array<[string, number, Record<string, boolean>]>} */
    const calls = [];
    const focused = await focusBrowserTab({
      tabs: {
        update: async (tabId, update) => {
          calls.push(['tab', tabId, update]);
          return { windowId: 8 };
        },
      },
      windows: {
        update: async (windowId, update) => { calls.push(['window', windowId, update]); },
      },
    }, 14, 3);

    expect(focused).toBe(true);
    expect(calls).toEqual([
      ['tab', 14, { active: true }],
      ['window', 8, { focused: true }],
    ]);
  });

  it('reports a failed protected-tab focus without throwing', async () => {
    const focused = await focusBrowserTab({
      tabs: { update: async () => { throw new Error('tab closed'); } },
    }, 14, 3);
    expect(focused).toBe(false);
  });
});
