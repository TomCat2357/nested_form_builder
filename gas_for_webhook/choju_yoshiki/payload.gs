// =============================================================================
// payload.gs — record.items の索引化・パス分解・子レコード（従事者情報）のグルーピング
//
// record.items[].question は「ヘッダー階層を "/" で連結した文字列」。
//   - 通常項目:      "申請者情報/申請者の個人・法人の別/個人/氏名"
//   - 子レコード行:  "従事者情報/#<レコードNo>/<子フォーム内パス>"
// セグメント内の "/" と "\" はバックスラッシュでエスケープされる
// （builder/src/utils/pathCodec.js の joinFieldPath / splitFieldKey と同じ規則）。
// =============================================================================

// エスケープ付き "/" 連結文字列 → セグメント配列（pathCodec.js splitFieldKey の移植）。
function Cho_splitPath_(text) {
  var str = String(text == null ? "" : text);
  var tokens = [];
  var current = "";
  var escaping = false;
  for (var i = 0; i < str.length; i++) {
    var ch = str.charAt(i);
    if (escaping) { current += ch; escaping = false; continue; }
    if (ch === "\\") { escaping = true; continue; }
    if (ch === "/") { tokens.push(current); current = ""; continue; }
    current += ch;
  }
  if (escaping) current += "\\";
  tokens.push(current);
  return tokens;
}

// items 配列 → 簡易索引。get(path) は完全一致した question の値（無ければ ""）。
function Cho_indexItems_(items) {
  var map = {};
  var list = [];
  for (var i = 0; i < (items || []).length; i++) {
    var it = items[i] || {};
    var q = String(it.question == null ? "" : it.question);
    if (!(q in map)) map[q] = it.value;
    list.push(it);
  }
  return {
    list: list,
    get: function (path) {
      var v = map[path];
      return v == null ? "" : String(v);
    },
    has: function (path) { return path in map; }
  };
}

// 親レコードの items を「親項目」と「従事者情報の子レコード行」に分ける。
// 戻り値: { parentItems: [...], children: [{ marker, items }] }（children は出現順）。
function Cho_splitParentAndChildren_(items) {
  var parentItems = [];
  var childMap = {};
  var childOrder = [];
  for (var i = 0; i < (items || []).length; i++) {
    var it = items[i] || {};
    var segs = Cho_splitPath_(it.question);
    if (segs.length >= 3 && segs[0] === CHO_L_FORMLINK_ && segs[1].charAt(0) === "#") {
      var marker = segs[1];
      if (!childMap[marker]) { childMap[marker] = []; childOrder.push(marker); }
      // 子フォーム内パスに剥がして積む（マーカーより後ろを "/" 連結し直す）
      childMap[marker].push({
        question: segs.slice(2).join("/"),
        value: it.value,
        type: it.type
      });
    } else {
      parentItems.push(it);
    }
  }
  var children = [];
  for (var c = 0; c < childOrder.length; c++) {
    children.push({ marker: childOrder[c], items: childMap[childOrder[c]] });
  }
  return { parentItems: parentItems, children: children };
}

// チェックボックス値（", " 連結）→ ラベル配列。空要素は捨てる。
function Cho_splitChecks_(value) {
  var s = String(value == null ? "" : value);
  if (!s) return [];
  var parts = s.split(", ");
  var out = [];
  for (var i = 0; i < parts.length; i++) {
    var p = parts[i].replace(/^\s+|\s+$/g, "");
    if (p) out.push(p);
  }
  return out;
}

// "YYYY-MM-DD" / "YYYY/MM/DD" → Date。パースできなければ元の文字列を返す（空は ""）。
function Cho_toDateOrText_(value) {
  var s = String(value == null ? "" : value).replace(/^\s+|\s+$/g, "");
  if (!s) return "";
  var m = s.match(/^(\d{4})[-\/](\d{1,2})[-\/](\d{1,2})$/);
  if (!m) return s;
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

// 数値文字列 → Number。数値にならなければ元の文字列（空は ""）。
function Cho_toNumberOrText_(value) {
  var s = String(value == null ? "" : value).replace(/^\s+|\s+$/g, "");
  if (!s) return "";
  var n = Number(s);
  return isNaN(n) ? s : n;
}

// Date → 和暦表示（"令和N年M月D日"）。Date 以外は素通し。
// Utilities.formatDate の era 書式は GAS の英語ロケールで和暦にならないため手計算する。
function Cho_formatWareki_(value) {
  if (!(value instanceof Date) || isNaN(value.getTime())) {
    return String(value == null ? "" : value);
  }
  var y = Number(Utilities.formatDate(value, "Asia/Tokyo", "yyyy"));
  var mo = Number(Utilities.formatDate(value, "Asia/Tokyo", "M"));
  var d = Number(Utilities.formatDate(value, "Asia/Tokyo", "d"));
  var era;
  var eraYear;
  if (y >= 2019) { era = "令和"; eraYear = y - 2018; }
  else if (y >= 1989) { era = "平成"; eraYear = y - 1988; }
  else { era = "昭和"; eraYear = y - 1925; }
  var nen = eraYear === 1 ? "元" : String(eraYear);
  return era + nen + "年" + mo + "月" + d + "日";
}
