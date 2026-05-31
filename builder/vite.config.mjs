import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { viteSingleFile } from "vite-plugin-singlefile";

const readable = process.env.NFB_READABLE === "1";

export default defineConfig({
  plugins: [react(), viteSingleFile()],
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
  },
});
