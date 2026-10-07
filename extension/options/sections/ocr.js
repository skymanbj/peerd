// @ts-check
// Options → OCR (rendered inside the combined "Voice & OCR" tab).
//
// Where the runtime has a document host, peerd reads PDF text with pdf.js by
// default. Scanned or image-only PDFs have no text layer, so they need OCR: an
// on-device engine downloaded once.
// This section owns that opt-in download. It lives in its own file (one section
// = one file, the established options pattern) but is mounted alongside the
// Voice section under a single "Voice & OCR" nav entry — both are heavy on-device
// model downloads, so the owner groups them in one tab.
//
// The engine SRIs are pinned before shipping (scripts/compute-ocr-sri.sh); until
// they are, the download is fail-closed and the button reads "not available in
// this build yet" — exactly how voice's Moonshine upgrade behaved pre-pinning.

import m from '/vendor/mithril/mithril.js';
import { createOcrStore, hasValidOcrSris, OCR_TOTAL_BYTES } from '/peerd-runtime/index.js';

export const OcrSection = {
  oninit(/** @type {any} */ vnode) {
    vnode.state.busy = false;
    vnode.state.progress = 0;
    vnode.state.error = null;
    vnode.state.installed = null;     // null = unknown until checked
    vnode.state.confirmOpen = false;
    // The download runs in THIS options context (synchronous progress, no
    // per-chunk message overhead — the voice rationale). The offscreen extractor
    // later reads the same cached bytes by URL.
    vnode.state.store = createOcrStore();
    vnode.state.store.isInstalled({ dev: false })
      .then((/** @type {any} */ ok) => { vnode.state.installed = ok; m.redraw(); })
      .catch(() => { vnode.state.installed = false; m.redraw(); });
  },

  view: (/** @type {{ attrs: { state: any, send: any }, state: any }} */ { attrs: { state, send }, state: ui }) => {
    const hostAvailable = state.capabilities?.pdfOcr?.status === 'available';
    const shippable = hasValidOcrSris();
    // Readiness reflects the ACTUAL cached engine (isInstalled), not the
    // ocrEnabled setting — a cleared IDB cache must not show "✓ installed" while
    // extraction would fail. ocrEnabled is persisted INTENT only.
    const ocrReady = ui.installed === true;
    const sizeMb = Math.round(OCR_TOTAL_BYTES / 1_000_000);

    const enableOcr = async () => {
      if (ui.busy) return;
      if (!hostAvailable) {
        ui.error = '此浏览器中无法使用 OCR。请改用页面图像或可搜索的 PDF。';
        m.redraw();
        return;
      }
      ui.busy = true;
      ui.error = null;
      ui.confirmOpen = false;
      ui.progress = 0;
      m.redraw();
      try {
        await ui.store.getEngine({ onProgress: (/** @type {number} */ p) => { ui.progress = Math.max(0, Math.min(1, p)); m.redraw(); }, dev: false });
        await send({ type: 'settings/update', patch: { ocrEnabled: true } });
        ui.installed = true;
      } catch (e) {
        ui.error = (/** @type {{ message?: string }} */ (e))?.message ?? 'download-failed';
        await send({ type: 'settings/update', patch: { ocrEnabled: false } });
      }
      ui.busy = false;
      m.redraw();
    };

    return m('.ocr-section', [
      m('h3', { style: 'margin:0 0 4px; font-size:15px;' }, 'PDF OCR（扫描文档）'),
      m('p.muted', { style: 'margin:0 0 8px;' }, hostAvailable ? [
        'peerd 使用内置的 pdf.js 文本读取器自动读取 PDF — ',
        '无需设置。 ',
        m('strong', '扫描或拍照的 PDF'),
        ' 没有文本层，因此需要 OCR：一个本地设备引擎，',
        `下载一次（约 ${sizeMb} MB，本地缓存）然后完全在此设备上识别文本。`,
      ] : '此浏览器中无法使用 PDF OCR。请改用页面图像或可搜索的 PDF。'),

      hostAvailable && ocrReady
        ? m('.voice-status.is-ok', '✓ OCR 引擎已安装 — 扫描的 PDF 可读')
        : null,

      ui.busy ? m('div', [
        m('.voice-status', `下载 OCR 引擎中… ${Math.round(ui.progress * 100)}%`),
        m('.voice-progress', m('.voice-progress-fill', { style: `width: ${Math.round(ui.progress * 100)}%` })),
      ]) : null,

      ui.error ? m('.voice-status.is-err', `错误：${ui.error}`) : null,

      hostAvailable ? m('div', { style: 'display:flex; gap:8px; align-items:center; margin-top:8px;' }, [
        ocrReady
          ? null
          : m('button', {
              type: 'button',
              disabled: ui.busy || !shippable,
              onclick: () => { ui.confirmOpen = true; m.redraw(); },
            }, shippable ? `下载 OCR 引擎（约 ${sizeMb} MB）` : '此构建中 OCR 尚不可用'),
      ]) : null,

      hostAvailable && !shippable
        ? m('p.muted', { style: 'font-size:12px; margin:8px 0 0;' },
            '此构建的 OCR 引擎尚未固定。pdf.js 仍可读取原生数字 PDF。')
        : null,

      // Download confirmation — facts shown BEFORE any download (the voice rule).
      hostAvailable && ui.confirmOpen ? m('.peerd-modal-backdrop', {
        onclick: (/** @type {any} */ e) => { if (e.target === e.currentTarget) { ui.confirmOpen = false; m.redraw(); } },
      }, m('.peerd-modal', [
        m('h3', '下载本地 OCR 引擎？'),
        m('ul', [
          m('li', `下载大小：约 ${sizeMb} MB（一次性，之后本地缓存）`),
          m('li', m('strong', '下载后：100% 本地设备 — 页面图像永远不会离开此设备')),
          m('li', '存储：仅在此浏览器的 IndexedDB 中'),
          m('li', '来源：已固定，完整性检查（SHA-384 SRI）'),
        ]),
        m('.peerd-modal-actions', [
          m('button.secondary', { type: 'button', disabled: ui.busy, onclick: () => { ui.confirmOpen = false; m.redraw(); } }, '取消'),
          m('button', { type: 'button', disabled: ui.busy || !shippable, onclick: enableOcr }, '下载并启用'),
        ]),
      ])) : null,
    ]);
  },
};
