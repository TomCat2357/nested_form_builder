// patch2.js
const fs = require('fs');
const path = require('path');

const applyPatch = (filePath, replacer) => {
  const fullPath = path.resolve(__dirname, filePath);
  if (!fs.existsSync(fullPath)) {
    console.error(`❌ File not found: ${filePath}`);
    return;
  }
  const original = fs.readFileSync(fullPath, 'utf8');
  const modified = replacer(original);
  if (original === modified) {
    console.warn(`⚠️ No changes made to: ${filePath}`);
  } else {
    fs.writeFileSync(fullPath, modified, 'utf8');
    console.log(`✅ Patched: ${filePath}`);
  }
};

// 1. gas/model.gs の修正 (差分同期用のパラメータ追加)
applyPatch('gas/model.gs', (content) => {
  // すでに適用済みの場合はスキップ
  if (content.includes('forceFullSync')) return content;
  
  return content.replace(
    /rowIndexHint,/g,
    `lastSyncedAt: body.lastSyncedAt || params.lastSyncedAt || null,
    forceFullSync: body.forceFullSync === true || params.forceFullSync === 'true',
    rowIndexHint,`
  );
});

// 2. gas/Code.gs の修正 (ListRecords_ の差分対応)
applyPatch('gas/Code.gs', (content) => {
  // すでに適用済みの場合はスキップ
  if (content.includes('isDelta')) return content;

  return content.replace(
    /function ListRecords_\(ctx\) \{([\s\S]*?)const records = Sheets_getAllRecords_\(sheet, temporalTypeMap\);\n\s*return \{ ok: true, records, count: records\.length, headerMatrix: Sheets_readHeaderMatrix_\(sheet\) \};\n\}/m,
    `function ListRecords_(ctx) {$1const allRecords = Sheets_getAllRecords_(sheet, temporalTypeMap);
  const headerMatrix = Sheets_readHeaderMatrix_(sheet);

  if (ctx.forceFullSync || !ctx.lastSyncedAt) {
    return { ok: true, records: allRecords, count: allRecords.length, headerMatrix, isDelta: false };
  }

  const updatedRecords = [];
  const allIds = [];

  for (let i = 0; i < allRecords.length; i++) {
    const rec = allRecords[i];
    allIds.push(rec.id);
    if (rec.modifiedAtUnixMs > ctx.lastSyncedAt) {
      updatedRecords.push(rec);
    }
  }

  return { ok: true, records: updatedRecords, allIds, count: updatedRecords.length, headerMatrix, isDelta: true };
}`
  );
});