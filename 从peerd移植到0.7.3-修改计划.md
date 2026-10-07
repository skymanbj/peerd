# peerd-0.7.3 修改计划（基于 `peerd` 仓库的定制提交）

> 生成时间：2026-10-07
> 源：`D:\Syncthing backup\Zhongzhuan\扩展程序\peerd`（定制源，基线 0.2.6）
> 目标：`D:\Syncthing backup\Zhongzhuan\扩展程序\peerd-0.7.3`（当前工作目录，基线 0.7.3）

---

## 一、背景与结论

| 项目 | `peerd` | `peerd-0.7.3` |
|---|---|---|
| package.json 版本 | 0.2.6 | 0.7.3 |
| CHANGELOG 最新 | 0.2.6（2026-07-06） | 0.7.3（2026-08-18） |
| git 提交 | 13 个（1 导入 + 12 定制） | 1 个（整包导入，1662 文件） |
| 远程 | 无 | `github.com/skymanbj/peerd.git` |
| 未提交改动 | 3 个文件（app.js / package.json / packaging/package.ts） | 无（工作区干净） |

**结论**：`peerd` 是**定制来源**（在旧版 0.2.6 上做了汉化、UI、提供商模型等 12 项改造），`peerd-0.7.3` 是**移植目标**（新版 0.7.3 上游代码，只完成了一部分定制）。本计划把 `peerd` 中**尚未移植**的定制，逐项落到 0.7.3。

**已完成移植的部分**（无需重复，已逐文件核对）：

- ✅ **汉化 / i18n**：`extension/home/locale.js` 与源**逐字节一致**
- ✅ **中英文切换（🌐）**：0.7.3 `home/home.js` 已含 `getLocale/setLocale`
- ✅ **自定义提供商**：`peerd-provider/custom-providers.js` **逐字节一致**
- ✅ **OpenAI 兼容适配器**：`peerd-provider/adapters/openai-compat.js` **逐字节一致**（含 `liveModels: true`、baseUrl 全路径）
- ✅ **模型目录密钥传递**：`background/model-catalog.js` 已含 `getSecret` 透传
- ✅ **自定义提供商 apiFormat 透传**：`background/service-worker.js:729` 已含
- ✅ **模型设置页**：`options/sections/providers.js` 已含 `customModelSearch`、`loadModelOptions`、runner-model 下拉

---

## 二、待移植定制总览

| # | 来源提交 | 内容 | 目标文件 | 状态 |
|---|---|---|---|---|
| A | 未提交改动 | 构建脚本 `bun` → `node` | `package.json` | ❌ 待移植 |
| B | 未提交改动 | Windows 打包 zip 回退 | `packaging/package.ts` | ❌ 待移植 |
| C | 86de52c | CSP 放行 `localhost:20128` | `manifests/*.json` | ❌ 待移植 |
| D | c4114a4 | 提供商路由全路径/回退模型 + 测试 | `background/routes/providers.js`、`tests/**` | ⚠️ 待核对 |
| E | 86de52c + 675ccff | SearchableSelect 搜索选择器 | `shared/searchable-select.js`（新增）等 | ❌ 待移植 |
| F | f471ad2 | 对话重命名 `session/updateTitle` | `background/routes/session-mutations.js`、`home/home.js` | ❌ 待移植 |
| G | fde91cc + badf6ef | 侧栏对话列表合并 + 折叠箭头 | `home/home.js`、`home/home.css` | ❌ 待移植 |
| H | e8b53a2 | 深色/浅色/自动主题 | `home/home.js`、`sidepanel/sidepanel.js`、`sidepanel/styles.css` | ❌ 待移植 |
| I | 66e29b3 + 675ccff | 输入框加宽 / 模型框边框 | `home/home.css` | ❌ 待移植 |
| J | 45fd58b + 未提交改动 | 移除「预览」徽章 | `home/home.js`、`sidepanel/components/app.js`、`home/home.css` | ❌ 待移植 |
| K | f471ad2 | 通行密钥自动拉起 + 按钮文案 | `sidepanel/components/vault-gate.js` | ❌ 待移植 |
| L | e8b53a2 | 统一 emoji（⚙️ 等） | `home/home.js` | ❌ 待移植 |

---

## 三、分阶段修改计划

### Phase 0 — 前置准备

1. **确认方向**：本计划假定移植方向为 `peerd` → `peerd-0.7.3`（如方向相反请先纠正）。
2. **建分支**：在 `peerd-0.7.3` 上新建 `port-from-peerd` 分支，保留 `main` 干净可回退。
3. **对齐基线**：`peerd` 有 3 个未提交改动（app.js / package.json / packaging/package.ts），移植前先确认这些也是要带过去的定制（本计划已将其纳入 A/B/J 项）。
4. **版本号保持不变**：`package.json` 的 `version` 维持 `0.7.3`，不要回退成 0.2.6。

### Phase 1 — 构建与打包环境适配（A、B）

> 依据：`peerd` 的未提交改动。用户环境为 Windows，且未使用 bun。

1. `package.json`：把 `scripts` 中所有 `bun xxx.ts` 改为 `node --experimental-strip-types xxx.ts`，`.mjs` 脚本改为 `node xxx.mjs`。
   - 注意 0.7.3 的 `gen:dev` 比 0.2.6 多了一步 `gen-supply-chain-badges.ts`，**必须保留**。
   - 0.7.3 的 `lint` 是 `eslint extension packaging/templates/web-shell`，不要漏掉第二个参数。
2. `packaging/package.ts`：为 `execFileSync('zip', ...)` 包一层 `try/catch`，`win32` 下回退到 PowerShell `Compress-Archive`，非 Windows 仍抛原错误。
   - ⚠️ 0.7.3 的 `package.ts` 已重写为「可复现 zip」（固定时间戳/权限/顺序，`SOURCE_DATE_EPOCH`）。回退分支要保留同样的确定性语义，或至少在注释中标注该回退产物不保证字节可复现。

### Phase 2 — 网络与提供商收尾（C、D）

1. **CSP 放行本地自定义提供商**（来源 86de52c）：
   - 在 `manifests/base.json`、`manifests/dev.patch.json`、`manifests/preview.patch.json` 的 `extension_pages.connect-src` 末尾追加 ` http://localhost:20128`。
   - 然后执行 `bun run gen:dev`（或 Phase 1 后的 `node` 版）重新生成 `extension/manifest.json`。
   - ⚠️ **禁止手改** `extension/manifest.json`：它由 `gen:dev` 从 `manifests/*.json` 生成，CI 会校验漂移（见 AGENTS.md）。
2. **核对 `background/routes/providers.js`**（来源 c4114a4 / 86de52c，与源差 55 行）：
   - 逐条确认：`baseUrl` 支持完整路径、测试模型回退逻辑是否已并入 0.7.3。
   - 0.7.3 上游有较大重构，缺失部分需按新结构补写，不要整文件覆盖。
3. **移植测试**：
   - `tests/background/routes-providers.test.ts`（+74 行）
   - `tests/peerd-provider/openai-compat-adapter.test.ts`（+64 行）
   - 若 0.7.3 已有同名测试，做增量合并而非覆盖。

### Phase 3 — SearchableSelect 搜索选择器（E）

> 这是最核心的新增组件，0.7.3 完全缺失。

1. **新增** `extension/shared/searchable-select.js`：采用 `675ccff` 的**最终输入框版**（`input.searchable-select-trigger`，`searchMin` 默认 1，`userTyped` 标志，Enter 选中首项 / Esc 关闭，backdrop 关闭并 blur）。
2. **样式**：
   - `extension/sidepanel/styles.css` 追加 `.searchable-select*` 规则（源 86de52c 的 +98 行）。
   - `extension/options/options.css` 追加对应规则（源 +46 行）。
   - 含 `.searchable-select-trigger:focus { border-color: var(--accent); cursor: text; }`。
3. **接入对话模型选择器**：
   - `extension/sidepanel/components/chat-view.js`：把当前第 421–423 行的原生 `m('select.model-picker-select', ...)` 替换为 `SearchableSelect`。
   - ⚠️ 0.7.3 的 `chat-view.js` 有模型指纹缓存逻辑（第 99 行附近），替换后需保证 `onchange` 仍触发同一套设置更新路径。
4. **接入设置页**：`options/sections/providers.js` 的模型下拉如需复用同一组件，按 0.7.3 已有 `loadModelOptions` 结构对接（0.7.3 已用原生 search 输入，可视情况统一）。

### Phase 4 — 对话 UI 定制（F、G）

1. **新增重命名路由**（来源 f471ad2）：
   - `extension/background/routes/session-mutations.js` 增加 `'session/updateTitle'`：校验 vault 未锁、`title` 为字符串、`trim().slice(0,100)`，更新 session 与 `sessionState`，`pushState()`，处理 `SessionNotFoundError`。
   - ⚠️ 0.7.3 的 `session-mutations.js` 当前 **0 处** `title`，需确认新版的 session 更新 API 签名是否与 0.2.6 一致（`sessions.update`）。
2. **ChatListPanel 重命名 UI**（`home/home.js`）：
   - 新增 `editingId / editVal` 状态、`startRename / saveRename / cancelRename`。
   - 行内 `input.chat-item-edit-input`（聚焦全选、Enter 保存、Esc 取消、blur 保存）。
   - 悬浮显示 `✏️`（`.chat-item-rename`）与 `🗑️`（`.chat-item-del` 由 `⋯` 改为 `🗑️`）。
   - 双击标题进入重命名。
3. **侧栏折叠箭头**（`home/home.js` + `home/home.css`）：
   - 新增 `chatsSubListCollapsed`、`.nav-arrow`（▾/▸）、`.home-nav-item.has-arrow`、`.home-nav-group`。
   - ⚠️ **重大适配风险**：0.7.3 的导航已重构为 `groupedNavItems()` + `.home-nav-group` + `.home-nav-group-label` + `.home-nav-group-items`，且含 `ActorsNavCount`、`NotificationsBell`、`navigateHome()`。源补丁基于旧的扁平 nav，**不能直接套用**，需在 0.7.3 的分组结构内重新实现「chat 项折叠子列表」。
4. **home.css 样式**：`.chat-item-rename`、`.chat-item-edit-input`、`.nav-arrow`、`.home-rail .chat-list*` 等（源 fde91cc +84 / f471ad2 +56 / badf6ef 微调）。

### Phase 5 — 主题（深色/浅色/自动）（H）

1. `home/home.js`：`applyTheme()`（写 `documentElement[data-theme]`）、`localStorage 'theme'`、`storage` 事件跨页同步、导航栏主题切换按钮（自动→浅色→深色循环，☀️/🌙/🌓）。
   - ⚠️ 接入 0.7.3 的 `.home-rail-action` 结构（源基于旧 `.home-nav-item`）。
2. `sidepanel/sidepanel.js`：同样的 `applyTheme()` + `storage` 监听。
3. `sidepanel/styles.css`：
   - 把 `@media (prefers-color-scheme: dark)` 的 `:root` 改为 `:root:not([data-theme="light"])`。
   - 追加 `:root[data-theme="dark"] { --bg:#0B0D0E; --bg-elev:#15181A; --fg:#E8E6E1; --fg-muted:#9a9a9a; --border:#353535; --accent-fg:#0B0D0E; }`。
4. 评估是否需要同步到 `options/` 页（源未改，可保持）。

### Phase 6 — 布局细节与视觉统一（I、L）

1. `home/home.css`：
   - `.home-content--chat { max-width: 960px; }`
   - `.home-content--chat .empty-state--home { width: min(100%, 800px); }`
   - `.home-content--chat .model-picker { border: 1px solid var(--border); border-radius: 8px; }`
2. `home/home.js`：统一 emoji（`⚙` → `⚙️` 等）。
   - 0.7.3 已用 `railIcon('lock'/'set')` 矢量图标替代 emoji，**仅对仍使用 emoji 的位置统一**（如 🌐），避免与新版图标体系冲突。

### Phase 7 — 预览徽章移除（J）

1. `home/home.js`：删除第 718–720 行 `CHANNEL === 'preview' ? m('span.channel-badge.channel-badge--in', ...) : null`。
2. `sidepanel/components/app.js`：删除 TopBar 中第 152 行附近的 `channel-badge` 节点（源未提交改动）。
3. `home/home.css`：删除 `.channel-badge--in` 规则。
4. 保留 `shared` 中 `channel-badge` 的通用样式（其他位置可能仍用）。

### Phase 8 — 通行密钥体验（K）

1. `sidepanel/components/vault-gate.js`：
   - `oncreate` 中 400ms 后机会性自动拉起通行密钥验证（条件：已锁 + `prfEnrolled` + WebAuthn 可用 + 未显示密码短语输入）。
   - 把「改用密码短语」按钮改为 `.secondary` + `margin-top:8px`，文案改为「改用普通密码创建（无 Windows Hello 推荐）」。
   - ⚠️ 0.7.3 的 `vault-gate.js` 与源差 185 行（上游改动较多），需定位到新版对应位置做增量修改。

---

## 四、适配风险与硬性约束

1. **上游架构已变**，源补丁不能整文件覆盖：
   - `extension/` 目录：0.7.3 用 `engine-tabs/`（合并了 app-tab / notebook-tab / vm-tab），并新增 `peerd-voice-host/`。
   - 导航重构：`groupedNavItems` + `.home-rail-action` + `railIcon()`。
   - 因此 Phase 3–5 的 UI 改动**必须按 0.7.3 的新结构重写**，而不是 `git apply`。
2. **生成文件禁改**：`extension/manifest.json`、`extension/shared/channel-config.js` 由 `bun run gen:dev` 生成，只能改 `manifests/*.json` / `packaging/default-settings.mjs`。
3. **保持无构建步骤**：`extension/` 直接跑，不得引入打包器。
4. **三套测试面**：改完必须过
   - `bun test`（单元）
   - `extension/tests/runner.html`（浏览器内，或 `scripts/cdp/run-inbrowser-tests.mjs` 无头）
   - ESLint + `tsc` 严格类型检查 + dweb 边界检查
5. **CSP 与安全**：`localhost:20128` 属本地自定义提供商端点，仅加入 `connect-src`，不要放宽 `script-src`。
6. **i18n 一致性**：新增 UI 文案一律用 `t('中文', 'English')`，沿用 `home/locale.js` 字典。

---

## 五、建议执行顺序与验收清单

**顺序**：Phase 0 → 1 → 2 → 3 → 4 → 5 → 6 → 7 → 8

**每阶段验收**：
- [ ] Phase 1：`node --experimental-strip-types packaging/gen-manifest.ts` 能跑通；Windows 下 `package` 能产出 zip。
- [ ] Phase 2：`gen:dev` 后 `git diff extension/manifest.json` 无意外漂移；CSP 含 `localhost:20128`。
- [ ] Phase 3：侧面板模型选择器可输入搜索、Enter 选中；`bun test` 通过。
- [ ] Phase 4：对话可双击/点击 ✏️ 重命名并持久化；侧栏 chat 可折叠。
- [ ] Phase 5：首页与侧面板切换 自动/浅色/深色 即时生效且跨页同步。
- [ ] Phase 6/7：首页输入区宽度、模型框边框正确；预览徽章消失。
- [ ] Phase 8：锁定状态下 400ms 后自动弹出通行密钥验证。
- [ ] 全部：`bun test` + 浏览器测试 + `eslint` + `tsc` + dweb 边界检查全绿；载入未打包扩展手工回归一遍。

---

## 六、附：源提交索引（`peerd`，旧→新）

| 提交 | 说明 |
|---|---|
| `3b6c4e1` | 汉化（导入基线，含 i18n） |
| `c6cf1cf` | 中英文切换 |
| `037a596` | 修改提供商、模型设置 |
| `777b043` | 完善模型设置 |
| `c4114a4` | fix provider: 全路径 baseUrl + 回退测试模型 |
| `86de52c` | 优化模型拉取、添加搜索功能（引入 SearchableSelect + CSP） |
| `fde91cc` | 合并对话 UI |
| `45fd58b` | 删除预览徽章 |
| `f471ad2` | 统一侧边栏 UI、对话标题编辑 |
| `badf6ef` | 修复错误、取消「＋」前缀 |
| `e8b53a2` | 深色浅色、统一 emoji |
| `66e29b3` | 加宽输入框 |
| `675ccff` | 加宽输入框、合并模型选择框（SearchableSelect 输入框化） |
| （未提交） | `app.js` 去徽章 / `package.json` bun→node / `package.ts` Windows zip 回退 |
