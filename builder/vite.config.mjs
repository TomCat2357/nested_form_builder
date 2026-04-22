import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { viteSingleFile } from "vite-plugin-singlefile";

export default defineConfig({
  plugins: [react(), viteSingleFile()],
  root: "./",
  server: {
    // pipeEngine.js は ../gas/ にあるので、builder/ 外の parent を許可する
    fs: { allow: [".."] },
  },
  optimizeDeps: {
    include: ["exceljs"],
  },
  build: {
    outDir: "../dist",
    emptyOutDir: true,
    sourcemap: false,
    minify: true,
    commonjsOptions: {
      // gas/pipeEngine.js は GAS/Node 両対応の CommonJS なので、ビルド時も
      // CJS として扱えるよう include に追加する
      include: [/gas\/pipeEngine\.js$/, /node_modules/],
    },
  },
});
