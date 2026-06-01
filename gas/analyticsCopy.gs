// =============================================
// Analytics Copy — 同じフォルダに新 ID で Question/Dashboard を複製
// =============================================

function Analytics_copyTemplate_(type, templateId) {
  return nfbSafeCall_(function() {
    if (!templateId) throw new Error("IDが指定されていません");

    var resultKey = Analytics_getResultKey_(type);
    var getRes = Analytics_getTemplate_(type, templateId);
    if (!getRes || !getRes.ok || !getRes[resultKey]) {
      throw new Error("コピー元が見つかりません: " + templateId);
    }
    var sourceTemplate = getRes[resultKey];

    // 元ファイルの親フォルダ URL を取得
    var mapping = Analytics_getMapping_(type);
    var sourceEntry = mapping[templateId] || {};
    var sourceFileId = Nfb_resolveFileIdFromEntry_(sourceEntry);
    var parentFolderUrl = SharedDrive_parentFolderUrlOfFileId_(sourceFileId, "Analytics_copyTemplate_");

    // クローンを作成（id を捨てて Analytics_saveTemplate_ で新 ID 採番）
    // 名前は元名のまま渡し、衝突回避は Analytics_saveTemplate_ 内の
    // Forms_makeUniqueFormTitle_ に委譲する（`名前 (1)` `名前 (2)` 形式で採番）
    var copied = JSON.parse(JSON.stringify(sourceTemplate));
    delete copied.id;
    delete copied.driveFileUrl;
    copied.archived = false;
    copied.name = sourceTemplate.name || "";

    return Analytics_saveTemplate_(type, copied, parentFolderUrl);
  });
}
