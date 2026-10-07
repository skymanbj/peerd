// @ts-check
// Instance-wide Actor Space. Unlike the compact chat fabric, this full-screen
// monitor intentionally spans every active root session in this peerd instance.
// Its input is the SW-owned projection, never actor-authored claims.

import m from '/vendor/mithril/mithril.js';
import { t } from './locale.js';
import { buildActorFabric } from '/sidepanel/components/actor-fabric-model.js';

/** @typedef {import('/sidepanel/components/actor-fabric-model.js').FabricNode} FabricNode */

const REFRESH_MS = 1_200;

/** @param {string} value */
const inspectorId = (value) => `actor-space-inspector-${value.replace(/[^a-zA-Z0-9_-]/g, '-')}`;

/** @param {string|null|undefined} value */
const displayModel = (value) => {
  const model = String(value ?? '').trim();
  if (!model) return t('模型待定', 'model pending');
  const slash = model.lastIndexOf('/');
  return slash >= 0 ? model.slice(slash + 1) : model;
};

/** @param {FabricNode} node */
const nodeStatus = (node) => node.status === 'handed-off' ? t('传承', 'lineage') : node.status;

/** @param {FabricNode} node @param {string} selectedId @param {(node: FabricNode) => void} select */
const actorNode = (node, selectedId, select) => m('button.actor-space-node', {
  type: 'button',
  class: `is-${node.variant}${selectedId === node.id ? ' is-selected' : ''}`,
  'data-actor-id': node.id,
  'data-actor-kind': node.variant,
  'aria-pressed': selectedId === node.id ? 'true' : 'false',
  'aria-expanded': selectedId === node.id ? 'true' : 'false',
  'aria-controls': selectedId === node.id ? inspectorId(node.id) : undefined,
  'aria-label': `${node.label}: ${node.name}; ${nodeStatus(node)}`,
  onclick: () => select(node),
}, [
  m('span.peerd-spinner.actor-space-node-orb', { 'aria-hidden': 'true' }),
  m('span.actor-space-node-copy', [
    m('span.actor-space-node-topline', [
      m('span.actor-space-node-kind', node.label),
      m('span.actor-space-node-status', nodeStatus(node)),
    ]),
    m('strong.actor-space-node-task', node.name),
    m('span.actor-space-node-activity', node.activity),
    m('span.actor-space-node-boundary', `${node.boundaryChip} · ${node.scope}`),
  ]),
]);

/**
 * @param {string} parentId
 * @param {Map<string, FabricNode[]>} children
 * @param {string} selectedId
 * @param {(node: FabricNode) => void} select
 * @param {Set<string>} ancestry
 * @returns {any}
 */
const actorBranches = (parentId, children, selectedId, select, ancestry) => {
  const rows = children.get(parentId) ?? [];
  if (rows.length === 0) return null;
  return m('ul.actor-space-branches', rows.map((node) => {
    if (ancestry.has(node.id)) return null;
    const next = new Set(ancestry);
    next.add(node.id);
    return m('li.actor-space-branch', { key: node.id }, [
      actorNode(node, selectedId, select),
      actorBranches(node.id, children, selectedId, select, next),
    ]);
  }));
};

/** @param {FabricNode} node @param {() => void} close */
const inspector = (node, close) => m('aside.actor-space-inspector', {
  id: inspectorId(node.id),
  role: 'region',
  'data-inspector-for': node.id,
  'aria-label': `${t('检查器：', 'Inspector for')} ${node.label}`,
}, [
  m('.actor-space-inspector-head', [
    m('span.actor-space-inspector-kicker', t('边界检查器', 'Boundary inspector')),
    m('button.actor-space-inspector-close', {
      type: 'button', 'aria-label': t('关闭参与者检查器', 'Close actor inspector'), onclick: close,
    }, '×'),
  ]),
  m('h3', node.name),
  m('p.actor-space-inspector-kind', `${node.label} · ${nodeStatus(node)}`),
  m('dl.actor-space-inspector-facts', [
    m('div', [m('dt', t('当前', 'Now')), m('dd', node.activity)]),
    m('div', [m('dt', t('访问', 'Access')), m('dd', node.access)]),
    m('div', [m('dt', t('隔离', 'Isolation')), m('dd', node.boundary)]),
  ]),
]);

/**
 * @param {any} root
 * @param {string} selectedId
 * @param {(node: FabricNode) => void} select
 * @param {(sessionId: string) => void|Promise<void>} onOpenSession
 * @param {string|null|undefined} currentSessionId
 * @param {boolean} chatOwnedBySidePanel
 */
const orchestratorRoom = (
  root, selectedId, select, onOpenSession, currentSessionId, chatOwnedBySidePanel,
) => {
  const fabric = buildActorFabric({
    rootSession: root.session,
    actors: root.topology?.actors,
    spawned: root.topology?.spawned,
    asyncTasks: root.topology?.asyncTasks,
  });
  const rootNode = {
    ...fabric.root,
    name: t('主上下文', 'Main context'),
    activity: root.activity,
  };
  /** @type {Map<string, FabricNode[]>} */
  const children = new Map();
  for (const node of fabric.nodes) {
    const siblings = children.get(node.parentId) ?? [];
    siblings.push(node);
    children.set(node.parentId, siblings);
  }
  const selected = [rootNode, ...fabric.nodes].find((node) => node.id === selectedId) ?? null;
  const label = root.busy ? t('编排中', 'orchestrating') : t('参与者活动', 'actors active');
  const current = root.session.sessionId === currentSessionId;
  const destination = chatOwnedBySidePanel
    ? (current ? t('当前在侧面板', 'Current in side panel') : t('在侧面板中显示', 'Show in side panel'))
    : t('在此打开', 'Open here');
  return m('article.actor-space-room', {
    key: root.session.sessionId,
    'data-root-session': root.session.sessionId,
  }, [
    m('header.actor-space-room-head', [
      m('.actor-space-room-identity', [
        m('span.peerd-spinner.actor-space-room-orb', { 'aria-hidden': 'true' }),
        m('div', [
          m('span.actor-space-room-kicker', t('编排器', 'Orchestrator')),
          m('h2', root.session?.title?.trim() || t('未命名对话', 'Untitled chat')),
        ]),
      ]),
      m('.actor-space-room-actions', [
        m('span.actor-space-room-state', label),
        m('button.actor-space-open-chat', {
          type: 'button',
          disabled: chatOwnedBySidePanel && current,
          onclick: () => onOpenSession(root.session.sessionId),
        }, destination),
      ]),
    ]),
    m('.actor-space-room-meta', [
      m('span', displayModel(root.session?.model)),
      m('span', fabric.activeActors === 1 ? t('1 个隔离参与者', '1 isolated actor') : `${fabric.activeActors} ${t('个隔离参与者', 'isolated actors')}`),
      m('span', t('一个主上下文', 'one main context')),
    ]),
    m('p.actor-space-room-now', [m('span', t('当前', 'Now')), root.activity]),
    m('.actor-space-tree', [
      m('.actor-space-root-wrap', actorNode(
        /** @type {FabricNode} */ (rootNode), selectedId, select,
      )),
      fabric.nodes.length
        ? actorBranches(rootNode.id, children, selectedId, select, new Set([rootNode.id]))
        : m('.actor-space-awaiting', t('尚未委派任何隔离工作进程。', 'No isolated worker has been delegated yet.')),
    ]),
    selected ? inspector(selected, () => select(selected)) : null,
  ]);
};

/**
 * @typedef {Object} ActorSpaceState
 * @property {any|null} overview
 * @property {string} error
 * @property {boolean} loading
 * @property {boolean} inFlight
 * @property {boolean} active
 * @property {string} selectedId
 * @property {string} announcement
 * @property {HTMLElement|null} root
 * @property {ReturnType<typeof setInterval>|null} timer
 * @property {(() => void)|null} onVisibility
 * @property {(manual?: boolean) => Promise<void>} load
 */

/** @param {any} overview */
const visibleNodeIds = (overview) => {
  const ids = new Set();
  for (const root of Array.isArray(overview?.roots) ? overview.roots : []) {
    const fabric = buildActorFabric({
      rootSession: root.session,
      actors: root.topology?.actors,
      spawned: root.topology?.spawned,
      asyncTasks: root.topology?.asyncTasks,
    });
    ids.add(fabric.root.id);
    for (const node of fabric.nodes) ids.add(node.id);
  }
  return ids;
};

/** @param {any} overview */
const overviewCounts = (overview) => {
  const roots = /** @type {any[]} */ (Array.isArray(overview?.roots) ? overview.roots : []);
  const actors = roots.reduce((/** @type {number} */ sum, /** @type {any} */ root) => sum + buildActorFabric({
    rootSession: root.session,
    actors: root.topology?.actors,
    spawned: root.topology?.spawned,
    asyncTasks: root.topology?.asyncTasks,
  }).activeActors, 0);
  return { roots: roots.length, actors };
};

export const ActorsSection = {
  /** @param {{ state: ActorSpaceState, attrs: {
   *   send: (msg: any) => Promise<any>,
   *   onActiveActorCount?: (count: number) => void,
   * } }} vnode */
  oninit(vnode) {
    const ui = vnode.state;
    ui.overview = null;
    ui.error = '';
    ui.loading = true;
    ui.inFlight = false;
    ui.active = true;
    ui.selectedId = '';
    ui.announcement = '';
    ui.root = null;
    ui.timer = null;
    ui.onVisibility = null;
    ui.load = async (manual = false) => {
      if (ui.inFlight) {
        if (manual) {
          ui.announcement = t('参与者活动已在刷新中。', 'Actor activity is already refreshing.');
          m.redraw();
        }
        return;
      }
      ui.inFlight = true;
      const initial = !ui.overview;
      if (manual || initial) ui.loading = true;
      if (manual) ui.announcement = t('正在刷新参与者活动。', 'Refreshing actor activity.');
      if (manual) m.redraw();
      let moveFocus = false;
      try {
        const result = await vnode.attrs.send({ type: 'actors/overview' });
        if (!result?.ok) throw new Error(result?.error ?? t('概览不可用', 'overview unavailable'));
        if (!ui.active) return;
        const nextIds = visibleNodeIds(result);
        const focused = document.activeElement;
        const focusedActor = focused instanceof Element
          ? focused.closest('.actor-space-node')?.getAttribute('data-actor-id') : null;
        const focusedInspector = focused instanceof Element
          ? focused.closest('.actor-space-inspector') : null;
        if ((focusedActor && !nextIds.has(focusedActor))
          || (focusedInspector && ui.selectedId && !nextIds.has(ui.selectedId))) {
          moveFocus = true;
          ui.announcement = t('参与者已结束；焦点已移至监视器控件。', 'Actor finished; focus moved to the monitor controls.');
        }
        if (ui.selectedId && !nextIds.has(ui.selectedId)) ui.selectedId = '';
        ui.overview = result;
        vnode.attrs.onActiveActorCount?.(overviewCounts(result).actors);
        ui.error = '';
        if (manual && !moveFocus) {
          const counts = overviewCounts(result);
          ui.announcement = `${t('参与者活动已刷新。', 'Actor activity refreshed.')} ${counts.roots} ${t('个编排器和', 'orchestrators and')} ${counts.actors} ${t('个隔离参与者处于活动状态。', 'isolated actors active.')}`;
        }
      } catch (error) {
        if (!ui.active) return;
        ui.error = error instanceof Error ? error.message : String(error);
        if (manual) ui.announcement = t('参与者活动刷新失败。', 'Actor activity refresh failed.');
      } finally {
        ui.inFlight = false;
        ui.loading = false;
        if (!ui.active) return;
        m.redraw();
        if (moveFocus) requestAnimationFrame(() => {
          const refresh = ui.root?.querySelector('.actor-space-refresh');
          if (refresh instanceof HTMLElement) refresh.focus();
        });
      }
    };
    void ui.load();
  },

  /** @param {{ state: ActorSpaceState, dom: Element }} vnode */
  oncreate({ state: ui, dom }) {
    ui.root = /** @type {HTMLElement} */ (dom);
    ui.timer = setInterval(() => { if (!document.hidden) void ui.load(); }, REFRESH_MS);
    ui.onVisibility = () => { if (!document.hidden) void ui.load(); };
    document.addEventListener('visibilitychange', ui.onVisibility);
  },

  /** @param {{ state: ActorSpaceState }} vnode */
  onremove({ state: ui }) {
    ui.active = false;
    if (ui.timer) clearInterval(ui.timer);
    if (ui.onVisibility) document.removeEventListener('visibilitychange', ui.onVisibility);
  },

  /**
   * @param {{ state: ActorSpaceState, attrs: {
   *   send: (msg: any) => Promise<any>,
   *   onActiveActorCount?: (count: number) => void,
   *   onOpenSession: (sessionId: string) => void|Promise<void>,
   *   currentSessionId?: string|null,
   *   chatOwnedBySidePanel?: boolean,
   * } }} vnode
   */
  view({ state: ui, attrs }) {
    const roots = /** @type {any[]} */ (Array.isArray(ui.overview?.roots) ? ui.overview.roots : []);
    const rooms = roots.map((/** @type {any} */ root) => ({
      root,
      fabric: buildActorFabric({
        rootSession: root.session,
        actors: root.topology?.actors,
        spawned: root.topology?.spawned,
        asyncTasks: root.topology?.asyncTasks,
      }),
    })).sort((a, b) => b.fabric.activeActors - a.fabric.activeActors
      || Number(b.root.busy) - Number(a.root.busy)
      || String(a.root.session?.title ?? a.root.session?.sessionId)
        .localeCompare(String(b.root.session?.title ?? b.root.session?.sessionId)));
    const fabrics = rooms.map((room) => room.fabric);
    const actorCount = fabrics.reduce((/** @type {number} */ sum, fabric) => sum + fabric.activeActors, 0);
    const boundCount = fabrics.reduce((/** @type {number} */ sum, fabric) => sum
      + fabric.nodes.filter((node) => node.variant === 'bound').length, 0);
    const select = (/** @type {FabricNode} */ node) => {
      const opening = ui.selectedId !== node.id;
      ui.selectedId = opening ? node.id : '';
      ui.announcement = opening
        ? `${node.label} ${t('详情已显示。', 'details shown.')}` : `${node.label} ${t('详情已隐藏。', 'details hidden.')}`;
      if (!opening) requestAnimationFrame(() => {
        const actor = [...(ui.root?.querySelectorAll('.actor-space-node') ?? [])]
          .find((element) => element.getAttribute('data-actor-id') === node.id);
        if (actor instanceof HTMLElement) actor.focus();
      });
    };

    return m('section.actor-space', { 'aria-labelledby': 'actor-space-title' }, [
      m('header.actor-space-hero', [
        m('.actor-space-hero-copy', [
          m('span.actor-space-eyebrow', t('实时实例图', 'Live instance map')),
          m('h1#actor-space-title', t('参与者', 'Actors')),
          m('p', t('此 peerd 实例中每个活跃的编排器和隔离工作进程，跨越所有对话。', 'Every active orchestrator and isolated worker in this peerd instance, across every chat.')),
        ]),
        m('.actor-space-summary', { 'aria-label': t('参与者统计', 'Actor totals') }, [
          m('.actor-space-stat', [m('strong', String(roots.length)),
            m('span', roots.length === 1 ? t('编排器', 'orchestrator') : t('编排器', 'orchestrators'))]),
          m('.actor-space-stat', [m('strong', String(actorCount)), m('span', t('隔离参与者', 'isolated actors'))]),
          m('.actor-space-stat', [m('strong', String(boundCount)), m('span', t('资源绑定', 'resource-bound'))]),
        ]),
      ]),
      m('.actor-space-trust-line', [
        m('span.peerd-spinner.peerd-spinner--sm', { 'aria-hidden': 'true' }),
        m('span', t('实时来自 peerd 运行时 · 工作进程边界是物理的，访问由服务器解析', 'Live from peerd runtime · worker boundaries are physical, access is server-resolved')),
        m('button.actor-space-refresh', {
          type: 'button', disabled: ui.loading, onclick: () => void ui.load(true),
        }, ui.loading ? t('刷新中…', 'Refreshing…') : t('刷新', 'Refresh')),
      ]),
      m('p.sr-only', { 'aria-live': 'polite', 'aria-atomic': 'true' },
        ui.announcement),
      ui.error ? m('.actor-space-error', { role: 'alert' }, `${t('无法刷新参与者：', 'Could not refresh actors:')} ${ui.error}`) : null,
      ui.loading && !ui.overview
        ? m('.actor-space-loading', [m('span.peerd-spinner', { 'aria-hidden': 'true' }), t('正在映射参与者…', 'Mapping actors…')])
        : roots.length === 0
          ? m('.actor-space-empty', [
              m('span.peerd-spinner.actor-space-empty-orb', { 'aria-hidden': 'true' }),
              m('h2', t('实例很安静', 'The instance is quiet')),
              m('p', t('当任何对话开始推理或委派工作时，其编排器和参与者将显示在此处。', 'When any chat starts reasoning or delegates work, its orchestrator and actors will appear here.')),
            ])
          : m('.actor-space-rooms', rooms.map(({ root }) => orchestratorRoom(
              root, ui.selectedId, select, attrs.onOpenSession,
              attrs.currentSessionId, attrs.chatOwnedBySidePanel === true,
            ))),
      m('footer.actor-space-legend', [
        m('span.actor-space-legend-root', t('编排器 · 主上下文', 'orchestrator · main context')),
        m('span.actor-space-legend-bound', t('实线 · 资源绑定参与者', 'solid · resource-bound actor')),
        m('span.actor-space-legend-sub', t('虚线 · 临时子参与者', 'dashed · temporary subactor')),
        m('span', t('隔离的回复会向上回传', 'fenced replies travel back up')),
      ]),
    ]);
  },
};
