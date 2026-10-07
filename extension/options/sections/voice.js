// @ts-check
// Options → Voice — enable/disable, engine status, on-device upgrade,
// silence slider, mic-permission help.
//
// Engine posture (2026-06-14, DECISIONS #22): the browser Web Speech API is
// the DEFAULT, instant, no-download engine; Moonshine (~250 MB, fully local)
// is an OPT-IN PRIVACY UPGRADE. When Web Speech is available, "Enable voice"
// turns it on instantly with an inline cloud-audio disclosure, and a separate
// upgrade block offers Moonshine with the rationale shown BEFORE any download.
// Without Web Speech, Moonshine is offered only when the runtime has a host.
//
// Ported from the panel's "Voice input" section. The one structural
// difference: this page owns its OWN voice manager instead of receiving
// the panel's. The SW forwards voice/chunk + voice/error pushes only to
// the panel port, so the subscription here is a deliberate no-op —
// enable() awaits its sends and drives Moonshine download progress
// locally (manager.js onProgress), which is everything this page needs.
// Live LISTENING stays a panel affair (the mic button lives there).

import m from '/vendor/mithril/mithril.js';
import browser from '/vendor/browser-polyfill.js';
import { createVoiceManager, detectVoiceCapability } from '/peerd-runtime/index.js';
import { resetRow } from './reset-row.js';
// OCR shares this tab (both are heavy on-device model downloads), but lives in
// its own section file — one section, one file.
import { OcrSection } from './ocr.js';

/** @typedef {import('./reset-row.js').Send} Send */

export const VoiceSection = {
  /** @param {{ state: any, attrs: { state: any, send: Send } }} vnode */
  oninit(vnode) {
    vnode.state.voiceConfirmOpen = false;     // Moonshine download confirmation modal
    vnode.state.voiceBusy = false;
    vnode.state.voiceError = null;
    vnode.state.voiceState = null;            // subscribed snapshot
    vnode.state.runtimeState = vnode.attrs.state;
    // why the no-op onMessage: SW voice pushes ride the panel port only;
    // this page never listens, so there is nothing to subscribe to.
    vnode.state.mgr = createVoiceManager({
      send: vnode.attrs.send,
      onMessage: () => () => {},
      moonshineHostAvailable: () => vnode.state.runtimeState?.capabilities?.moonshineVoiceHost?.status === 'available',
    });
    vnode.state.voiceUnsub = vnode.state.mgr.subscribe((/** @type {any} */ s) => {
      vnode.state.voiceState = s;
      m.redraw();
    });
  },

  /** @param {{ state: any }} vnode */
  onremove(vnode) {
    vnode.state.voiceUnsub?.();
  },

  /** @param {{ attrs: { state: any, send: Send }, state: any }} vnode */
  view: ({ attrs: { state, send }, state: ui }) => {
    ui.runtimeState = state;
    const voiceManager = ui.mgr;
    const voiceEnabled = !!state.settings?.voiceEnabled;
    const voiceVariant = state.settings?.voiceVariant ?? 'base';
    const voiceEngine = state.settings?.voiceEngine ?? 'auto';
    const voiceSilenceMs = state.settings?.voiceSilenceMs ?? 1500;
    const voice = ui.voiceState ?? voiceManager?.getState?.() ?? null;
    const voiceStatus = voice?.status ?? 'idle';
    const voiceProgress = voice?.progress ?? 0;
    // Capability snapshot for the CURRENT preference. Reports both
    // availabilities so we can offer the on-device upgrade independently of
    // the live engine.
    const capability = detectVoiceCapability(voiceEngine, {
      moonshineHostAvailable: state.capabilities?.moonshineVoiceHost?.status === 'available',
    });
    // Active engine — live state from the manager. Only set after enable.
    const activeEngine = voice?.engine ?? null;
    const cloudVendor = voice?.cloudVendor ?? capability.cloudVendor ?? '浏览器供应商的云服务';
    // The on-device upgrade is offered whenever Moonshine is available and is
    // not already the live engine.
    const canUpgrade = capability.moonshine && activeEngine !== 'moonshine';

    // Enable voice. With no `engine` arg it uses the stored preference (instant
    // Web Speech under 'auto'); with engine === 'moonshine' it persists the
    // preference and downloads the on-device model (the upgrade).
    /** @param {string} [engine] */
    const enableVoice = async (engine) => {
      if (ui.voiceBusy) return;
      ui.voiceBusy = true;
      ui.voiceError = null;
      ui.voiceConfirmOpen = false;
      m.redraw();
      try {
        if (engine && engine !== voiceEngine) {
          await send({ type: 'settings/update', patch: { voiceEngine: engine } });
        }
        // why disable first: switching engines (Web Speech → Moonshine) must
        // tear down the live transcriber before the new one inits.
        if (voiceEnabled) await voiceManager?.disable?.();
        await voiceManager?.enable?.({ variant: voiceVariant, engine: engine ?? voiceEngine });
        await send({ type: 'settings/update', patch: { voiceEnabled: true } });
      } catch (e) {
        ui.voiceError = /** @type {{ message?: string }} */ (e)?.message ?? 'enable-failed';
        await send({ type: 'settings/update', patch: { voiceEnabled: false } });
      }
      ui.voiceBusy = false;
      m.redraw();
    };

    return m('div', [
      m('.voice-section', [
        // Lead paragraph — set expectations for the resolved engine.
        m('p', capability.engine === null
          ? '此浏览器不支持语音输入。请在输入框中键入。'
          : voiceEnabled
            ? activeEngine === 'moonshine'
              ? '语音输入已启用。使用 Moonshine — 转录完全在此设备上运行。'
              : activeEngine === 'web-speech'
                ? `语音输入已通过浏览器的 Web Speech API 启用 — 音频已发送到 ${cloudVendor} 进行转录。${capability.moonshine ? ' 在下方升级到本地设备转录。' : ''}`
                : '语音输入已启用。点击 peerd 面板中任何文本字段旁边的麦克风，然后说话。'
            : capability.webSpeech
              ? `与 peerd 语音交流而非输入。您浏览器的 Web Speech API 可即时使用 — 但它通常会将您的音频发送到 ${cloudVendor} 进行转录。`
              : '与 peerd 语音交流而非输入。此浏览器没有内置语音 API，因此 peerd 使用本地设备 Moonshine 模型 — 它下载一次（约 250 MB）然后完全在此设备上运行。'),

        // Moonshine download progress (after opt-in).
        voiceStatus === 'downloading' ? m('div', [
          m('.voice-status', activeEngine === 'moonshine'
            ? `下载语音模型中… ${Math.round(voiceProgress * 100)}%`
            : '准备中…'),
          activeEngine === 'moonshine' ? m('.voice-progress',
            m('.voice-progress-fill', { style: `width: ${Math.round(voiceProgress * 100)}%` }),
          ) : null,
        ]) : null,

        voiceStatus === 'available' || voiceStatus === 'listening'
          ? m('.voice-status.is-ok', activeEngine === 'moonshine'
              ? '✓ 语音就绪 — Moonshine（本地设备）'
              : '✓ 语音就绪 — Web Speech API（浏览器）')
          : null,

        voice?.error === 'mic-permission-denied'
          ? m(MicPermissionHelp, { voiceManager })
          : voice?.error ? m('.voice-status.is-err',
              voice.error === 'mic-hardware-error'
                ? '未检测到麦克风，或浏览器无法打开麦克风。请检查麦克风是否已连接并重试。'
                : voice.error === 'transcriber-network-error'
                  ? '无法访问浏览器的语音服务。请检查您的网络连接。'
                  : voice.error === 'model-integrity-check-failed'
                    ? '模型完整性检查失败。下载已被丢弃；请尝试不同的变体或更新扩展。'
                    : voice.error === 'voice-not-supported-in-this-build'
                      ? '此构建不支持语音（moonshine-js 未内置）。'
                      : `错误：${voice.error}`,
            ) : null,
        ui.voiceError ? m('.voice-status.is-err', ui.voiceError) : null,

        voiceEnabled || capability.engine !== null
          ? m('div', { style: 'display:flex; gap:8px; align-items:center; margin-top:8px;' }, [
          voiceEnabled
            ? m('button.secondary', {
                type: 'button',
                disabled: ui.voiceBusy,
                onclick: async () => {
                  if (ui.voiceBusy) return;
                  ui.voiceBusy = true;
                  ui.voiceError = null;
                  try {
                    await voiceManager?.disable?.();
                    await send({ type: 'settings/update', patch: { voiceEnabled: false } });
                  } catch (e) {
                    ui.voiceError = /** @type {{ message?: string }} */ (e)?.message ?? 'disable-failed';
                  }
                  ui.voiceBusy = false;
                  m.redraw();
                },
              }, '禁用语音')
            : m('button', {
                type: 'button',
                disabled: ui.voiceBusy || voiceStatus === 'downloading'
                  || (!capability.webSpeech && !capability.moonshine),
                onclick: () => {
                  // why: Web Speech is instant, so enable it with the inline
                  // disclosure above. Without Web Speech, Moonshine needs an
                  // explicit download confirmation first.
                  if (capability.webSpeech) enableVoice();
                  else { ui.voiceConfirmOpen = true; m.redraw(); }
                },
              }, capability.webSpeech ? '启用语音' : '启用语音（下载模型）'),
          ])
          : null,

        // ---- Upgrade to on-device transcription (Moonshine) ----------------
        // Always visible when Moonshine is available and not the live engine.
        // The privacy rationale + the ~250 MB cost are shown HERE, BEFORE the
        // user triggers any download (owner requirement).
        canUpgrade ? m('div', {
          style: 'border:1px solid var(--border); border-radius:var(--radius); padding:10px 12px; background:var(--bg-elev); margin-top:12px;',
        }, [
          m('p', { style: 'margin:0 0 4px; font-weight:600;' }, '升级到本地设备转录'),
          m('p.muted', { style: 'margin:0 0 8px;' }, [
            'Web Speech 无需下载，但它通常 ',
            m('strong', '将您的音频发送到浏览器供应商的服务器'),
            ' 进行转录。Moonshine 下载一次（约 250 MB，本地缓存）使语音转文本完全在此设备上运行 — peerd 避免了云往返。',
          ]),
          m('button.secondary', {
            type: 'button',
            disabled: ui.voiceBusy || voiceStatus === 'downloading',
            onclick: () => { ui.voiceConfirmOpen = true; m.redraw(); },
          }, '升级到本地设备（Moonshine）'),
        ]) : null,

        // Silence threshold (only when enabled). The Model line is Moonshine-
        // specific, so it only shows when Moonshine is the live engine.
        voiceEnabled ? m('div', { style: 'margin-top:14px; display:flex; flex-direction:column; gap:6px;' }, [
          activeEngine === 'moonshine' ? m('label', { style: 'font-size:13px;' }, '模型') : null,
          activeEngine === 'moonshine'
            ? m('p.muted', { style: 'margin:0;' }, 'Moonshine 基础版 — 约 250 MB，在本地设备上运行（下载一次，本地缓存）。')
            : null,
          m('label', { style: 'font-size:13px; margin-top:8px;' },
            `静音停止：${(voiceSilenceMs / 1000).toFixed(1)}s`),
          m('input', {
            type: 'range',
            min: 500, max: 5000, step: 100,
            value: voiceSilenceMs,
            disabled: ui.voiceBusy,
            oninput: (/** @type {{ target: HTMLInputElement }} */ e) => {
              const ms = Number(e.target.value);
              send({ type: 'settings/update', patch: { voiceSilenceMs: ms } });
              voiceManager?.setSilenceThreshold?.(ms);
            },
          }),
        ]) : null,

        // ---- Moonshine download confirmation modal ------------------------
        // Reached from "Upgrade to on-device" (Chrome) or "Enable voice"
        // (Firefox, where it's required). Always about the on-device model.
        ui.voiceConfirmOpen ? m('.peerd-modal-backdrop', {
          onclick: (/** @type {Event} */ e) => { if (e.target === e.currentTarget) ui.voiceConfirmOpen = false; },
        }, m('.peerd-modal', [
          m('h3', '下载本地设备语音模型？'),
          m('p', [
            'peerd 将使用 ',
            m('a', {
              href: 'https://github.com/moonshine-ai/moonshine',
              target: '_blank',
              rel: 'noopener noreferrer',
            }, 'Moonshine'),
            '，一个开源的本地语音识别模型。',
          ]),
          m('ul', [
            m('li', '下载大小：约 250 MB（一次性，之后本地缓存）'),
            m('li', '来源：已固定的 Hugging Face 提交'),
            m('li', m('strong', '下载后：100% 本地设备 — 您的音频永远不会离开此设备')),
            m('li', '存储：仅在此浏览器的 IndexedDB 中'),
            m('li', '许可证：MIT'),
          ]),
          !capability.webSpeech
            ? m('p.muted', { style: 'margin:8px 0 0;' },
                '此浏览器没有内置语音 API，因此需要本地设备模型才能使用语音。')
            : null,
          m('.peerd-modal-actions', [
            m('button.secondary', {
              type: 'button',
              disabled: ui.voiceBusy,
              onclick: () => { ui.voiceConfirmOpen = false; m.redraw(); },
            }, '取消'),
            m('button', {
              type: 'button',
              disabled: ui.voiceBusy || !capability.moonshine,
              onclick: () => enableVoice('moonshine'),
            }, '下载并启用'),
          ]),
        ])) : null,
      ]),
      m('hr', { style: 'border:none; border-top:1px solid var(--border); margin:20px 0;' }),
      m(OcrSection, { state, send }),
      resetRow(send, ['voiceEnabled', 'voiceVariant', 'voiceEngine', 'voiceSilenceMs', 'voiceOnboardingDismissed', 'ocrEnabled']),
    ]);
  },
};

// ---- mic permission help -------------------------------------------------
//
// Shown when state.error === 'mic-permission-denied'. The two situations
// that put us here are:
//   1. The user denied the browser prompt (or denied it earlier and the
//      browser cached the rejection).
//   2. Chrome itself doesn't have OS-level mic permission. On macOS,
//      that's System Settings → Privacy → Microphone → Chrome.
// Neither is fixable from extension code. The button below opens
// chrome://settings/content/microphone in a new tab so the user is one
// click away from the relevant browser-level setting. The text walks
// them through the OS-level case in parallel — we can't detect which
// of the two it is, so we name both.

const platformLabel = () => {
  const ua = navigator.userAgent ?? '';
  if (/Mac OS X|Macintosh/.test(ua)) return 'mac';
  if (/Windows/.test(ua)) return 'windows';
  if (/Linux/.test(ua)) return 'linux';
  return 'other';
};

const MicPermissionHelp = {
  /** @param {{ attrs: { voiceManager: any } }} vnode */
  view: ({ attrs: { voiceManager } }) => {
    const platform = platformLabel();
    return m('div', { style: 'border:1px solid var(--warn); border-radius:var(--radius); padding:10px 12px; background:var(--bg-elev); margin-top:8px;' }, [
      m('p', { style: 'margin:0 0 8px; font-weight:600; color:var(--warn);' },
        '麦克风访问被阻止。'),
      m('p.muted', { style: 'font-size:12px; margin:0 0 8px;' },
        '扩展页面在 Chrome 中无法始终显示麦克风提示。'
        + '点击下方按钮打开专用授权页面 — 您的浏览器'
        + '将在此处显示权限提示，授权将返回到'
        + '每个 peerd 界面（此页面和面板）。'),
      m('p.muted', { style: 'font-size:12px; margin:0 0 8px;' },
        '如果授权页面也无法提示，最可能的原因是您的'
        + '操作系统阻止了浏览器本身的麦克风访问：'),
      m('ol', { style: 'font-size:12px; padding-left:18px; margin:0 0 10px;' }, [
        platform === 'mac' ? m('li', { style: 'margin-bottom:6px;' }, [
          m('strong', 'macOS：'),
          ' 系统设置 → 隐私与安全性 → 麦克风 → 启用 Google Chrome。',
        ]) : platform === 'windows' ? m('li', { style: 'margin-bottom:6px;' }, [
          m('strong', 'Windows：'),
          ' 设置 → 隐私和安全 → 麦克风 → 麦克风访问开启，且允许 Chrome。',
        ]) : m('li', { style: 'margin-bottom:6px;' },
          '在您的操作系统隐私设置中允许浏览器访问麦克风。'),
      ]),
      m('div', { style: 'display:flex; gap:8px; align-items:center; flex-wrap:wrap;' }, [
        m('button', {
          type: 'button',
          onclick: () => {
            // why: opening a dedicated extension page in a real tab works
            // where panel/options prompts don't — the grant lands at
            // chrome-extension://<id> origin and every extension surface
            // inherits it for subsequent calls.
            try {
              browser.tabs.create({ url: browser.runtime.getURL('permissions/mic.html') });
            } catch (e) {
              console.warn('[options] open grant page failed', e);
            }
          },
        }, '授予麦克风访问权限'),
        // why the guard: chrome://settings/* only exists on Chromium, and
        // Firefox refuses tabs.create for its privileged about: pages —
        // there is no equivalent deep link to offer, so on Firefox the
        // shortcut is omitted rather than shipped broken.
        browser.runtime.getURL('').startsWith('chrome-extension://')
          ? m('button.secondary', {
            type: 'button',
            onclick: () => {
              try {
                browser.tabs.create({ url: 'chrome://settings/content/microphone' });
              } catch (e) {
                console.warn('[options] open browser settings failed', e);
              }
            },
          }, '打开浏览器麦克风设置')
          : null,
        m('button.secondary', {
          type: 'button',
          onclick: () => {
            // Clear the cached error so the UI returns to a clean
            // state. The next enable/mic attempt re-runs the prompt; if
            // the user fixed the underlying setting in the meantime, it
            // goes through.
            voiceManager?.clearError?.();
          },
        }, '清除错误并重试'),
      ]),
    ]);
  },
};
