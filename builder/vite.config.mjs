import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { viteSingleFile } from "vite-plugin-singlefile";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const readable = process.env.NFB_READABLE === "1";

// vite-plugin-singlefile は動的 import が残す `__VITE_PRELOAD__` マーカーを
// /"__VITE_PRELOAD__"/（ダブルクォート付き）でしか除去できない。一方 Vite 7 は
// inlineDynamicImports 下で `__vitePreload(fn, __VITE_PRELOAD__)` の第2引数を
// 裸トークンのまま残すため、その regex に取りこぼされて実行時に
// `__VITE_PRELOAD__ is not defined`（prefetchQueryTokens の動的 import が全滅＝
// テンプレートの full-query `{{SELECT ...}}` が一切解決できない）になる。
// singlefile が JS をインライン化する前（renderChunk）に裸マーカーを void 0 へ潰す。
// __vitePreload の deps 引数は falsy で問題ない（プリロード対象なし＝即 baseModule 実行）。
const stripVitePreloadMarker = () => ({
  name: "nfb:strip-vite-preload-marker",
  enforce: "post",
  renderChunk(code) {
    if (!code.includes("__VITE_PRELOAD__")) return null;
    return { code: code.replace(/\b__VITE_PRELOAD__\b/g, "void 0"), map: null };
  },
});

export default defineConfig({
  plugins: [react(), stripVitePreloadMarker(), viteSingleFile()],
  root: "./",
  // 出力を ASCII 限定にし、非ASCII（特に BMP 外＝サロゲートペア）文字をすべて \uXXXX エスケープへ。
  // GAS HtmlService は配信時に BMP 外文字を文字化けさせるため、exceljs/xmlchars が new RegExp(..,"u") で
  // 組み立てる XML 文字クラス（U+10000〜U+10FFFF を範囲端に含む）が「Range out of order」で壊れる。
  // ソースを ASCII 化しておけば GAS が壊せる生のサロゲートバイトが残らない。Vite 既定の "utf8" を上書き。
  esbuild: {
    charset: "ascii",
  },
  optimizeDeps: {
    include: ["exceljs"],
  },
  build: {
    outDir: "../dist",
    emptyOutDir: true,
    sourcemap: readable ? "inline" : false,
    minify: !readable,
    // エントリ HTML は `Index.html`（大文字 I）。Vite 既定の `index.html` 探索は
    // 大文字小文字を区別する Linux（CI/コンテナ）で解決に失敗するため、明示指定する。
    rollupOptions: {
      input: path.resolve(here, "Index.html"),
    },
  },
});
