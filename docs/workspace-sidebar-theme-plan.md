# ColaMD 工作区侧边栏与主题系统实施计划

状态：In Progress  
更新时间：2026-03-30

## 1. 背景

ColaMD 当前是一个极简的单文档 Markdown 编辑器，主打外部 Agent 修改文件时的实时热更新。现在希望在不破坏极简体验的前提下，引入一个参考 Typora 的工作区/文件夹侧边栏，并为后续主题系统扩展、设置面板、状态栏等 UI 演进打基础。

这里有一个产品约束必须保留：

- 默认体验仍然应该是“内容优先”
- 侧边栏必须是可隐藏、可退出的辅助能力
- 不能因为引入工作区功能，把 ColaMD 直接做成 Obsidian 式信息管理工具

同时，第一版工作区侧边栏已经暴露出一个明确问题：虽然功能链路可用，但顶部按钮堆叠过重、文件树图标和选中态过弱、工作区信息位置不稳定，整体离 Typora 那种“轻而克制”的辅助导航还有明显差距。

## 2. 当前代码现状

### 2.1 渲染层

- `src/renderer/index.html` 只有 `#titlebar` 和 `#editor`
- `src/renderer/main.ts` 同时负责应用启动、菜单事件响应、文件同步、拖拽打开
- `src/renderer/editor/editor.ts` 只关心 Milkdown 编辑器实例，不关心 UI 壳层
- `src/renderer/themes/base.css` 当前只覆盖标题栏占位和编辑区样式

### 2.2 主进程与 IPC

- `src/main/index.ts` 当前模型是“单窗口单文件”
- 打开另一个文件时，优先复用空白窗口，否则新开窗口
- 只有“打开文件 / 保存 / 导出 / 导入主题”等 IPC
- 还没有“打开文件夹 / 列目录 / 同窗口切换文件 / 记住工作区”的能力

### 2.3 主题系统

- 当前已有 `body class + CSS variables` 的主题机制
- 当前主题更偏“文档渲染风格”，还不是完整的应用壳主题
- 后续如果加入侧边栏，单一主题轴会开始变得不够用

## 3. 核心决策

### 3.1 不引入 React/Vue 等重 UI 框架

当前阶段不建议引入 React/Vue/Svelte。

原因：

- 当前渲染层 UI 壳非常薄，复杂度还没有高到需要框架
- 编辑器核心是 Milkdown + ProseMirror，壳层与编辑区天然分层，原生 DOM 足够
- 现在引入框架会增加运行时、构建和生命周期协调成本
- 真正缺的不是框架，而是轻量的模块边界和状态管理

### 3.2 引入轻量前端基础设施

采用：

- 原生 TypeScript + DOM
- 极简状态容器
- 清晰的 UI 模块生命周期约定
- 语义化 design tokens

不采用：

- Redux / Zustand / MobX
- 路由系统
- 大型组件库

### 3.3 侧边栏必须默认可隐藏

推荐行为：

- 未打开工作区时，默认隐藏侧边栏
- 用户显式打开文件夹后展示侧边栏
- 用户可通过标题栏按钮和菜单随时隐藏
- 隐藏后主编辑区恢复纯内容视图

### 3.4 主题拆成两层

后续主题体系拆分为：

- `uiTheme`: `system | light | dark`
- `docTheme`: `default | elegant | newsprint | custom`

这样可以避免“整套应用壳都跟着新闻纸/优雅主题跑”的耦合。

### 3.5 工作区导航采用“同窗口切文件”

一旦进入工作区模式，点击文件树中的文件应优先在当前窗口切换，而不是继续沿用“一窗一文件”的旧逻辑。

原因：

- 这更接近 Typora 的预期
- 更适合左侧工作区的交互模型
- 避免点击树节点时不断新开窗口

保留现有行为：

- 用户从 Finder 或命令行直接打开单个文件时，仍可继续走现有单文件入口

## 4. 目标架构

### 4.1 渲染层目标结构

建议演进为：

```text
src/renderer/
├── main.ts
├── env.d.ts
├── editor/
│   └── editor.ts
├── shell/
│   └── app-shell.ts
├── sidebar/
│   ├── sidebar.ts
│   └── tree.ts
├── store/
│   └── app-store.ts
└── themes/
    ├── base.css
    └── theme-manager.ts
```

原则：

- `editor/` 不感知侧边栏
- `shell/` 负责整体布局和挂载
- `sidebar/` 负责工作区 DOM 和交互
- `store/` 负责应用状态，不直接操作具体 DOM
- `theme-manager` 只负责主题计算与应用

### 4.2 页面骨架目标

当前：

```text
body
├── #titlebar
└── #editor
```

目标：

```text
body
└── #app
    ├── #titlebar
    └── #workspace-shell
        ├── #sidebar
        └── #main-pane
            └── #editor
```

### 4.3 状态模型

建议新增全局应用状态：

```ts
interface AppState {
  sidebarCollapsed: boolean
  workspaceRoot: string | null
  workspaceRootSource: 'explicit' | 'inferred' | null
  activeFilePath: string | null
  expandedDirs: string[]
  uiTheme: 'system' | 'light' | 'dark'
  docTheme: 'default' | 'elegant' | 'newsprint' | 'custom'
  customDocThemeCSS?: string
}
```

建议先使用一个极简 store：

- `getState()`
- `setState(partial)`
- `subscribe(listener)`

即可，不需要更复杂的状态库。

## 5. 设计目标

### 5.1 视觉方向

参考 Typora，不参考 Obsidian 的地方：

- 侧边栏更窄，信息密度更高
- 工具按钮更少
- 视觉层级更轻
- 侧边栏是辅助，不是主舞台

推荐参数：

- 侧边栏展开宽度：`240px` 到 `252px`
- 树节点行高：`30px` 到 `32px`
- 缩进：每级 `14px`
- 顶部标题区高度：`48px` 到 `52px`
- 折叠动画时长：`160ms`

### 5.4 Sidebar V2 交互目标

这一轮需要把第一版“可用”继续收敛成“看起来就是对的”：

- 顶部只保留汉堡菜单、`Files/文件` 标题、搜索和新建两个图标按钮
- `Open Folder / Refresh / Close Workspace` 不再堆在正文上方，统一收进底栏三点菜单
- 文件夹和文件使用真实图标，不再显示 `DIR / DOC` 文本标签
- 当前文件使用背景选中态和 hover 反馈，而不是只靠粗体
- 工作区名称和路径信息移到固定底栏，避免漂浮在树底部
- 搜索和新建按钮不能只是视觉 mock，至少要有轻量可交互行为

### 5.2 主题目标

UI 和文档内容要能分别控制：

- `uiTheme` 控制应用壳，包括标题栏占位、侧边栏、面板、hover、边框
- `docTheme` 控制 ProseMirror 内容阅读风格

### 5.3 保留极简产品哲学

这一轮不要做：

- Tabs
- 多面板
- 标签/知识库
- 全局搜索
- 最近文件复杂面板
- 工作区内多文件监听递归刷新

## 6. 分阶段实施计划

## Phase 0：基础设施与主题重构

目标：先把未来扩展会反复碰到的基础问题处理干净。

当前状态：大部分已完成，剩余主要是后续按组件继续保持统一接口约定。

### 任务

- [x] 新增 `src/renderer/store/app-store.ts`
- [x] 将 renderer 级状态从 `main.ts` 拆出
- [ ] 约定 UI 模块接口：`mount / update / destroy`
- [x] 将 `base.css` 的颜色变量升级为语义化 design tokens
- [x] 将主题模型拆为 `uiTheme + docTheme`
- [x] 在 `theme-manager.ts` 中支持 `system` 模式
- [x] 定义侧边栏、面板、hover、选中、分割线等 UI token

### 推荐文件改动

- `src/renderer/main.ts`
- `src/renderer/themes/base.css`
- `src/renderer/themes/theme-manager.ts`
- `src/renderer/store/app-store.ts`（新）

### 验收标准

- 主题切换仍然可用
- 现有编辑器功能无回归
- renderer 入口不再持续膨胀
- 新 token 足够支撑后续 sidebar / settings / statusbar

## Phase 1：应用壳与可隐藏侧边栏

目标：先把 UI 壳子搭起来，哪怕此时工作区数据还是假的或极简的。

当前状态：已完成第一版可用 skeleton。

### 任务

- [x] 将 `index.html` 改成 app shell 结构
- [x] 新增标题栏左侧侧边栏开关按钮
- [x] 新增 `sidebarCollapsed` 状态和本地持久化
- [x] 新增侧边栏空态
- [x] 新增基础动画和响应式行为
- [x] 保证侧边栏按钮是 `no-drag`，不影响窗口拖拽

### 推荐文件改动

- `src/renderer/index.html`
- `src/renderer/main.ts`
- `src/renderer/themes/base.css`
- `src/renderer/shell/app-shell.ts`（新）
- `src/renderer/sidebar/sidebar.ts`（新）

### 验收标准

- 侧边栏可展开/收起
- 收起后编辑区宽度正常恢复
- macOS 标题栏拖拽与交通灯位置不受破坏
- 主题切换时侧边栏颜色正确跟随

## Phase 2：工作区文件夹与文件树

目标：从“一个壳子”变成真正可用的工作区浏览器。

当前状态：第一版可用工作区已完成，目录树采用按目录懒加载，支持手动刷新与目录错误态。

### 任务

- [x] 在主进程增加“打开文件夹”能力
- [x] 在 preload 暴露 `pickWorkspaceFolder`
- [x] 在主进程增加“读取目录树” IPC
- [x] 在 renderer 渲染目录树
- [x] 支持目录展开/折叠
- [x] 支持按文件名排序，目录优先
- [x] 过滤 `.git`、`node_modules`、隐藏文件和非目标文本文件
- [x] 当前文件在树中高亮
- [x] 支持手动刷新工作区
- [x] 区分空目录与目录读取失败

### 推荐 IPC

- `pick-workspace-folder`
- `read-workspace-directory`
- `open-file-in-current-window`

### 推荐文件改动

- `src/main/index.ts`
- `src/preload/index.ts`
- `src/renderer/sidebar/sidebar.ts`
- `src/renderer/sidebar/tree.ts`（新）
- `src/renderer/main.ts`

### 验收标准

- 用户可以选择文件夹作为工作区
- 文件树展示稳定且排序正确
- 点击文件不会新开窗口，而是在当前窗口切换
- 当前文件切换时仍然保留热更新能力

## Phase 3：同窗口切文件与脏状态保护

目标：把工作区模式下最容易出 bug 的部分做稳。

当前状态：核心流程已落地，显式工作区和推断工作区已分开，后续主要是继续验证边界。

### 任务

- [x] 从现有“一窗一文件”逻辑中抽出“当前窗口加载文件”的独立函数
- [x] 新增 `openFileInCurrentWindow(path)` IPC
- [x] 切换文件前复用现有 unsaved changes 确认逻辑
- [x] 切换文件后更新标题、watcher、activeFilePath、侧边栏高亮
- [x] 明确单文件模式和工作区模式的切换边界

### 推荐实现要点

- 直接复用 `confirmDiscardIfDirty`
- 复用 `setLoadedFileState`
- 不复用现在的 `open-file` handler 作为工作区点击入口

### 验收标准

- 点击工作区文件时不会乱开新窗口
- 有未保存内容时会弹确认
- 切换后 watcher 正常工作
- 标题与侧边栏高亮同步

## Phase 4：主题体系完整化

目标：支持真正可持续扩展的明暗模式和文档风格。

当前状态：主体已落地，剩余主要是继续校验和打磨。

### 任务

- [x] `uiTheme` 支持 `system / light / dark`
- [x] 响应系统外观变化
- [x] `docTheme` 支持 `default / elegant / newsprint / custom`
- [x] 将现有主题菜单拆分为“应用主题”和“文档主题”
- [ ] 校验所有 sidebar / panel / editor token 在 light/dark 下的对比度

### 推荐 token 分类

- 背景：`--bg-app` `--bg-surface` `--bg-sidebar`
- 文本：`--text-primary` `--text-secondary`
- 边框：`--border-subtle` `--border-strong`
- 交互：`--hover-bg` `--active-bg` `--selection-bg`
- 结构：`--radius-sm` `--radius-md` `--space-2` `--space-3`

### 验收标准

- 应用壳和文档主题不再彼此污染
- 系统切换深浅色时应用壳可自动同步
- 自定义文档主题仍然可导入

## Phase 5：打磨与稳定性

目标：提升可用性和质量，而不是继续扩功能。

当前状态：菜单级刷新、侧边栏手动刷新和目录错误态已落地；本轮重点切换到 Sidebar V2 打磨，把结构从“功能可用”推进到“视觉和交互都合理”。

### 任务

- [x] 增加 `View -> Toggle Sidebar`
- [x] 增加 `CmdOrCtrl+\\` 快捷键
- [x] 增加 `File -> Open Folder...`
- [x] 支持关闭当前显式工作区
- [x] 支持手动刷新工作区
- [x] 将顶部操作改成 Typora 风格极简顶栏
- [x] 将工作区信息和低频操作移动到底栏
- [x] 增加侧边栏内本地搜索过滤
- [x] 增加工作区内快速新建 Markdown 文件
- [x] 用图标和背景选中态重做文件树视觉层级
- [ ] 优化大目录下的懒展开与渲染
- [x] 补充空态、错误态和权限异常提示
- [ ] 评估是否需要目录变化监听

### 验收标准

- 常用操作都能通过菜单/快捷键触发
- 边界情况有明确反馈
- 大型工作区不会明显拖垮渲染性能

## 7. 文件落点建议

### 高优先级修改文件

- `src/renderer/index.html`
- `src/renderer/main.ts`
- `src/renderer/themes/base.css`
- `src/renderer/themes/theme-manager.ts`
- `src/main/index.ts`
- `src/preload/index.ts`

### 建议新增文件

- `src/renderer/store/app-store.ts`
- `src/renderer/shell/app-shell.ts`
- `src/renderer/sidebar/sidebar.ts`
- `src/renderer/sidebar/tree.ts`

## 8. 关键风险与应对

### 风险 1：与现有产品哲学冲突

问题：

- README 和 CLAUDE 文档当前明确写着“不做文件管理 / 工作区 / 侧边栏”

应对：

- 该能力设计为可隐藏、非默认侵入
- 对外文案改成“可选工作区模式”，而不是产品重心转移

### 风险 2：旧的一窗一文件模型与新工作区模型冲突

问题：

- 当前主进程默认用窗口作为文件容器

应对：

- 新增独立的“当前窗口切换文件”路径
- 不直接拿旧 `open-file` 行为硬套

### 风险 3：主题变量不够语义化，后续样式会发散

问题：

- 当前变量更偏编辑器排版层

应对：

- 在 Phase 0 先补 token，再做 sidebar 视觉

### 风险 4：拖拽区域和按钮冲突

问题：

- `titlebar` 现在整体是拖拽区

应对：

- 所有可点击元素必须显式 `-webkit-app-region: no-drag`

### 风险 5：目录监听跨平台复杂度高

问题：

- 递归目录监听在 macOS / Windows / Linux 上行为不完全一致

应对：

- 第一版不做自动目录树刷新
- 先做手动刷新或重新读取当前目录

## 9. 推荐的里程碑拆分

建议按以下 6 个小 PR 或提交推进：

1. `renderer store + theme tokens`
2. `app shell + collapsible sidebar skeleton`
3. `workspace folder picker + tree rendering`
4. `open file in current window`
5. `uiTheme + docTheme split`
6. `menu shortcuts + polish`

这样每一步都可运行、可回退、可验收。

## 10. 手动验证清单

- [ ] 现有打开文件、保存、另存为、导出 PDF 不回归
- [ ] 外部 Agent 修改当前文件时仍能自动热更新
- [ ] 侧边栏展开/收起无布局抖动
- [ ] 侧边栏隐藏后仍保持纯内容编辑体验
- [ ] 工作区切文件时 dirty state 提示正常
- [ ] 侧边栏顶栏不再出现高频按钮堆叠
- [ ] 文件树 hover、选中态、缩进和图标层级清晰
- [ ] 工作区信息固定在底栏，低频动作走更多菜单
- [ ] light/dark 下文本与边框对比度足够
- [ ] elegant/newsprint/custom 文档主题仍可正常作用于编辑区
- [ ] 窗口拖拽区域、交通灯、点击按钮行为正确

## 11. 当前推荐默认决策

为了避免后续实现阶段反复讨论，先记录推荐默认值：

- 默认不显示侧边栏
- 打开工作区后自动显示侧边栏
- 打开单个文件时，可将其父目录视为临时工作区根目录
- 侧边栏默认宽度 `236px`
- 折叠后宽度 `0`
- 仅展示目录和受支持文本文件
- 工作区点击文件时，在当前窗口切换
- 初版不做递归目录监听

## 12. 暂不处理事项

以下内容明确不在本轮计划内：

- 多标签页
- 最近文件面板
- 全局搜索
- 文件重命名/删除/新建
- 拖拽排序
- Obsidian 式多侧栏布局
- 插件系统

## 13. 下一步建议

建议实际开发从 Phase 0 开始，先处理这三件事：

- 建立 `app-store`
- 重构主题为 `uiTheme + docTheme`
- 把 `index.html` 升级成 app shell

完成后再进入 Phase 2 和 Phase 3，会明显顺很多。

当前建议已更新为：

- 继续做 Phase 5 打磨，重点补一轮手动 UI 回归和大目录性能观察
- 菜单快捷键的人手实机回归仍值得再补一轮，尤其是 `CmdOrCtrl+\\`

## 14. 2026-03-30 真实交互回归记录

测试环境：

- 本机 macOS Electron 真实应用实例
- 工作区样例目录：`/tmp/colamd-ui-regression/notes`
- 样例文件：`root.md`、`child-a.md`、`archive/old.md`

已确认通过：

- 常规实例里，`Open Folder...` 真实打开链路可用；此前通过 `CmdOrCtrl+Shift+O` 加系统文件面板成功进入 `/tmp/colamd-ui-regression/notes`
- 显式工作区加载后，树节点点击可在同窗口切换文件：`child-a.md -> root.md -> archive/old.md`
- 子目录 `archive` 可展开，展开后能看到并打开 `old.md`
- 侧边栏内隐藏按钮可将侧边栏折叠，标题栏开关按钮可再次展开
- 工作区刷新不是空操作；新增 `fresh.md` 后，点击 `Refresh` 可把新文件刷进树中
- 从显式工作区点击 `Close Workspace` 后，不会直接清空；会正确回退到当前文件上下文，本轮样例里回退到 `archive`

本轮未完全确认：

- `View -> Toggle Sidebar` 和 `CmdOrCtrl+\\` 的系统层快捷键，在调试辅助实例里受 macOS 焦点和多 Electron 进程影响，自动化结论不稳定；代码路径已存在，但仍建议补一轮纯人工实机点按
- `Save As...` 后的路径同步，这一轮没有覆盖
