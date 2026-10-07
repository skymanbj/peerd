// @ts-check
// Pure projection for the Actor Fabric. It renders only server-stamped lineage
// belonging to the viewed chat; missing ancestry is omitted, never invented.

/**
 * @typedef {Object} FabricNode
 * @property {string} id
 * @property {string} parentId
 * @property {'root'|'bound'|'subactor'} variant
 * @property {string} kind
 * @property {string} label
 * @property {string} name
 * @property {'working'|'finishing'|'handed-off'} status
 * @property {string} activity
 * @property {string} scope
 * @property {string} access
 * @property {string} boundaryChip
 * @property {string} boundary
 * @property {number|null} cost
 */

/** @param {unknown} value @param {number} [max] */
const compact = (value, max = 80) => {
  const text = String(value ?? '').replace(/\s+/g, ' ').trim();
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
};

/** @param {any[]} messages @param {string} toolUseId */
const toolUseFor = (messages, toolUseId) => {
  for (const message of Array.isArray(messages) ? messages : []) {
    const found = Array.isArray(message?.toolUses)
      ? message.toolUses.find((/** @type {any} */ tool) => tool?.id === toolUseId)
      : null;
    if (found) return found;
  }
  return null;
};

/** @param {any[]} messages @param {unknown} grantedTools */
const latestActivity = (messages, grantedTools) => {
  const allowed = new Set(Array.isArray(grantedTools)
    ? grantedTools.filter((tool) => typeof tool === 'string') : []);
  const rows = Array.isArray(messages) ? messages : [];
  for (let index = rows.length - 1; index >= 0; index -= 1) {
    const uses = Array.isArray(rows[index]?.toolUses) ? rows[index].toolUses : [];
    const tool = uses[uses.length - 1];
    // A model can request any string. Show it as activity only when it was in
    // the server-resolved grant advertised to that worker.
    if (typeof tool?.name === 'string' && allowed.has(tool.name)) {
      return `已请求 ${tool.name.replaceAll('_', ' ')}…`;
    }
  }
  return '正在其任务上下文中推理…';
};

/** @param {unknown} tools */
const exactGrants = (tools) => {
  if (!Array.isArray(tools)) return '正在加载权限';
  if (tools.length === 0) return '仅推理';
  return tools
    .filter((tool) => typeof tool === 'string')
    .join(' · ') || '仅推理';
};

const CAPABILITY_LABELS = /** @type {Readonly<Record<string, string>>} */ (Object.freeze({
  actor_create: '派生子参与者', actor_list: '列出参与者', message_actor: '委派',
  fetch_url: '获取 URL', navigate: '导航', read_page: '读取页面',
  click: '点击页面', type: '在页面上输入', page_keys: '发送页面按键',
  page_code: '运行页面代码', site_client_run: '使用站点客户端',
  script: '运行本地代码',
}));

/** @param {unknown} tools */
const capabilitySummary = (tools) => {
  if (!Array.isArray(tools)) return '正在加载权限';
  if (tools.length === 0) return '仅推理';
  return tools
    .filter((tool) => typeof tool === 'string')
    .map((tool) => CAPABILITY_LABELS[tool] ?? tool.replaceAll('_', ' '))
    .join(' · ') || '仅推理';
};

/** @param {string} kind @param {string} instanceId @param {string} grant */
const boundGrant = (kind, instanceId, grant) => {
  if (kind === 'web' && /^https?:\/\//.test(instanceId)) return `一个来源 · ${grant}`;
  if (kind === 'web') return `一个网页标签页 · ${grant}`;
  if (kind === 'webvm') return `一个 WebVM · ${grant}`;
  if (kind === 'notebook') return `一个笔记本 · ${grant}`;
  if (kind === 'app') return `一个应用 · ${grant}`;
  if (kind === 'dweb') return `对等网格 · ${grant}`;
  return grant;
};

/** @param {string} kind */
const kindName = (kind) => kind === 'webvm' ? 'WebVM' : kind;

/** @param {Record<string, any>} sessions @param {string} sessionId @param {string} rootSessionId */
const belongsToRoot = (sessions, sessionId, rootSessionId) => {
  let cursor = sessionId;
  const seen = new Set();
  while (cursor && !seen.has(cursor)) {
    if (cursor === rootSessionId) return true;
    seen.add(cursor);
    const session = sessions[cursor];
    if (!session) return false;
    if (session.rootSessionId) return session.rootSessionId === rootSessionId;
    cursor = session.parentSessionId;
  }
  return false;
};

/**
 * @param {{
 *   rootSession?: any,
 *   actors?: Record<string, any>,
 *   spawned?: { sessions?: Record<string, any> },
 *   asyncTasks?: Record<string, any>,
 * }} input
 * @returns {{ root: FabricNode, nodes: FabricNode[], activeActors: number }}
 */
export const buildActorFabric = ({ rootSession, actors = {}, spawned = {}, asyncTasks = {} }) => {
  const rootSessionId = String(rootSession?.sessionId ?? '');
  const rootId = `session:${rootSessionId || 'chat'}`;
  const sessions = spawned?.sessions ?? {};

  /** @type {Map<string, { parentSessionId: string, task: any }>} */
  const taskByChild = new Map();
  /** @type {Array<{ parentSessionId: string, task: any }>} */
  const visibleTasks = [];
  for (const [parentSessionId, rawTasks] of Object.entries(asyncTasks ?? {})) {
    if (!Array.isArray(rawTasks)) continue;
    if (parentSessionId !== rootSessionId
      && !belongsToRoot(sessions, parentSessionId, rootSessionId)) continue;
    for (const task of rawTasks) {
      if (!task || (task.status !== 'running' && task.status !== 'done')) continue;
      const row = { parentSessionId, task };
      visibleTasks.push(row);
      if (typeof task.childSessionId === 'string' && task.childSessionId) {
        taskByChild.set(task.childSessionId, row);
      }
    }
  }

  const liveSessionIds = new Set();
  for (const session of Object.values(sessions)) {
    if (!session?.sessionId || !belongsToRoot(sessions, session.sessionId, rootSessionId)) continue;
    if (session.running === true || taskByChild.has(session.sessionId)) {
      liveSessionIds.add(session.sessionId);
    }
  }

  // Keep a settled parent as a lineage stub while a descendant still works,
  // including the brief interval where an async child's session is allocated
  // but its first actor-start snapshot has not hydrated yet.
  const visibleSessionIds = new Set(liveSessionIds);
  const preserveAncestors = (/** @type {string|undefined} */ startId) => {
    let cursor = startId;
    const seen = new Set();
    while (cursor && cursor !== rootSessionId && !seen.has(cursor)) {
      seen.add(cursor);
      if (!sessions[cursor] || !belongsToRoot(sessions, cursor, rootSessionId)) break;
      visibleSessionIds.add(cursor);
      cursor = sessions[cursor]?.parentSessionId;
    }
  };
  for (const sessionId of liveSessionIds) {
    preserveAncestors(sessions[sessionId]?.parentSessionId);
  }
  for (const { parentSessionId } of visibleTasks) {
    preserveAncestors(parentSessionId);
  }

  /** @type {FabricNode[]} */
  const nodes = [];
  /** @type {Set<string>} */
  const nodeIds = new Set();

  for (const sessionId of visibleSessionIds) {
    const session = sessions[sessionId];
    const taskRow = taskByChild.get(sessionId);
    const live = liveSessionIds.has(sessionId);
    const id = `session:${sessionId}`;
    nodes.push({
      id,
      parentId: session.parentSessionId ? `session:${session.parentSessionId}` : rootId,
      variant: 'subactor',
      kind: 'subactor',
      label: live ? '临时子参与者' : '委派父级',
      name: compact(session.task ?? taskRow?.task?.task ?? '临时任务'),
      status: live ? (taskRow?.task?.status === 'done' ? 'finishing' : 'working') : 'handed-off',
      activity: live
        ? latestActivity(session.messages, session.grantedTools ?? taskRow?.task?.grantedTools)
        : '其子级仍在工作…',
      scope: capabilitySummary(session.grantedTools ?? taskRow?.task?.grantedTools),
      access: exactGrants(session.grantedTools ?? taskRow?.task?.grantedTools),
      boundaryChip: live ? '独立工作器' : '仅血缘',
      boundary: live
        ? '专用的无密钥工作器。其独立记录会保留；只有围栏回复会进入父级上下文。'
        : '此已结算的参与者仅为了保留真实委派路径而保持可见。',
      cost: typeof session.cost?.cost === 'number' ? session.cost.cost : null,
    });
    nodeIds.add(id);
  }

  // A running task can know its child id before the first session snapshot.
  // Render the stable session id immediately, then enrich the same node later.
  for (const { parentSessionId, task } of visibleTasks) {
    const childSessionId = typeof task.childSessionId === 'string' && task.childSessionId
      ? task.childSessionId : null;
    const id = childSessionId
      ? `session:${childSessionId}`
      : `task:${parentSessionId}:${String(task.taskId ?? 'pending')}`;
    if (nodeIds.has(id)) continue;
    nodes.push({
      id,
      parentId: parentSessionId ? `session:${parentSessionId}` : rootId,
      variant: 'subactor',
      kind: 'subactor',
      label: '临时子参与者',
      name: compact(task.task ?? '临时任务'),
      status: task.status === 'done' ? 'finishing' : 'working',
      activity: task.status === 'done' ? '正在准备其回复…' : '正在启动其独立工作器…',
      scope: capabilitySummary(task.grantedTools),
      access: exactGrants(task.grantedTools),
      boundaryChip: '独立工作器',
      boundary: '专用的无密钥工作器。其独立记录会保留；只有围栏回复会进入父级上下文。',
      cost: null,
    });
    nodeIds.add(id);
  }

  for (const [toolUseId, card] of Object.entries(actors ?? {})) {
    if (!card?.streaming || !card.sessionId) continue;
    // The root stamp comes from the trusted delivery lane. Unstamped or foreign
    // cards are not safe to attach to the chat merely because an id happens to fit.
    if (card.rootSessionId !== rootSessionId) continue;
    const parentId = card.parentSessionId === rootSessionId
      ? rootId : `session:${String(card.parentSessionId ?? '')}`;
    if (parentId !== rootId && !nodeIds.has(parentId)) continue;
    const parentMessages = parentId === rootId
      ? rootSession?.messages : sessions[card.parentSessionId]?.messages;
    const toolUse = toolUseFor(parentMessages, toolUseId);
    const kind = String(card.kind ?? 'actor');
    const instanceId = String(card.instanceId ?? '');
    const integration = kind === 'web' && /^https?:\/\//.test(instanceId);
    const fallbackName = card.name ?? (integration ? instanceId : instanceId || `${kindName(kind)} 参与者`);
    const task = card.task ?? toolUse?.input?.message;
    /** @type {FabricNode} */
    const node = {
      id: `actor:${card.sessionId}`,
      parentId,
      variant: 'bound',
      kind,
      label: integration ? '集成参与者' : `${kindName(kind)} 参与者`,
      name: compact(task || fallbackName),
      status: 'working',
      activity: latestActivity(card.messages, card.grantedTools),
      scope: boundGrant(kind, instanceId, capabilitySummary(card.grantedTools)),
      access: boundGrant(kind, instanceId, exactGrants(card.grantedTools)),
      boundaryChip: '独立工作器',
      boundary: '专用的无密钥工作器，没有密钥或扩展 API。其记录保留在主模型上下文之外；只有围栏回复会进入。',
      cost: typeof card.cost?.cost === 'number' ? card.cost.cost : null,
    };
    nodes.push(node);
    nodeIds.add(node.id);
  }

  // Reachability, not mere parent-id presence, defines the visible fabric. A
  // corrupt partial chain must not inflate the headline with orphaned nodes.
  const reachable = new Set([rootId]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const node of nodes) {
      if (!reachable.has(node.parentId) || reachable.has(node.id)) continue;
      reachable.add(node.id);
      grew = true;
    }
  }
  const safeNodes = nodes.filter((node) => reachable.has(node.id));
  safeNodes.sort((a, b) => {
    if (a.variant !== b.variant) return a.variant === 'bound' ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
  const activeActors = safeNodes.filter((node) => node.status !== 'handed-off').length;

  /** @type {FabricNode} */
  const root = {
    id: rootId,
    parentId: '',
    variant: 'root',
    kind: 'root',
    label: '主代理',
    name: '协调工作；参与者记忆保持独立。',
    status: 'working',
    activity: activeActors === 1 ? '正在协调一个隔离参与者…' : `正在协调 ${activeActors} 个隔离参与者…`,
    scope: '持有对话权限',
    access: '对话权限',
    boundaryChip: '主上下文',
    boundary: '主代理持有对话权限。参与者记录保留在其模型上下文之外；只有围栏回复会进入。',
    cost: null,
  };

  return { root, nodes: safeNodes, activeActors };
};
