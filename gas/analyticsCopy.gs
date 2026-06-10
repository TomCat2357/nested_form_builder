// =============================================
// Analytics Copy — 同じフォルダに新 ID で Question/Dashboard を複製
// =============================================

function Analytics_copyTemplate_(type, templateId) {
  return nfbSafeCall_(function() {
    if (!templateId) throw new Error("IDが指定されていません");

    var resultKey = Analytics_getResultKey_(type);

    // 本体は SharedEntity_copyEntity_（sharedEntityCrud.gs）。analytics 固有の差分を opts で注入する。
    // 名前は元名のまま渡し、衝突回避は Analytics_saveTemplate_ 内の Forms_makeUniqueFormTitle_ に
    // 委譲する（`名前 (1)` `名前 (2)` 形式で採番）。
    return SharedEntity_copyEntity_(templateId, {
      logLabel: "Analytics_copyTemplate_",
      loadItem: function(id) {
        var getRes = Analytics_getTemplate_(type, id);
        if (!getRes || !getRes.ok || !getRes[resultKey]) {
          throw new Error("コピー元が見つかりません: " + id);
        }
        return getRes[resultKey];
      },
      getSourceFileId: function(id) {
        return Nfb_resolveFileIdFromEntry_(Analytics_getMapping_(type)[id] || {});
      },
      prepCopy: function(copied, sourceTemplate) {
        copied.name = sourceTemplate.name || "";
      },
      saveCopy: function(copied, parentFolderUrl) {
        return Analytics_saveTemplate_(type, copied, parentFolderUrl);
      },
    });
  });
}
