// 苦情 PDF 振り分けの純ロジック検証（GAS / 外部 API 不要）。
//   node scripts/test_mapping.mjs
// Combined.gs を vm で読み込み module.exports の純関数を呼ぶ。
//   - 様式判定 / ラベル抽出は scripts/fixtures/*.txt（ブラウザ pdf.js が出力する「生テキスト」を再現したもの）を入力にする。
//   - PropertiesService は sandbox に無いので KUJ_FORM_ID_ は ""。String.normalize 等は vm の intrinsics を使う。
import fs from "node:fs";
import vm from "node:vm";
import path from "node:path";
import { fileURLToPath } from "node:url";

const dir = path.dirname(fileURLToPath(import.meta.url));
const code = fs.readFileSync(path.join(dir, "..", "Combined.gs"), "utf8");
const sandbox = { module: { exports: {} }, console, Date, Math, JSON, RegExp, Number, String, Array, Object, isNaN, isFinite };
vm.runInNewContext(code, sandbox);
const C = sandbox.module.exports;
const fix = (name) => fs.readFileSync(path.join(dir, "fixtures", name), "utf8");

let pass = 0, fail = 0;
const eq = (l, g, w) => { (JSON.stringify(g) === JSON.stringify(w)) ? pass++ : (fail++, console.log(`  FAIL ${l}: got=${JSON.stringify(g)} want=${JSON.stringify(w)}`)); };
const ok = (l, c, d) => { c ? pass++ : (fail++, console.log(`  FAIL ${l} ${d || ""}`)); };
const data = (cand) => C.Kuj_candidateToData_(cand).data;

// ===== mapper / codec / date / uploadRecords（既存カバレッジ） =====

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

// ===== 部首正規化 / 様式判定 / ラベル抽出（pdf.js 版で追加） =====

// 11. Kangxi/CJK 部首コードポイントを通常漢字へ（全角記号は保つ）
eq("11 部首 氏(U+2F52)→氏", C.Kuj_normalizeText_("⽒名"), "氏名");
eq("11 部首 長(U+2FA7)→長", C.Kuj_normalizeText_("部⾧"), "部長");
eq("11 全角！は保つ", C.Kuj_normalizeText_("だめ！"), "だめ！");

// 12. 様式判定
eq("12 detect ホームページ", C.Kuj_detectLayout_("問い合わせ日:2026/06/26\nメールアドレス a@b.c"), "ホームページ");
eq("12 detect 市政相談対応票", C.Kuj_detectLayout_("市政提案\n00-12-2264令和8年6月23日"), "市政相談対応票");
eq("12 detect 不明", C.Kuj_detectLayout_("ただのメモ"), "");

// 13. ラベル走査（折返しを "" 連結で戻す・全角コロン対応）
const sc = C.Kuj_scanLabels_("件名 アンケートのお願\nい です\n内容：本文", ["件名", "内容"]);
eq("13 scan 件名 折返し連結", sc["件名"], "アンケートのお願い です");
eq("13 scan 内容 全角コロン", sc["内容"], "本文");

// 14. 様式A 抽出（fixture: 市政相談対応票）
const candA = C.Kuj_textToCandidate_(fix("shisei_taiouhyou.txt"));
eq("14 様式A layout", candA._layout, "市政相談対応票");
eq("14 様式A 方法", candA.toiawaseHoho, "市政相談対応票");
eq("14 様式A 受付日(raw)", candA.ukeotsukeDate, "令和8年6月23日");
eq("14 様式A 問合せ元", candA.toiawaseMoto, "匿名");
eq("14 様式A 備考", candA.bikou, "受付番号 00-12-2264");
ok("14 様式A 相談詳細にカラス本文", /サイクリングロード/.test(candA.soudanShosai) && /威嚇/.test(candA.soudanShosai), candA.soudanShosai);
ok("14 様式A 相談詳細に部首残らない", !/[⺀-⻿⼀-⿟]/.test(candA.soudanShosai));

// 15. 様式A → data（受付日 canonical・問合せ方法・相談詳細）
const upA = C.Kuj_buildUploadRecords_([candA]);
const dataA = upA.parent.uploadRecords[0].data;
eq("15 様式A 受付日 canonical", dataA["受付日"], "2026-06-23");
eq("15 様式A 問合せ方法 data", dataA["問合せ方法"], "市政相談対応票");
eq("15 様式A 問合せ元 data", dataA["問合せ元"], "匿名");
eq("15 様式A 備考 data", dataA["備考"], "受付番号 00-12-2264");
ok("15 様式A 相談大分類は自動で入らない", !("相談大分類" in dataA), JSON.stringify(Object.keys(dataA)));

// 16. 様式B 抽出（fixture: ホームページ問い合わせ）
const candB = C.Kuj_textToCandidate_(fix("homepage_toiawase.txt"));
eq("16 様式B layout", candB._layout, "ホームページ");
eq("16 様式B 方法", candB.toiawaseHoho, "ホームページ");
eq("16 様式B 問合せ元", candB.toiawaseMoto, "古賀達也");
eq("16 様式B 連絡先", candB.toiawaseMotoRenraku, "koga_tatsuya760@ffpri.go.jp, 茨城県つくば市松の里1");
ok("16 様式B 件名が相談詳細に", /鳥獣行政に関するアンケート/.test(candB.soudanShosai), candB.soudanShosai.slice(0, 80));
ok("16 様式B 内容が相談詳細に", /森林総合研究所/.test(candB.soudanShosai) && /拝啓/.test(candB.soudanShosai));
ok("16 様式B 印刷フッター除外", !/print\.php/.test(candB.soudanShosai));
ok("16 様式B 部首残らない", !/[⺀-⻿⼀-⿟]/.test(candB.soudanShosai));

// 17. 様式B → data（受付日 canonical・連絡先）
const upB = C.Kuj_buildUploadRecords_([candB]);
const dataB = upB.parent.uploadRecords[0].data;
eq("17 様式B 受付日 canonical", dataB["受付日"], "2026-06-26");
eq("17 様式B 問合せ方法 data", dataB["問合せ方法"], "ホームページ");
eq("17 様式B 連絡先 data", dataB["問合せ元　連絡先"], "koga_tatsuya760@ffpri.go.jp, 茨城県つくば市松の里1");

// 18. parseTextToRecords（テキスト→records の一気通貫・1PDF=1候補）
const built = C.Kuj_parseTextToRecords_(fix("shisei_taiouhyou.txt"), "カラス.pdf");
ok("18 parseTextToRecords ok", built.ok === true);
eq("18 records 件数", built.parent.uploadRecords.length, 1);
eq("18 受付日", built.parent.uploadRecords[0].data["受付日"], "2026-06-23");

// 19. Drive ID 抽出
eq("19 drive /file/d/", C.Kuj_extractDriveId_("https://drive.google.com/file/d/1AbcdefghijklmnopqrstuVWXYZ012345/view"), "1AbcdefghijklmnopqrstuVWXYZ012345");
eq("19 drive ?id=", C.Kuj_extractDriveId_("https://drive.google.com/open?id=1AbcdefghijklmnopqrstuVWXYZ012345"), "1AbcdefghijklmnopqrstuVWXYZ012345");
eq("19 素のID", C.Kuj_extractDriveId_("1AbcdefghijklmnopqrstuVWXYZ012345"), "1AbcdefghijklmnopqrstuVWXYZ012345");
eq("19 非Drive URLは空", C.Kuj_extractDriveId_("https://example.com/a.pdf"), "");

// 20. 様式不明は全文を相談詳細へ（人手）
const candU = C.Kuj_textToCandidate_("これはただのメモです。分類できない文章。");
eq("20 不明 layout", candU._layout, "不明");
ok("20 不明 相談詳細に全文", /ただのメモ/.test(candU.soudanShosai));
ok("20 不明 方法は空", !candU.toiawaseHoho);

// ===== CSV（お問い合わせフォーム）取り込み（CSV 版で追加） =====

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

// 28. 重複取り込み防止（現在の振分先〜内容が一致なら、ステータス/問い合わせ日/返信者が違っても同一）
const HDR = "ステータス,問い合わせ日,返信者,現在の振分先,問い合わせ件名,メールアドレス,氏名,ふりがな,年齢,職業,住所,郵便番号,電話番号,件名,内容\n";
const ROW = (st, dt, resp, subj, body) => `${st},${dt},${resp},環境共生,${subj},a@b.c,山田,やまだ,40代,会社員,中央区,060-0001,011-0,${subj},${body}\n`;
const dupCsv = HDR + ROW("未返信", "2026/6/27 12:46", "", "カラス", "威嚇された")
  + ROW("返信済", "2026/6/28 9:00", "担当A", "カラス", "威嚇された")   // 上と内容同一（状態/日付/返信者のみ差）→ 重複
  + ROW("未返信", "2026/6/29 0:00", "", "ハト", "糞害");               // 件名/内容が違う → 別物
const dupParsed = C.Kuj_csvToCandidates_(dupCsv);
eq("28 重複除外後の候補数", dupParsed.candidates.length, 2);
eq("28 重複検出数", dupParsed.duplicates, 1);
eq("28 残った1件目=カラス", dupParsed.candidates[0].soudanShosai, "カラス\n威嚇された");
eq("28 残った2件目=ハト", dupParsed.candidates[1].soudanShosai, "ハト\n糞害");
// dedupKey は内容一致で同一・別内容で別（ブラウザのファイル横断重複排除が依存する契約）
const k1 = C.Kuj_csvRowToCandidate_(C.Kuj_csvHeaderIndex_(C.Kuj_parseCsv_(HDR)[0]), C.Kuj_parseCsv_(ROW("未返信", "2026/6/27 12:46", "", "カラス", "威嚇された"))[0])._dedupKey;
const k2 = C.Kuj_csvRowToCandidate_(C.Kuj_csvHeaderIndex_(C.Kuj_parseCsv_(HDR)[0]), C.Kuj_parseCsv_(ROW("返信済", "2026/6/28 9:00", "担当A", "カラス", "威嚇された"))[0])._dedupKey;
const k3 = C.Kuj_csvRowToCandidate_(C.Kuj_csvHeaderIndex_(C.Kuj_parseCsv_(HDR)[0]), C.Kuj_parseCsv_(ROW("未返信", "2026/6/29 0:00", "", "ハト", "糞害"))[0])._dedupKey;
ok("28 dedupKey 内容一致で同一", k1 === k2, `${k1} vs ${k2}`);
ok("28 dedupKey 別内容で別", k1 !== k3);
// dedupKey は preview に乗る（ブラウザ finish() がファイル横断重複排除に使う）
ok("28 preview に dedupKey", typeof C.Kuj_buildUploadRecords_(dupParsed.candidates).preview[0].dedupKey === "string" && C.Kuj_buildUploadRecords_(dupParsed.candidates).preview[0].dedupKey.length > 0);

console.log(`\n==== ${pass} PASS / ${fail} FAIL ====`);
process.exit(fail ? 1 : 0);
