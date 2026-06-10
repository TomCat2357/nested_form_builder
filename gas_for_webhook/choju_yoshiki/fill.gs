// =============================================================================
// fill.gs — テンプレート複製とシート書き込み（静的マップ / 種数テーブル / 従事者名簿）
//
// 書き込み規約:
//   - 値が "" / null のセルは触らない（テンプレートの空欄をそのまま残す）
//   - 結合セルは左上番地に setValue（mapping.gs の番地は merges.tsv で左上を確認済み）
//   - Date はそのまま setValue し、テンプレート側に残る表示形式（和暦等）に委ねる
// =============================================================================

// Script Properties のキー
var CHO_PROP_TEMPLATE_ = "CHO_TEMPLATE_FILE_ID";
var CHO_PROP_FOLDER_ = "CHO_OUTPUT_FOLDER_ID";
var CHO_PROP_KEY_ = "CHO_ACCESS_KEY";

// テンプレートを出力フォルダへ複製し、ファイル（DriveApp File）を返す。
function Cho_createOutputCopy_(recordNo) {
  var props = PropertiesService.getScriptProperties();
  var templateId = props.getProperty(CHO_PROP_TEMPLATE_);
  var folderId = props.getProperty(CHO_PROP_FOLDER_);
  if (!templateId || !folderId) {
    throw new Error("テンプレート未設定です。setup.gs の Cho_registerSettings を実行してください。");
  }
  var stamp = Utilities.formatDate(new Date(), "Asia/Tokyo", "yyyyMMdd_HHmmss");
  var noPart = String(recordNo == null || recordNo === "" ? "record" : recordNo);
  var name = "鳥獣保護管理法様式_" + noPart + "_" + stamp;
  return DriveApp.getFileById(templateId).makeCopy(name, DriveApp.getFolderById(folderId));
}

function Cho_setCell_(sheet, a1, value) {
  if (value === "" || value === null || value === undefined) return;
  sheet.getRange(a1).setValue(value);
}

// ----- 全シート書き込み -----
function Cho_fillAll_(ss, model) {
  var sheetNames = Object.keys(CHO_SHEET_MAPS_);
  for (var i = 0; i < sheetNames.length; i++) {
    var name = sheetNames[i];
    var cond = CHO_SHEET_CONDITIONS_[name];
    if (cond && !cond(model)) continue;
    var sheet = ss.getSheetByName(name);
    if (!sheet) {
      model.warnings.push("シート「" + name + "」がテンプレートに見つかりません。");
      continue;
    }
    Cho_writeStaticMap_(sheet, CHO_SHEET_MAPS_[name], model);
    if (CHO_SPECIES_TABLES_[name]) {
      Cho_writeSpeciesTable_(sheet, name, CHO_SPECIES_TABLES_[name], model);
    }
  }
  Cho_writeRosterBlocks_(ss, model);
}

// ----- 静的セルマップ -----
function Cho_writeStaticMap_(sheet, map, model) {
  for (var i = 0; i < map.length; i++) {
    Cho_setCell_(sheet, map[i].cell, model[map[i].get]);
  }
}

// ----- 種数テーブル -----
// cols: name / count / unit / eggLabel / eggCount / eggUnit / name2 / quotaCount / quotaEgg
function Cho_writeSpeciesTable_(sheet, sheetName, cfg, model) {
  var list = model.speciesList || [];
  if (list.length > cfg.maxRows) {
    model.warnings.push("シート「" + sheetName + "」の種数欄(" + cfg.maxRows + "行)を超えたため、" +
      (list.length - cfg.maxRows) + " 種を出力できませんでした。");
  }
  var cols = cfg.cols;
  var n = Math.min(list.length, cfg.maxRows);
  for (var i = 0; i < n; i++) {
    var sp = list[i];
    var row = cfg.startRow + i;
    if (cols.name) Cho_setCell_(sheet, cols.name + row, sp.name);
    if (cols.count) Cho_setCell_(sheet, cols.count + row, sp.count);
    if (cols.unit && sp.name) Cho_setCell_(sheet, cols.unit + row, sp.unit);
    if (cols.eggLabel && sp.eggCount !== "") Cho_setCell_(sheet, cols.eggLabel + row, "卵");
    if (cols.eggCount) Cho_setCell_(sheet, cols.eggCount + row, sp.eggCount);
    if (cols.eggUnit && sp.eggCount !== "") Cho_setCell_(sheet, cols.eggUnit + row, "個");
    if (cols.name2) Cho_setCell_(sheet, cols.name2 + row, sp.name);
    if (cols.quotaCount) Cho_setCell_(sheet, cols.quotaCount + row, Cho_perPerson_(sp.count, model.workerCount));
    if (cols.quotaEgg) Cho_setCell_(sheet, cols.quotaEgg + row, Cho_perPerson_(sp.eggCount, model.workerCount));
  }
}

// 1 人あたり数量（許可審査表 G-I 列。旧数式 = 数量 / 従事者数）。
function Cho_perPerson_(total, workerCount) {
  if (typeof total !== "number" || !workerCount) return "";
  return total / workerCount;
}

// ----- 従事者名簿（従事者 × 捕獲方法 で 1 ブロック） -----
function Cho_writeRosterBlocks_(ss, model) {
  var layout = CHO_ROSTER_LAYOUTS_[model.applicantType === "法人" ? "法人" : "個人"];
  var sheet = ss.getSheetByName(layout.sheetName);
  if (!sheet) {
    model.warnings.push("シート「" + layout.sheetName + "」がテンプレートに見つかりません。");
    return;
  }
  var entries = model.rosterEntries || [];
  if (entries.length > layout.blockCount) {
    model.warnings.push("従事者名簿の枠(" + layout.blockCount + "ブロック)を超えたため、" +
      (entries.length - layout.blockCount) + " 件を出力できませんでした。");
  }
  var cols = layout.cols;
  var n = Math.min(entries.length, layout.blockCount);
  for (var e = 0; e < n; e++) {
    var entry = entries[e];
    var top = layout.firstRow + e * layout.blockHeight;
    var worker = entry.worker;
    var method = entry.method;

    Cho_setCell_(sheet, cols.certNo + top, entry.certNo);
    if (entry.includePersonal) {
      Cho_setCell_(sheet, cols.address + top, worker.address);
      Cho_setCell_(sheet, cols.name + top, worker.name);
      Cho_setCell_(sheet, cols.occupation + top, worker.occupation);
      Cho_setCell_(sheet, cols.birth + top, worker.birth);
      // 種数（ブロック内 6 行 = 最大 6 種。2 ブロック目以降は二重計上防止のため空欄）
      var species = worker.species || [];
      if (species.length > layout.blockHeight) {
        model.warnings.push("従事者「" + worker.name + "」の種数が " + layout.blockHeight +
          " 行を超えたため、" + (species.length - layout.blockHeight) + " 種を出力できませんでした。");
      }
      for (var s = 0; s < Math.min(species.length, layout.blockHeight); s++) {
        var sp = species[s];
        var row = top + s;
        Cho_setCell_(sheet, cols.speciesName + row, sp.name);
        Cho_setCell_(sheet, cols.speciesCount + row, sp.count);
        if (sp.name) Cho_setCell_(sheet, cols.speciesUnit + row, sp.unit);
        if (sp.eggCount !== "") {
          Cho_setCell_(sheet, cols.eggLabel + row, "卵");
          Cho_setCell_(sheet, cols.eggCount + row, sp.eggCount);
          Cho_setCell_(sheet, cols.eggUnit + row, "個");
        }
      }
    }

    // 捕獲用具（P 列の 2 行 × 3 サブスロット）。4 つ以上は最終スロットへ連結。
    var tools = method.tools || [];
    var slotCount = cols.toolSlotOffsets.length;
    for (var t = 0; t < Math.min(tools.length, slotCount); t++) {
      var toolValue = (t === slotCount - 1 && tools.length > slotCount)
        ? tools.slice(t).join("、")
        : tools[t];
      Cho_setCell_(sheet, cols.toolCol + (top + cols.toolSlotOffsets[t]), toolValue);
    }

    if (method.lic) {
      Cho_setCell_(sheet, cols.licType + top, method.lic.type);
      Cho_setCell_(sheet, cols.licAuthority + top, method.lic.authority);
      Cho_setCell_(sheet, cols.licNo + top, method.lic.no);
      Cho_setCell_(sheet, cols.licDate + top, method.lic.date);
    }
    if (method.reg) {
      Cho_setCell_(sheet, cols.regType + top, method.reg.type);
      Cho_setCell_(sheet, cols.regNo + top, method.reg.no);
      Cho_setCell_(sheet, cols.regDate + top, method.reg.date);
    }
    if (method.poss) {
      Cho_setCell_(sheet, cols.gunPermitNo + top, method.poss.no);
      Cho_setCell_(sheet, cols.gunPermitDate + top, method.poss.date);
      Cho_setCell_(sheet, cols.gunKind + top, method.gunKind);
    }
  }
}
