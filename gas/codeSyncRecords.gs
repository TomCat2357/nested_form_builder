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

    var getRecordModifiedAtUnixMs = function(record) {
      var modifiedAtUnixMs = parseInt(record && record.modifiedAtUnixMs, 10);
      if (isFinite(modifiedAtUnixMs) && modifiedAtUnixMs > 0) return modifiedAtUnixMs;
      // 固定メタ列は Unix ms 厳密解釈
      return Sheets_toStrictUnixMs_(record && record.modifiedAt) || 0;
    };

    var buildReadOnlyResult = function() {
      var temporalTypeMap = ResolveTemporalTypeMap_(ctx);
      var allRecords = Sheets_getAllRecords_(sheet, temporalTypeMap, { normalize: false });
      var headerMatrix = Sheets_readHeaderMatrix_(sheet);

      if (forceFullSync || lastServerReadAt <= 0) {
        var fullRecords = allRecords.map(SerializeRecord_);
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
      for (var i = 0; i < allRecords.length; i++) {
        var record = allRecords[i];
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
      if (sheetLastUpdatedAt > 0 && lastServerReadAt > 0 && sheetLastUpdatedAt <= lastServerReadAt) {
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
      var temporalTypeMap = ResolveTemporalTypeMap_(ctx);
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
            rowData[2] = insertMeta.createdAt;
            rowData[5] = insertMeta.createdBy;
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
            rowData[3] = recModifiedAt;
            rowData[6] = currentUserEmail;
            rowFormats[2] = "0";
            rowFormats[3] = "0";

            if (rec.deletedAt) {
              rowData[4] = Sheets_toStrictUnixMs_(rec.deletedAt) || rec.deletedAt;
              rowData[7] = rec.deletedBy || currentUserEmail;
              rowFormats[4] = "0";
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
          var outRange = sheet.getRange(dataStartRow, 1, existingData.length, lastColumn);
          outRange.setValues(existingData);
          outRange.setNumberFormats(existingFormats);
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
