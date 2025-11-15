import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { viteSingleFile } from "vite-plugin-singlefile";

// Custom plugin to preserve console.log in template strings
const preserveConsoleLog = () => ({
  name: 'preserve-console-log',
  transform(code, id) {
    // Don't minify the runtime.inline.js file at all
    if (id.includes('runtime.inline.js')) {
      return {
        code,
        map: null,
      };
    }
  },
  renderChunk(code) {
    // Ensure console.log is not removed from any bundled code
    return code;
  },
});

export default defineConfig({
  plugins: [react(), viteSingleFile(), preserveConsoleLog()],
  root: "./",
  build: {
    outDir: "../dist",
    emptyOutDir: true,
    assetsInlineLimit: 0,
    cssCodeSplit: false,
    modulePreload: false,
    minify: false, // Completely disable minification to preserve console.log
    rollupOptions: {
      input: './Index.html',  // 明示的にIndex.htmlを指定
      output: {
        inlineDynamicImports: true,
        entryFileNames: '[name].js',
        assetFileNames: '[name].[ext]',
      },
    },
  },
});
