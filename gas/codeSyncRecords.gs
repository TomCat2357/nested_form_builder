/**
 * codeSyncRecords.gs
 * レコード同期処理
 */

function syncRecordsProxy(payload) {
  return executeAction_("sync_records", payload, { source: "scriptRun" });
}

function SyncRecords_(ctx) {
  return ExecuteWithSheet_(ctx, function(sheet) {
    var forceFullSync = !!ctx.raw.forceFullSync;
    var uploadRecords = Array.isArray(ctx.raw.uploadRecords) ? ctx.raw.uploadRecords : [];
    var lastServerReadAt = parseInt(ctx.raw.lastServerReadAt, 10) || 0;
    var sheetLastUpdatedAt = Sheets_readSheetLastUpdated_(sheet);
    var serverModifiedAt = GetServerModifiedAt_();
    var isAdmin = Nfb_isAdminFromCtx_(ctx);
    // URL で pid が指定されている間は、その pid に等しい行だけを同期対象にする。
    var pid = Nfb_resolvePidFromCtx_(ctx);
    var filterVisibleRecords = function(records) {
      var out = [];
      for (var i = 0; i < records.length; i++) {
        if (!Nfb_recordMatchesPid_(records[i], pid)) continue;
        if (!isAdmin && Nfb_isSoftDeletedRecord_(records[i])) continue;
        out.push(records[i]);
      }
      return out;
    };

    var getRecordModifiedAtUnixMs = function(record) {
      var modifiedAtUnixMs = parseInt(record && record.modifiedAtUnixMs, 10);
      if (isFinite(modifiedAtUnixMs) && modifiedAtUnixMs > 0) return modifiedAtUnixMs;
      // 固定メタ列は Unix ms 厳密解釈
      return Sheets_toStrictUnixMs_(record && record.modifiedAt) || 0;
    };

    var buildReadOnlyResult = function() {
      var temporalTypeMap = ResolveTemporalTypeMap_(ctx);
      var allRecords = Sheets_getAllRecords_(sheet, temporalTypeMap, { normalize: false });
      var visibleRecords = filterVisibleRecords(allRecords);
      var headerMatrix = Sheets_readHeaderMatrix_(sheet);

      if (forceFullSync || lastServerReadAt <= 0) {
        var fullRecords = visibleRecords.map(SerializeRecord_);
        return {
          ok: true,
          serverModifiedAt: serverModifiedAt,
          serverCommitToken: serverModifiedAt,
          records: fullRecords,
          headerMatrix: headerMatrix,
          isDelta: false,
          unchanged: false,
          count: fullRecords.length,
          sheetLastUpdatedAt: sheetLastUpdatedAt,
        };
      }

      var deltaRecords = [];
      for (var i = 0; i < visibleRecords.length; i++) {
        var record = visibleRecords[i];
        if (getRecordModifiedAtUnixMs(record) > lastServerReadAt) {
          deltaRecords.push(record);
        }
      }
      var serializedDelta = deltaRecords.map(SerializeRecord_);
      return {
        ok: true,
        serverModifiedAt: serverModifiedAt,
        serverCommitToken: serverModifiedAt,
        records: serializedDelta,
        headerMatrix: headerMatrix,
        isDelta: true,
        unchanged: false,
        count: serializedDelta.length,
        sheetLastUpdatedAt: sheetLastUpdatedAt,
      };
    };

    if (uploadRecords.length === 0) {
      // forceFullSync（手動「更新」）は staleness 短絡を必ずバイパスして全件再読込する。
      // 外部アクション等の別プロジェクト直書きは本体の sheetLastUpdatedAt を更新できず、
      // 短絡したままだと「更新」ボタンで新規行が反映されない（フルリロードまで見えない）。
      if (!forceFullSync && sheetLastUpdatedAt > 0 && lastServerReadAt > 0 && sheetLastUpdatedAt <= lastServerReadAt) {
        return {
          ok: true,
          serverModifiedAt: serverModifiedAt,
          serverCommitToken: serverModifiedAt,
          records: [],
          isDelta: true,
          unchanged: true,
          count: 0,
          sheetLastUpdatedAt: sheetLastUpdatedAt,
        };
      }
      return buildReadOnlyResult();
    }

    return WithScriptLock_("同期", function() {
      var nowMs = Date.now();
      var order = ctx.order || [];
      if (ctx.raw.formSchema) {
        order = Sheets_buildOrderFromSchema_(ctx.raw.formSchema);
      } else {
        order = Sheets_normalizeHeaderKeyList_(order);
      }
      var syncSchema = Nfb_resolveFormSchemaArray_(ctx);
      var temporalTypeMap = syncSchema ? Sheets_collectTemporalPathMap_(syncSchema) : null;
      var columnFormatMap = syncSchema ? Sheets_collectColumnFormatMap_(syncSchema) : null;
      Sheets_ensureHeaderMatrix_(sheet, order);
      var keyToColumn = Sheets_buildHeaderKeyMap_(sheet);
      var fixedColMap = Sheets_buildFixedColMapFromSheet_(sheet);

      var lastColumn = Math.max(sheet.getLastColumn(), 10);
      var lastRow = sheet.getLastRow();
      var dataStartRow = NFB_DATA_START_ROW;

      // 全データを取得
      var existingData = [];
      var existingFormats = [];
      if (lastRow >= dataStartRow) {
        var dataRange = sheet.getRange(dataStartRow, 1, lastRow - dataStartRow + 1, lastColumn);
        existingData = dataRange.getValues();
        existingFormats = dataRange.getNumberFormats();
      }

      var existingRowMap = {};
      var maxNo = 0;
      for (var i = 0; i < existingData.length; i++) {
        var id = String(existingData[i][0] || "").trim();
        if (id) existingRowMap[id] = i;
        var noVal = Number(existingData[i][1]);
        if (isFinite(noVal) && noVal > maxNo) maxNo = noVal;
      }

      var modifiedCount = 0;
      var uploadedRecordIds = {};
      var currentUserEmail = ResolveActiveUserEmail_();

      for (var j = 0; j < uploadRecords.length; j++) {
        var rec = uploadRecords[j];
        var normalizedRecordData = Sheets_normalizeRecordDataKeys_(rec && rec.data);
        var recId = rec.id || Nfb_generateRecordId_();
        var cacheModifiedAt = parseInt(rec.modifiedAtUnixMs, 10) || Sheets_toStrictUnixMs_(rec.modifiedAt) || 0;
        var recModifiedAt = cacheModifiedAt || nowMs;

        var localIndex = existingRowMap.hasOwnProperty(recId) ? existingRowMap[recId] : -1;
        var sheetModifiedAt = 0;

        if (localIndex !== -1) {
          var modAtVal = existingData[localIndex][3];
          sheetModifiedAt = Sheets_toUnixMs_(modAtVal, true) || 0;
        }

        var shouldApplyRecord = Sync_shouldApplyRecordToSheet_({
          hasSheetRow: localIndex !== -1,
          cacheModifiedAt: cacheModifiedAt,
          sheetModifiedAt: sheetModifiedAt,
        });

        if (localIndex !== -1) {
          try {
            Logger.log(
              "[NFB-sync] recId=%s forceFullSync=%s cacheMs=%s sheetMs=%s delta=%s apply=%s cacheBy=%s sheetBy=%s formId=%s",
              String(recId),
              String(forceFullSync),
              String(cacheModifiedAt),
              String(sheetModifiedAt),
              String((cacheModifiedAt || 0) - (sheetModifiedAt || 0)),
              String(shouldApplyRecord),
              String((rec && rec.modifiedBy) || ""),
              String(existingData[localIndex][6] || ""),
              String((ctx && ctx.raw && ctx.raw.formId) || "")
            );
          } catch (e) { /* no-op */ }
        }

        if (shouldApplyRecord) {
          var rowData;
          var rowFormats;

          if (localIndex === -1) {
            var insertMeta = Sync_resolveNewRecordMetadata_({
              record: rec,
              fallbackRecordNo: maxNo + 1,
              fallbackCreatedAt: nowMs,
              fallbackCreatedBy: currentUserEmail,
            });
            rowData = new Array(lastColumn).fill("");
            rowFormats = new Array(lastColumn).fill("General");
            rowData[0] = recId;
            rowData[1] = insertMeta.recordNo;
            // createdAt はシート上は数値の日時 (Date) で書き込む（insertMeta.createdAt は Unix ms）
            rowData[2] = Sheets_unixMsToSheetDate_(insertMeta.createdAt) || "";
            rowFormats[2] = NFB_SHEETS_DATETIME_FORMAT;
            rowData[5] = insertMeta.createdBy;
            // URL で pid 指定中の新規行には、その pid を必ず刻む（親レコードへの所属）。
            Sheets_stampPid_(rowData, fixedColMap.hasOwnProperty("pid") ? fixedColMap.pid : -1, pid, lastColumn);
            maxNo = Math.max(maxNo, insertMeta.recordNo);

            localIndex = existingData.length;
            existingData.push(rowData);
            existingFormats.push(rowFormats);
            existingRowMap[recId] = localIndex;
          } else {
            rowData = existingData[localIndex];
            rowFormats = existingFormats[localIndex];
            for (var key in keyToColumn) {
              if (keyToColumn.hasOwnProperty(key) && !NFB_RESERVED_HEADER_KEYS[key]) {
                var cIdx = keyToColumn[key] - 1;
                if (cIdx >= 0 && cIdx < lastColumn) rowData[cIdx] = "";
              }
            }
            Sync_syncFixedMetaColumnsFromRecord_({
              rowData: rowData,
              rowFormats: rowFormats,
              record: rec,
              mode: "overwrite",
              fixedColMap: fixedColMap,
              toUnixMs: function(value) {
                return Sheets_toStrictUnixMs_(value);
              },
            });
          }

          if (localIndex === -1) {
            rowData[3] = Sheets_unixMsToSheetDate_(recModifiedAt) || "";
            rowData[6] = currentUserEmail;
            rowFormats[2] = NFB_SHEETS_DATETIME_FORMAT;
            rowFormats[3] = NFB_SHEETS_DATETIME_FORMAT;

            if (rec.deletedAt) {
              rowData[4] = Sheets_unixMsToSheetDate_(Sheets_toStrictUnixMs_(rec.deletedAt)) || "";
              rowData[7] = rec.deletedBy || currentUserEmail;
              rowFormats[4] = NFB_SHEETS_DATETIME_FORMAT;
            } else {
              rowData[4] = "";
              rowData[7] = "";
            }
          }

          for (var k = 0; k < order.length; k++) {
            var kName = String(order[k] || "");
            if (!kName || NFB_RESERVED_HEADER_KEYS[kName]) continue;
            var colIdx = keyToColumn[kName] - 1;
            if (colIdx < 0) continue;

            var val = Object.prototype.hasOwnProperty.call(normalizedRecordData, kName) ? normalizedRecordData[kName] : "";
            var tType = temporalTypeMap && temporalTypeMap[kName] ? temporalTypeMap[kName] : null;
            var norm = Sheets_resolveTemporalCell_(val, tType);

            rowData[colIdx] = norm.value;
            if (norm.numberFormat) rowFormats[colIdx] = norm.numberFormat;
          }

          rec["No."] = rowData[2];
          uploadedRecordIds[String(recId)] = true;
          modifiedCount++;
        }
      }

      if (modifiedCount > 0) {
        Sheets_ensureRowCapacity_(sheet, dataStartRow + existingData.length - 1);
        if (existingData.length > 0) {
          // テキスト系の列は全行 "@"（プレーンテキスト）に統一する。ブロック書き込みでは
          // 未変更行の値もそのまま setValues するため、書式を先に確定しないと文字列が
          // 日付/数値へ自動変換されてしまう。
          if (columnFormatMap) {
            for (var fk in columnFormatMap) {
              if (!columnFormatMap.hasOwnProperty(fk)) continue;
              if (NFB_RESERVED_HEADER_KEYS[fk]) continue;
              if (!keyToColumn.hasOwnProperty(fk)) continue;
              var fmtCol0 = keyToColumn[fk] - 1;
              if (fmtCol0 < 0 || fmtCol0 >= lastColumn) continue;
              var fmtVal = columnFormatMap[fk];
              for (var fr = 0; fr < existingFormats.length; fr++) {
                if (existingFormats[fr] && fmtCol0 < existingFormats[fr].length) {
                  existingFormats[fr][fmtCol0] = fmtVal;
                }
              }
            }
          }
          var outRange = sheet.getRange(dataStartRow, 1, existingData.length, lastColumn);
          outRange.setNumberFormats(existingFormats);
          outRange.setValues(existingData);
        }
        SetServerModifiedAt_(nowMs);
        Sheets_touchSheetLastUpdated_(sheet, nowMs);
        serverModifiedAt = nowMs;
        sheetLastUpdatedAt = nowMs;
      } else {
        sheetLastUpdatedAt = Sheets_readSheetLastUpdated_(sheet);
        serverModifiedAt = GetServerModifiedAt_();
      }

      // 返却データ構築
      var returnRecords = [];
      var columnPaths = Sheets_readColumnPaths_(sheet, lastColumn);

      Sheets_applyTemporalFormatsToMemory_(columnPaths, existingData, existingData.length, temporalTypeMap);

      for (var r = 0; r < existingData.length; r++) {
        var aRec = Sheets_buildRecordFromRow_(existingData[r], columnPaths);
        if (!aRec) continue;
        if (!Nfb_recordMatchesPid_(aRec, pid)) continue;
        if (!isAdmin && Nfb_isSoftDeletedRecord_(aRec)) continue;

        if (forceFullSync) {
          returnRecords.push(aRec);
        } else {
          var aModAt = getRecordModifiedAtUnixMs(aRec);
          if (aModAt > lastServerReadAt || uploadedRecordIds[String(aRec.id)]) {
            returnRecords.push(aRec);
          }
        }
      }

      var headerMatrix = Sheets_readHeaderMatrix_(sheet);
      var serializedRecords = returnRecords.map(SerializeRecord_);

      return {
        ok: true,
        serverModifiedAt: serverModifiedAt,
        serverCommitToken: serverModifiedAt,
        records: serializedRecords,
        headerMatrix: headerMatrix,
        isDelta: !forceFullSync,
        unchanged: false,
        count: serializedRecords.length,
        sheetLastUpdatedAt: sheetLastUpdatedAt,
      };
    });
  });
}
