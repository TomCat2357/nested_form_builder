import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { viteSingleFile } from "vite-plugin-singlefile";

export default defineConfig({
  plugins: [react(), viteSingleFile()],
  root: "./",
  optimizeDeps: {
    include: ["exceljs"],
  },
  build: {
    outDir: "../dist",
    emptyOutDir: true,
    sourcemap: false,
    minify: true,
  },
});
