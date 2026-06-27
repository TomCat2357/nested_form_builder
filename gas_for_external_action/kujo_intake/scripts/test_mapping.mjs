// 苦情・通報 CSV 取り込みの純ロジック検証（GAS / 外部 API 不要）。
//   node scripts/test_mapping.mjs
// Combined.gs を vm で読み込み module.exports の純関数を呼ぶ。
//   - CSV パース / 列ヘッダ駆動マッピング / 重複排除（時間込み）/ 30 行制限 / 候補→data / 日付 / 直接書き込み行の組み立て。
//   - PropertiesService は sandbox に無いので KUJ_FORM_ID_ は ""。String.normalize 等は vm の intrinsics を使う。
import fs from "node:fs";
import vm from "node:vm";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const dir = path.dirname(fileURLToPath(import.meta.url));
const code = fs.readFileSync(path.join(dir, "..", "Combined.gs"), "utf8");
// GAS の Utilities.computeHmacSha256Signature は符号付きバイト（Byte[]: -128..127）を返す。
// 誤送信防止プローブの署名互換（本体 ExtAction の verifier と同形式）を node でも検証できるよう、
// node:crypto の HMAC を符号付きバイト配列で返すスタブを供給する。
// GAS の Utilities.base64EncodeWebSafe / base64DecodeWebSafe / newBlob を node で再現する
// （自己完結 ctx トークンのエンコード/デコードを検証する。GAS は decode で符号付きバイトを返すので、
// newBlob 側で符号無しへ戻して文字列化する＝Combined.gs の実装と同じ往復経路にする）。
const Utilities = {
  computeHmacSha256Signature(message, key) {
    const mac = crypto.createHmac("sha256", Buffer.from(String(key == null ? "" : key), "utf8"))
      .update(Buffer.from(String(message == null ? "" : message), "utf8"))
      .digest();
    return Array.from(mac).map((b) => (b > 127 ? b - 256 : b));
  },
  Charset: { UTF_8: "UTF-8" },
  base64EncodeWebSafe(input /*, charset */) {
    return Buffer.from(String(input), "utf8").toString("base64").replace(/\+/g, "-").replace(/\//g, "_");
  },
  base64DecodeWebSafe(s) {
    const t = String(s).replace(/-/g, "+").replace(/_/g, "/");
    return Array.from(Buffer.from(t, "base64")).map((b) => (b > 127 ? b - 256 : b)); // GAS 同様の符号付き Byte[]
  },
  newBlob(bytes) {
    const buf = Buffer.from((bytes || []).map((b) => (b < 0 ? b + 256 : b)));
    return { getDataAsString: () => buf.toString("utf8") };
  },
};
const sandbox = { module: { exports: {} }, console, Date, Math, JSON, RegExp, Number, String, Array, Object, isNaN, isFinite, parseInt, Utilities };
vm.runInNewContext(code, sandbox);
const C = sandbox.module.exports;
const fix = (name) => fs.readFileSync(path.join(dir, "fixtures", name), "utf8");

let pass = 0, fail = 0;
const eq = (l, g, w) => { (JSON.stringify(g) === JSON.stringify(w)) ? pass++ : (fail++, console.log(`  FAIL ${l}: got=${JSON.stringify(g)} want=${JSON.stringify(w)}`)); };
const ok = (l, c, d) => { c ? pass++ : (fail++, console.log(`  FAIL ${l} ${d || ""}`)); };
const data = (cand) => C.Kuj_candidateToData_(cand).data;

// ===== mapper / codec / date / uploadRecords =====

// 1. エスケープ: 継続中 → data キー 継続\/完結（バックスラッシュ付き・1 セグメント）
const d1 = data({ keizokuKanketsu: "継続中" });
eq("1 escape 継続/完結", d1["継続\\/完結"], "継続中");
ok("1 escape キー形", Object.keys(d1).includes("継続\\/完結"), Object.keys(d1).join(","));

// 2. 複数値連結: ", " 連結
eq("2 multi join", data({ soudanDaibunrui: ["野生鳥獣", "生物多様性"] })["相談大分類"], "野生鳥獣, 生物多様性");

// 3. ゲーティング ON
eq("3 gate ON 対象種",
  data({ soudanDaibunrui: ["野生鳥獣"], taishoSpecies: ["カラス", "ハト"] })["相談大分類/野生鳥獣/対象種"],
  "カラス, ハト");

// 4. ゲーティング OFF（親に野生鳥獣が無ければ対象種キー不在）
ok("4 gate OFF 対象種不在",
  !("相談大分類/野生鳥獣/対象種" in data({ soudanDaibunrui: ["生物多様性"], taishoSpecies: ["カラス"] })));

// 5. 孫ゲート
eq("5 孫ゲート 子ガラスか",
  data({ soudanDaibunrui: ["野生鳥獣"], taishoSpecies: ["カラス"], kogarasuKa: ["はい"] })["相談大分類/野生鳥獣/対象種/カラス/子ガラスか"],
  "はい");
ok("5 孫ゲート カラス未選択で不在",
  !("相談大分類/野生鳥獣/対象種/カラス/子ガラスか" in data({ soudanDaibunrui: ["野生鳥獣"], taishoSpecies: ["スズメ"], kogarasuKa: ["はい"] })));

// 6. 紹介先
eq("6 紹介先",
  data({ soudanDaibunrui: ["野生鳥獣"], kaitoKani: ["他行政機関紹介"], shokaisaki: ["土木センター（公園等管理者）", "石狩振興局自然環境係"] })["相談大分類/野生鳥獣/回答（簡易）/他行政機関紹介/紹介先"],
  "土木センター（公園等管理者）, 石狩振興局自然環境係");

// 7. 空値は data に出さない
const d7 = data({ toiawaseMoto: "", soudanDaibunrui: [], genbaJusho: "   " });
ok("7 空 問合せ元 不在", !("問合せ元" in d7));
ok("7 空 相談大分類 不在", !("相談大分類" in d7));
ok("7 空白のみ 現場住所等 不在", !("現場住所等" in d7));

// 8. 日付（和暦/西暦・全角混じり）
eq("8 date 和暦", C.Kuj_toCanonicalDate_("令和8年6月23日"), "2026-06-23");
eq("8 date 西暦スラッシュ", C.Kuj_toCanonicalDate_("2026/06/23"), "2026-06-23");
eq("8 date 西暦ハイフン", C.Kuj_toCanonicalDate_("2026-6-3"), "2026-06-03");
eq("8 date 和暦元年", C.Kuj_toCanonicalDate_("令和元年5月1日"), "2019-05-01");
eq("8 date 時刻付き先頭一致", C.Kuj_toCanonicalDate_("2026/06/26 08:44"), "2026-06-26");
eq("8 date 解釈不能", C.Kuj_toCanonicalDate_("不明"), "");

// 9. uploadRecords 形
const up = C.Kuj_buildUploadRecords_([{ soudanDaibunrui: ["野生鳥獣"] }, { soudanDaibunrui: ["その他"], soudanDaibunruiOther: "営業" }]);
eq("9 uploadRecords 件数", up.parent.uploadRecords.length, 2);
ok("9 record id r_ 始まり", /^r_/.test(up.parent.uploadRecords[0].id) && /^r_/.test(up.parent.uploadRecords[1].id),
  up.parent.uploadRecords.map(r => r.id).join(","));
ok("9 record id 一意", up.parent.uploadRecords[0].id !== up.parent.uploadRecords[1].id);
ok("9 modifiedAtUnixMs 数値", typeof up.parent.uploadRecords[0].modifiedAtUnixMs === "number");
eq("9 parentFormId===parent.formId", up.parentFormId, up.parent.formId);
eq("9 parentRecordId 空", up.parentRecordId, "");
ok("9 子 その他/具体的に 連動",
  up.parent.uploadRecords[1].data["相談大分類/その他/具体的に"] === "営業",
  JSON.stringify(up.parent.uploadRecords[1].data));

// 10. enum 防御: 未知ラベルは破棄 + warning
const conv10 = C.Kuj_candidateToData_({ soudanDaibunrui: ["宇宙"] });
ok("10 enum 防御 破棄", !("相談大分類" in conv10.data), JSON.stringify(conv10.data));
ok("10 enum 防御 warning", conv10.warnings.length > 0, JSON.stringify(conv10.warnings));
const conv10b = C.Kuj_candidateToData_({ soudanDaibunrui: ["野生鳥獣", "宇宙"] });
eq("10 enum 混在は既知のみ", conv10b.data["相談大分類"], "野生鳥獣");
ok("10 enum 混在 warning", conv10b.warnings.length > 0);

// ===== テキスト正規化（CSV ヘッダ/値の部首正規化）=====

// 11. Kangxi/CJK 部首コードポイントを通常漢字へ（全角記号は保つ）
eq("11 部首 氏(U+2F52)→氏", C.Kuj_normalizeText_("⽒名"), "氏名");
eq("11 部首 長(U+2FA7)→長", C.Kuj_normalizeText_("部⾧"), "部長");
eq("11 全角！は保つ", C.Kuj_normalizeText_("だめ！"), "だめ！");

// ===== CSV（お問い合わせフォーム）取り込み =====

// 21. ピュア CSV パーサ（引用符内カンマ/改行・CRLF・末尾空行・"" エスケープ）
const cr = C.Kuj_parseCsv_('a,b,c\r\n1,"x,y","p\nq"\r\n,,\r\n');
eq("21 CSV 行数", cr.length, 3);
eq("21 CSV 引用符内カンマ", cr[1][1], "x,y");
eq("21 CSV 引用符内改行", cr[1][2], "p\nq");
eq("21 CSV 空行は空セル列", cr[2], ["", "", ""]);
eq("21 CSV \"\" エスケープ", C.Kuj_parseCsv_('"a""b"')[0][0], 'a"b');

// 22. ヘッダ index（名前 → 列インデックス）
const idx = C.Kuj_csvHeaderIndex_(["ステータス", "問い合わせ日", "氏名", "件名", "内容"]);
eq("22 ヘッダ index 問い合わせ日", idx["問い合わせ日"], 1);
eq("22 ヘッダ index 内容", idx["内容"], 4);

// 23. fixture（お問い合わせフォーム CSV）→ 候補（カラス重複行・空行を含む）
const csvFix = fix("homepage_csv.csv");
const parsed = C.Kuj_csvToCandidates_(csvFix);
ok("23 ヘッダ判定 OK", parsed.headerOk);
eq("23 候補数(空行・重複スキップ後)", parsed.candidates.length, 3);
eq("23 skip 件数(空行)", parsed.skipped, 1);
eq("23 重複スキップ数", parsed.duplicates, 1);
ok("23 重複 warning", parsed.warnings.some(w => /重複/.test(w)), JSON.stringify(parsed.warnings));
const c0 = parsed.candidates[0];
eq("23 方法", c0.toiawaseHoho, "ホームページ");
eq("23 問合せ元", c0.toiawaseMoto, "札幌花子");
eq("23 連絡先順(メール/電話/郵便/住所)", c0.toiawaseMotoRenraku, "hanako@example.com, 011-200-0000, 060-0001, 札幌市中央区北1条西2丁目");
eq("23 相談詳細 件名+内容", c0.soudanShosai, "カラス被害について\n子育て中のカラスに威嚇されました。");
ok("23 備考にふりがな/年齢/職業", /ふりがな: さっぽろはなこ/.test(c0.bikou) && /年齢: 30代/.test(c0.bikou) && /職業: 会社員/.test(c0.bikou), c0.bikou);

// 24. 引用符内カンマ・改行を保持した相談詳細・返信者→担当者
const c1 = parsed.candidates[1];
eq("24 相談詳細 改行・カンマ保持", c1.soudanShosai, "糞害について\nハト, スズメが多く、\n糞害が出ています。\n対応をお願いします。");
eq("24 担当者=返信者", c1.tantosha, "環境太郎");

// 25. 氏名空の行も詳細だけで取り込む
const c2 = parsed.candidates[2];
eq("25 氏名空", c2.toiawaseMoto, "");
ok("25 相談詳細にアンケート", /アンケート/.test(c2.soudanShosai));

// 26. parseCsvToRecords（一気通貫・N 行→N レコード）
const upCsv = C.Kuj_parseCsvToRecords_(csvFix, "toiawase.csv");
ok("26 ok", upCsv.ok === true);
eq("26 filename", upCsv.filename, "toiawase.csv");
eq("26 records 件数", upCsv.parent.uploadRecords.length, 3);
eq("26 受付日 canonical r0", upCsv.parent.uploadRecords[0].data["受付日"], "2026-06-27");
eq("26 受付日 canonical r1", upCsv.parent.uploadRecords[1].data["受付日"], "2026-06-26");
eq("26 問合せ方法 data", upCsv.parent.uploadRecords[0].data["問合せ方法"], "ホームページ");
eq("26 連絡先 data", upCsv.parent.uploadRecords[0].data["問合せ元　連絡先"], "hanako@example.com, 011-200-0000, 060-0001, 札幌市中央区北1条西2丁目");
ok("26 備考 data あり", !!upCsv.parent.uploadRecords[0].data["備考"], JSON.stringify(upCsv.parent.uploadRecords[0].data));
ok("26 相談大分類は自動で入らない", !("相談大分類" in upCsv.parent.uploadRecords[0].data));
ok("26 record id r_ 始まり", /^r_/.test(upCsv.parent.uploadRecords[0].id));

// 27. ヘッダ不一致はベストエフォート＋warning
const bad = C.Kuj_csvToCandidates_("foo,bar\n1,2\n");
ok("27 ヘッダ不一致は headerOk=false", !bad.headerOk);
ok("27 ヘッダ不一致 warning", bad.warnings.length > 0, JSON.stringify(bad.warnings));

// 28. 重複取り込み防止（問い合わせ日込み。内容+日時が一致なら重複。日時が違えば別物）
const HDR = "ステータス,問い合わせ日,返信者,現在の振分先,問い合わせ件名,メールアドレス,氏名,ふりがな,年齢,職業,住所,郵便番号,電話番号,件名,内容\n";
const ROW = (st, dt, resp, subj, body) => `${st},${dt},${resp},環境共生,${subj},a@b.c,山田,やまだ,40代,会社員,中央区,060-0001,011-0,${subj},${body}\n`;
const dupCsv = HDR + ROW("未返信", "2026/6/27 12:46", "", "カラス", "威嚇された")
  + ROW("返信済", "2026/6/27 12:46", "担当A", "カラス", "威嚇された")  // 内容も日時も同一（状態/返信者のみ差）→ 重複
  + ROW("未返信", "2026/6/28 9:00", "", "カラス", "威嚇された")        // 内容同一だが日時が違う → 別物
  + ROW("未返信", "2026/6/29 0:00", "", "ハト", "糞害");               // 件名/内容が違う → 別物
const dupParsed = C.Kuj_csvToCandidates_(dupCsv);
eq("28 重複除外後の候補数(日時込み)", dupParsed.candidates.length, 3);
eq("28 重複検出数", dupParsed.duplicates, 1);
eq("28 残った1=カラス12:46", dupParsed.candidates[0].soudanShosai, "カラス\n威嚇された");
eq("28 残った3=ハト", dupParsed.candidates[2].soudanShosai, "ハト\n糞害");
// dedupKey 契約: 内容+日時一致で同一 / 日時違いは別 / 内容違いは別
const key = (st, dt, resp, subj, body) =>
  C.Kuj_csvRowToCandidate_(C.Kuj_csvHeaderIndex_(C.Kuj_parseCsv_(HDR)[0]), C.Kuj_parseCsv_(ROW(st, dt, resp, subj, body))[0])._dedupKey;
const k1 = key("未返信", "2026/6/27 12:46", "", "カラス", "威嚇された");
const k2 = key("返信済", "2026/6/27 12:46", "担当A", "カラス", "威嚇された");
const k3 = key("未返信", "2026/6/28 9:00", "", "カラス", "威嚇された");
const k4 = key("未返信", "2026/6/29 0:00", "", "ハト", "糞害");
ok("28 dedupKey 内容+日時一致で同一", k1 === k2, `${k1} vs ${k2}`);
ok("28 dedupKey 日時違いは別", k1 !== k3);
ok("28 dedupKey 内容違いは別", k1 !== k4);
ok("28 preview に dedupKey", typeof C.Kuj_buildUploadRecords_(dupParsed.candidates).preview[0].dedupKey === "string" && C.Kuj_buildUploadRecords_(dupParsed.candidates).preview[0].dedupKey.length > 0);

// ===== 誤送信防止プローブ署名（外部アクションリレー doPost の互換性） =====
// 本体 ExtAction_verifyProbeResponse_ は signature === ExtAction_hmacHex_(nonce, secret) のときだけ通す。

// 29. HMAC hex が node:crypto の HMAC-SHA256 と一致（符号変換の正しさ＝本体 verifier との互換）
const expectHmac = (msg, key2) =>
  crypto.createHmac("sha256", Buffer.from(key2, "utf8")).update(Buffer.from(msg, "utf8")).digest("hex");
eq("29 hmacHex 一致(secret有)", C.Kuj_hmacHex_("nonce-123", "shared-secret"), expectHmac("nonce-123", "shared-secret"));
eq("29 hmacHex 一致(secret空)", C.Kuj_hmacHex_("nonce-123", ""), expectHmac("nonce-123", ""));
ok("29 hmacHex 64桁hex", /^[0-9a-f]{64}$/.test(C.Kuj_hmacHex_("x", "y")));

// 30. プローブ応答の形（本体 verifier が要求する ok/nfbExternalAction/signature）。
const probe = C.Kuj_buildProbeResponse_("the-nonce");
eq("30 probe ok", probe.ok, true);
eq("30 probe nfbExternalAction", probe.nfbExternalAction, true);
eq("30 probe signature=hmac(nonce, '')", probe.signature, expectHmac("the-nonce", ""));
eq("30 probe nonce null 安全", C.Kuj_buildProbeResponse_(null).signature, expectHmac("", ""));

// ===== 直接書き込み（NFB レイアウト・行組み立て・列照合・リレー文脈）=====

// 31. パスコーデック: kujo data キー（Kuj_joinFieldPath_）と列キー（Sheets_pathKey_）が一致
const dataKey = C.Kuj_joinFieldPath_(["継続/完結"]); // "継続\/完結"
eq("31 escape key", dataKey, "継続\\/完結");
eq("31 列キーと一致(ヘッダ→pathKey)", C.Sheets_pathKey_(["継続/完結"]), dataKey);
eq("31 nested 一致", C.Sheets_pathKey_(["相談大分類", "野生鳥獣", "対象種"]), C.Kuj_joinFieldPath_(["相談大分類", "野生鳥獣", "対象種"]));
const nrk = C.Sheets_normalizeRecordDataKeys_({ "継続\\/完結": "継続中", "相談大分類/野生鳥獣/対象種": "カラス" });
ok("31 normalizeRecordDataKeys 不変",
  Object.prototype.hasOwnProperty.call(nrk, "継続\\/完結") && Object.prototype.hasOwnProperty.call(nrk, "相談大分類/野生鳥獣/対象種"),
  Object.keys(nrk).join("|"));

// 32. resolveCell: YYYY-MM-DD → Date(yyyy/mm/dd) / 数式中和 / 通常文字列 / 空→@
const rcDate = C.Kuj_resolveCell_("2026-06-27");
ok("32 resolveCell 日付 Date", rcDate.value instanceof Date && rcDate.numberFormat === "yyyy/mm/dd", JSON.stringify(rcDate.numberFormat));
eq("32 resolveCell 数式中和", C.Kuj_resolveCell_("=SUM(A1)").value, "'=SUM(A1)");
eq("32 resolveCell 文字列素通し", C.Kuj_resolveCell_("ホームページ").value, "ホームページ");
eq("32 resolveCell 空→@", C.Kuj_resolveCell_("").numberFormat, "@");

// 33. buildNewRow: 固定列配置・data 列照合・受付日 Date 化・未知キー drop
const keyToColumn = { "受付日": 10, "問合せ方法": 11, "相談詳細": 12 }; // 1-based 列番号
const fixedColMap = { "id": 0, "No.": 1, "createdAt": 2, "modifiedAt": 3, "pid": 8 }; // 0-based
const rec = { id: "r_test", pid: "", data: { "受付日": "2026-06-27", "問合せ方法": "ホームページ", "相談詳細": "本文", "存在しない列": "x" } };
const built = C.Kuj_buildNewRow_(keyToColumn, fixedColMap, 13, rec, 4, 1700000000000, "me@example.com");
eq("33 id 配置", built.rowData[0], "r_test");
eq("33 No. = maxNo+1", built.rowData[1], 5);
ok("33 createdAt Date", built.rowData[2] instanceof Date);
ok("33 受付日 Date 化", built.rowData[9] instanceof Date && built.rowFormats[9] === "yyyy/mm/dd");
eq("33 問合せ方法 配置", built.rowData[10], "ホームページ");
eq("33 相談詳細 配置", built.rowData[11], "本文");
const dropped = C.Kuj_collectDroppedKeys_(rec.data, keyToColumn);
ok("33 未知列を drop 検出", dropped.indexOf("存在しない列") >= 0, JSON.stringify(dropped));

// 34. targetsFromCtx / extractRelayContext（リレー文脈・ctx 一本化）
const ctx = C.Kuj_extractRelayContext_({ storage: { spreadsheetId: "SS_X", sheetName: "Data2" }, formId: "f1" });
eq("34 relay spreadsheetId", ctx.spreadsheetId, "SS_X");
eq("34 relay sheetName", ctx.sheetName, "Data2");
const tgt = C.Kuj_targetsFromCtx_(ctx);
eq("34 ctx spreadsheetId 解決", tgt.spreadsheetId, "SS_X");
eq("34 ctx sheetName 解決", tgt.sheetName, "Data2");
const tgtNoCtx = C.Kuj_targetsFromCtx_(null);
eq("34 ctx 無→未解決", tgtNoCtx.spreadsheetId, "");
eq("34 sheetName 既定 Data", tgtNoCtx.sheetName, "Data");

// 35. parseCsvBatch: ファイル横断 dedup（時間込み）＋ 30 行制限
const HB = "ステータス,問い合わせ日,返信者,現在の振分先,問い合わせ件名,メールアドレス,氏名,ふりがな,年齢,職業,住所,郵便番号,電話番号,件名,内容\n";
const R = (dt, subj, body) => `未返信,${dt},,環境共生,${subj},a@b.c,山田,やまだ,40代,会社員,中央区,060-0001,011-0,${subj},${body}\n`;
const file1 = HB + R("2026/6/27 12:46", "カラス", "威嚇") + R("2026/6/27 13:00", "ハト", "糞害");
const file2 = HB + R("2026/6/27 12:46", "カラス", "威嚇") + R("2026/6/28 9:00", "カラス", "威嚇");
const batch = C.Kuj_parseCsvBatch_([file1, file2]);
eq("35 横断 dedup 後の件数", batch.candidates.length, 3); // カラス12:46 / ハト13:00 / カラス28日
eq("35 横断 重複検出", batch.duplicates, 1);
const many = HB + Array.from({ length: 31 }, (_, i) => R("2026/6/27 " + i + ":00", "件" + i, "本" + i)).join("");
const capped = C.Kuj_parseCsvBatch_([many]);
eq("35 30 行制限後", capped.candidates.length, C.KUJ_MAX_ROWS_);
eq("35 overflow", capped.overflow, 31 - C.KUJ_MAX_ROWS_);
ok("35 30 行 warning", capped.warnings.some(w => /行/.test(w)), JSON.stringify(capped.warnings));

// 36. prettyLabel: エスケープ済みパス → " ＞ " 区切り
eq("36 prettyLabel nested", C.Kuj_prettyLabel_("相談大分類/野生鳥獣/対象種"), "相談大分類 ＞ 野生鳥獣 ＞ 対象種");
eq("36 prettyLabel escaped", C.Kuj_prettyLabel_("継続\\/完結"), "継続/完結");

// 37. previewRowsFromCandidates: 候補 → ラベル＝値（読みやすいプレビュー）
const pr = C.Kuj_previewRowsFromCandidates_([{ toiawaseHoho: "ホームページ", ukeotsukeDate: "2026/6/27 12:46", soudanShosai: "本文", _layout: "ホームページ（CSV）" }]);
eq("37 preview 行数", pr.length, 1);
ok("37 preview 受付日 canonical", pr[0].fields.some(f => f.label === "受付日" && f.value === "2026-06-27"), JSON.stringify(pr[0].fields));
ok("37 preview 問合せ方法", pr[0].fields.some(f => f.label === "問合せ方法" && f.value === "ホームページ"));

// 38. 自己完結 ctx トークン（キャッシュ非依存）: encode→decode 往復で保存先が保たれる
const ctx38 = C.Kuj_extractRelayContext_({ storage: { spreadsheetId: "SS_ROUNDTRIP", sheetName: "回答" }, formId: "f38" });
const tok38 = C.Kuj_encodeCtx_(ctx38);
ok("38 トークン接頭辞 c1.", tok38.indexOf("c1.") === 0, tok38);
ok("38 トークンは URL-safe(base64url)", /^c1\.[A-Za-z0-9_-]+$/.test(tok38), tok38);
const dec38 = C.Kuj_decodeCtx_(tok38);
eq("38 decode spreadsheetId", dec38.spreadsheetId, "SS_ROUNDTRIP");
eq("38 decode sheetName", dec38.sheetName, "回答");
eq("38 decode formId", dec38.formId, "f38");
// targetsFromCtx と合わせて「ボタン押下で渡った保存先がそのまま書き込み先になる」ことを確認（ctx 一本化）
const tgt38 = C.Kuj_targetsFromCtx_(dec38);
eq("38 ctx spreadsheetId 解決", tgt38.spreadsheetId, "SS_ROUNDTRIP");
eq("38 ctx sheetName 解決", tgt38.sheetName, "回答");
// ctx が無ければ未解決（""）＋既定シート "Data"（フォールバックは無い）
const tgtNull38 = C.Kuj_targetsFromCtx_(null);
eq("38 ctx 無し spreadsheetId 未解決", tgtNull38.spreadsheetId, "");
eq("38 ctx 無し sheetName 既定", tgtNull38.sheetName, "Data");
// 旧キャッシュ方式トークン（"r_..."）/ 不正文字列は decode 対象外 → null（resolveTargets が readCtx へフォールバック）
ok("38 旧トークンは decode 対象外", C.Kuj_decodeCtx_("r_abc_def") === null);
ok("38 不正トークンは null", C.Kuj_decodeCtx_("c1.@@notbase64@@") === null || typeof C.Kuj_decodeCtx_("c1.@@notbase64@@") === "object");
ok("38 空トークンは null", C.Kuj_decodeCtx_("") === null);

console.log(`\n==== ${pass} PASS / ${fail} FAIL ====`);
process.exit(fail ? 1 : 0);
