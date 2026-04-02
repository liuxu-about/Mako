# Mako

**一个面向真实本地文件工作流的 Markdown 编辑器，适合人与 AI Agent 一起使用，也适合单独使用。**

Mako 是一个桌面 Markdown 编辑器，核心是直接操作本地文件。你可以打开本地笔记，在所见即所得界面里编辑它，持续监听磁盘变化；当单文件不够时，再展开一个轻量工作区侧边栏做导航。

它更接近“专注的文件编辑器”，而不是知识库应用或 IDE 外壳。

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![GitHub release](https://img.shields.io/github/release/liuxu-about/Mako.svg)](https://github.com/liuxu-about/Mako/releases)

[下载](#下载) | [能力](#能力) | [边界](#边界) | [开发](#开发) | [English](README.md)

---

## 它是什么

Mako 围绕本地 Markdown 文档展开。

- 直接打开并编辑磁盘上的笔记
- 当别的工具或 Agent 改动同一个文件时，继续保持同步
- 需要导航、搜索或大纲时，再展开轻量工作区
- 让界面尽量贴近文档本身，而不是堆成一层重型项目壳

## 能力

- **所见即所得编辑器 + 源码模式**：默认在富文本界面里编辑，需要时可以切回原始 Markdown。
- **本地文件工作流**：支持打开、保存、另存为、拖拽文件到窗口，以及通过文件路径直接启动应用。
- **外部文件监听**：当前文件在磁盘上发生变化时，Mako 会重新加载；如果你有未保存修改，会先询问。
- **已打开文件自动保存**：编辑已经打开的文件时，会自动落盘。
- **工作区侧边栏**：可以打开文件夹、浏览受支持的笔记、展开目录、全文搜索、查看当前文档大纲，并直接新建、重命名、删除笔记。
- **大纲导航**：会提取 1 到 3 级标题，显示在侧边栏里，并支持跳转。
- **编辑器里的 Markdown 扩展块**：支持 CommonMark、GFM 风格编辑、KaTeX 数学块和 Mermaid 图表块。
- **主题与阅读设置**：应用主题和文档主题分离，支持导入自定义 CSS 文档主题，也支持编辑器字体和字号设置。
- **桌面应用能力**：包含本地化菜单、多窗口文件路由、窗口状态持久化，以及中英文界面。
- **PDF 导出**：当前在 macOS 的 Tauri 壳里可用。

## 边界

Mako 的范围是刻意收窄的。

- 它是文件编辑器，不是数据库式笔记系统。
- 它有工作区侧边栏，但目标不是演化成 IDE。
- 它不内置 AI 功能、同步、协作、插件、标签体系或知识库管理。

这个边界是有意为之。项目优先优化的是：快速打开 Markdown 文件、舒服地编辑它、并持续和文件系统保持一致。

## 支持的文件

- 从磁盘打开：`.md`、`.markdown`、`.mdown`、`.mkd`、`.txt`
- 工作区侧边栏索引：`.md`、`.markdown`、`.mdown`、`.mkd`、`.txt`
- 保存对话框默认扩展名：`.md`

## 下载

> 打包版本见 [Releases](https://github.com/liuxu-about/Mako/releases)。

| 平台 | 格式 |
|------|------|
| macOS | `.dmg` |
| Windows | `.exe` |
| Linux | `.AppImage` / `.deb` |

## 开发

```bash
git clone git@github.com:liuxu-about/Mako.git
cd Mako
npm install
npm run dev
```

### 构建

```bash
npm run dist
npm run dist:mac
npm run dist:win
npm run dist:linux
```

### 技术栈

- **Tauri 2**：桌面壳和原生菜单
- **Rust**：文件读写、工作区命令、文件监听、菜单连接、窗口生命周期、PDF 导出
- **Milkdown**：编辑器核心
- **TypeScript**：renderer 与状态管理
- **Vite**：renderer 构建

## 开源协议

[MIT](LICENSE)
