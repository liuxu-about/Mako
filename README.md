# Mako

**A local-first Markdown editor for working on real files, with or without AI agents.**

Mako is a desktop Markdown editor built for a direct file-based workflow. It opens local notes, keeps them editable in a WYSIWYG surface, watches for changes on disk, and gives you an optional workspace sidebar for navigation when a single file is not enough.

It is designed for people who want a focused editor rather than a knowledge-base app or an IDE shell.

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![GitHub release](https://img.shields.io/github/release/liuxu-about/Mako.svg)](https://github.com/liuxu-about/Mako/releases)

[Download](#download) | [Capabilities](#capabilities) | [Scope](#scope) | [Development](#development) | [中文](README_CN.md)

---

## What Mako Is

Mako is centered on local Markdown documents.

- Open and edit a note directly from disk
- Keep working when another tool or agent updates the same file
- Expand into a lightweight workspace when you need navigation, search, or outline
- Stay close to the document instead of wrapping it in a heavy project UI

## Capabilities

- **WYSIWYG editor with source mode**: edit in a rich text surface, or switch to raw Markdown when needed.
- **Local file workflow**: open, save, save as, drag and drop a file into the window, and launch the app with a file path.
- **External file watching**: when the tracked file changes on disk, Mako reloads it; if you have unsaved edits, it asks before replacing them.
- **Autosave for opened files**: changes to an existing file are saved automatically while you edit.
- **Workspace sidebar**: open a folder, browse supported notes, expand directories, search across the workspace, inspect the current document outline, and create, rename, or delete notes.
- **Outline navigation**: headings up to level 3 are collected into an outline and can be jumped to from the sidebar.
- **Markdown extensions in the editor**: CommonMark, GFM-style editing, KaTeX math blocks, and Mermaid diagram blocks.
- **Theme and reading controls**: separate application theme and document theme, custom CSS import for document styling, editor font family, and font size controls.
- **Desktop app behavior**: localized menus, multi-window file routing, persisted window state, and Chinese/English UI.
- **PDF export**: available in the current macOS Tauri shell.

## Scope

Mako is intentionally narrow.

- It is a file editor, not a database-backed notes system.
- It has a workspace sidebar, but it is not trying to become an IDE.
- It does not provide built-in AI features, sync, collaboration, plugins, tags, or knowledge-base management.

That constraint is deliberate. The project is optimized for opening Markdown files quickly, editing them comfortably, and staying in sync with the filesystem.

## Supported Files

- Open from disk: `.md`, `.markdown`, `.mdown`, `.mkd`, `.txt`
- Workspace sidebar indexing: `.md`, `.markdown`, `.mdown`, `.mkd`, `.txt`
- Save dialog default: `.md`

## Download

> See [Releases](https://github.com/liuxu-about/Mako/releases) for packaged builds.

| Platform | Format |
|----------|--------|
| macOS | `.dmg` |
| Windows | `.exe` |
| Linux | `.AppImage` / `.deb` |

## Development

```bash
git clone git@github.com:liuxu-about/Mako.git
cd Mako
npm install
npm run dev
```

### Build

```bash
npm run dist
npm run dist:mac
npm run dist:win
npm run dist:linux
```

### Stack

- **Tauri 2** for the desktop shell and native menus
- **Rust** for file IO, workspace commands, file watching, menu wiring, window lifecycle, and PDF export
- **Milkdown** for the editor
- **TypeScript** for the renderer and state management
- **Vite** for the renderer build

## License

[MIT](LICENSE)
