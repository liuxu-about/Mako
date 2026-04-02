# Mako Tauri 迁移计划

状态：Implemented  
更新时间：2026-04-02  
分支：`main`

## 0. 当前完成度

- Phase 0 到 Phase 5 已全部落地，仓库默认桌面壳和默认发布链路已切到 Tauri 2
- `npm run dev` / `npm run dist` 已全部切到 Tauri，Electron 壳已从仓库中移除
- Electron 主进程、preload、builder 配置和旧的 `afterPack` 打包脚本已全部删除
- macOS 发布链路使用仓库内的 `scripts/dist-tauri.mjs`，直接产出 `dist/Mako.app` 和 `dist/Mako.dmg`
- Windows / Linux 的 Tauri 打包脚本已接入 `dist:win` / `dist:linux`，但最终发布前仍需要在对应原生系统或 CI runner 上做一次 smoke test

说明：第 2 到第 10 节保留迁移过程存档，因此仍会提到已经删除的 Electron 文件和双宿主迁移策略；这些内容仅用于记录迁移决策，不代表当前仓库仍保留 Electron 代码。

## 1. 目标

这次迁移的核心目标不是“借机重做前端”，而是：

- 尽量保留现有 `src/renderer/**` 的 UI、排版、交互和编辑器栈
- 去掉 Electron / Chromium 的壳成本，优先换成 Tauri 2
- 保留当前产品能力：单文件打开、工作区侧边栏、自动保存、外部文件热更新、主题、自定义 CSS、PDF 导出、拖拽打开、文件关联
- 把迁移风险控制在“主进程重写 + 前端适配层替换”，而不是“整仓重做”

结合当前仓库实现，最可行的路线是：

1. 先在前端引入一层与 Electron 脱钩的 `DesktopAPI`
2. 再在 `src-tauri/` 里用 Rust commands / events / menu / window API 接住这些能力
3. 等 Tauri 版本跑通后，再删除 Electron 主进程和 preload（已完成）

## 2. 迁移前实现现状（存档）

### 2.1 当前架构

- Electron 主进程几乎所有桌面能力都集中在 [src/main/index.ts](/Users/liuxu/lifeProjects/ColaMD/src/main/index.ts)
- preload 只负责暴露 `window.electronAPI`，定义在 [src/preload/index.ts](/Users/liuxu/lifeProjects/ColaMD/src/preload/index.ts)
- renderer 入口在 [src/renderer/main.ts](/Users/liuxu/lifeProjects/ColaMD/src/renderer/main.ts)
- 编辑器、侧边栏、设置、主题、状态基本都已经在 `src/renderer/**` 内部完成解耦
- 打包和发布由 [electron-builder.yml](/Users/liuxu/lifeProjects/ColaMD/electron-builder.yml) + [package.json](/Users/liuxu/lifeProjects/ColaMD/package.json) 驱动

### 2.2 哪些部分可以直接复用

可以高概率直接复用或只做小改动的部分：

- [src/renderer/editor/editor.ts](/Users/liuxu/lifeProjects/ColaMD/src/renderer/editor/editor.ts) 及其相关编辑器视图
- [src/renderer/sidebar/sidebar.ts](/Users/liuxu/lifeProjects/ColaMD/src/renderer/sidebar/sidebar.ts)
- [src/renderer/shell/app-shell.ts](/Users/liuxu/lifeProjects/ColaMD/src/renderer/shell/app-shell.ts)
- [src/renderer/shell/settings-panel.ts](/Users/liuxu/lifeProjects/ColaMD/src/renderer/shell/settings-panel.ts)
- [src/renderer/store/app-store.ts](/Users/liuxu/lifeProjects/ColaMD/src/renderer/store/app-store.ts)
- [src/renderer/themes/base.css](/Users/liuxu/lifeProjects/ColaMD/src/renderer/themes/base.css)
- [src/renderer/themes/theme-manager.ts](/Users/liuxu/lifeProjects/ColaMD/src/renderer/themes/theme-manager.ts)
- [src/renderer/index.html](/Users/liuxu/lifeProjects/ColaMD/src/renderer/index.html)
- `resources/` 下现有图标资源，尤其是 `icon.icns` / `icon.png` / `icon.svg`

结论：这不是一个“前端需要重写”的项目，真正需要替换的是 Electron 宿主层。

### 2.3 哪些部分与 Electron 强耦合

这几块需要重做：

- [src/main/index.ts](/Users/liuxu/lifeProjects/ColaMD/src/main/index.ts)
  - 窗口创建、多窗口复用、标题更新、关闭拦截、菜单、文件监听、文件对话框、PDF 导出、文件关联入口都在这里
- [src/preload/index.ts](/Users/liuxu/lifeProjects/ColaMD/src/preload/index.ts)
  - `contextBridge + ipcRenderer.invoke/on`
- [src/renderer/env.d.ts](/Users/liuxu/lifeProjects/ColaMD/src/renderer/env.d.ts)
  - 全局类型目前绑定到 `window.electronAPI`
- [src/renderer/main.ts](/Users/liuxu/lifeProjects/ColaMD/src/renderer/main.ts)
  - 当前直接依赖 Electron 风格的菜单事件和 IPC 语义
- [electron.vite.config.ts](/Users/liuxu/lifeProjects/ColaMD/electron.vite.config.ts)
  - 构建输出同时包含 `main/preload/renderer`
- [electron-builder.yml](/Users/liuxu/lifeProjects/ColaMD/electron-builder.yml)
  - 目标平台、安装包、文件关联、图标、afterPack 钩子都在这里
- [scripts/afterPack.js](/Users/liuxu/lifeProjects/ColaMD/scripts/afterPack.js)
  - 这是 Electron Builder 的 macOS 打包后处理，不会原样复用

## 3. 迁移判断

### 3.1 为什么适合 Tauri

这个仓库适合 Tauri 的原因很直接：

- 前端已经是独立的 HTML + TypeScript + CSS，不依赖 React/Vue 或 Electron DOM hack
- Electron 特有逻辑主要集中在主进程和 preload，没有大面积渗透到组件内部
- 当前资源占用的大头是 Electron 壳，而不是需要重做的 UI 层
- Tauri 官方支持接入现有前端和 Vite 构建流程，适合“保留前端，替换宿主层”的迁移路径

### 3.2 预期收益

按当前仓库形态，迁到 Tauri 后的收益主要是：

- 明显降低桌面壳的内存基线
- 显著缩小安装包体积
- 保留现有前端代码和产品交互

但这件事也有边界：

- `Milkdown + Mermaid + KaTeX` 的前端内存不会因为换 Tauri 而消失
- 如果目标是做到“接近原生编辑器”的极低占用，后面仍然要继续优化编辑器栈

更具体地说，当前仓库最像是“Electron 壳偏重，renderer 也不轻”的组合：

- 换到 Tauri 后，最先下降的是 Electron/Chromium 的宿主成本
- `src/renderer/**` 里的编辑器和 UI 栈会大体保留原有开销
- 所以这次迁移的工程目标应该是“明显变轻”，而不是“变成原生级极轻应用”

## 4. 目标架构

### 4.1 新的分层

建议迁移后的结构：

```text
src/
├── renderer/
│   ├── main.ts
│   ├── desktop/
│   │   ├── api.ts
│   │   ├── types.ts
│   │   ├── electron-adapter.ts
│   │   └── tauri-adapter.ts
│   └── ...
└── ...

src-tauri/
├── Cargo.toml
├── tauri.conf.json
├── capabilities/
└── src/
    ├── main.rs
    ├── commands/
    ├── menu.rs
    ├── window.rs
    ├── files.rs
    └── watch.rs
```

原则：

- renderer 不再直接依赖 `window.electronAPI`
- renderer 只认识一个平台无关接口 `DesktopAPI`
- Electron 和 Tauri 都只是 `DesktopAPI` 的不同实现
- 迁移期可以双宿主并存，先跑通 Tauri，再删除 Electron

### 4.2 建议定义的前端接口

建议先抽一层接口，覆盖当前 [src/preload/index.ts](/Users/liuxu/lifeProjects/ColaMD/src/preload/index.ts) 暴露的能力：

```ts
export interface DesktopAPI {
  openFile(): Promise<OpenedFileData | null>
  openFileInCurrentWindow(path: string): Promise<OpenedFileData | null>
  openDroppedFile(file: File): Promise<OpenedFileData | null>
  saveFile(content: string): Promise<FileActionResult>
  saveCurrentFileSilently(content: string): Promise<boolean>
  saveFileAs(content: string): Promise<FileActionResult>
  exportPDF(): Promise<FileActionResult>
  pickWorkspaceFolder(): Promise<string | null>
  readWorkspaceDirectory(path: string): Promise<WorkspaceDirectoryResult>
  searchWorkspace(root: string, query: string): Promise<WorkspaceSearchResult[]>
  renameWorkspaceFile(path: string, nextName: string): Promise<WorkspaceRenameResult | null>
  createWorkspaceNote(root: string, preferredDirectory?: string | null): Promise<OpenedFileData | null>
  loadCustomTheme(): Promise<string | null>
  setDirtyState(isDirty: boolean): Promise<void>
  rendererReady(): Promise<OpenedFileData | null>
  notifyWindowCloseReady(): Promise<void>
  onFileChanged(callback: (content: string) => void): () => void
  onFilePathUpdated(callback: (path: string) => void): () => void
  onNewFile(callback: () => void): () => void
  onFileOpened(callback: (data: OpenedFileData) => void): () => void
  onMenuOpen(callback: () => void): () => void
  onOpenSettings(callback: () => void): () => void
  onMenuOpenFolder(callback: () => void): () => void
  onMenuCloseWorkspace(callback: () => void): () => void
  onMenuRefreshWorkspace(callback: () => void): () => void
  onMenuSave(callback: () => void): () => void
  onMenuSaveAs(callback: () => void): () => void
  onMenuExportPDF(callback: () => void): () => void
  onToggleSourceMode(callback: () => void): () => void
  onShowOutline(callback: () => void): () => void
  onSetUITheme(callback: (theme: UIThemeName) => void): () => void
  onSetDocTheme(callback: (theme: DocThemeName) => void): () => void
  onToggleSidebar(callback: () => void): () => void
  onMenuImportTheme(callback: () => void): () => void
  onPrepareWindowClose(callback: () => void): () => void
}
```

关键点不是这个接口本身，而是尽快把 renderer 从 `window.electronAPI` 上摘下来。

## 5. Electron 能力到 Tauri 的映射

| 当前能力 | 当前实现 | Tauri 对应方案 | 风险 |
| --- | --- | --- | --- |
| 打开/保存文件对话框 | `dialog.showOpenDialog/showSaveDialog` in [src/main/index.ts](/Users/liuxu/lifeProjects/ColaMD/src/main/index.ts) | `@tauri-apps/plugin-dialog` + Rust command | 低 |
| 读写文件 | Node `fs` / `fs/promises` in [src/main/index.ts](/Users/liuxu/lifeProjects/ColaMD/src/main/index.ts) | Rust commands 直接处理；必要时辅以 `plugin-fs` | 低 |
| 外部文件热更新 | `fs.watch` in [src/main/index.ts](/Users/liuxu/lifeProjects/ColaMD/src/main/index.ts) | Rust 后端监听文件变化并向窗口 emit 事件 | 中 |
| 工作区目录读取 / 搜索 / 重命名 / 新建 note | 同上 | Rust commands | 低 |
| 多窗口与同文件复用 | `BrowserWindow` 管理 in [src/main/index.ts](/Users/liuxu/lifeProjects/ColaMD/src/main/index.ts) | `WebviewWindow` / `Window` + Rust 状态管理 | 中 |
| 菜单事件 | `Menu.setApplicationMenu` + `webContents.send` | Tauri 原生 menu + menu event 回调 | 中 |
| 窗口关闭前 flush 自动保存 | `prepare-window-close` 握手 in [src/main/index.ts](/Users/liuxu/lifeProjects/ColaMD/src/main/index.ts) and [src/renderer/main.ts](/Users/liuxu/lifeProjects/ColaMD/src/renderer/main.ts) | `onCloseRequested` + 前端 preventDefault + flush + 二次 close | 低 |
| 文件拖拽打开 | DOM drop + preload path extraction in [src/preload/index.ts](/Users/liuxu/lifeProjects/ColaMD/src/preload/index.ts) | Tauri window/webview drag-drop 事件或直接 DOM File + command | 低 |
| 打开外部链接 | `shell.openExternal` | `@tauri-apps/plugin-opener` | 低 |
| 文件关联 / 命令行文件参数 | `electron-builder` + `app.on('open-file')` + argv parsing | `tauri.conf.json` bundle fileAssociations + Rust startup handling | 中 |
| PDF 导出 | `webContents.printToPDF` | 需要替代方案，不能按 Electron 代码平移 | 高 |

### 5.1 插件和 Rust commands 的职责划分

对这个仓库，不建议把文件系统能力直接散落到前端插件调用里。更稳的划分是：

- `@tauri-apps/plugin-dialog`
  - 负责打开文件、选择文件夹、保存路径、导入 CSS 主题
- `@tauri-apps/plugin-opener`
  - 负责打开外部链接
- `tauri-plugin-window-state`
  - 负责窗口大小、位置、最大化状态持久化
- Rust commands
  - 负责读写文件、工作区目录扫描、全文搜索、重命名、新建 note、静默保存
- Rust 后端事件
  - 负责文件监听、菜单事件转发、关闭前协商、二次打开文件事件

这样做更贴近当前 [src/main/index.ts](/Users/liuxu/lifeProjects/ColaMD/src/main/index.ts) 的职责分布，也更适合后续做多窗口和文件关联。

### 5.2 当前 IPC 面与建议的 Tauri 对照

当前 [src/preload/index.ts](/Users/liuxu/lifeProjects/ColaMD/src/preload/index.ts) 暴露的接口，建议在 Tauri 中继续保留同样语义：

命令式调用：

- `openFile`
- `pickWorkspaceFolder`
- `readWorkspaceDirectory`
- `renameWorkspaceFile`
- `searchWorkspace`
- `createWorkspaceNote`
- `openFileInCurrentWindow`
- `openDroppedFile`
- `saveFile`
- `saveCurrentFileSilently`
- `saveFileAs`
- `exportPDF`
- `loadCustomTheme`
- `setDirtyState`
- `notifyWindowCloseReady`
- `rendererReady`

事件式回调：

- `onFileChanged`
- `onFilePathUpdated`
- `onNewFile`
- `onFileOpened`
- `onMenuOpen`
- `onOpenSettings`
- `onMenuOpenFolder`
- `onMenuCloseWorkspace`
- `onMenuRefreshWorkspace`
- `onMenuSave`
- `onMenuSaveAs`
- `onMenuExportPDF`
- `onToggleSourceMode`
- `onShowOutline`
- `onSetUITheme`
- `onSetDocTheme`
- `onToggleSidebar`
- `onMenuImportTheme`
- `onPrepareWindowClose`

迁移时最重要的不是“把这些名字翻成 Tauri 名词”，而是继续保留这些前端语义。这样 [src/renderer/main.ts](/Users/liuxu/lifeProjects/ColaMD/src/renderer/main.ts) 的业务流就不需要重写。

## 6. 重点风险

### 6.1 PDF 导出是最高风险项

当前 PDF 导出直接依赖 [src/main/index.ts](/Users/liuxu/lifeProjects/ColaMD/src/main/index.ts) 里的 `win.webContents.printToPDF()`。这属于 Electron 专属能力，不能简单替换成 Tauri 官方现成 API。

迁移时建议把 PDF 导出单独拆成一个里程碑，不要阻塞主迁移。备选方案：

- 短期方案：前端打印样式 + 系统打印流程
- 中期方案：单独调研 Tauri 生态插件或平台原生实现
- 保守方案：先让 Tauri 版本缺省关闭 PDF 导出，等主线跑通后补回

这是唯一一个我不建议在 Phase 1 就要求完全对齐的功能。

### 6.2 Tauri 的权限模型需要提前设计

Tauri 2 的 `capabilities / permissions / scope` 比 Electron 更严格。当前应用的能力天然涉及：

- 用户选择任意 Markdown 文件
- 工作区目录读写
- 文件重命名
- 文件监听
- 自定义主题 CSS 读取

如果直接依赖前端 `plugin-fs` 到处访问路径，权限和 scope 会很快变复杂。更稳的做法是：

- 打开文件/文件夹仍然走原生对话框
- 对话框返回的路径只交给 Rust 后端 commands 使用
- 前端尽量不要直接拥有广泛文件系统能力

这样迁移后安全边界更清晰，也更接近当前 Electron 主进程的职责模型。

### 6.3 macOS / Windows / Linux 会出现浏览器内核差异

当前 renderer 基本使用标准 DOM API，但 Tauri 不是固定 Chromium：

- macOS 是 `WKWebView`
- Windows 是 `WebView2`
- Linux 是 `webkit2gtk`

当前代码里需要重点回归的不是基础 DOM，而是：

- Milkdown 编辑器行为
- Mermaid 渲染
- KaTeX 样式
- 复杂 CSS、滚动条、焦点和拖拽体验

从代码看，这些并不是“必然不兼容”，但必须做真机验证，不能只凭 Chromium 经验判断。

### 6.4 菜单和窗口行为会有平台差异

当前菜单和窗口关闭语义深度耦合 Electron：

- macOS 菜单放在应用级
- Windows/Linux 也复用了同一套模板
- 关闭窗口前的 autosave flush 已经有一套工作逻辑

这块不能只“把菜单换成 Tauri API”，而是要保证：

- 菜单事件仍然能命中当前焦点窗口
- 多窗口时不会串发事件
- 关闭窗口流程能正确等待自动保存

### 6.5 打包与发布链不能只做机械替换

当前仓库的发布逻辑不只是“生成一个 `.app`”：

- [package.json](/Users/liuxu/lifeProjects/ColaMD/package.json) 里有 `dev/build/dist` 脚本
- [electron-builder.yml](/Users/liuxu/lifeProjects/ColaMD/electron-builder.yml) 里有平台 target、图标、输出目录、文件关联
- [scripts/afterPack.js](/Users/liuxu/lifeProjects/ColaMD/scripts/afterPack.js) 还做了 macOS 打包后清理

迁到 Tauri 时：

- `resources/` 下的图标大概率能继续复用
- `electron-builder.yml` 的职责会迁到 `src-tauri/tauri.conf.json`
- `afterPack.js` 不能默认继续沿用，需要重新确认 Tauri 打包后的签名和扩展属性处理是否还需要额外步骤

所以发布链的正确迁移方式是“平行接入 Tauri，再逐步退出 Electron”，不是把文件名一对一替换掉。

## 7. 推荐迁移顺序（存档）

## Phase 0：先做接口切缝，不动产品 UI

目标：让前端先不依赖 Electron 全局对象。

任务：

- 新增 `src/renderer/desktop/types.ts`
- 新增 `src/renderer/desktop/api.ts`
- 新增 `src/renderer/desktop/electron-adapter.ts`
- 把 [src/renderer/main.ts](/Users/liuxu/lifeProjects/ColaMD/src/renderer/main.ts) 从 `window.electronAPI` 改成 `getDesktopAPI()`
- 把 [src/renderer/env.d.ts](/Users/liuxu/lifeProjects/ColaMD/src/renderer/env.d.ts) 从 Electron 专属类型调整成适配层可选注入

验收标准：

- 现有 Electron 版本功能不回归
- renderer 已不再直接 import `../preload/index`
- 后续加 Tauri adapter 不需要继续改 UI 组件

## Phase 1：并行接入 Tauri 外壳

目标：先让当前前端在 Tauri 窗口里跑起来。

任务：

- 初始化 `src-tauri/`
- 新增 `tauri.conf.json`、`Cargo.toml`、`src-tauri/src/main.rs`
- 将前端构建切换为普通 Vite 输出，保留现有 `src/renderer` 目录
- 新增 Tauri 版 `dev/build` 脚本
- 让 Tauri 版能加载现有 `index.html` 和 CSS

验收标准：

- `npm run tauri dev` 能拉起现有界面
- 编辑器 UI 正常显示
- 主题和基础交互正常
- `resources/` 中的现有图标资源能被 Tauri bundle 正确消费

## Phase 2：先迁最低风险文件能力

目标：优先迁移文件打开、保存、对话框、标题更新这些低风险能力。

任务：

- 用 Tauri dialog 替换 open/save/pick-folder
- 用 Rust commands 实现读写文件
- 实现 `saveCurrentFileSilently`
- 实现脏状态同步和标题更新
- 实现 `loadCustomTheme`

验收标准：

- 单文件打开/保存/另存为可用
- 自动保存可用
- 自定义主题导入可用

## Phase 3：迁工作区与文件监听

目标：迁移当前最核心的“Agent Native”体验。

任务：

- Rust 实现目录读取、搜索、新建 note、重命名
- Rust 实现文件监听和外部变更推送
- 在 Tauri 多窗口场景下维持“同一文件只开一个窗口”

验收标准：

- 工作区侧边栏完整可用
- 外部修改文件时内容可实时刷新
- 多窗口打开策略与当前版本一致

## Phase 4：迁菜单、文件关联和关闭流程

目标：恢复桌面应用级行为。

任务：

- 用 Tauri menu 重建应用菜单
- 菜单事件分发到当前窗口
- 恢复文件关联和“从 Finder/命令行打开文件”
- 迁移关闭前 autosave flush 逻辑
- 恢复 macOS 应用激活行为

验收标准：

- 菜单快捷键和当前版本一致
- 双击 `.md` 文件可打开 Mako
- 关闭窗口不再意外丢内容

## Phase 5：处理 PDF 导出与发布替换

目标：把剩余平台能力补齐，并移除 Electron 发布链路。

任务：

- 决定 PDF 的正式替代方案
- 迁移图标、bundle metadata、文件关联、安装包格式
- 替换 `electron-builder` 产物为 Tauri bundle
- 完成 Electron fallback 退出并删除旧构建链

完成情况（2026-03-31）：

- PDF 正式替代方案已落地为 macOS `WKWebView.createPDF`，并配合 print-only 样式只导出当前 Markdown 文档内容
- 图标、bundle metadata、文件关联已经迁到 [src-tauri/tauri.conf.json](/Users/liuxu/lifeProjects/ColaMD/src-tauri/tauri.conf.json)
- 默认发布脚本已经从 Electron 切到 Tauri：`npm run dist` / `npm run dist:mac` 产出 `dist/Mako.app` 与 `dist/Mako.dmg`
- Electron fallback 已退出，仓库桌面端仅保留 Tauri 实现

验收标准：

- macOS 基本打包已验证通过
- Windows / Linux 已切到 Tauri bundle 脚本，但需要在对应平台做一次原生打包 smoke test
- 新安装包已可替代旧 macOS 发布链路
- Electron 已从仓库中移除，桌面端只保留 Tauri 构建目标

## 8. 具体到当前仓库的落地建议

### 8.1 第一批文件改造范围

第一批应该只动这些文件：

- [src/renderer/main.ts](/Users/liuxu/lifeProjects/ColaMD/src/renderer/main.ts)
- [src/renderer/env.d.ts](/Users/liuxu/lifeProjects/ColaMD/src/renderer/env.d.ts)
- 新增 `src/renderer/desktop/*`
- [package.json](/Users/liuxu/lifeProjects/ColaMD/package.json)

先不要动：

- 编辑器内部结构
- 侧边栏 DOM/样式
- 主题系统
- 视觉设计

### 8.2 第二批文件改造范围

当 Tauri 外壳和适配层稳定后，再新增：

- `src-tauri/src/main.rs`
- `src-tauri/src/commands/*.rs`
- `src-tauri/src/menu.rs`
- `src-tauri/src/window.rs`
- `src-tauri/src/watch.rs`
- `src-tauri/tauri.conf.json`
- `src-tauri/capabilities/*.json`

### 8.3 Electron 构建链退出记录（存档）

迁移前：

- [package.json](/Users/liuxu/lifeProjects/ColaMD/package.json) 使用 `electron-vite` 和 `electron-builder`
- [electron.vite.config.ts](/Users/liuxu/lifeProjects/ColaMD/electron.vite.config.ts) 负责 `main/preload/renderer`
- [electron-builder.yml](/Users/liuxu/lifeProjects/ColaMD/electron-builder.yml) 负责发布

实际退出顺序：

1. 保留 Electron 构建链，先把 Tauri 构建链并行加进来
2. 等 Tauri 版本达到“日常可用”
3. 再删除 Electron 主进程、preload、builder 配置

这个顺序已经执行完成，当前仓库不再保留 Electron 可发布版本。

### 8.4 建议新增的 Tauri 宿主文件

按当前功能面，`src-tauri/` 至少建议拆成这些职责：

- `src-tauri/src/main.rs`
  - 启动、插件注册、窗口初始化
- `src-tauri/src/commands.rs`
  - 打开/保存/工作区/搜索/重命名/新建 note 等命令
- `src-tauri/src/menu.rs`
  - 原生菜单定义与事件分发
- `src-tauri/src/window.rs`
  - 多窗口、标题、关闭前协商、打开文件参数处理
- `src-tauri/src/watch.rs`
  - 文件监听、去抖、内部保存屏蔽、事件回推

如果一开始就把所有逻辑都塞进 `main.rs`，那只是把今天的 [src/main/index.ts](/Users/liuxu/lifeProjects/ColaMD/src/main/index.ts) 直接换一种语言重写，后面同样会失控。

## 9. 预计回报

按当前仓库形态，迁到 Tauri 的最现实收益是：

- 包体从当前 Electron `.app` 进一步明显下降
- 总内存占用比当前版本下降一大截
- 迁移成本主要集中在宿主层，不需要重做前端

保守判断：

- 这次迁移更像是“换壳 + 重写后端桌面桥”，不是“重做产品”
- 真正的高风险项只有 PDF 导出和跨平台桌面细节
- 只要先把适配层切出来，这个迁移是可控的

## 10. 迁移期推荐下一步（存档）

下一步不要直接上 Rust commands 大迁移，先做最小切缝：

1. 新增 `DesktopAPI` 适配层
2. 让 Electron 继续通过 `electron-adapter` 跑通
3. 再初始化 `src-tauri/`，接入一个最小可运行窗口
4. 然后只优先打通 `open/save/saveAs/silentSave`
5. 最后再上工作区、watcher、菜单和关闭流程

这样做的好处是：

- 不会打断当前 Mako 的可用版本
- 能最早验证“前端几乎不改”这个核心假设
- 也能最快暴露 Tauri 版真正的阻塞点

## 参考

- Tauri 2 支持复用现有前端和手动接入现有项目：<https://v2.tauri.app/start/create-project/>
- Tauri 对 Vite 的前端接入建议：<https://v2.tauri.app/start/frontend/vite/>
- Tauri 配置文件职责：<https://v2.tauri.app/develop/configuration-files/>
- Tauri capabilities / permissions / scope：<https://v2.tauri.app/security/capabilities/>
- Tauri dialog plugin：<https://v2.tauri.app/plugin/dialog/>
- Tauri fs plugin 与 scope：<https://v2.tauri.app/reference/javascript/fs/>
- Tauri menu：<https://v2.tauri.app/learn/window-menu/>
- Tauri webview 版本与平台差异：<https://v2.tauri.app/reference/webview-versions/>
- Tauri 打包与分发：<https://v2.tauri.app/distribute/>
- Tauri macOS app bundle：<https://v2.tauri.app/distribute/macos-application-bundle/>
- Tauri 配置中的 fileAssociations：<https://v2.tauri.app/reference/config/>
