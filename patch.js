const fs = require("fs");
const path = require("path");

function applyRegexPatch(filePath, patches) {
  const fullPath = path.resolve(__dirname, filePath);
  if (!fs.existsSync(fullPath)) {
    console.error(`File not found: ${fullPath}`);
    return;
  }

  let content = fs.readFileSync(fullPath, "utf8");
  let original = content;

  for (const { rx, repl } of patches) {
    content = content.replace(rx, repl);
  }

  if (content !== original) {
    fs.writeFileSync(fullPath, content, "utf8");
    console.log(`Patched: ${filePath}`);
  } else {
    console.log(`No changes needed in: ${filePath}`);
  }
}

// 1. スプレッドシート1行目の最終更新時間書き込み改良（C1セルに日時文字列を追加）
applyRegexPatch("gas/sheetsHeaders.gs", [
  {
    rx: /function Sheets_touchSheetLastUpdated_\(sheet,\s*serial\)\s*\{[\s\S]*?sheet\.getRange\(1,\s*2\)\.setValue\(timestampSerial\);\s*\}/,
    repl: `function Sheets_touchSheetLastUpdated_(sheet, serial) {
  var isNum = typeof serial === "number" && isFinite(serial);
  var timestampSerial = isNum ? serial : Sheets_dateToSerial_(new Date());
  sheet.getRange(1, 1).setValue(NFB_SHEET_LAST_UPDATED_LABEL);
  sheet.getRange(1, 2).setValue(timestampSerial);
  try {
    var dt = new Date(timestampSerial);
    var formatted = Utilities.formatDate(dt, Session.getScriptTimeZone(), "yyyy/MM/dd HH:mm:ss");
    sheet.getRange(1, 3).setValue(formatted);
  } catch (e) {
    // ignore
  }
}`,
  },
]);

// 2. Number.isFinite を isFinite に安全化
applyRegexPatch("gas/sheetsRowOps.gs", [
  {
    rx: /Number\.isFinite\(val\)/g,
    repl: `(typeof val === "number" && isFinite(val))`,
  },
  {
    // nowSerial という変数名で不具合が起きるのを防ぐため、currentTs に一括置換
    rx: /nowSerial/g,
    repl: `currentTs`,
  },
]);

// 3. gas内の他のファイルにある nowSerial も currentTs に一括置換
applyRegexPatch("gas/formsCrud.gs", [{ rx: /nowSerial/g, repl: `currentTs` }]);

applyRegexPatch("gas/formsStorage.gs", [
  { rx: /nowSerial/g, repl: `currentTs` },
]);

// 4. (再確認) 日付・時刻のフォーマット修正 (HTMLの <input type="date"> に適合する YYYY-MM-DD に修正)
applyRegexPatch("builder/src/utils/responses.js", [
  {
    rx: /return field\.type === "time" \? formatUnixMsTime\(unixMs\) : formatUnixMsDate\(unixMs\);/g,
    repl: `const d = new Date(unixMs);
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  const hh = String(d.getHours()).padStart(2, "0");
  const mi = String(d.getMinutes()).padStart(2, "0");
  return field.type === "time" ? \`\${hh}:\${mi}\` : \`\${yyyy}-\${mm}-\${dd}\`;`,
  },
  {
    rx: /const dateValue = formatUnixMsDate\(now\.getTime\(\)\);\s*const timeValue = formatUnixMsTime\(now\.getTime\(\)\);/g,
    repl: `const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const dd = String(now.getDate()).padStart(2, "0");
  const hh = String(now.getHours()).padStart(2, "0");
  const mi = String(now.getMinutes()).padStart(2, "0");

  const dateValue = \`\${yyyy}-\${mm}-\${dd}\`;
  const timeValue = \`\${hh}:\${mi}\`;`,
  },
]);

console.log("All patches applied.");
