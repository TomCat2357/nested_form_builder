/**
 * builder/src/features/expression/gasRuntimeEntry.js を esbuild で IIFE バンドルし、
 * gas/generated/nfbAlasqlUdfs.gs を生成する。
 *
 * GAS は ES Modules を解釈できないため、フロントの ESM ソースを `var NfbAlasqlRuntime = (...)()`
 * 形に変換して GAS バンドル (dist/Bundle.gs) に取り込む。
 *
 * 使い方: `npm run build:gas-udfs`（registerNfbUdfs.js / dateTime.js / eraConversion.js /
 * kanaTables.js を変更したら必ず再生成すること）。
 */
import { build } from "esbuild";
import { fileURLToPath } from "node:url";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..", "..");
const entry = path.join(repoRoot, "builder/src/features/expression/gasRuntimeEntry.js");
const outfile = path.join(repoRoot, "gas/generated/nfbAlasqlUdfs.gs");

await build({
  entryPoints: [entry],
  bundle: true,
  format: "iife",
  globalName: "NfbAlasqlRuntime",
  platform: "neutral",
  target: "es2019",
  legalComments: "none",
  outfile,
  banner: {
    js: "/* AUTO-GENERATED — DO NOT EDIT.\n   Source: builder/src/features/expression/gasRuntimeEntry.js\n   Regenerate: npm run build:gas-udfs */",
  },
});

console.log(`✅ Generated ${path.relative(repoRoot, outfile)}`);
