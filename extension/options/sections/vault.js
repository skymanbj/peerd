// @ts-check
// Options → Vault & unlock — passkey enrollment, recovery passphrase,
// idle auto-lock.
//
// Ported from the panel's "Vault & unlock" section. Enrollment
// ceremonies (WebAuthn PRF) are fine in a full tab — arguably better
// than the panel for the platform-authenticator sheet. UNLOCK ceremonies
// stay in the panel's VaultGate; this page only ever renders when the
// vault is already unlocked (the options shell gates on locked).

import m from '/vendor/mithril/mithril.js';
import {
  enrollWithPrf,
  isWebAuthnAvailable,
  probeWebAuthnCapabilities,
  planEnrollment,
  platformAuthenticatorLabel,
  PrfCancelledError,
  PrfNotSupportedError,
  PrfUnsupportedByAuthenticatorError,
} from '/peerd-egress/index.js';
import { bytesToBase64 } from '/shared/util.js';

/** @typedef {import('./reset-row.js').Send} Send */

export const VaultSection = {
  /** @param {{ state: any }} vnode */
  oninit(vnode) {
    vnode.state.prfBusy = false;
    vnode.state.prfMessage = null;
    vnode.state.prfError = null;
    // Capability probe → enrollment plan (pure planEnrollment in
    // peerd-egress). null while the async probes resolve (milliseconds);
    // the section renders the generic single button meanwhile.
    vnode.state.prfProbe = null;
    probeWebAuthnCapabilities().then((/** @type {any} */ p) => {
      vnode.state.prfProbe = p;
      m.redraw();
    }).catch(() => { /* keep generic button */ });
    // Recovery-passphrase form state
    vnode.state.recoveryPass = '';
    vnode.state.recoveryConfirm = '';
    vnode.state.recoveryBusy = false;
    vnode.state.recoveryMessage = null;
    vnode.state.recoveryError = null;
  },

  /** @param {{ attrs: { state: any, send: Send }, state: any }} vnode */
  view: ({ attrs: { state, send }, state: ui }) => {
    const prfEnrolled = !!state.vault?.prfEnrolled;
    const hasRecovery = !!state.vault?.hasRecovery;
    const webauthnAvailable = isWebAuthnAvailable();
    // Enrollment choices from the capability probe (null while the
    // probe resolves → generic single button, the legacy behavior).
    const prfPlan = ui.prfProbe ? planEnrollment(ui.prfProbe) : null;
    // LABEL only — never behavior. navigator.userAgentData is
    // Chromium-only (not in the TS DOM lib); navigator.platform is the
    // universal fallback.
    const uaData = /** @type {{ userAgentData?: { platform?: string } }} */ (navigator).userAgentData;
    const platformLabel = platformAuthenticatorLabel(
      uaData?.platform || navigator.platform || '');

    // flavor: 'platform' | 'security-key' | undefined (browser's picker).
    /** @param {import('/peerd-egress/vault/enroll-options.js').EnrollFlavor} [flavor] */
    const enrollPasskey = async (flavor) => {
      if (ui.prfBusy) return;
      ui.prfBusy = true;
      ui.prfError = null;
      ui.prfMessage = null;
      try {
        const { credentialId, prfSalt, prfOutput, transports } =
          await enrollWithPrf({ flavor });
        const reply = await send({
          type: 'vault/enrollPrf',
          credentialId: bytesToBase64(credentialId),
          prfSalt:      bytesToBase64(prfSalt),
          prfOutput:    bytesToBase64(prfOutput),
          transports,
        });
        if (reply?.ok) {
          ui.prfMessage = '通行密钥已添加。现在可以通过轻触解锁。';
        } else {
          ui.prfError = reply?.error === 'locked'
            ? '密码库已锁定 — 请先在 peerd 面板中解锁。'
            : reply?.error ?? '无法添加通行密钥。';
        }
      } catch (e) {
        if (e instanceof PrfCancelledError) {
          // User cancelled — silent.
        } else if (e instanceof PrfUnsupportedByAuthenticatorError) {
          // PRF honesty: the ceremony worked but THIS authenticator can't
          // produce the vault KEK — nothing was enrolled.
          ui.prfError = '此验证器无法保护密码库密钥 — 它'
            + '不支持 PRF 扩展。请尝试其他验证器'
            + '（YubiKey 5 或更新的安全密钥可用）。';
        } else if (e instanceof PrfNotSupportedError) {
          ui.prfError = '此浏览器不支持 PRF 扩展。';
        } else {
          console.error('[options] enroll passkey threw', e);
          ui.prfError = '通行密钥注册失败。';
        }
      } finally {
        ui.prfBusy = false;
        m.redraw();
      }
    };

    const disableTouchId = async () => {
      if (ui.prfBusy) return;
      ui.prfBusy = true;
      ui.prfError = null;
      ui.prfMessage = null;
      const reply = await send({ type: 'vault/disablePrf' });
      ui.prfBusy = false;
      if (reply?.ok) {
        ui.prfMessage = '通行密钥已移除。现在需要恢复密码短语来解锁。';
      } else if (reply?.error === 'recovery-not-set') {
        ui.prfError = '请先设置恢复密码短语 — 那将是你唯一的恢复途径。';
      } else {
        ui.prfError = reply?.error ?? '无法移除通行密钥。';
      }
      m.redraw();
    };

    /** @param {Event} [e] */
    const setRecovery = async (e) => {
      e?.preventDefault?.();
      if (ui.recoveryBusy) return;
      ui.recoveryError = null;
      ui.recoveryMessage = null;
      if (ui.recoveryPass.length < 8) {
        ui.recoveryError = '密码短语至少需要8个字符。';
        return;
      }
      if (ui.recoveryPass !== ui.recoveryConfirm) {
        ui.recoveryError = '密码短语不匹配。';
        return;
      }
      ui.recoveryBusy = true;
      const reply = await send({ type: 'vault/setRecoveryPassphrase', passphrase: ui.recoveryPass });
      ui.recoveryBusy = false;
      if (reply?.ok) {
        ui.recoveryPass = '';
        ui.recoveryConfirm = '';
        ui.recoveryMessage = hasRecovery
          ? '恢复密码短语已更新。'
          : '恢复密码短语已设置。请将其保存在安全的地方 — 我们无法为您恢复。';
      } else {
        ui.recoveryError = reply?.error === 'locked'
          ? '密码库已锁定 — 请先在 peerd 面板中解锁。'
          : reply?.error ?? '无法保存恢复密码短语。';
      }
      m.redraw();
    };

    return m('div', [
      m('h3', '通行密钥'),
      m('p', prfEnrolled
        ? '已注册通行密钥 — 通过轻触（Touch ID / Windows Hello）或安全密钥即可解锁。'
        : prfPlan && prfPlan.paths.length === 0
          // Definite client-level "no PRF" (getClientCapabilities):
          // no authenticator could protect the vault key here, so be
          // honest instead of offering a button that can only fail.
          ? '此浏览器无法使用通行密钥保护密码库密钥（不支持 PRF）。仅限密码短语解锁。'
          : webauthnAvailable
            ? `添加通行密钥，以便无需输入密码短语即可解锁。${
              prfPlan?.paths?.includes('platform')
                ? `${platformLabel ?? '此设备的内置验证器'}可用，硬件安全密钥也可用。`
                : '硬件安全密钥（YubiKey 5 或任何支持 PRF 的 FIDO2 密钥）可用；未在此设备上检测到内置验证器。'}`
            : '此浏览器不支持 WebAuthn。仅限密码短语解锁。'),
      webauthnAvailable ? m('div', { style: 'display:flex; gap:8px; align-items:center; flex-wrap:wrap;' },
        prfEnrolled
          // why: only allow removing the passkey when a recovery
          // passphrase exists — otherwise it's the only factor and the
          // vault would be unrecoverable. The SW enforces this too.
          ? m('button.secondary', {
              type: 'button',
              disabled: ui.prfBusy || !hasRecovery,
              title: hasRecovery ? '' : '请先设置恢复密码短语',
              onclick: disableTouchId,
            }, ui.prfBusy ? '…' : '移除通行密钥')
          // Choices from the pure plan: the platform authenticator
          // (labeled where recognizable — label only, never behavior)
          // leads when one exists; a security key is ALWAYS offered
          // (keys are pluggable, absence right now proves nothing).
          // Probe pending/failed → the generic single button (legacy
          // full-picker behavior). Plan says no paths → no buttons
          // (copy above explains why).
          : (prfPlan
              ? prfPlan.paths.map((flavor, i) =>
                  m(i === 0 ? 'button' : 'button.secondary', {
                    type: 'button',
                    disabled: ui.prfBusy,
                    onclick: () => enrollPasskey(flavor),
                  }, ui.prfBusy ? '…'
                    : flavor === 'platform' ? `添加 ${platformLabel ?? '通行密钥（此设备）'}`
                    : '添加安全密钥（YubiKey 或其他 FIDO2 密钥）'))
              : [m('button', { type: 'button', disabled: ui.prfBusy, onclick: () => enrollPasskey(undefined) },
                  ui.prfBusy ? '…' : '添加通行密钥')])
      ) : null,
      // why "recent" and no version trivia: PRF via Windows Hello
      // depends on OS plumbing older Windows lacks; the honest,
      // durable statement is "recent Windows 11".
      (!prfEnrolled && platformLabel === 'Windows Hello' && prfPlan?.paths?.includes('platform')) ? m('p.hint',
        'Windows Hello 可在较新版本的 Windows 11 上保护密码库。如果注册失败，请使用安全密钥。') : null,
      (prfEnrolled && !hasRecovery) ? m('p.hint',
        '通行密钥是进入此密码库的唯一方式。请在下方设置恢复密码短语作为备份。') : null,
      ui.prfError   ? m('p.error', ui.prfError) : null,
      ui.prfMessage ? m('p', { style: 'color: var(--ok);' }, ui.prfMessage) : null,

      m('.settings-divider'),
      m('h3', '恢复密码短语'),
      m('p', hasRecovery
        ? '已设置恢复密码短语。如果你丢失通行密钥，可以用它解锁密码库。在下方输入新的来替换。'
        : '可选的备份因子。设置一个密码短语，当你丢失通行密钥时可以用来解锁密码库 — 我们无法为你恢复。'),
      m('form', { onsubmit: setRecovery }, [
        m('.input-row', [
          m('label', { for: 'recpass' }, hasRecovery ? '新的恢复密码短语' : '恢复密码短语'),
          m('input', {
            id: 'recpass',
            type: 'password',
            autocomplete: 'new-password',
            value: ui.recoveryPass,
            disabled: ui.recoveryBusy,
            oninput: (/** @type {{ target: HTMLInputElement }} */ e) => { ui.recoveryPass = e.target.value; },
          }),
        ]),
        m('.input-row', [
          m('label', { for: 'recpass2' }, '确认密码短语'),
          m('input', {
            id: 'recpass2',
            type: 'password',
            autocomplete: 'new-password',
            value: ui.recoveryConfirm,
            disabled: ui.recoveryBusy,
            oninput: (/** @type {{ target: HTMLInputElement }} */ e) => { ui.recoveryConfirm = e.target.value; },
          }),
        ]),
        m('div', { style: 'display:flex; gap:8px; align-items:center;' }, [
          m('button', { type: 'submit', disabled: ui.recoveryBusy },
            ui.recoveryBusy ? '…' : hasRecovery ? '更新恢复密码短语' : '设置恢复密码短语'),
        ]),
        ui.recoveryError   ? m('p.error', ui.recoveryError) : null,
        ui.recoveryMessage ? m('p', { style: 'color: var(--ok);' }, ui.recoveryMessage) : null,
      ]),

      m('.settings-divider'),
      m('h3', '自动锁定'),
      m('p', '在一段时间不活动后锁定密码库。解锁时，解密后的密钥保存在内存中；自动锁定限制了这个时间窗口。使用通行密钥重新解锁只需轻触 — 在 peerd 面板中。'),
      m('.input-row', [
        m('label', { for: 'autolock' }, '空闲时锁定'),
        m('select', {
          id: 'autolock',
          value: String(state.settings?.vaultAutoLockMs ?? 2700000),
          onchange: async (/** @type {{ target: HTMLSelectElement }} */ e) => {
            await send({ type: 'settings/update', patch: { vaultAutoLockMs: Number(e.target.value) } });
            m.redraw();
          },
        }, [
          [60000, '1 分钟'],
          [300000, '5 分钟'],
          [900000, '15 分钟'],
          [1800000, '30 分钟'],
          [2700000, '45 分钟'],
          [3600000, '1 小时'],
          [0, '从不'],
        ].map(([ms, label]) => m('option', { value: String(ms) }, label))),
      ]),
    ]);
  },
};
