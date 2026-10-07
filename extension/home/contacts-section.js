// @ts-check
// home/contacts-section.js — Contacts: your known peers (dweb, preview-only).
//
// Every peer is just an opaque did:key until you name it. This is where you do
// that: a list of KNOWN peers — anyone you've installed an app from, interacted
// with (the audit timeline), saved, or who's on the mesh right now — each one
// nameable, with an expandable summary of your shared history (what they've
// shared with you, when you last met). The personal name (+ notes) persists
// locally, keyed by the did.
//
// Two data sources, merged client-side: `contacts/list` (the DURABLE union —
// saved overlay + App catalog + audit log, with the per-peer activity summary)
// and `dweb/distributed/info` (the LIVE mesh — who's connected, by what path,
// last seen). A pure CLIENT: it never imports the dweb module (the boundary),
// so the brand palette is inlined, same as network-section.js. Mounted only
// when DWEB_ENABLED + dweb-on (home.js), so it ships inert on the store build.

import m from '/vendor/mithril/mithril.js';
import { t } from './locale.js';

/** @typedef {import('../options/sections/reset-row.js').Send} Send */
/** @typedef {{ linked?: boolean | string, path?: string, lastSeen?: number, name?: string, did?: string }} LivePeer */
/**
 * @typedef {object} Contact
 * @property {string} did
 * @property {string | null} [name]
 * @property {string} [notes]
 * @property {string[]} [tags]
 * @property {boolean} [favorite]
 * @property {boolean} [saved]
 * @property {number | null} [createdAt]
 * @property {number | null} [updatedAt]
 * @property {any} [activity]
 * @property {LivePeer | null} [live]
 */

// p·cyan e·red e·amber r·green d·magenta — a peer's avatar color, random per
// did, cached for the session (the sanctioned "peers ARE the content" accent,
// mirroring network-section.js / the commons participant rail).
const BRAND = ['#00B7EB', '#EF4444', '#F59E0B', '#22C55E', '#D946EF'];
/** @type {Map<string, string>} */
const colorByDid = new Map();
/** @param {string} did */
const colorOf = (did) => {
  if (!colorByDid.has(did)) {
    if (colorByDid.size >= 512) colorByDid.clear();
    colorByDid.set(did, BRAND[Math.floor(Math.random() * BRAND.length)]);
  }
  // why the cast: the key was just ensured present, so it's always a string.
  return /** @type {string} */ (colorByDid.get(did));
};

/** @param {string} did */
const short = (did) => (typeof did === 'string' ? did.slice(-8) : '????????');

/** @param {number} [ms] */
const fmtWhen = (ms) => {
  if (typeof ms !== 'number' || !ms) return '';
  const min = Math.round((Date.now() - ms) / 60000);
  if (min < 1) return t('刚刚', 'just now');
  if (min < 60) return `${min}${t('分钟前', 'm ago')}`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr}${t('小时前', 'h ago')}`;
  const day = Math.round(hr / 24);
  if (day < 30) return `${day}${t('天前', 'd ago')}`;
  try { return new Date(ms).toLocaleDateString(); } catch { return ''; }
};

// The live connectivity glance for a peer (honest about a browser mesh — never
// fabricates a path). Returns { label, cls } or null when we have no live read.
/** @param {LivePeer | null | undefined} live */
const liveStatus = (live) => {
  if (!live) return null;
  if (!live.linked) return { label: t('听到 · 八卦', 'heard · gossip'), cls: 'is-gossip' };
  const p = live.path;
  if (!p || p === 'unknown') return { label: t('连接中…', 'connecting…'), cls: 'is-connecting' };
  if (p === 'direct-ipv6') return { label: t('直连 · IPv6', 'direct · IPv6'), cls: 'is-direct' };
  if (p === 'direct-ipv4') return { label: t('直连 · IPv4', 'direct · IPv4'), cls: 'is-direct' };
  if (p.includes('srflx')) return { label: t('直连 · IPv4 (STUN)', 'direct · IPv4 (STUN)'), cls: 'is-stun' };
  if (p.includes('relay')) return { label: t('中继 · TURN', 'relay · TURN'), cls: 'is-relay' };
  return { label: p, cls: 'is-stun' };
};

/** @param {Contact} row */
const displayName = (row) => (row.name && row.name.trim() ? row.name.trim() : null);

/** The Contacts section. attrs: { send } */
export const ContactsSection = () => {
  /** @type {Contact[] | null} */
  let contacts = null;          // null = loading; else the contacts/list rows
  /** @type {Map<string, LivePeer>} */
  let liveByDid = new Map();    // did -> live peer { linked, path, lastSeen, name }
  /** @type {string | null} */
  let error = null;
  /** @type {string | null} */
  let expandedDid = null;
  /** @type {string | null} */
  let editingDid = null;
  let editValue = '';
  /** @type {string | null} */
  let busyDid = null;
  /** @type {ReturnType<typeof setInterval> | number} */
  let timer = 0;
  let dead = false;

  /** @param {Send} send */
  const refresh = async (send) => {
    try {
      const r = await send({ type: 'contacts/list' });
      if (r?.ok) { contacts = r.contacts ?? []; error = null; }
      else error = r?.error || t('加载联系人失败', 'failed to load contacts');
    } catch (e) { error = /** @type {{ message?: string }} */ (e)?.message || String(e); }
    if (!dead) m.redraw();
  };

  // Live presence enrichment — best-effort; a failure just drops the status dot.
  /** @param {Send} send */
  const refreshLive = async (send) => {
    try {
      const r = await send({ type: 'dweb/distributed/info' });
      if (r?.ok && Array.isArray(r.peers)) liveByDid = new Map(r.peers.map((/** @type {LivePeer} */ p) => [p.did, p]));
    } catch { /* best-effort */ }
  };

  // The merged, sorted view: durable contacts first, then any LIVE peer we don't
  // yet have a row for (so a peer you just met is nameable before any history).
  const rows = () => {
    /** @type {Map<string, Contact>} */
    const byDid = new Map((contacts ?? []).map((c) => [c.did, { ...c, live: liveByDid.get(c.did) ?? null }]));
    for (const [did, live] of liveByDid) {
      if (byDid.has(did)) continue;
      byDid.set(did, {
        did, name: null, notes: '', tags: [], favorite: false, saved: false,
        createdAt: null, updatedAt: null,
        activity: { appsInstalled: [], appCount: 0, installCount: 0, updateCount: 0, eventCount: 0, firstEventAt: null, lastEventAt: null },
        live,
      });
    }
    /** @param {Contact} r */
    const recency = (r) => Math.max(r.activity?.lastEventAt ?? 0, r.updatedAt ?? 0, r.live?.lastSeen ?? 0);
    return [...byDid.values()].sort((a, b) =>
      (Number(b.favorite) - Number(a.favorite))
      || (Number(!!b.live?.linked) - Number(!!a.live?.linked))
      || (recency(b) - recency(a))
      || (Number(!!displayName(b)) - Number(!!displayName(a)))
      || a.did.localeCompare(b.did));
  };

  /** @param {Contact} row */
  const startEdit = (row) => { editingDid = row.did; editValue = displayName(row) || ''; };
  /**
   * @param {Send} send
   * @param {Contact} row
   */
  const commitEdit = async (send, row) => {
    if (editingDid !== row.did) return;
    const name = editValue.trim();
    editingDid = null;
    // No-op if unchanged (and don't create an empty overlay for a live-only peer).
    if (name === (displayName(row) || '')) { m.redraw(); return; }
    busyDid = row.did;
    const r = await send({ type: 'contacts/set', did: row.did, name });
    busyDid = null;
    if (!r?.ok) error = r?.error || t('无法保存名称', 'could not save name');
    await refresh(send);
  };

  /**
   * @param {Send} send
   * @param {Contact} row
   */
  const toggleFavorite = async (send, row) => {
    busyDid = row.did;
    const r = await send({ type: 'contacts/set', did: row.did, favorite: !row.favorite });
    busyDid = null;
    if (!r?.ok) error = r?.error || t('无法更新', 'could not update');
    await refresh(send);
  };

  /**
   * @param {Send} send
   * @param {Contact} row
   */
  const forget = async (send, row) => {
    busyDid = row.did;
    const r = await send({ type: 'contacts/forget', did: row.did });
    busyDid = null;
    if (!r?.ok && r?.error !== 'contact-not-found') error = r?.error || t('无法忘记', 'could not forget');
    expandedDid = null;
    await refresh(send);
  };

  /**
   * @param {Send} send
   * @param {Contact} row
   */
  const detail = (send, row) => {
    /** @type {any} */
    const a = row.activity || {};
    return m('.contact-detail', [
      m('.contact-did', { title: row.did }, row.did),
      m('.contact-activity', [
        a.appCount
          ? m('div', [
              m('span.contact-stat-label', `${a.appCount} ${t('个应用已从此对端安装：', `app${a.appCount === 1 ? '' : 's'} installed from them: `)}`),
              a.appsInstalled.map((/** @type {any} */ app, /** @type {number} */ i) => m('span.contact-app', { key: app.appId || i }, (app.name || t('未命名', 'untitled')) + (i < a.appsInstalled.length - 1 ? ', ' : ''))),
            ])
          : m('.muted', t('暂无从此对端安装的应用。', 'No apps installed from this peer yet.')),
        (a.installCount || a.updateCount)
          ? m('.muted.contact-counts', `${a.installCount} ${t('次安装', `install${a.installCount === 1 ? '' : 's'}`)} · ${a.updateCount} ${t('次更新', `update${a.updateCount === 1 ? '' : 's'}`)}`)
          : null,
        a.firstEventAt ? m('.muted.contact-counts', `${t('首次相遇', 'First met')} ${fmtWhen(a.firstEventAt)} · ${t('最后活动', 'last activity')} ${fmtWhen(a.lastEventAt)}`) : null,
      ]),
      m('.contact-detail-actions', [
        m('button.peerd-net-btn', { disabled: busyDid === row.did, onclick: () => toggleFavorite(send, row) }, row.favorite ? t('★ 已收藏', '★ Favorited') : t('☆ 收藏', '☆ Favorite')),
        row.saved
          ? m('button.peerd-net-btn', { disabled: busyDid === row.did, onclick: () => forget(send, row) }, t('忘记', 'Forget'))
          : null,
      ]),
    ]);
  };

  /**
   * @param {Send} send
   * @param {Contact} r
   */
  const row = (send, r) => {
    const name = displayName(r);
    const status = liveStatus(r.live);
    const expanded = expandedDid === r.did;
    const editing = editingDid === r.did;
    const initial = (name || short(r.did)).trim().charAt(0).toUpperCase() || '?';
    return m('li.peerd-disc-row.contact-row', { key: r.did }, [
      m('.contact-avatar', { style: `background:${colorOf(r.did)}`, 'aria-hidden': 'true' }, initial),
      m('.peerd-disc-meta', [
        editing
          ? m('input.contact-name-input', {
              value: editValue,
              placeholder: t('添加名称…', 'Add a name…'),
              oncreate: (/** @type {{ dom: HTMLInputElement }} */ v) => v.dom.focus(),
              oninput: (/** @type {{ target: HTMLInputElement }} */ e) => { editValue = e.target.value; },
              onkeydown: (/** @type {KeyboardEvent} */ e) => {
                if (e.key === 'Enter') commitEdit(send, r);
                if (e.key === 'Escape') { editingDid = null; m.redraw(); }
              },
              onblur: () => commitEdit(send, r),
            })
          : m('.contact-name-line', [
              m('span.peerd-disc-name', name || m('span.muted', `${t('对端', 'peer')} ${short(r.did)}`)),
              r.favorite ? m('span.contact-fav', { 'aria-label': t('收藏', 'favorite') }, '★') : null,
              status ? m('span.contact-status', { class: status.cls }, status.label) : null,
            ]),
        m('span.peerd-disc-pub', name
          ? `…${short(r.did)}${r.activity?.appCount ? ` · ${r.activity.appCount} ${t('个应用', `app${r.activity.appCount === 1 ? '' : 's'}`)}` : ''}`
          : (r.activity?.appCount ? `${r.activity.appCount} ${t('个应用', `app${r.activity.appCount === 1 ? '' : 's'}`)} · …${short(r.did)}` : `…${short(r.did)}`)),
      ]),
      m('.contact-row-actions', [
        m('button.peerd-net-btn', { title: t('编辑名称', 'Edit name'), disabled: busyDid === r.did, onclick: () => startEdit(r) }, name ? t('重命名', 'Rename') : t('命名', 'Name')),
        m('button.peerd-net-btn', {
          'aria-expanded': String(expanded),
          title: expanded ? t('隐藏活动', 'Hide activity') : t('显示活动', 'Show activity'),
          onclick: () => { expandedDid = expanded ? null : r.did; },
        }, expanded ? t('隐藏', 'Hide') : t('活动', 'Activity')),
      ]),
      expanded ? detail(send, r) : null,
    ]);
  };

  return {
    /** @param {{ attrs: { send: Send } }} vnode */
    oninit(vnode) { refresh(vnode.attrs.send); refreshLive(vnode.attrs.send); },
    /** @param {{ attrs: { send: Send } }} vnode */
    oncreate(vnode) {
      timer = setInterval(() => {
        if (document.hidden) return;
        refresh(vnode.attrs.send);
        refreshLive(vnode.attrs.send);
      }, 5000);
    },
    onremove() { dead = true; if (timer) clearInterval(timer); },
    /** @param {{ attrs: { send: Send } }} vnode */
    view(vnode) {
      const send = vnode.attrs.send;
      const list = contacts === null ? [] : rows();
      return m('.peerd-disc.contacts', [
        error ? m('p.peerd-disc-err', { style: 'padding:8px;' }, error) : null,
        contacts === null
          ? m('.peerd-net-empty', t('加载联系人中…', 'Loading contacts…'))
          : list.length === 0
            ? m('.peerd-net-empty',
                t('暂无已知对端。您在网络上遇到的对端 — 以及您从中', 'No known peers yet. Peers you meet on the network — and anyone you ')
                + t('安装应用的任何人 — 都会显示在此处，可随时命名。', 'install an app from — show up here, ready to name.'))
            : m('ul.peerd-disc-list', list.map((r) => row(send, r))),
      ]);
    },
  };
};
