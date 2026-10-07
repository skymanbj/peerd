// @ts-check
// First-run / locked-vault gate.
//
// A passkey (WebAuthn PRF — Touch ID, Windows Hello, or a hardware
// security key) is the DEFAULT and only factor at sign-up. A recovery
// passphrase is OPTIONAL and added later from settings; it exists as a
// fallback for losing access to the passkey.
//
// First-run states
// ----------------
//   - WebAuthn available: passkey-only sign-up — one ceremony →
//     `vault/initializeWithPasskey`. A capability probe (pure planning
//     in peerd-egress enroll-options) decides which choices to show:
//     the platform authenticator leads when one exists (labeled "Touch
//     ID"/"Windows Hello" where the platform is recognizable — label
//     only, never behavior), and a security key (YubiKey or any FIDO2
//     key with PRF) is ALWAYS offered, since keys are pluggable. A
//     quiet "Use a passphrase instead" link drops to the passphrase
//     path (also the automatic fallback if the browser can't do PRF).
//   - WebAuthn unavailable, the client can't do PRF, or the user chose
//     the fallback: passphrase-only init (`vault/initialize`). A
//     passkey can be added later from settings.
//
// Locked states
// -------------
//   - Passkey enrolled + WebAuthn available: lead with "Unlock with
//     passkey". The recovery-passphrase form is offered only when a
//     recovery passphrase actually exists (state.vault.hasRecovery).
//   - Otherwise: passphrase form.
//
// All real validation happens in the SW (the vault throws typed errors
// on bad passphrase / already-initialized / no-recovery-set). UI shows
// the SW's reply verbatim where it's actionable.

import m from '/vendor/mithril/mithril.js';
import {
  enrollWithPrf,
  getPrfOutput,
  isWebAuthnAvailable,
  probeWebAuthnCapabilities,
  planEnrollment,
  platformAuthenticatorLabel,
  PrfCancelledError,
  PrfNotSupportedError,
  PrfUnsupportedByAuthenticatorError,
} from '/peerd-egress/index.js';
import { base64ToBytes, bytesToBase64 } from '/shared/util.js';
import browser from '/vendor/browser-polyfill.js';

// LABEL only (the enrollment flow is identical everywhere):
// navigator.userAgentData is Chromium-only; navigator.platform is the
// universal fallback. Unknown platforms render generic "passkey" copy.
const PLATFORM_LABEL = platformAuthenticatorLabel(
  (typeof navigator !== 'undefined'
    && (/** @type {{ userAgentData?: { platform?: string } }} */ (navigator).userAgentData?.platform
      || navigator.platform)) || '');

// App version for the hero subtitle. getManifest() is synchronous and
// always present on an extension page; guarded so a non-extension context
// (unit tests) simply renders no version line.
const APP_VERSION = (() => {
  try { return browser.runtime.getManifest().version; } catch { return ''; }
})();

/**
 * Big "manifest" brand wordmark for the vault gate — the hero logo on
 * the lock / sign-up screen, and the only brand mark there (the top-bar
 * wordmark is suppressed while locked). It plays the same two-phase
 * intro as peerd.ai: the letters type out behind a terminal cursor,
 * then the blocks colorize. Pure CSS via .wordmark--intro/.wordmark--hero;
 * runs once on mount (Mithril patches the node across redraws).
 *
 * Below the wordmark sit two static brand lines: the version (small, mono)
 * right under it, then the "Your browser. Your AI." tagline. The whole
 * block centers as a column (.vault-brand) whose bottom margin is the
 * breathing room before the action buttons.
 */
const BrandHeader = {
  view: () => m('.vault-brand', [
    // A lock-mark chip crowns the gate (redesign Screen 1) — the one place the
    // panel says "this surface is sealed" before the wordmark. Decorative;
    // the real lock state lives in the SW.
    m('.vault-lockmark', { 'aria-hidden': 'true' },
      m('svg.ic', { width: 19, height: 19, viewBox: '0 0 24 24' },
        m('use', { href: '#ic-lock' }))),
    m('.wordmark.wordmark--intro.wordmark--hero', {
      'aria-label': 'peerd',
      role: 'img',
    }, [
      m('.block.b-p',  'p'),
      m('.block.b-e',  'e'),
      m('.block.b-e2', 'e'),
      m('.block.b-r',  'r'),
      m('.block.b-d',  'd'),
      m('.wordmark-cursor', { 'aria-hidden': 'true' }),
    ]),
    APP_VERSION ? m('.brand-version', `v${APP_VERSION}`) : null,
    m('.brand-tagline', '你的浏览器。你的 AI。'),
  ]),
};

// Short, valid DOM/JS fragments — each types out at its own random spot, like
// the rain but horizontal. Attention to detail: real browser APIs, not lorem.
const SNIPPETS = [
  "document.querySelector('#peerd')",
  "el.addEventListener('pointerdown', unlock)",
  "await navigator.credentials.get({ publicKey })",
  "crypto.subtle.deriveKey({ name: 'AES-GCM' })",
  "crypto.getRandomValues(new Uint8Array(32))",
  "cred.getClientExtensionResults().prf",
  "document.createElement('section')",
  "node.classList.add('peer', 'online')",
  "el.dataset.peerId = id",
  "root.replaceChildren(view(state))",
  "new WebSocket('wss://peerd.ai/rendezvous')",
  "socket.addEventListener('message', route)",
  "for (const peer of swarm) dial(peer)",
  "await indexedDB.open('peerd-vault', 1)",
  "requestAnimationFrame(frame)",
  "queueMicrotask(flush)",
  "new TextEncoder().encode(json)",
  "navigator.storage.persist()",
  "structuredClone(state)",
  "JSON.parse(event.data)",
  "vault.open(key)",
  "performance.now()",
];

/**
 * Faint typing backdrop behind the gate — short DOM/JS fragments type themselves
 * out, left-to-right, at many random spots at once, each leaving a fading trail:
 * a horizontal take on a code rain, a hint you're entering a browser-native
 * machine. Monochrome and very low-contrast (borrows --fg on a transparent
 * canvas, so it themes light/dark for free) — atmosphere, not chrome.
 * prefers-reduced-motion shows a static scatter, no typing. Mounted only while
 * the gate is; the loop is cancelled on unmount.
 */
const CodeStream = {
  /** @param {any} vnode */
  oncreate(vnode) {
    /** @type {HTMLCanvasElement} */
    const canvas = vnode.dom;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const cs = getComputedStyle(document.documentElement);
    const fg = (cs.getPropertyValue('--fg') || '#F3F3EF').trim();
    const mono = (cs.getPropertyValue('--font-mono') || 'monospace').trim();
    const reduce = !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    const ROW = 24;                         // vertical spacing between typer rows
    // Trail decay per tick. why redraw-from-state (clearRect + explicit per-char
    // alpha) instead of the classic alpha-wash-toward-bg: source-over washing
    // only ASYMPTOTES to the background — every row ever typed on kept a faint
    // permanent residue, which read as lighter-than-black bands on the row grid
    // (owner report 2026-07-04). Clearing each frame and fading by age reaches
    // EXACT zero, so idle rows are indistinguishable from untouched background.
    const DECAY = 0.85;                     // matches the old wash (1 - 0.15)
    const HEAD = 0.8;                       // the bright typing head
    const FLOOR = 0.02;                     // below this a char is invisible → skip
    /** @typedef {{ x: number, y: number, text: string, i: number, wait: number, done: number }} Writer */
    /** @type {Writer[]} */
    let writers = [];
    let w = 0, h = 0, cw = 8, raf = 0, last = 0;

    /** @returns {Writer} a fresh typer at a random spot */
    const spawn = () => {
      const text = SNIPPETS[Math.floor(Math.random() * SNIPPETS.length)] || '';
      const maxX = Math.max(8, w - text.length * cw - 8);
      const rowN = Math.max(1, Math.floor((h - 16) / ROW));
      return {
        x: 8 + Math.floor(Math.random() * Math.max(1, maxX)),
        y: 12 + Math.floor(Math.random() * rowN) * ROW,
        text,
        i: 0,
        wait: Math.floor(Math.random() * 55), // stagger so they don't move in lockstep
        done: 0,                              // ticks since the line finished (fade-out age)
      };
    };

    const layout = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      w = canvas.clientWidth;
      h = canvas.clientHeight;
      canvas.width = Math.max(1, Math.floor(w * dpr));
      canvas.height = Math.max(1, Math.floor(h * dpr));
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.font = `13px ${mono}`;
      ctx.textBaseline = 'top';
      cw = ctx.measureText('M').width || 8;
      writers = Array.from({ length: Math.max(3, Math.round((w * h) / 57500)) }, spawn);
    };

    const frame = (/** @type {number} */ t) => {
      raf = requestAnimationFrame(frame);
      if (t - last < 66) return;             // type cadence (unhurried)
      last = t;
      ctx.clearRect(0, 0, w, h);             // fresh frame — the page bg shows through, no residue
      ctx.fillStyle = fg;
      writers.forEach((wr, k) => {
        if (wr.wait > 0) { wr.wait -= 1; return; }
        // advance: type the next char, or age a finished line toward respawn
        if (wr.i < wr.text.length) wr.i += 1;
        else wr.done += 1;
        // draw the trail: each typed char fades by its age (newest = the bright
        // head), and a finished line keeps aging via `done` until fully out.
        let visible = false;
        for (let k2 = 0; k2 < wr.i; k2 += 1) {
          const age = (wr.i - 1 - k2) + wr.done;
          const alpha = HEAD * DECAY ** age;
          if (alpha < FLOOR) continue;
          visible = true;
          ctx.globalAlpha = alpha;
          ctx.fillText(wr.text[k2] || '', wr.x + k2 * cw, wr.y);
        }
        if (wr.done > 0 && !visible) writers[k] = spawn();   // fully faded → respawn elsewhere
      });
      ctx.globalAlpha = 1;
    };

    const still = () => {                     // reduced-motion: a static scatter
      ctx.fillStyle = fg;
      ctx.globalAlpha = 0.13;
      writers.forEach((wr) => ctx.fillText(wr.text, wr.x, wr.y));
      ctx.globalAlpha = 1;
    };

    // Hold the typing until the wordmark intro has fully settled (its last
    // block colorizes at 1480ms — see styles.css wmColor*) plus a 0.7s buffer,
    // so the gate renders calmly before the code starts.
    /** @type {ReturnType<typeof setTimeout>|undefined} */
    let startTimer;
    const onResize = () => { layout(); if (reduce) still(); };
    layout();
    window.addEventListener('resize', onResize);
    vnode.state.stop = () => { cancelAnimationFrame(raf); if (startTimer) clearTimeout(startTimer); window.removeEventListener('resize', onResize); };
    if (reduce) still();
    else startTimer = setTimeout(() => { raf = requestAnimationFrame(frame); }, 2180);
  },
  /** @param {any} vnode */
  onremove(vnode) { vnode.state.stop?.(); },
  view: () => m('canvas.code-stream', { 'aria-hidden': 'true' }),
};

/** @type {Record<string, string>} */
const ERROR_MESSAGES = {
  'wrong-passphrase':    '密码短语不正确。',
  'not-initialized':     '密码库尚未设置。',
  'already-initialized': '此配置文件上已存在密码库。',
  'locked':              '密码库已锁定。',
  'prf-not-enrolled':    '此密码库未注册通行密钥。',
  'prf-unlock-failed':   '你的通行密钥无法解锁密码库。',
  'recovery-not-set':    '未设置恢复密码短语 — 请使用通行密钥解锁。',
  'invalid-passphrase':  '密码短语至少需要8个字符。',
  'invalid-prf-payload': '通行密钥设置未返回可用凭据。',
};

/** @typedef {import('../chat-reducer.js').ChatState} ChatState */
/** @typedef {(msg: object) => Promise<any>} Send */
/** @typedef {import('/peerd-egress/vault/enroll-options.js').CapabilityProbe} CapabilityProbe */
/** @typedef {import('/peerd-egress/vault/enroll-options.js').EnrollFlavor} EnrollFlavor */

/**
 * Component-local UI state for the vault gate.
 * @typedef {Object} VaultGateState
 * @property {string} passphrase
 * @property {string} confirmPassphrase
 * @property {string|null} error
 * @property {'wrong'|'neutral'} errorKind  §5f: only a WRONG ANSWER is red
 *   (the mismatch, the wrong passphrase); every other message is a condition
 *   and takes the neutral treatment.
 * @property {boolean} floorViolated  §5d: the 8-character floor is announced
 *   up front and a violation emphasizes the hint - it is not an error.
 * @property {boolean} busy
 * @property {'idle'|'ceremony'|'finishing'} passkeyStage
 * @property {boolean} showPassphrase
 * @property {boolean} forcePassphrase
 * @property {CapabilityProbe|null} probe
 * @property {(() => Promise<void>)|null} unlockWithPasskey  wired by `view`
 *   (the handler closes over view-local state); `oncreate` reads it for the
 *   opportunistic auto-raise. Null until the first render.
 */

/** @typedef {{ state: VaultGateState, attrs: { state: ChatState, send: Send } }} VaultGateVnode */

export const VaultGate = {
  // Component-local UI state. The "real" vault state lives in the SW.
  /** @param {VaultGateVnode} vnode */
  oninit(vnode) {
    vnode.state.passphrase = '';
    vnode.state.confirmPassphrase = '';
    vnode.state.error = null;
    vnode.state.errorKind = 'neutral';
    vnode.state.floorViolated = false;
    vnode.state.busy = false;
    vnode.state.passkeyStage = 'idle';
    // Unlock-state: with a passkey enrolled, the recovery-passphrase
    // form is collapsed behind a link. Persisted for the component mount
    // so a single cancelled passkey tap doesn't yank the form away.
    vnode.state.showPassphrase = false;
    // First-run-state: when WebAuthn is available, sign-up is passkey-
    // only by default. The user can fall back to a passphrase-only vault
    // (the only path when WebAuthn is unavailable). Forced true on a
    // PrfNotSupported result so the user is never stranded.
    vnode.state.forcePassphrase = false;
    // Capability probe → enrollment plan (pure planEnrollment). null
    // while the async probes run (they resolve in milliseconds — well
    // before a human can click); the UI renders the generic single
    // passkey button meanwhile, which is the legacy behavior.
    vnode.state.probe = null;
    vnode.state.unlockWithPasskey = null;
    probeWebAuthnCapabilities().then((p) => {
      vnode.state.probe = p;
      m.redraw();
    }).catch(() => { /* keep legacy generic button */ });
  },

  // Opportunistically auto-raise the passkey prompt ~400ms after the gate
  // mounts on a LOCKED vault with a passkey enrolled — saves the user the
  // extra click. Deliberately deferred: the capability probe and first paint
  // must settle first, and a 400ms beat lets a user who meant to reach for the
  // passphrase link do so without a WebAuthn prompt fighting them. `view` runs
  // before `oncreate` on mount, so `ui.unlockWithPasskey` is already wired.
  /** @param {VaultGateVnode} vnode */
  oncreate(vnode) {
    setTimeout(() => {
      const isLocked = !!vnode.attrs.state.vault?.locked;
      const prfEnrolled = !!vnode.attrs.state.vault?.prfEnrolled;
      const webauthnAvailable = isWebAuthnAvailable();
      if (isLocked && prfEnrolled && webauthnAvailable && !vnode.state.showPassphrase) {
        vnode.state.unlockWithPasskey?.().catch(() => {});
      }
    }, 400);
  },

  /** @param {VaultGateVnode} vnode */
  view: ({ attrs: { state, send }, state: ui }) => {
    // The gate is a cardless hero on every surface (home AND side panel):
    // the wordmark/version/tagline + the action, no card box. The unlock
    // screen also drops its heading/subtext — the action speaks for itself.
    // The faint code-stream rides behind every gate state, then the card.
    /** @param {any} kids */
    const shell = (kids) => [m(CodeStream), m('.gate-card', kids)];
    // §5f: one message element, two severities. A red line is reserved for a
    // WRONG ANSWER; conditions render the same line in the neutral voice.
    const gateError = () => (ui.error
      ? m('p.gate-msg', { class: ui.errorKind === 'wrong' ? 'is-wrong' : '' }, [
          m('span.gate-msg-dot', { 'aria-hidden': 'true' }),
          ui.error,
        ])
      : null);
    // §5f: the ceremony hands control to the browser - say so while it is
    // pending. The spec marks this sentence as the non-negotiable part.
    const waitNote = () => (ui.busy && ui.passkeyStage !== 'finishing'
      ? m('p.muted.gate-wait-note', '你的浏览器正在询问。尚未向任何地方发送任何内容。')
      : null);
    // §5g: say WHY it locked - only for an idle lock (a manual lock was the
    // user's own act, and a fresh session has no reason to explain), quoting
    // the user's own configured interval. The one genuine anxiety this
    // screen creates is whether the conversation survived. It did.
    const idleLockNote = () => {
      if (state.vault.lockReason !== 'idle') return null;
      const ms = Number(state.settings?.vaultAutoLockMs);
      const minutes = Number.isFinite(ms) && ms > 0 ? Math.round(ms / 60_000) : null;
      return m('p.muted.gate-lock-note',
        `闲置 ${minutes ?? '几分钟'} 分钟后已锁定。你的对话仍在这里。`);
    };
    const isFirstRun = !state.vault.initialized;
    const prfEnrolled = !!state.vault.prfEnrolled;
    const hasRecovery = !!state.vault.hasRecovery;
    // INITIAL_STATE is only a paint-safe placeholder. Do not let a user finish
    // WebAuthn before the background has loaded and sent its authoritative
    // vault snapshot; otherwise the post-credential request can appear stuck
    // behind a cold service-worker module graph.
    const backendReady = state.hydrated === true;
    const webauthnAvailable = isWebAuthnAvailable();
    // What this machine offers, per the capability probe. null while the
    // probe is in flight → the generic single passkey button (legacy).
    const plan = ui.probe ? planEnrollment(ui.probe) : null;
    // Definite client-level "no PRF" (getClientCapabilities) — no
    // authenticator could ever produce the vault KEK through this
    // browser, so sign-up routes straight to the passphrase with honest
    // copy instead of letting every ceremony fail.
    const passkeyBlocked = !!plan && plan.paths.length === 0;
    // Passkey sign-up is the default whenever WebAuthn is available and
    // the user hasn't explicitly fallen back to a passphrase.
    const usePasskeySignup = isFirstRun && webauthnAvailable && !ui.forcePassphrase && !passkeyBlocked;
    const usePasskeyUnlock = !isFirstRun && prfEnrolled && webauthnAvailable && !ui.showPassphrase;

    // ---------- First-run: passkey-only --------------------------------
    // flavor: 'platform' | 'security-key' | undefined (browser's picker).
    /** @param {EnrollFlavor} [flavor] */
    const setupWithPasskey = async (flavor) => {
      if (ui.busy || !backendReady) return;
      ui.error = null;
      ui.errorKind = 'neutral';
      ui.busy = true;
      ui.passkeyStage = 'ceremony';
      // A hardware authenticator can keep the browser prompt open long enough
      // for an extension SW to become idle. A cheap status request keeps the
      // already-hydrated backend warm until the credential is ready to commit.
      const keepBackendWarm = setInterval(() => {
        send({ type: 'vault/prfStatus' }).catch(() => {});
      }, 20_000);
      m.redraw();
      try {
        // Run the ceremony FIRST while the click is the active gesture —
        // create() needs user activation, which a SW round-trip can lose.
        const { credentialId, prfSalt, prfOutput, transports } =
          await enrollWithPrf({ flavor });
        ui.passkeyStage = 'finishing';
        m.redraw();
        const reply = await send({
          type: 'vault/initializeWithPasskey',
          credentialId: bytesToBase64(credentialId),
          prfSalt:      bytesToBase64(prfSalt),
          prfOutput:    bytesToBase64(prfOutput),
          transports,
        });
        if (!reply?.ok) {
          ui.error = ERROR_MESSAGES[reply?.error] ?? reply?.error ?? '设置失败。';
        }
        // on success the SW unlocks → state push flips us out of the gate
      } catch (err) {
        if (err instanceof PrfCancelledError) {
          ui.error = '通行密钥设置已取消。请重试，或使用密码短语。';
        } else if (err instanceof PrfUnsupportedByAuthenticatorError) {
          // THIS authenticator can't do PRF, so it can't protect the
          // vault key — but another one (or the passphrase) still can.
          // Stay on the passkey screen with the other choices intact.
          ui.error = '此验证器无法保护密码库密钥 — 它不支持'
            + 'PRF 扩展。请尝试其他验证器（YubiKey 5 或'
            + '更新的安全密钥），或使用密码短语。';
        } else if (err instanceof PrfNotSupportedError) {
          // The BROWSER can't do WebAuthn PRF — there's nothing to retry
          // with any authenticator. Drop to the passphrase path so the
          // user can still get a vault.
          ui.error = '此浏览器无法使用通行密钥保护密码库。请改用密码短语。';
          ui.forcePassphrase = true;
        } else {
          console.error('[vault-gate] passkey setup threw', err);
          ui.error = '通行密钥设置失败。请重试，或使用密码短语。';
        }
      } finally {
        clearInterval(keepBackendWarm);
        ui.busy = false;
        ui.passkeyStage = 'idle';
        m.redraw();
      }
    };

    /** @param {Event} [e] */
    const setupWithPassphrase = async (e) => {
      e?.preventDefault?.();
      if (ui.busy || !backendReady) return;
      ui.error = null;
      ui.errorKind = 'neutral';
      ui.floorViolated = false;
      // §5d: two failure kinds, two treatments. The floor was announced up
      // front (the hint under the confirm field), so violating it only
      // emphasizes the hint - a violated rule you were told about is neutral.
      // A mismatch is a wrong answer, and takes the sanctioned red.
      if (ui.passphrase.length < 8) {
        ui.floorViolated = true;
        return;
      }
      if (ui.passphrase !== ui.confirmPassphrase) {
        ui.error = '密码短语不匹配。';
        ui.errorKind = 'wrong';
        return;
      }
      ui.busy = true;
      const reply = await send({ type: 'vault/initialize', passphrase: ui.passphrase });
      ui.busy = false;
      if (reply?.ok) {
        ui.passphrase = '';
        ui.confirmPassphrase = '';
      } else if (reply?.error === 'invalid-passphrase') {
        ui.floorViolated = true;
      } else {
        ui.error = ERROR_MESSAGES[reply?.error] ?? reply?.error ?? '出了点问题。';
      }
      m.redraw();
    };

    // ---------- Unlock paths ------------------------------------------
    const unlockWithPasskey = async () => {
      if (ui.busy) return;
      ui.error = null;
      ui.errorKind = 'neutral';
      ui.busy = true;
      m.redraw();
      try {
        const status = await send({ type: 'vault/prfStatus' });
        if (!status?.ok || !status.enrolled) {
          ui.error = ERROR_MESSAGES['prf-not-enrolled'];
          if (hasRecovery) ui.showPassphrase = true;
          return;
        }
        const prfOutput = await getPrfOutput({
          credentialId: base64ToBytes(status.credentialId),
          prfSalt:      base64ToBytes(status.prfSalt),
          // Recorded at enrollment (when the authenticator reported
          // them); routes the browser prompt to the right authenticator
          // class — absent on older enrollments, which keeps today's
          // try-everything prompt.
          transports:   status.transports,
        });
        const reply = await send({
          type: 'vault/unlockPrf',
          prfOutput: bytesToBase64(prfOutput),
        });
        if (!reply?.ok) {
          ui.error = ERROR_MESSAGES[reply?.error] ?? reply?.error ?? '通行密钥解锁失败。';
        }
      } catch (err) {
        if (err instanceof PrfCancelledError) {
          // User dismissed the prompt. Offer the recovery passphrase if
          // one exists; otherwise leave them on the passkey screen.
          if (hasRecovery) ui.showPassphrase = true;
        } else if (err instanceof PrfNotSupportedError) {
          ui.error = '此浏览器不支持通行密钥。';
          if (hasRecovery) ui.showPassphrase = true;
        } else {
          console.error('[vault-gate] passkey unlock threw', err);
          ui.error = hasRecovery
            ? '你的通行密钥无法使用。请使用恢复密码短语。'
            : '你的通行密钥无法使用。请重试。';
          if (hasRecovery) ui.showPassphrase = true;
        }
      } finally {
        ui.busy = false;
        m.redraw();
      }
    };
    // Hand the handler to `oncreate` (which fires after this first render) so
    // the gate can opportunistically raise the prompt on its own.
    ui.unlockWithPasskey = unlockWithPasskey;

    /** @param {Event} [e] */
    const unlockWithPassphrase = async (e) => {
      e?.preventDefault?.();
      if (ui.busy) return;
      ui.error = null;
      ui.errorKind = 'neutral';
      if (!ui.passphrase) {
        ui.error = '请输入恢复密码短语。';
        return;
      }
      ui.busy = true;
      const reply = await send({ type: 'vault/unlock', passphrase: ui.passphrase });
      ui.busy = false;
      if (reply?.ok) {
        ui.passphrase = '';
      } else {
        ui.error = ERROR_MESSAGES[reply?.error] ?? reply?.error ?? '出了点问题。';
        // §5f: the wrong passphrase is the one WRONG ANSWER on this
        // screen - everything else that can land here is a condition.
        ui.errorKind = reply?.error === 'wrong-passphrase' ? 'wrong' : 'neutral';
      }
      m.redraw();
    };

    // ---------- Render: first-run -------------------------------------
    if (isFirstRun) {
      if (usePasskeySignup) {
        // Ordered choices from the pure plan. Probe still in flight (or
        // failed) → [undefined] = one generic button driving the
        // browser's full picker, exactly the pre-probe behavior.
        const paths = plan?.paths?.length ? plan.paths : [undefined];
        const leadsWithPlatform = paths[0] === 'platform';
        const passkeyBusyLabel = ui.passkeyStage === 'finishing'
          ? '正在完成设置…'
          : '正在等待通行密钥…';
        /**
         * @param {EnrollFlavor|undefined} flavor
         * @param {boolean} isLead
         */
        const buttonLabel = (flavor, isLead) => {
          if (flavor === 'platform') {
            return `使用 ${PLATFORM_LABEL ?? '本设备上的通行密钥'} 创建密码库`;
          }
          if (flavor === 'security-key') {
            // As the lead (no platform authenticator detected) say what
            // it creates; as the secondary it reads as the alternative.
            return isLead
              ? '使用安全密钥创建密码库'
              : '使用安全密钥（YubiKey 或其他 FIDO2 密钥）';
          }
          return '使用通行密钥创建密码库';
        };
        return shell([
          m(BrandHeader),
          m('h2', '初始设置'),
          // §5c: never render a platform name the probe did not return -
          // before the probe settles, and on an unrecognized platform, the
          // copy stays generic. The label is cosmetic; the ceremony is
          // identical either way.
          m('p.muted', !plan
            ? '使用通行密钥或硬件安全密钥创建密码库。它会在本设备上加密你的 '
              + 'API 密钥和机密。无需选择或记住密码。'
            : leadsWithPlatform
              ? `使用通行密钥${
                PLATFORM_LABEL ? `（${PLATFORM_LABEL}）` : ''
                }或硬件安全密钥创建密码库。它会在本设备上加密你的 API 密钥和 ` +
                `机密。无需选择或记住密码。`
              : '未在此设备上检测到内置验证器。你'
                + '可以使用硬件安全密钥（'
                + 'YubiKey 5 或任何支持 PRF 的 FIDO2 密钥）创建密码库，或使用'
                + '密码短语。'),
          m('.auth-actions', [
            ...paths.map((flavor, i) => m(i === 0 ? 'button' : 'button.secondary', {
              type: 'button',
              disabled: ui.busy || !backendReady,
              onclick: () => setupWithPasskey(flavor),
            }, !backendReady ? '正在准备安全设置…'
              : ui.busy ? passkeyBusyLabel : buttonLabel(flavor, i === 0))),
            m('button.secondary', {
              type: 'button',
              disabled: ui.busy || !backendReady,
              style: 'margin-top: 8px;',
              onclick: () => { ui.forcePassphrase = true; ui.error = null; ui.errorKind = 'neutral'; ui.floorViolated = false; m.redraw(); },
            }, '改用普通密码创建（无 Windows Hello 推荐）'),
          ]),
          // why "recent" and no version trivia: PRF support via Windows
          // Hello depends on OS plumbing that older Windows lacks; the
          // honest, durable statement is "recent Windows 11".
          (leadsWithPlatform && PLATFORM_LABEL === 'Windows Hello') ? m('p.muted', { style: 'font-size:11px; margin-top:12px;' },
            'Windows Hello 可在较新版本的 Windows 11 上保护密码库。' +
            '如果设置失败，请使用安全密钥或密码短语。') : null,
          m('p.muted', { style: 'font-size:11px; margin-top:12px;' },
            '你可以在设置中稍后添加恢复密码短语，以防' +
            '丢失通行密钥访问权限。'),
          !backendReady ? m('p.muted', {
            role: 'status',
            'aria-live': 'polite',
          }, '正在启动安全密码库服务。首次启动可能需要一点时间…') : null,
          ui.passkeyStage === 'finishing' ? m('p.muted', {
            role: 'status',
            'aria-live': 'polite',
          }, '通行密钥已验证。正在完成安全密码库设置…') : null,
          waitNote(),
          gateError(),
        ]);
      }

      // Passphrase-only first-run — WebAuthn unavailable, the client
      // can't do PRF, or the user chose the fallback. This vault has no
      // passkey factor (one can be enrolled later from settings).
      return shell([
        m(BrandHeader),
        m('h2', '设置密码短语'),
        m('p.muted',
          '此密码短语加密你的提供商 API 密钥和其他' +
          '静态机密。我们无法为你恢复。'),
        // Capability honesty: tell the user WHY there is no passkey
        // option rather than silently hiding it. §5d draws it as a
        // callout - the absent option's replacement, not a footnote.
        passkeyBlocked ? m('p.muted.gate-callout',
          '此浏览器无法使用通行密钥保护密码库密钥' +
          '（不支持 PRF），因此需要密码短语。') : null,
        m('form', { onsubmit: setupWithPassphrase }, [
          m('.input-row', [
            m('label', { for: 'pass' }, '密码短语'),
            m('input', {
              id: 'pass',
              type: 'password',
              autocomplete: 'new-password',
              value: ui.passphrase,
              disabled: ui.busy,
              oninput: (/** @type {Event} */ e) => { ui.passphrase = /** @type {HTMLInputElement} */ (e.target).value; },
              autofocus: true,
            }),
          ]),
          m('.input-row', [
            m('label', { for: 'pass2' }, '确认密码短语'),
            m('input', {
              id: 'pass2',
              type: 'password',
              autocomplete: 'new-password',
              value: ui.confirmPassphrase,
              disabled: ui.busy,
              // §5f: the wrong answer marks the field it contradicts.
              class: ui.errorKind === 'wrong' && ui.error ? 'is-error' : '',
              oninput: (/** @type {Event} */ e) => { ui.confirmPassphrase = /** @type {HTMLInputElement} */ (e.target).value; },
            }),
          ]),
          // §5d: the 8-character floor moves up front - discoverable by
          // reading, not by failing. A violation emphasizes this line.
          m('p.passphrase-floor-hint', { class: ui.floorViolated ? 'is-violated' : '' },
            '至少 8 个字符'),
          gateError(),
          m('.auth-actions.auth-actions--row', [
            m('button', { type: 'submit', disabled: ui.busy || !backendReady },
              !backendReady ? '正在准备安全设置…' : ui.busy ? '…' : '创建密码库'),
            // No passkey toggle when the client definitively can't do
            // PRF — offering a path that can only fail is worse than
            // not offering it.
            (webauthnAvailable && !passkeyBlocked) ? m('button.secondary', {
              type: 'button',
              disabled: ui.busy || !backendReady,
              onclick: () => { ui.forcePassphrase = false; ui.error = null; ui.errorKind = 'neutral'; ui.floorViolated = false; m.redraw(); },
            }, '改用通行密钥') : null,
          ]),
          !backendReady ? m('p.muted', {
            role: 'status',
            'aria-live': 'polite',
          }, '正在启动安全密码库服务。首次启动可能需要一点时间…') : null,
        ]),
      ]);
    }

    // ---------- Render: unlock ----------------------------------------
    if (usePasskeyUnlock) {
      return shell([
        m(BrandHeader),
        // The wordmark + tagline + the button say it all — no heading/subtext.
        idleLockNote(),
        m('.auth-actions.auth-actions--row', [
          m('button', {
            type: 'button',
            disabled: ui.busy,
            onclick: unlockWithPasskey,
          }, ui.busy ? '…' : '使用通行密钥解锁'),
          // Recovery passphrase is only an option if one was ever set.
          hasRecovery ? m('button.secondary', {
            type: 'button',
            disabled: ui.busy,
            onclick: () => { ui.showPassphrase = true; ui.error = null; ui.errorKind = 'neutral'; m.redraw(); },
          }, '使用恢复密码短语') : null,
        ]),
        waitNote(),
        gateError(),
      ]);
    }

    // Passphrase unlock — no passkey enrolled, or the user chose their
    // recovery passphrase this time.
    return shell([
      m(BrandHeader),
      idleLockNote(),
      m('form', { onsubmit: unlockWithPassphrase }, [
        m('.input-row', [
          m('label', { for: 'pass' }, prfEnrolled ? '恢复密码短语' : '密码短语'),
          m('input', {
            id: 'pass',
            type: 'password',
            autocomplete: 'current-password',
            value: ui.passphrase,
            disabled: ui.busy,
            // §5f: only the wrong answer marks the field.
            class: ui.errorKind === 'wrong' && ui.error ? 'is-error' : '',
            oninput: (/** @type {Event} */ e) => { ui.passphrase = /** @type {HTMLInputElement} */ (e.target).value; },
            autofocus: true,
          }),
        ]),
        gateError(),
        m('.auth-actions.auth-actions--row', [
          m('button', { type: 'submit', disabled: ui.busy },
            ui.busy ? '…' : '解锁'),
          (prfEnrolled && webauthnAvailable) ? m('button.secondary', {
            type: 'button',
            disabled: ui.busy,
            onclick: () => { ui.showPassphrase = false; ui.error = null; ui.errorKind = 'neutral'; m.redraw(); },
          }, '使用通行密钥') : null,
        ]),
      ]),
    ]);
  },
};
