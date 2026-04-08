#!/usr/bin/env node

import { readFileSync, writeFileSync, existsSync } from "fs";
import { resolve, basename, extname, dirname, isAbsolute } from "path";
import { pathToFileURL } from "url";
import MarkdownIt from "markdown-it";
import highlightjs from "markdown-it-highlightjs";
import puppeteer from "puppeteer";

// --- CLI args ---
const args = process.argv.slice(2);
if (args.length === 0 || args.includes("--help") || args.includes("-h")) {
  console.log(`Usage: node md2pdf.mjs <input.md> [output.pdf]

Options:
  --help, -h    Show this help
  --paper <size>  Paper size: A4 (default), A3, Letter, Legal
  --landscape     Landscape orientation`);
  process.exit(0);
}

const inputPath = resolve(args[0]);
const landscapeIdx = args.indexOf("--landscape");
const landscape = landscapeIdx !== -1;

const paperIdx = args.indexOf("--paper");
const paperSize = paperIdx !== -1 ? args[paperIdx + 1] : "A4";

// Output path: explicit second arg (not a flag) or derive from input
let outputPath;
for (let i = 1; i < args.length; i++) {
  if (args[i].startsWith("--")) {
    if (args[i] === "--paper") i++; // skip value
    continue;
  }
  outputPath = resolve(args[i]);
  break;
}
if (!outputPath) {
  outputPath = resolve(basename(inputPath, extname(inputPath)) + ".pdf");
}

// --- Read & parse markdown ---
const md = new MarkdownIt({
  html: true,
  linkify: true,
  typographer: true,
});
md.use(highlightjs);

const markdown = readFileSync(inputPath, "utf-8");
const inputDir = dirname(inputPath);
const htmlBody = md.render(markdown);

// Resolve relative image src to absolute file:// URLs so Puppeteer can load them
function resolveImages(html, baseDir) {
  return html.replace(
    /(<img\s[^>]*src=")([^"]+)(")/g,
    (match, pre, src, post) => {
      if (/^https?:\/\/|^data:|^file:/i.test(src)) return match;
      const absPath = isAbsolute(src) ? src : resolve(baseDir, src);
      if (!existsSync(absPath)) return match;
      return pre + pathToFileURL(absPath).href + post;
    }
  );
}

// --- Build full HTML with styling ---
const html = `<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="utf-8">
<style>
/* highlight.js github theme (inline) */
.hljs{background:#f6f8fa;padding:1em;overflow-x:auto}
.hljs-comment,.hljs-quote{color:#6a737d;font-style:italic}
.hljs-keyword,.hljs-selector-tag,.hljs-subst{color:#d73a49;font-weight:700}
.hljs-literal,.hljs-number,.hljs-variable,.hljs-template-variable,.hljs-tag .hljs-attr{color:#005cc5}
.hljs-string,.hljs-doctag{color:#032f62}
.hljs-title,.hljs-section,.hljs-selector-id{color:#6f42c1;font-weight:700}
.hljs-type,.hljs-class .hljs-title{color:#6f42c1}
.hljs-tag,.hljs-name,.hljs-attribute{color:#22863a}
.hljs-regexp,.hljs-link{color:#032f62}
.hljs-symbol,.hljs-bullet{color:#e36209}
.hljs-built_in,.hljs-builtin-name{color:#005cc5}
.hljs-meta{color:#735c0f;font-weight:700}
.hljs-deletion{background:#ffeef0;color:#b31d28}
.hljs-addition{background:#f0fff4;color:#22863a}

/* GitHub-like markdown body */
body {
  font-family: "Segoe UI", "Noto Sans JP", "Hiragino Kaku Gothic ProN",
               "Meiryo", sans-serif;
  font-size: 14px;
  line-height: 1.7;
  color: #24292e;
  max-width: 100%;
  padding: 2em 3em;
  word-wrap: break-word;
  overflow-wrap: break-word;
}

h1, h2, h3, h4, h5, h6 {
  margin-top: 1.5em;
  margin-bottom: 0.5em;
  font-weight: 600;
  line-height: 1.25;
}
h1 { font-size: 2em; padding-bottom: 0.3em; border-bottom: 1px solid #eaecef; }
h2 { font-size: 1.5em; padding-bottom: 0.3em; border-bottom: 1px solid #eaecef; }
h3 { font-size: 1.25em; }
h4 { font-size: 1em; }

p { margin: 0.5em 0 1em; }

a { color: #0366d6; text-decoration: none; }
a:hover { text-decoration: underline; }

code {
  font-family: "Consolas", "SFMono-Regular", "Noto Sans Mono CJK JP", monospace;
  font-size: 0.9em;
  background: #f6f8fa;
  padding: 0.2em 0.4em;
  border-radius: 3px;
}

pre {
  background: #f6f8fa;
  border-radius: 6px;
  padding: 1em;
  overflow-x: auto;
  line-height: 1.5;
  margin: 1em 0;
}
pre code {
  background: none;
  padding: 0;
  font-size: 0.85em;
}

blockquote {
  margin: 1em 0;
  padding: 0 1em;
  color: #6a737d;
  border-left: 4px solid #dfe2e5;
}

table {
  border-collapse: collapse;
  width: 100%;
  margin: 1em 0;
}
th, td {
  border: 1px solid #dfe2e5;
  padding: 6px 13px;
}
th {
  background: #f6f8fa;
  font-weight: 600;
}
tr:nth-child(even) {
  background: #f6f8fa;
}

ul, ol {
  padding-left: 2em;
  margin: 0.5em 0;
}
li { margin: 0.25em 0; }
li > ul, li > ol { margin: 0; }

hr {
  border: none;
  border-top: 2px solid #eaecef;
  margin: 2em 0;
}

img {
  max-width: 100%;
  height: auto;
}

/* Task list */
input[type="checkbox"] {
  margin-right: 0.5em;
}

/* Page break hint */
h1 { page-break-before: auto; }
pre, table, blockquote, img { page-break-inside: avoid; }
</style>
</head>
<body>
${resolveImages(htmlBody, inputDir)}
</body>
</html>`;

// --- Generate PDF ---
import { tmpdir } from "os";
import { join } from "path";
import { unlinkSync } from "fs";

const tmpHtml = join(tmpdir(), `md2pdf_${Date.now()}.html`);
writeFileSync(tmpHtml, html, "utf-8");

const browser = await puppeteer.launch({
  headless: true,
  args: ["--allow-file-access-from-files"],
});
const page = await browser.newPage();
await page.goto(pathToFileURL(tmpHtml).href, { waitUntil: "networkidle0" });

await page.pdf({
  path: outputPath,
  format: paperSize,
  landscape,
  printBackground: true,
  margin: { top: "15mm", bottom: "15mm", left: "15mm", right: "15mm" },
});

await browser.close();
try { unlinkSync(tmpHtml); } catch {}
console.log(`PDF generated: ${outputPath}`);
