// @ts-check
// Options → Backup & restore — the explicit migration path between
// installs, including between peerd (store) and peerd preview, which
// are separate extensions with isolated storage by design. Backed by the
// existing guarded transfer routes:
// transfer/export + transfer/inspectImport + transfer/import.

import m from '/vendor/mithril/mithril.js';
import { CHANNEL } from '/shared/channel-config.js';
import { bundleToOtlp, EXPORT_PASSPHRASE_MIN_LENGTH } from '/peerd-runtime/index.js';
import { EXPORT_FILE_LIMIT_BYTES } from '/peerd-engine/index.js';
import { PrivateTransferPortError } from '../private-transfer-client.js';

const MAX_BACKUP_FILE_BYTES = 32 * 1024 * 1024;
const IMPORT_NOT_STARTED_CODES = new Set([
  'channel-unavailable', 'channel-request-failed', 'channel-timeout', 'post-failed',
]);
/** @param {string | null | undefined} did */
const displayDid = (did) => did || '未知';
/** @param {any} summary */
const hasApplicableImport = (summary) => !!summary && (
  summary.settingsKeys?.length > 0
  || summary.hasSecrets
  || (summary.hasIdentityRecord && !summary.dwebDropped)
  || summary.memoryDocs > 0
  || summary.hooks > 0
  || summary.endpointUrls?.length > 0
);
/** @param {any} counts */
const describeImportedCounts = (counts = {}) =>
  `${counts.settings ?? 0} 个设置、${counts.secrets ?? 0} 个存储的凭据、`
  + `${counts.providerEndpoints ?? 0} 个提供者端点、${counts.memoryWritten ?? 0} 个内存文档，`
  + `以及 ${counts.hooks ?? 0} 个钩子`;
/** @param {string | null | undefined} failure */
const describeImportFailure = (failure) => (/** @type {Record<string, string>} */ ({
  'wrong-passphrase': '无法用该密码短语解锁对等身份。',
  'dweb-identity-stop-failed': '无法安全暂停对等网络。',
  'dweb-identity-store-failed': '无法存储对等身份。',
  'dweb-identity-resume-failed': '无法恢复对等网络。',
  'write-failed': '本地写入失败。',
}))[failure ?? ''] ?? '某个本地恢复步骤失败。';
/** @param {string | null | undefined} error */
const describeImportError = (error) => {
  if (error?.startsWith('unsupported-export-version-')) {
    return '此备份由不兼容的 peerd 版本创建。请更新 peerd 后重试。';
  }
  return (/** @type {Record<string, string>} */ ({
    'wrong-passphrase': '此备份的加密凭据或对等身份的密码短语不正确。',
    'vault-locked': '保险库已锁定。请在 peerd 面板中解锁后重试。',
    'dweb-identity-in-use': '在本地创作的应用仍被共享时无法替换此身份。请先取消共享，然后重试。',
    'dweb-identity-unavailable': '此构建中无法恢复对等身份。请更新 peerd preview 后重试。',
    'dweb-identity-dweb-disabled': '由于此构建中禁用了对等网络，无法恢复对等身份。',
    'dweb-identity-vault-locked': '保险库已锁定。请在 peerd 面板中解锁后重试。',
    'dweb-identity-identity-changed': '审阅后本地对等身份发生了变化。请在决定是否替换之前再次检查备份。',
    'dweb-identity-no-openable-wrapper': '无法用该密码短语解锁对等身份。',
    'dweb-identity-invalid-local-identity': '本地对等身份已损坏。请停止，并从已知良好的备份中恢复它，然后再导入其他状态。',
    'dweb-identity-unsupported': '此备份使用的对等身份格式本构建无法恢复。请更新 peerd preview 后重试。',
    'dweb-identity-adopt-failed': '无法恢复对等身份。请重新打开 peerd 后重试。',
    'dweb-identity-approval-required': '身份替换批准已过期。请检查备份并再次审阅两个身份。',
    'not-a-peerd-export': '该文件不是 peerd 导出。',
    'invalid-export-sections': '该 peerd 导出包含格式错误或过大的部分，已被拒绝。',
  }))[error ?? ''] ?? '导入失败。请重新打开 peerd，再次检查备份，然后重试。';
};
/** @param {unknown} value */
const describeSettingValue = (value) => {
  const encoded = JSON.stringify(value);
  return typeof encoded === 'string' ? encoded : String(value);
};

/** @typedef {import('./reset-row.js').Send} Send */

export const TransferSection = {
  /** @param {{ state: any, attrs: { send: Send } }} vnode */
  oninit(vnode) {
    vnode.state.exportPass = '';
    vnode.state.exportConfirm = '';
    vnode.state.exportBusy = false;
    vnode.state.exportMsg = null;             // { ok, text }
    vnode.state.importPayload = null;         // parsed export file
    vnode.state.importSummary = null;         // inspectImport summary
    vnode.state.importPass = '';
    vnode.state.importBusy = false;
    vnode.state.importInspectBusy = false;
    vnode.state.importMsg = null;             // { ok, text } | null
    vnode.state.importNotices = [];
    vnode.state.identityConflict = null;
    vnode.state.replacementPending = false;
    vnode.state.importFileInput = null;
    vnode.state.importInspectGeneration = 0;
    vnode.state.restoreFocusToReview = false;
    vnode.state.focusImportFileOnUpdate = false;
    vnode.state.focusImportStatusOnUpdate = false;
    // Artifacts (.peerd app/notebook/vm files — DESIGN-10). Same
    // inspect-then-apply shape as the settings import above, but a
    // separate state island: artifacts and settings never mix.
    vnode.state.artifactEnvelope = null;      // parsed .peerd envelope
    vnode.state.artifactSummary = null;       // import/inspect summary
    vnode.state.artifactBusy = false;
    vnode.state.artifactMsg = null;           // { ok, text } | null
    // Debug bundle (the debug surface's options-page entry point): a session
    // picker over ALL chats — unlike the in-chat debug chip, this reaches any
    // past session without opening it.
    vnode.state.debugSessions = null;         // null = loading; [] = none
    vnode.state.debugSessionId = '';
    vnode.state.debugBusy = false;
    vnode.state.debugMsg = null;              // { ok, text } | null
    Promise.resolve(vnode.attrs.send({ type: 'session/list' })).then((reply) => {
      vnode.state.debugSessions = reply?.ok !== false && Array.isArray(reply?.sessions) ? reply.sessions : [];
      vnode.state.debugSessionId = vnode.state.debugSessions[0]?.sessionId ?? '';
      m.redraw();
    }).catch(() => { vnode.state.debugSessions = []; m.redraw(); });
  },

  /** @param {{ attrs: { send: Send }, state: any }} vnode */
  view: ({ attrs: { send }, state: ui }) => {
    // The debug surface: same route + pure OTel mapper the in-chat chip uses;
    // the options page adds only the session picker (any chat, not just the
    // open one) and this save shell.
    const exportDebug = async (/** @type {'json'|'otlp'} */ format) => {
      if (ui.debugBusy || !ui.debugSessionId) return;
      ui.debugBusy = true;
      ui.debugMsg = null;
      m.redraw();
      try {
        const reply = await send({ type: 'session/debugBundle', sessionId: ui.debugSessionId });
        if (!reply?.ok) {
          ui.debugMsg = {
            ok: false,
            text: reply?.error === 'locked' ? '保险库已锁定 — 先在 peerd 面板中解锁。' : (reply?.error ?? '导出失败。'),
          };
          return;
        }
        const payload = format === 'otlp' ? bundleToOtlp(reply.bundle) : reply.bundle;
        const stem = format === 'otlp' ? 'peerd-trace' : 'peerd-debug';
        const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${stem}-${ui.debugSessionId.slice(0, 8)}-${new Date().toISOString().slice(0, 10)}.json`;
        a.click();
        URL.revokeObjectURL(url);
        ui.debugMsg = { ok: true, text: format === 'otlp' ? 'OTel 追踪已保存。' : '调试包已保存。' };
      } finally {
        ui.debugBusy = false;
        m.redraw();
      }
    };

    const doExport = async () => {
      if (ui.exportBusy) return;
      ui.exportMsg = null;
      if (ui.exportPass.length < EXPORT_PASSPHRASE_MIN_LENGTH) {
        ui.exportMsg = {
          ok: false,
          text: `请使用长且唯一的密码短语（${EXPORT_PASSPHRASE_MIN_LENGTH}+ 个字符）。`,
        };
        return;
      }
      if (ui.exportPass !== ui.exportConfirm) {
        ui.exportMsg = { ok: false, text: '密码短语不匹配。' };
        return;
      }
      ui.exportBusy = true;
      m.redraw();
      try {
        const reply = await send({ type: 'transfer/export', passphrase: ui.exportPass });
        if (reply?.ok) {
          const blob = new Blob([JSON.stringify(reply.payload, null, 2)], { type: 'application/json' });
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = `peerd-export-${new Date().toISOString().slice(0, 10)}.json`;
          a.click();
          URL.revokeObjectURL(url);
          ui.exportPass = '';
          ui.exportConfirm = '';
          ui.exportMsg = {
            ok: true,
            text: reply.identityIncluded
              ? `备份已保存，包含对等身份 ${displayDid(reply.identityDid)}。请妥善保管文件和密码短语。`
              : CHANNEL === 'preview'
                ? '备份已保存，但未包含对等身份，因为此安装尚无对等身份。请妥善保管文件和密码短语。'
                : '备份已保存。此构建不携带对等身份。请妥善保管文件和密码短语。',
          };
        } else {
          ui.exportMsg = {
            ok: false,
            text: reply?.error === 'vault-locked' ? '保险库已锁定 — 先在 peerd 面板中解锁。'
              : reply?.error === 'passphrase-required' ? `需要长密码短语（${EXPORT_PASSPHRASE_MIN_LENGTH}+ 个字符）来保护凭据和对等身份。`
              : reply?.error === 'identity-export-failed' ? '备份已停止，因为无法保护您的对等身份。未下载任何内容；请重新打开 peerd 后重试。'
              : reply?.error ?? '导出失败。',
          };
        }
      } catch {
        ui.exportMsg = { ok: false, text: '创建备份时 peerd 变得不可用。请重新打开 peerd 后重试。' };
      } finally {
        ui.exportBusy = false;
        m.redraw();
      }
    };

    const onImportFile = async (/** @type {{ target: HTMLInputElement }} */ e) => {
      const generation = ++ui.importInspectGeneration;
      ui.importMsg = null;
      ui.importSummary = null;
      ui.importPayload = null;
      ui.importNotices = [];
      ui.identityConflict = null;
      ui.replacementPending = false;
      const file = e.target.files?.[0];
      if (!file) return;
      ui.importInspectBusy = true;
      m.redraw();
      if (file.size > MAX_BACKUP_FILE_BYTES) {
        ui.importMsg = { ok: false, text: '该备份过大，无法安全导入（最大 32 MB）。' };
        e.target.value = '';
        ui.importInspectBusy = false;
        m.redraw();
        return;
      }
      let payload;
      try {
        payload = JSON.parse(await file.text());
      } catch {
        if (generation !== ui.importInspectGeneration) return;
        ui.importMsg = { ok: false, text: '无法将该文件解析为 JSON。' };
        e.target.value = '';
        ui.importInspectBusy = false;
        m.redraw();
        return;
      }
      if (generation !== ui.importInspectGeneration) return;
      try {
        const reply = await send({ type: 'transfer/inspectImport', payload });
        if (generation !== ui.importInspectGeneration) return;
        if (reply?.ok) {
          ui.importPayload = payload;
          ui.importSummary = reply.summary;
        } else {
          ui.importMsg = {
            ok: false,
            text: describeImportError(reply?.error),
          };
          e.target.value = '';
        }
      } catch {
        if (generation !== ui.importInspectGeneration) return;
        ui.importMsg = { ok: false, text: '检查备份时 peerd 变得不可用。请重新打开 peerd 后重试。' };
        e.target.value = '';
      }
      if (generation === ui.importInspectGeneration) ui.importInspectBusy = false;
      m.redraw();
    };

    const onArtifactFile = async (/** @type {{ target: HTMLInputElement }} */ e) => {
      ui.artifactMsg = null;
      ui.artifactSummary = null;
      ui.artifactEnvelope = null;
      const file = e.target.files?.[0];
      if (!file) return;
      if (file.size > EXPORT_FILE_LIMIT_BYTES) {
        ui.artifactMsg = {
          ok: false,
          text: `该工件过大，无法安全导入（最大 ${Math.round(EXPORT_FILE_LIMIT_BYTES / 1024 / 1024)} MB）。`,
        };
        e.target.value = '';
        m.redraw();
        return;
      }
      let envelope;
      try {
        envelope = JSON.parse(await file.text());
      } catch {
        ui.artifactMsg = { ok: false, text: '无法将该文件解析为 .peerd 信封。' };
        m.redraw();
        return;
      }
      try {
        const reply = await send({ type: 'import/inspect', envelope });
        if (reply?.ok) {
          ui.artifactEnvelope = envelope;
          ui.artifactSummary = reply.summary;
        } else {
          ui.artifactMsg = { ok: false, text: reply?.error ?? '无法读取该文件。' };
        }
      } catch {
        ui.artifactMsg = { ok: false, text: '检查工件时 peerd 变得不可用。请重新打开 peerd 后重试。' };
      }
      m.redraw();
    };

    const doArtifactApply = async () => {
      if (ui.artifactBusy || !ui.artifactEnvelope) return;
      ui.artifactBusy = true;
      ui.artifactMsg = null;
      m.redraw();
      try {
        const reply = await send({ type: 'import/apply', envelope: ui.artifactEnvelope });
        if (reply?.ok) {
          ui.artifactMsg = {
            ok: true,
            text: reply.kind === 'vm'
              ? `已导入为新 VM（${reply.id}）。基础镜像已钉住完整性；首次启动时会流式拉取。`
              : `已导入为新 ${reply.kind}（${reply.id}）。`,
          };
          ui.artifactEnvelope = null;
          ui.artifactSummary = null;
        } else {
          ui.artifactMsg = { ok: false, text: reply?.error ?? '导入失败。' };
        }
      } catch {
        ui.artifactMsg = { ok: false, text: '工件导入期间 peerd 变得不可用。请重新打开 peerd 后重试。' };
      } finally {
        ui.artifactBusy = false;
        m.redraw();
      }
    };

    /** @param {boolean} [focusFile] */
    const clearImportSelection = (focusFile = false) => {
      ui.importInspectGeneration++;
      ui.importPayload = null; ui.importSummary = null; ui.importPass = '';
      ui.identityConflict = null; ui.replacementPending = false;
      ui.importNotices = [];
      if (ui.importFileInput) ui.importFileInput.value = '';
      if (focusFile) ui.focusImportFileOnUpdate = true;
    };

    /** @param {'normal'|'replace'|'skip'} identityChoice */
    const doImport = async (identityChoice = 'normal') => {
      if (ui.importBusy || !ui.importPayload) return;
      ui.importBusy = true;
      ui.importMsg = null;
      m.redraw();
      try {
        const reply = await send({
          type: 'transfer/import',
          payload: ui.importPayload,
          passphrase: ui.importPass,
          replaceDwebIdentity: identityChoice === 'replace',
          skipDwebIdentity: identityChoice === 'skip',
          ...(identityChoice === 'replace' ? {
            approvedExistingDwebDid: ui.identityConflict?.existingDid,
            approvedExistingDwebRevision: ui.identityConflict?.existingRevision,
            approvedIncomingDwebDid: ui.identityConflict?.incomingDid,
          } : {}),
        });
        if (reply?.ok) {
          ui.importNotices = reply.notices ?? [];
          const identityText = (/** @type {Record<string, string>} */ ({
            restored: ' 对等身份已恢复。',
            replaced: ' 先前的对等身份已被替换。',
            'already-present': ' 备份的对等身份已存在。',
            'kept-local': ' 已保留本地对等身份。',
            unsupported: ' 此构建不支持备份的对等身份。',
            'not-present': '',
          }))[reply.identityOutcome ?? 'not-present'] ?? '';
          const recoveryText = reply.runtimeRecoveryPending
            ? ' 对等网络仍在恢复中。请保持 peerd 打开；它会自动重试。'
            : '';
          ui.importMsg = {
            ok: true,
            text: `已导入 ${reply.imported.settings} 个设置、${reply.imported.secrets} 个存储的凭据、`
              + `${reply.imported.providerEndpoints ?? 0} 个提供者端点、`
              + `${reply.imported.memoryWritten} 个内存文档，以及 ${reply.imported.hooks} 个钩子。${identityText}${recoveryText}`,
          };
          ui.importPayload = null;
          ui.importSummary = null;
          ui.importPass = '';
          ui.identityConflict = null;
          ui.replacementPending = false;
          ui.focusImportStatusOnUpdate = true;
          if (ui.importFileInput) ui.importFileInput.value = '';
        } else if (reply?.partial) {
          ui.identityConflict = null;
          ui.replacementPending = false;
          ui.importMsg = {
            ok: false,
            text: `导入在恢复 ${describeImportedCounts(reply.partial)} 后停止。`
              + `对等身份未更改。${describeImportFailure(reply.failure)} `
              + '请在选择备份文件之前检查本地状态。',
          };
          clearImportSelection(true);
        } else if (reply?.error === 'dweb-identity-conflict') {
          ui.identityConflict = reply.conflict;
          ui.replacementPending = false;
          ui.importMsg = null;
        } else {
          ui.importMsg = {
            ok: false,
            text: describeImportError(reply?.error),
          };
        }
      } catch (error) {
        if (error instanceof PrivateTransferPortError
            && IMPORT_NOT_STARTED_CODES.has(error.code)) {
          ui.importMsg = {
            ok: false,
            text: '恢复未开始，因为私有连接不可用。请关闭其他 peerd 设置标签页，然后重试。',
          };
          ui.focusImportStatusOnUpdate = true;
        } else {
          ui.importMsg = {
            ok: false,
            text: '导入期间与 peerd 的连接丢失，因此其最终状态未知。请重新打开 peerd，检查本地状态，然后再次选择备份文件。',
          };
          clearImportSelection(true);
        }
      } finally {
        ui.importBusy = false;
        m.redraw();
      }
    };

    return m('.transfer-section', [
      m('h3', '备份 peerd'),
      m('p', '下载一个 JSON 文件，包含您的设置、内存、钩子、'
        + '技能列表、提供者端点、加密凭据，以及在 '
        + '预览构建中您的加密对等身份。大多数设置在文件中保持 '
        + '可读；密码短语保护凭据和身份。 '
        + '用此备份，或将状态迁移到 '
        + 'peerd 和 peerd preview 之间（独立安装，从不 '
        + '自动共享存储）。'),
      m('.input-row', [
        m('label', { for: 'exppass' }, '导出密码短语'),
        m('input', {
          id: 'exppass', type: 'password', autocomplete: 'new-password',
          minlength: EXPORT_PASSPHRASE_MIN_LENGTH, 'aria-describedby': 'backup-passphrase-help',
          value: ui.exportPass, disabled: ui.exportBusy,
          oninput: (/** @type {{ target: HTMLInputElement }} */ e) => { ui.exportPass = e.target.value; },
        }),
      ]),
      m('p.hint', { id: 'backup-passphrase-help' },
        `使用 ${EXPORT_PASSPHRASE_MIN_LENGTH}+ 个字符。恢复加密凭据或您的对等身份时需要此密码短语。`),
      m('.input-row', [
        m('label', { for: 'exppass2' }, '确认密码短语'),
        m('input', {
          id: 'exppass2', type: 'password', autocomplete: 'new-password',
          value: ui.exportConfirm, disabled: ui.exportBusy,
          oninput: (/** @type {{ target: HTMLInputElement }} */ e) => { ui.exportConfirm = e.target.value; },
        }),
      ]),
      m('div', { style: 'display:flex; gap:8px; align-items:center;' }, [
        m('button', { type: 'button', disabled: ui.exportBusy, onclick: doExport },
          ui.exportBusy ? '正在创建备份…' : '下载备份'),
      ]),
      ui.exportMsg ? m(ui.exportMsg.ok ? 'p.transfer-status.transfer-status--success' : 'p.error.transfer-status.transfer-status--error',
        { role: ui.exportMsg.ok ? 'status' : 'alert' },
        ui.exportMsg.text) : null,

      m('.settings-divider'),
      m('h3', '从备份恢复'),
      m('p', '选择一个 peerd 导出文件。您将在任何内容被应用之前看到它的确切内容以及将被覆盖的部分。'),
      m('label', { for: 'peerd-backup-file' }, '备份文件'),
      m('input', {
        id: 'peerd-backup-file', type: 'file', accept: 'application/json,.json',
        disabled: ui.importBusy,
        oncreate: (/** @type {{ dom: HTMLInputElement }} */ vnode) => { ui.importFileInput = vnode.dom; },
        onupdate: (/** @type {{ dom: HTMLInputElement }} */ vnode) => {
          if (ui.focusImportFileOnUpdate && !vnode.dom.disabled) {
            ui.focusImportFileOnUpdate = false;
            vnode.dom.focus();
          }
        },
        onchange: onImportFile,
      }),
      ui.importInspectBusy ? m('.transfer-progress-row', [
        m('p.transfer-progress', { role: 'status', 'aria-live': 'polite' },
          '正在检查备份。请保持此页面打开，或取消并选择其他文件。'),
        m('button.secondary', {
          type: 'button',
          onclick: () => { ui.importInspectBusy = false; clearImportSelection(true); },
        }, '取消检查'),
      ]) : null,
      ui.importSummary ? m('span.sr-only', { role: 'status' }, '备份已检查。请查看导入摘要并选择要恢复的内容。') : null,
      ui.importSummary ? m('.import-summary', {
        id: 'restore-summary', tabindex: -1, 'aria-busy': ui.importBusy ? 'true' : 'false',
        oncreate: (/** @type {{ dom: HTMLElement }} */ vnode) => vnode.dom.focus(),
      }, [
        m('h3', '此导入将应用：'),
        m('ul', [
          ui.importSummary.settingsKeys.length > 0
            ? m('li', [
                `${ui.importSummary.settingsKeys.length} 个设置将覆盖您当前的值。`,
                m('details.import-setting-values', [
                  m('summary', '查看完整的设置值'),
                  m('ul', ui.importSummary.settingsKeys.map((/** @type {string} */ key) =>
                    m('li', m('code', `${key} = ${describeSettingValue(ui.importPayload?.settings?.[key])}`)))),
                ]),
              ])
            : null,
          ui.importSummary.hasSecrets ? m('li', '存储的凭据（已加密 — 下方需要密码短语）；同名的现有凭据将被覆盖') : null,
          ui.importSummary.hasIdentityRecord
            ? m('li', [
                '对等身份 ', m('code.identity-did', displayDid(ui.importSummary.identityDid)),
                ' （已加密；恢复它可能会替换此安装上创建的身份）',
              ])
            : null,
          ui.importSummary.memoryDocs > 0 ? m('li', `${ui.importSummary.memoryDocs} 个内存文档 — 较新的本地编辑保留（后写者胜）`) : null,
          ui.importSummary.hooks > 0 ? m('li', `${ui.importSummary.hooks} 个钩子 — 相同 id 的钩子将被替换`) : null,
          ui.importSummary.skills.length > 0 ? m('li', `技能列表（仅元数据）：${ui.importSummary.skills.join(', ')}`) : null,
        ]),
        ui.importSummary.notices.map((/** @type {string} */ n) => m('p.hint', n)),
        ui.importSummary.sourceChannel && ui.importSummary.sourceChannel !== CHANNEL
          ? m('p.hint', `此导出来自 ${ui.importSummary.sourceChannel} 构建；您当前在 ${CHANNEL}。您的显式值完整传输 — 渠道默认值仅适用于您未触碰的设置。`)
          : null,
        ui.importSummary.requiresPassphrase ? m('.input-row', [
          m('label', { for: 'imppass' }, '文件密码短语'),
          m('input', {
            id: 'imppass', type: 'password', autocomplete: 'off',
            'aria-describedby': 'restore-passphrase-help',
            value: ui.importPass, disabled: ui.importBusy,
            oninput: (/** @type {{ target: HTMLInputElement }} */ e) => { ui.importPass = e.target.value; },
          }),
          m('p.hint', { id: 'restore-passphrase-help' },
            '请输入创建此备份时使用的密码短语。'),
        ]) : null,
        ui.identityConflict ? m('.import-summary', {
          id: 'identity-conflict', tabindex: -1, role: 'alert',
          'aria-labelledby': 'identity-conflict-title',
          oncreate: (/** @type {{ dom: HTMLElement }} */ vnode) => vnode.dom.focus(),
        }, [
          m('h4', { id: 'identity-conflict-title' }, '身份冲突'),
          ui.identityConflict.existingUnreadable
            ? m('p', ['此安装的本地对等身份不可读。备份包含 ',
                m('code.identity-did', displayDid(ui.identityConflict.incomingDid)), '。'])
            : m('p', ['此安装使用 ', m('code.identity-did', displayDid(ui.identityConflict.existingDid)),
                '；备份使用 ', m('code.identity-did', displayDid(ui.identityConflict.incomingDid)), '。']),
          m('p.hint', ui.identityConflict.existingUnreadable
            ? '保留当前数据只会导入备份的其他部分。恢复备份将丢弃损坏的身份数据。'
            : '保留它只会导入备份的其他部分。替换会更改现有对等方看到的永久对等身份。'),
        ]) : null,
        ui.identityConflict && ui.replacementPending ? m('.identity-replace-confirmation', {
          id: 'identity-replace-confirmation', role: 'alert', tabindex: -1,
          oncreate: (/** @type {{ dom: HTMLElement }} */ vnode) => vnode.dom.focus(),
        }, [
          ui.identityConflict.existingUnreadable
            ? m('p.error', ['丢弃不可读的本地身份并恢复 ',
                m('code.identity-did', displayDid(ui.identityConflict.incomingDid)), '？'])
            : m('p.error', ['将永久对等身份 ',
                m('code.identity-did', displayDid(ui.identityConflict.existingDid)), ' 替换为 ',
                m('code.identity-did', displayDid(ui.identityConflict.incomingDid)), '？']),
          m('p.hint', ui.identityConflict.existingUnreadable
            ? '这将永久丢弃损坏的本地身份数据。现有对等方将看到恢复后的备份身份。在本地创作的应用仍被共享时无法继续。'
            : '现有对等方将看到新身份。您只能从另一个备份恢复旧身份。在本地创作的应用仍被共享时无法继续。'),
        ]) : null,
        ui.importBusy
          ? m('p.transfer-progress', { role: 'status', 'aria-live': 'polite' },
              '正在恢复。无法取消。身份检查可能需要几秒钟。请保持此页面打开。')
          : null,
        !ui.importBusy ? m('p.hint',
          '恢复开始后无法取消。请保持此页面打开直到完成。') : null,
        m('div', { style: 'display:flex; gap:8px; align-items:center; flex-wrap:wrap;' }, [
          ui.identityConflict
              ? m('button', { type: 'button', disabled: ui.importBusy, onclick: () => doImport('skip') },
                ui.importBusy ? '正在导入…' : '保留当前身份并导入其余内容')
            : m('button', {
                type: 'button',
                disabled: ui.importBusy || !hasApplicableImport(ui.importSummary)
                  || (ui.importSummary.requiresPassphrase && !ui.importPass),
                onclick: () => doImport('normal'),
              },
                ui.importBusy ? '正在导入…' : hasApplicableImport(ui.importSummary) ? '应用导入' : '无需恢复的内容'),
          ui.identityConflict
            ? ui.replacementPending
              ? m('button.danger', { type: 'button', disabled: ui.importBusy, onclick: () => doImport('replace') },
                  ui.importBusy ? '正在替换身份…'
                    : ui.identityConflict.existingUnreadable
                      ? '丢弃损坏的身份并恢复'
                      : '永久替换身份')
              : m('button.danger', {
                  type: 'button', disabled: ui.importBusy,
                  oncreate: (/** @type {{ dom: HTMLButtonElement }} */ vnode) => {
                    if (ui.restoreFocusToReview) { ui.restoreFocusToReview = false; vnode.dom.focus(); }
                  },
                  onupdate: (/** @type {{ dom: HTMLButtonElement }} */ vnode) => {
                    if (ui.restoreFocusToReview) { ui.restoreFocusToReview = false; vnode.dom.focus(); }
                  },
                  onclick: () => { ui.replacementPending = true; },
                },
                  '审阅身份替换')
            : null,
          ui.replacementPending
            ? m('button.secondary', {
                type: 'button', disabled: ui.importBusy,
                onclick: () => { ui.restoreFocusToReview = true; ui.replacementPending = false; },
              }, '返回')
            : null,
          m('button.secondary', {
            type: 'button', disabled: ui.importBusy,
            onclick: () => {
              ui.importMsg = null;
              clearImportSelection(true);
            },
          }, '取消'),
        ]),
      ]) : null,
      ui.importNotices.map((/** @type {string} */ n) => m('p.hint', n)),
      ui.importMsg ? m(ui.importMsg.ok ? 'p.transfer-status.transfer-status--success' : 'p.error.transfer-status.transfer-status--error',
        {
          id: 'transfer-import-status', tabindex: -1,
          role: ui.importMsg.ok ? 'status' : 'alert',
          oncreate: (/** @type {{ dom: HTMLElement }} */ vnode) => {
            if (ui.focusImportStatusOnUpdate) { ui.focusImportStatusOnUpdate = false; vnode.dom.focus(); }
          },
          onupdate: (/** @type {{ dom: HTMLElement }} */ vnode) => {
            if (ui.focusImportStatusOnUpdate) { ui.focusImportStatusOnUpdate = false; vnode.dom.focus(); }
          },
        },
        ui.importMsg.text) : null,

      // --- Artifacts (.peerd files) — separate from settings & data ----
      // Apps, Notebooks, and VM recipes exported from their tabs.
      // Same inspect-then-apply contract: nothing is written until the
      // file's hashes verify AND the user clicks Apply; imports always
      // create a NEW artifact (fresh id), never overwriting one.
      m('.settings-divider'),
      m('h3', '调试包'),
      m('p', '下载一个对话的完整调试故事作为本地 JSON 文件：'
        + '转录（包括每个参与者及其委托的参与者）、'
        + '审计切片、成本、设置和实时上下文快照 — 或相同的 '
        + '数据作为 OpenTelemetry 追踪供任何 OTel 查看器使用。任何内容都不会被发送到 '
        + '任何地方；存储的凭据不会出现在任何一个文件中。'),
      m('.input-row', [
        m('label', { for: 'dbgsess' }, '对话'),
        ui.debugSessions === null
          ? m('span.muted', '加载中…')
          : ui.debugSessions.length === 0
            ? m('span.muted', '暂无对话')
            : m('select', {
                id: 'dbgsess', value: ui.debugSessionId, disabled: ui.debugBusy,
                onchange: (/** @type {{ target: HTMLSelectElement }} */ e) => { ui.debugSessionId = e.target.value; },
              }, ui.debugSessions.map((/** @type {any} */ row) => m('option', { value: row.sessionId },
                `${row.title || '(无标题)'} · ${new Date(row.createdAt).toLocaleString()}`))),
      ]),
      m('.button-row', [
        m('button', {
          disabled: ui.debugBusy || !ui.debugSessionId,
          onclick: () => exportDebug('json'),
        }, '导出调试包'),
        m('button.secondary', {
          disabled: ui.debugBusy || !ui.debugSessionId,
          onclick: () => exportDebug('otlp'),
        }, '导出 OTel 追踪'),
      ]),
      ui.debugMsg ? m(ui.debugMsg.ok ? 'p.ok-msg' : 'p.err-msg', ui.debugMsg.text) : null,

      m('h3', '工件'),
      m('p', '从 .peerd 文件导入应用、笔记本或 VM 配方 '
        + '（通过工件自己标签页中的导出按钮导出）。'
        + '这与上方的设置导出分开：.peerd 文件 '
        + '携带一个工件，经内容哈希验证，'
        + '导入始终创建新副本 — 您现有的内容不会被 '
        + '覆盖。'),
      m('label', { for: 'peerd-artifact-file' }, '工件文件'),
      m('input', {
        id: 'peerd-artifact-file', type: 'file', accept: '.peerd',
        disabled: ui.artifactBusy,
        onchange: onArtifactFile,
      }),
      ui.artifactSummary ? m('.import-summary', [
        m('h3', '此文件包含：'),
        m('ul', [
          m('li', `类型：${(/** @type {Record<string, string>} */ ({ app: '应用', notebook: '笔记本', vm: 'VM 配方' }))[ui.artifactSummary.kind] ?? ui.artifactSummary.kind}`),
          m('li', `名称：${ui.artifactSummary.name}`),
          m('li', `大小：${ui.artifactSummary.size < 1_048_576
            ? `${Math.max(1, Math.round(ui.artifactSummary.size / 1024))} KB`
            : `${(ui.artifactSummary.size / 1_048_576).toFixed(1)} MB`}`),
          ui.artifactSummary.kind === 'vm'
            ? m('li', '仅配方 — 基础镜像 URL + 完整性钉；不传输磁盘内容')
            : m('li', `${ui.artifactSummary.fileCount} 个文件`),
        ]),
        ui.artifactSummary.kind === 'vm'
          ? m('p.hint', '新 VM 在首次启动前钉住基础镜像，因此更改的镜像会安全失败。')
          : m('p.hint', '导入的工件在与此处构建的工件相同的沙箱领域中运行 — 导入不授予额外权限。'),
        m('div', { style: 'display:flex; gap:8px; align-items:center;' }, [
          m('button', { type: 'button', disabled: ui.artifactBusy, onclick: doArtifactApply },
            ui.artifactBusy ? '…' : '应用导入'),
          m('button.secondary', {
            type: 'button',
            onclick: () => { ui.artifactEnvelope = null; ui.artifactSummary = null; },
          }, '取消'),
        ]),
      ]) : null,
      ui.artifactMsg ? m(ui.artifactMsg.ok ? 'p.transfer-status.transfer-status--success' : 'p.error.transfer-status.transfer-status--error',
        { role: ui.artifactMsg.ok ? 'status' : 'alert' }, ui.artifactMsg.text) : null,
    ]);
  },
};
