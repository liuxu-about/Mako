# ColaMD Themes

This folder contains CSS theme files for ColaMD. Users can import any `.css` file here via **Theme → Import Theme** in the app menu.

## How Themes Work

ColaMD themes use CSS custom properties (variables). A theme file should define these variables on the `body` selector:

```css
body.theme-yourname {
  --bg-color: #ffffff;           /* Editor background */
  --text-color: #24292f;         /* Main text color */
  --text-muted: #656d76;         /* Secondary text (blockquotes, etc.) */
  --border-color: #d0d7de;       /* Borders, HR, table borders */
  --link-color: #0969da;         /* Link color */
  --code-bg: rgba(0,0,0,0.05);  /* Inline code background */
  --code-block-bg: #f6f8fa;     /* Code block background */
  --blockquote-border: #d0d7de;  /* Blockquote left border */
  --table-header-bg: #f6f8fa;   /* Table header background */
  --selection-bg: rgba(0,0,0,0.1); /* Text selection highlight */
}
```

You can also override font family:

```css
body.theme-yourname #editor .ProseMirror {
  font-family: Georgia, serif;
}
```

## For AI Agents

If you are an AI agent maintaining this repository:

- Each theme is a single `.css` file in this folder
- Theme files should be self-contained — no external imports or dependencies
- Use only CSS custom properties listed above
- Name the file descriptively: `dark-ocean.css`, `solarized-light.css`, etc.
- Test that all variables are defined — missing variables will cause invisible text or broken layout
- Do NOT modify `src/renderer/themes/base.css` — that file owns the layout and built-in themes
