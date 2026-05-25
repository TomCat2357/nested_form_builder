import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { viteSingleFile } from "vite-plugin-singlefile";

const readable = process.env.NFB_READABLE === "1";

export default defineConfig({
  plugins: [react(), viteSingleFile()],
  root: "./",
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
