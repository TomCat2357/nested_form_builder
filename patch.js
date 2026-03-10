const fs = require("fs");
const path = require("path");

function applyPatch() {
  const patches = [
    // 1. ZIPエクスポート時のファイル名サニタイズ (パストラバーサル防止)
    {
      file: "builder/src/pages/AdminDashboardPage.jsx",
      replacements: [
        {
          target:
            "const filename = `${form.settings?.formTitle || form.id}.json`;",
          replacement:
            'const safeTitle = (form.settings?.formTitle || form.id).replace(/[\\\\/:*?"<>|\\r\\n]/g, "_").replace(/^\\.+/, "");\n        const filename = `${safeTitle}.json`;',
        },
      ],
    },
    // 2. 本番環境での不要なコンソール出力の抑制
    {
      file: "builder/src/pages/FormPage.jsx",
      replacements: [
        {
          // responses mutated のログ出力をコメントアウトまたは条件付きにする
          target: 'console.log("[FormPage] responses mutated", {',
          replacement:
            'if (process.env.NODE_ENV !== "production") console.log("[FormPage] responses mutated", {',
        },
        {
          target: 'console.log("[FormPage] applyEntryToState", {',
          replacement:
            'if (process.env.NODE_ENV !== "production") console.log("[FormPage] applyEntryToState", {',
        },
        {
          target: 'console.log("[FormPage] defaultNow values applied", {',
          replacement:
            'if (process.env.NODE_ENV !== "production") console.log("[FormPage] defaultNow values applied", {',
        },
      ],
    },
  ];

  let hasError = false;

  for (const patch of patches) {
    const targetPath = path.join(process.cwd(), patch.file);
    if (!fs.existsSync(targetPath)) {
      console.error(`❌ ファイルが見つかりません: ${patch.file}`);
      hasError = true;
      continue;
    }

    let content = fs.readFileSync(targetPath, "utf-8");
    let modified = false;

    for (const r of patch.replacements) {
      if (content.includes(r.target)) {
        content = content.split(r.target).join(r.replacement);
        modified = true;
      } else {
        console.warn(`⚠️ 置換対象が見つかりませんでした: ${patch.file}`);
      }
    }

    if (modified) {
      fs.writeFileSync(targetPath, content, "utf-8");
      console.log(`✅ 修正完了: ${patch.file}`);
    } else {
      console.log(`ℹ️ 変更なし: ${patch.file}`);
    }
  }

  if (hasError) {
    console.log("\n⚠️ 一部のファイルが見つかりませんでした。");
  } else {
    console.log(
      "\n🎉 パッチ適用完了。※注意: 情報漏洩を防ぐためにはGAS側の修正も必ず行ってください。",
    );
  }
}

applyPatch();
