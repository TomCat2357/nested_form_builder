// 出力（フォーム → Excel）の純ロジック検証（GAS API 不要）。
//   node scripts/test_fill.mjs
// payload（単票 record / 一覧 search）を手書き fixture で与え、パース・集計・法人/個人分岐・
// セル差分・番号生成を検証する（GAS I/O は対象外＝デプロイ後 E2E）。
import fs from "node:fs";
import vm from "node:vm";
import path from "node:path";
import { fileURLToPath } from "node:url";

const dir = path.dirname(fileURLToPath(import.meta.url));
const code = fs.readFileSync(path.join(dir, "..", "Combined.gs"), "utf8");
const sandbox = { module: { exports: {} }, console, Date, Math, JSON, RegExp, Number, String, Array, Object, isNaN, isFinite, parseInt, parseFloat };
vm.runInNewContext(code, sandbox);
const C = sandbox.module.exports;

let pass = 0, fail = 0;
const eq = (l, g, w) => { (JSON.stringify(g) === JSON.stringify(w)) ? pass++ : (fail++, console.log(`  FAIL ${l}: got=${JSON.stringify(g)} want=${JSON.stringify(w)}`)); };
const ok = (l, c, d) => { c ? pass++ : (fail++, console.log(`  FAIL ${l} ${d || ""}`)); };
const cellOf = (cells, a1) => { const f = cells.find((x) => x.a1 === a1); return f ? f.value : undefined; };

const SP = "捕獲等をする鳥獣又は採取等をする鳥類の卵の種類及び数量";
const M = "捕獲等又は採取等の方法（使用する捕獲用具の名称）"; // 閉じ括弧は全角（実フォーム・CHO2_L_W_METHOD_ と一致）

// ---- record items（統一フォーマット）を組む。子は "従事者情報/#<no>/<子質問>" でインライン ----
function w1Items(prefix) {
  return [
    [prefix + "氏名", "鈴木新之助"], [prefix + "住所", "小樽市"], [prefix + "職業", "無職"], [prefix + "生年月日", "1996-05-01"],
    [prefix + SP, "キジバト, キツネ"],
    [prefix + SP + "/キジバト/捕獲頭数", "2"], [prefix + SP + "/キジバト/採取卵数", "1"],
    [prefix + SP + "/キツネ/捕獲頭数", "7"],
    [prefix + M, "手捕り, 銃器"],
    [prefix + M + "/銃器/銃の種類", "空気銃"],
    [prefix + M + "/銃器/銃の種類/空気銃/所持許可/所持許可証番号", "01234567890"],
    [prefix + M + "/銃器/銃の種類/空気銃/所持許可/交付年月日", "2025-03-01"],
    [prefix + M + "/銃器/銃の種類/空気銃/狩猟免許", "第二種銃猟免許"],
    [prefix + M + "/銃器/銃の種類/空気銃/狩猟免許/第二種銃猟免許/都道府県", "北海道"],
    [prefix + M + "/銃器/銃の種類/空気銃/狩猟免許/第二種銃猟免許/番号", "石狩第1235号"],
    [prefix + M + "/銃器/銃の種類/空気銃/狩猟免許/第二種銃猟免許/交付年月日", "2025-03-01"],
  ];
}
function w2Items(prefix) {
  return [
    [prefix + "氏名", "田中聡"], [prefix + "住所", "札幌市"], [prefix + "職業", "公務員"], [prefix + "生年月日", "1996-05-08"],
    [prefix + SP, "キジバト, スズメ"],
    [prefix + SP + "/キジバト/捕獲頭数", "1"], [prefix + SP + "/キジバト/採取卵数", "1"],
    [prefix + SP + "/スズメ/捕獲頭数", "3"],
    [prefix + M, "わな"],
    [prefix + M + "/わな/道具の種類", "はこわな, くくりわな"],
    [prefix + M + "/わな/狩猟免許", "あり"],
    [prefix + M + "/わな/狩猟免許/あり/免許情報/都道府県", "北海道"],
    [prefix + M + "/わな/狩猟免許/あり/免許情報/番号", "石狩第1237号"],
    [prefix + M + "/わな/狩猟免許/あり/免許情報/交付年月日", "2025-03-03"],
    [prefix + M + "/わな/狩猟者登録/登録の有無", "あり"],
    [prefix + M + "/わな/狩猟者登録/登録の有無/あり/番号", "石狩第9999号"],
    [prefix + M + "/わな/狩猟者登録/登録の有無/あり/交付年月日", "2025-03-04"],
  ];
}
function parentItems(extra) {
  const base = [
    ["受付日", "2026-05-30"],
    ["捕獲等又は採取等の目的", "生活環境の被害防止"],
    ["捕獲等又は採取等の期間/開始", "2026-06-07"],
    ["捕獲等又は採取等の期間/終了", "2026-10-03"],
    ["捕獲等又は採取等の区域/所在地", "札幌市南区定山渓405"],
    ["捕獲等又は採取等をしたあとの処置", "埋設"],
    ["許可処分情報/処分の種類", "条件付き許可"],
    ["許可処分情報/処分の種類/条件付き許可/許可条件", "わなの見回り条件テスト"],
    ["許可処分情報/許可番号", "1-1"],
    ["許可処分情報/許可年月日", "2026-06-07"],
  ];
  return base.concat(extra);
}
function toItems(pairs) { return pairs.map(([question, value]) => ({ question, value, type: "text" })); }

// 統一フォーマット: 起動元に依らず records[].items（子は "従事者情報/#<No>/…" で常時インライン）。
const personItems = toItems(
  parentItems([
    ["申請者情報/個人・法人の別", "個人"],
    ["申請者情報/個人・法人の別/個人/氏名", "鈴木新之助"],
    ["申請者情報/個人・法人の別/個人/住所", "小樽市"],
    ["申請者情報/個人・法人の別/個人/生年月日", "1996-05-01"],
  ]).concat(w1Items("従事者情報/#1/")).concat(w2Items("従事者情報/#2/"))
);

const corpItems = toItems(
  parentItems([
    ["申請者情報/個人・法人の別", "法人"],
    ["申請者情報/個人・法人の別/法人/法人名", "株式会社ハンター協会"],
    ["申請者情報/個人・法人の別/法人/代表者名", "代表取締役　秋　はじめ"],
    ["申請者情報/個人・法人の別/法人/住所", "札幌市南区南４５条西３４丁目４－３"],
  ]).concat(w1Items("従事者情報/#1/")).concat(w2Items("従事者情報/#2/"))
);

// ---- パース（items → {parent, workers}）----
const pPerson = C.Cho2_parseRecordItems_(personItems);
eq("個人 workers数", pPerson.workers.length, 2);
eq("個人 worker0 氏名", pPerson.workers[0]["氏名"], "鈴木新之助");
eq("個人 worker1 氏名", pPerson.workers[1]["氏名"], "田中聡");
eq("個人 parent applicantType", C.Cho2_applicantType_(pPerson.parent), "個人");
eq("個人 parent 許可番号", pPerson.parent["許可処分情報/許可番号"], "1-1");

const pCorp = C.Cho2_parseRecordItems_(corpItems);
eq("法人 applicantType", C.Cho2_applicantType_(pCorp.parent), "法人");
eq("法人 法人名", pCorp.parent["申請者情報/個人・法人の別/法人/法人名"], "株式会社ハンター協会");

// ---- 種数集計 ----
const ws0 = C.Cho2_workerSpecies_(pPerson.workers[0]);
eq("worker0 キジバト count", ws0["キジバト"].count, 2);
eq("worker0 キジバト egg", ws0["キジバト"].egg, 1);
eq("worker0 キツネ count", ws0["キツネ"].count, 7);
eq("worker0 スズメ count", ws0["スズメ"].count, 0);
const agg = C.Cho2_aggregateSpecies_(pPerson.workers);
eq("agg キジバト count", agg["キジバト"].count, 3);
eq("agg キジバト egg", agg["キジバト"].egg, 2);
eq("agg スズメ count", agg["スズメ"].count, 3);
eq("agg キツネ count", agg["キツネ"].count, 7);

// ---- 用具平坦化・和集合（CHO2_TOOL_ORDER_ 順）----
eq("worker0 tools", C.Cho2_workerTools_(pPerson.workers[0]), ["手捕り", "空気銃"]);
eq("worker1 tools", C.Cho2_workerTools_(pPerson.workers[1]), ["くくりわな", "はこわな"]);
eq("union tools", C.Cho2_unionTools_(pPerson.workers), ["手捕り", "くくりわな", "はこわな", "空気銃"]);

// ---- 免許/登録/銃器（名簿 Q-Z 用）----
const lic0 = C.Cho2_toolLicense_(pPerson.workers[0], "空気銃");
eq("空気銃 licType", lic0.licType, "第二種銃猟");
eq("空気銃 licNo", lic0.licNo, "石狩第1235号");
eq("空気銃 gunNo", lic0.gunNo, "01234567890");
eq("空気銃 gunKind", lic0.gunKind, "空気銃");
const lic1 = C.Cho2_toolLicense_(pPerson.workers[1], "はこわな");
eq("はこわな kind", lic1.kind, "わな");
eq("はこわな licType(免許あり=空)", lic1.licType, ""); // 免許ありのとき Q列(種類)は空欄（記載例に合わせる）
eq("はこわな licNo", lic1.licNo, "石狩第1237号");     // 狩猟免許/あり/免許情報/番号
eq("はこわな regNo", lic1.regNo, "石狩第9999号");     // 狩猟者登録（免許と兄弟）

// わな 免許なし＋従事（補助）適任者証明書 → Q列に短縮値（choju_intake の逆）
const certWorker = C.Cho2_parseRecordItems_(toItems([
  ["従事者情報/#1/氏名", "証明太郎"],
  ["従事者情報/#1/" + M, "わな"],
  ["従事者情報/#1/" + M + "/わな/道具の種類", "はこわな"],
  ["従事者情報/#1/" + M + "/わな/狩猟免許", "なし"],
  ["従事者情報/#1/" + M + "/わな/狩猟免許/なし/免許不要の理由（小型のはこわな限定）", "従事（補助）適任者証明書（法人かつ他に免許者がいる場合に限る。）"],
])).workers[0];
const certLic = C.Cho2_toolLicense_(certWorker, "はこわな");
eq("わな 免許なし＋証明書 licType", certLic.licType, "従事（補助）適任者証明書");
eq("わな 免許なし licNo空", certLic.licNo, "");

// 網 免許あり＋登録（登録は 狩猟免許/あり 配下）
const netWorker = C.Cho2_parseRecordItems_(toItems([
  ["従事者情報/#1/氏名", "網次郎"],
  ["従事者情報/#1/" + M, "網"],
  ["従事者情報/#1/" + M + "/網/道具の種類", "つき網"],
  ["従事者情報/#1/" + M + "/網/狩猟免許", "あり"],
  ["従事者情報/#1/" + M + "/網/狩猟免許/あり/免許情報/都道府県", "北海道"],
  ["従事者情報/#1/" + M + "/網/狩猟免許/あり/免許情報/番号", "石狩第2222号"],
  ["従事者情報/#1/" + M + "/網/狩猟免許/あり/免許情報/交付年月日", "2025-04-01"],
  ["従事者情報/#1/" + M + "/網/狩猟免許/あり/狩猟者登録/登録の有無", "あり"],
  ["従事者情報/#1/" + M + "/網/狩猟免許/あり/狩猟者登録/登録の有無/あり/番号", "石狩登3333号"],
])).workers[0];
const netLic = C.Cho2_toolLicense_(netWorker, "つき網");
eq("網 licType(免許あり=空)", netLic.licType, "");
eq("網 licPref", netLic.licPref, "北海道");
eq("網 licNo", netLic.licNo, "石狩第2222号");
eq("網 regNo(狩猟免許/あり配下)", netLic.regNo, "石狩登3333号");

// ---- 番号生成 ----
eq("permitNo", C.Cho2_permitNo_("1-1", 1), "第1-1-1号");
eq("certNoRaw", C.Cho2_certNoRaw_("1-1", 1), "1-1-1");
eq("certNoRaw 空", C.Cho2_certNoRaw_("", 1), "");
eq("kyokaBangoMark", C.Cho2_kyokaBangoMark_("1-1"), "第1-1号");
eq("docNo", C.Cho2_docNo_("1-1"), "札環対許可第1-1号");
eq("permitNoRange", C.Cho2_permitNoRange_("1-1", 2), "(許可証番号　第1-1-1号～第1-1-2号)");
eq("permitNo 空", C.Cho2_permitNo_("", 1), "");

// ---- 種数グリッド差分 ----
const grid = C.Cho2_gridCells_(C.CHO2_GRID_KYOKASHO_, agg);
eq("grid キジバト name G17", cellOf(grid, "G17"), "キジバト");
eq("grid キジバト count H17", cellOf(grid, "H17"), 3);
eq("grid キジバト 卵 J17", cellOf(grid, "J17"), "卵");
eq("grid キジバト egg K17", cellOf(grid, "K17"), 2);
eq("grid キツネ name G23", cellOf(grid, "G23"), "キツネ");
eq("grid キツネ count H23", cellOf(grid, "H23"), 7);
ok("grid スズメ name C19無し（許可証はG列）", cellOf(grid, "C19") === undefined, "");
// スズメ off2 → 行 19
eq("grid スズメ name G19", cellOf(grid, "G19"), "スズメ");
eq("grid スズメ count H19", cellOf(grid, "H19"), 3);

// ---- buildPlan: 個人 = 許可証N・従事者証0 ----
const planP = C.Cho2_buildPlan_(pPerson, "");
eq("個人 plan type", planP.type, "個人");
eq("個人 許可証 枚数", planP.kyokasho.length, 2);
eq("個人 従事者証 枚数", planP.juji.length, 0);
eq("個人 許可証0 label", planP.kyokasho[0].label, "鈴木新之助");
// 個人 許可証0 = その人自身の頭数（キツネ7）
eq("個人 許可証0 キツネ count", cellOf(planP.kyokasho[0].cells, "H23"), 7);
eq("個人 許可証0 番号C3", cellOf(planP.kyokasho[0].cells, "C3"), "1-1-1");
eq("個人 許可証0 氏名G13", cellOf(planP.kyokasho[0].cells, "G13"), "鈴木新之助");
eq("個人 許可証0 住所G12", cellOf(planP.kyokasho[0].cells, "G12"), "小樽市");
eq("個人 許可証0 方法G30", cellOf(planP.kyokasho[0].cells, "G30"), "手捕り,空気銃");
// 個人 許可証1（田中）はキジバト1・スズメ3
eq("個人 許可証1 スズメ count", cellOf(planP.kyokasho[1].cells, "H19"), 3);
eq("個人 許可証1 番号C3", cellOf(planP.kyokasho[1].cells, "C3"), "1-1-2");
// 通知（全員合計・個人=先頭従事者名 + 許可証番号範囲 + 他N名）
eq("個人 通知 住所C12", cellOf(planP.shinko, "C12"), "小樽市");
eq("個人 通知 氏名C13", cellOf(planP.shinko, "C13"), "鈴木新之助");
eq("個人 通知 番号C14", cellOf(planP.shinko, "C14"), "1-1-1");
eq("個人 通知 範囲D14", cellOf(planP.shinko, "D14"), "～");
eq("個人 通知 範囲E14", cellOf(planP.shinko, "E14"), "1-1-2");
eq("個人 通知 他N名G14", cellOf(planP.shinko, "G14"), 1); // workers.length - 1（セル書式 他#名）
eq("個人 通知 キツネ count D23", cellOf(planP.shinko, "D23"), 7); // 通知 grid base17・off6=行23
eq("個人 通知 許可番号F2", cellOf(planP.shinko, "F2"), "1-1");          // 札環対許可第 @ 号 はセル書式が付与
eq("個人 通知 許可年月日F3", cellOf(planP.shinko, "F3"), "令和8年6月7日"); // 2026-06-07 → 和暦文字列
eq("個人 通知 許可条件C34", cellOf(planP.shinko, "C34"), "わなの見回り条件テスト"); // 3通知に許可条件欄を追加
eq("個人 名簿 枚数(2名=1枚)", planP.roster.length, 1);
eq("個人 名簿 E5 番号(raw)", cellOf(planP.roster[0].cells, "E5"), "1-1-1");
eq("個人 名簿 E14 番号(raw)", cellOf(planP.roster[0].cells, "E14"), "1-1-2");

// ---- 交付通知書（記欄が +1 行シフト・F2/F3 不動・宛名 B4・B9 トークン置換）----
eq("個人 交付 許可番号F2(不動)", cellOf(planP.kofu, "F2"), "1-1");
eq("個人 交付 許可年月日F3(不動)", cellOf(planP.kofu, "F3"), "令和8年6月7日");
eq("個人 交付 宛名B4", cellOf(planP.kofu, "B4"), "鈴木新之助"); // 被許可者宛て（個人=氏名）
eq("個人 交付 住所C13(+1)", cellOf(planP.kofu, "C13"), "小樽市");
eq("個人 交付 氏名C14(+1)", cellOf(planP.kofu, "C14"), "鈴木新之助");
eq("個人 交付 番号C15(+1)", cellOf(planP.kofu, "C15"), "1-1-1");
eq("個人 交付 範囲D15(+1)", cellOf(planP.kofu, "D15"), "～");
eq("個人 交付 範囲E15(+1)", cellOf(planP.kofu, "E15"), "1-1-2");
eq("個人 交付 他N名G15(+1)", cellOf(planP.kofu, "G15"), 1);
eq("個人 交付 キツネ count D24(base18)", cellOf(planP.kofu, "D24"), 7); // 振興局 D23 の +1
eq("個人 交付 許可条件C35(+1)", cellOf(planP.kofu, "C35"), "わなの見回り条件テスト");
eq("個人 交付 B9トークン a1", planP.kofuTokens[0].a1, "B9");
eq("個人 交付 B9トークン 値(受付日和暦)", planP.kofuTokens[0].value, "令和8年5月30日");

// ---- buildPlan: 法人 = 許可証1・従事者証N（ともに全員合計）----
const planC = C.Cho2_buildPlan_(pCorp, "");
eq("法人 plan type", planC.type, "法人");
eq("法人 許可証 枚数", planC.kyokasho.length, 1);
eq("法人 従事者証 枚数", planC.juji.length, 2);
eq("法人 許可証0 番号C3", cellOf(planC.kyokasho[0].cells, "C3"), "1-1"); // 法人は base
eq("法人 許可証0 法人名G13", cellOf(planC.kyokasho[0].cells, "G13"), "株式会社ハンター協会");
eq("法人 許可証0 代表者G14", cellOf(planC.kyokasho[0].cells, "G14"), "代表取締役　秋　はじめ");
// 法人 許可証 = 全員合計（キツネ7・スズメ3・キジバト3）
eq("法人 許可証0 キツネ合計H23", cellOf(planC.kyokasho[0].cells, "H23"), 7);
eq("法人 許可証0 スズメ合計H19", cellOf(planC.kyokasho[0].cells, "H19"), 3);
// 従事者証: 種数=全員合計、方法=その従事者分、法人名・氏名
eq("法人 従事者証0 法人名K16", cellOf(planC.juji[0].cells, "K16"), "株式会社ハンター協会");
eq("法人 従事者証0 氏名D23", cellOf(planC.juji[0].cells, "D23"), "鈴木新之助");
eq("法人 従事者証0 許可番号K14", cellOf(planC.juji[0].cells, "K14"), "1-1");
eq("法人 従事者証0 従事者証番号C4", cellOf(planC.juji[0].cells, "C4"), "1-1-1"); // 素・セル書式 第@号
eq("法人 従事者証0 キツネ合計L24", cellOf(planC.juji[0].cells, "L24"), 7); // 従事者証 grid base18 off6=行24、count列L
eq("法人 従事者証0 方法K31", cellOf(planC.juji[0].cells, "K31"), "手捕り,空気銃"); // worker0 の方法
eq("法人 通知 氏名C13", cellOf(planC.shinko, "C13"), "株式会社ハンター協会　代表取締役　秋　はじめ");
eq("法人 通知 住所C12", cellOf(planC.shinko, "C12"), "札幌市南区南４５条西３４丁目４－３");
eq("法人 通知 許可番号C14", cellOf(planC.shinko, "C14"), "1-1");
eq("法人 通知 別紙C15", cellOf(planC.shinko, "C15"), "別紙のとおり");
eq("法人 通知 許可条件C34", cellOf(planC.shinko, "C34"), "わなの見回り条件テスト");
// 交付通知書（法人＝振興局と同じ法人表記の +1・宛名 B3/B4）
eq("法人 交付 宛名B3(法人名)", cellOf(planC.kofu, "B3"), "株式会社ハンター協会");
eq("法人 交付 宛名B4(代表者)", cellOf(planC.kofu, "B4"), "代表取締役　秋　はじめ");
eq("法人 交付 住所C13(+1)", cellOf(planC.kofu, "C13"), "札幌市南区南４５条西３４丁目４－３");
eq("法人 交付 氏名C14(+1)", cellOf(planC.kofu, "C14"), "株式会社ハンター協会　代表取締役　秋　はじめ");
eq("法人 交付 許可番号C15(+1)", cellOf(planC.kofu, "C15"), "1-1");
eq("法人 交付 別紙C16(+1)", cellOf(planC.kofu, "C16"), "別紙のとおり");
eq("法人 交付 許可条件C35(+1)", cellOf(planC.kofu, "C35"), "わなの見回り条件テスト");

// ---- 従事者名簿ブロック ----
const block0 = C.Cho2_rosterBlockCells_(pPerson.workers[0], 5, "1-1-1");
eq("名簿 E5 許可証番号", cellOf(block0, "E5"), "1-1-1");
eq("名簿 G5 氏名", cellOf(block0, "G5"), "鈴木新之助");
eq("名簿 F5 住所", cellOf(block0, "F5"), "小樽市");
eq("名簿 H5 職業", cellOf(block0, "H5"), "無職");
eq("名簿 J5 キジバト", cellOf(block0, "J5"), "キジバト");
eq("名簿 K5 頭数", cellOf(block0, "K5"), 2);
eq("名簿 M5 卵", cellOf(block0, "M5"), "卵");
eq("名簿 N5 卵数", cellOf(block0, "N5"), 1);
// キツネ off6 → 行11 J列
eq("名簿 J11 キツネ", cellOf(block0, "J11"), "キツネ");
eq("名簿 K11 頭数", cellOf(block0, "K11"), 7);
// 方法: P5=手捕り（用具0）, P6=空気銃（用具1）+ 銃器列
eq("名簿 P5 手捕り", cellOf(block0, "P5"), "手捕り");
eq("名簿 P6 空気銃", cellOf(block0, "P6"), "空気銃");
eq("名簿 Q6 免許種類", cellOf(block0, "Q6"), "第二種銃猟");
eq("名簿 S6 免許番号", cellOf(block0, "S6"), "石狩第1235号");
eq("名簿 X6 所持許可番号", cellOf(block0, "X6"), "01234567890");
eq("名簿 Z6 鉄砲種類", cellOf(block0, "Z6"), "空気銃");

// 名簿 worker1（田中・わな2種）: P5=くくりわな, P6=はこわな, S列=免許番号, V列=登録番号
const block1 = C.Cho2_rosterBlockCells_(pPerson.workers[1], 14, "1-1-2");
eq("名簿2 P14 くくりわな", cellOf(block1, "P14"), "くくりわな");
ok("名簿2 Q14 免許種類は空(免許あり)", cellOf(block1, "Q14") === undefined, ""); // 旧「わな猟免許」補完は撤去
eq("名簿2 P15 はこわな", cellOf(block1, "P15"), "はこわな");
eq("名簿2 S14 免許番号", cellOf(block1, "S14"), "石狩第1237号");
eq("名簿2 V14 登録番号", cellOf(block1, "V14"), "石狩第9999号");

// ---- 従事者名簿: 個人＝各自の種数・集計注記なし ----
const rosterP = planP.roster[0].cells;
eq("個人名簿 先頭 キジバトK5(各自)", cellOf(rosterP, "K5"), 2);
eq("個人名簿 先頭 キツネK11(各自)", cellOf(rosterP, "K11"), 7);
ok("個人名簿 集計注記なしM13", cellOf(rosterP, "M13") === undefined, "");
eq("個人名簿 2人目 キジバトK14(各自)", cellOf(rosterP, "K14"), 1);

// ---- 従事者名簿: 法人＝先頭ブロックに全員合計＋注記、2 人目以降は種数なし ----
const rosterC = planC.roster[0].cells;
eq("法人名簿 先頭 キジバト合計K5", cellOf(rosterC, "K5"), 3);
eq("法人名簿 先頭 卵合計N5", cellOf(rosterC, "N5"), 2);
eq("法人名簿 先頭 スズメ合計K7", cellOf(rosterC, "K7"), 3);
eq("法人名簿 先頭 キツネ合計K11", cellOf(rosterC, "K11"), 7);
eq("法人名簿 先頭 集計注記M13", cellOf(rosterC, "M13"), "※法人全体の数量");
ok("法人名簿 2人目 種数なしJ14", cellOf(rosterC, "J14") === undefined, "");
ok("法人名簿 2人目 種数なしK14", cellOf(rosterC, "K14") === undefined, "");
eq("法人名簿 2人目 氏名G14(各自)", cellOf(rosterC, "G14"), "田中聡");
eq("法人名簿 2人目 用具P14(各自)", cellOf(rosterC, "P14"), "くくりわな");

// ---- 従事者名簿: 9 名以上は 8 名/シートに分割（許可証番号はシートをまたいで通し）----
const manyPairs = [];
for (let i = 1; i <= 9; i++) manyPairs.push(...((i % 2) ? w1Items : w2Items)(`従事者情報/#${i}/`));
const nineItems = toItems(
  parentItems([
    ["申請者情報/個人・法人の別", "個人"],
    ["申請者情報/個人・法人の別/個人/氏名", "鈴木新之助"],
    ["申請者情報/個人・法人の別/個人/住所", "小樽市"],
    ["申請者情報/個人・法人の別/個人/生年月日", "1996-05-01"],
  ]).concat(manyPairs)
);
const pNine = C.Cho2_parseRecordItems_(nineItems);
eq("9名 workers数", pNine.workers.length, 9);
const planN = C.Cho2_buildPlan_(pNine, "");
eq("9名 名簿 枚数(9名=2枚)", planN.roster.length, 2);
eq("9名 名簿1 label", planN.roster[0].label, "1");
eq("9名 名簿2 label", planN.roster[1].label, "2");
// 1 枚目 = 8 名（行 5,14,…,68 = 番号 1-1-1〜1-1-8）
eq("9名 名簿1 E5 番号(1人目)", cellOf(planN.roster[0].cells, "E5"), "1-1-1");
eq("9名 名簿1 E68 番号(8人目)", cellOf(planN.roster[0].cells, "E68"), "1-1-8");
ok("9名 名簿1 は8名まで(E77無し)", cellOf(planN.roster[0].cells, "E77") === undefined, "");
// 2 枚目 = 9 人目が行 5 に載り、番号はシートをまたいで通し "1-1-9"
eq("9名 名簿2 E5 番号(9人目・通し)", cellOf(planN.roster[1].cells, "E5"), "1-1-9");
ok("9名 名簿2 は1名のみ(E14無し)", cellOf(planN.roster[1].cells, "E14") === undefined, "");

// ---- 統一フォーマット payload（編集画面・検索一覧の単一/複数選択すべて records[]）----
// 検索一覧の複数選択でも各行は records[] の 1 件として届き、子は items にインライン展開される。
const multiData = {
  recordCount: 2,
  records: [
    { id: "r1", no: 1, items: personItems },
    { id: "r2", no: 2, items: corpItems },
  ],
};
const apps = C.Cho2_parseApplications_(multiData);
eq("apps数（recordCount分）", apps.length, 2);
eq("apps0 workers数", apps[0].workers.length, 2);
eq("apps0 worker0 氏名", apps[0].workers[0]["氏名"], "鈴木新之助");
eq("apps0 applicantType", C.Cho2_applicantType_(apps[0].parent), "個人");
eq("apps1 applicantType", C.Cho2_applicantType_(apps[1].parent), "法人");
const corpPlan = C.Cho2_buildPlan_(apps[1], "");
eq("法人 従事者証枚数", corpPlan.juji.length, 2);

// ---- extractFileId / dateParts / hmac ----
eq("fileId from /d/ url", C.Cho2_extractFileId_("https://drive.google.com/file/d/1AbCdEfGhIjKlMnOpQrStUvWxYz012345/view?usp=sharing"), "1AbCdEfGhIjKlMnOpQrStUvWxYz012345");
eq("fileId from ?id=", C.Cho2_extractFileId_("https://drive.google.com/open?id=1AbCdEfGhIjKlMnOpQrStUvWxYz012345"), "1AbCdEfGhIjKlMnOpQrStUvWxYz012345");
eq("fileId bare", C.Cho2_extractFileId_("1AbCdEfGhIjKlMnOpQrStUvWxYz012345"), "1AbCdEfGhIjKlMnOpQrStUvWxYz012345");
eq("fileId 空", C.Cho2_extractFileId_(""), "");
eq("dateParts", C.Cho2_dateParts_("2026-06-07"), { y: 2026, m: 6, d: 7 });
eq("dateParts slash", C.Cho2_dateParts_("2026/6/7"), { y: 2026, m: 6, d: 7 });
eq("dateParts 不可", C.Cho2_dateParts_("令和8年"), null);
// 注: Cho2_hmacHex_ は GAS Utilities 依存のため node では検証しない（本体 ExtAction_hmacHex_ と同形・コード一致で担保）。

// ---- 日付セル差分は和暦文字列（元年表記・数値書式に依存しない）----
eq("名簿 I5 生年月日(和暦)", cellOf(block0, "I5"), "平成8年5月1日"); // 1996-05-01 → 和暦文字列
eq("和暦 令和元年", C.Cho2_warekiString_({ y: 2019, m: 5, d: 1 }), "令和元年5月1日");   // 改元日
eq("和暦 令和(改元前日=平成)", C.Cho2_warekiString_({ y: 2019, m: 4, d: 30 }), "平成31年4月30日");
eq("和暦 令和8年", C.Cho2_warekiString_({ y: 2026, m: 6, d: 1 }), "令和8年6月1日");
eq("和暦 平成元年", C.Cho2_warekiString_({ y: 1989, m: 1, d: 8 }), "平成元年1月8日");   // 改元日
eq("和暦 昭和元年", C.Cho2_warekiString_({ y: 1926, m: 12, d: 25 }), "昭和元年12月25日"); // 改元日
eq("和暦 昭和50年", C.Cho2_warekiString_({ y: 1975, m: 1, d: 1 }), "昭和50年1月1日");
eq("和暦 大正元年", C.Cho2_warekiString_({ y: 1912, m: 7, d: 30 }), "大正元年7月30日");   // 改元日
eq("和暦 明治改元前→西暦", C.Cho2_warekiString_({ y: 1860, m: 1, d: 1 }), "1860年1月1日");
eq("和暦 null→空", C.Cho2_warekiString_(null), "");

// ---- 出力先フォルダ（folderUrl）の収集・先頭採用・URL解釈・未指定エラー ----
const FID = "1AbCdEfGhIjKlMnOpQrStUvWxYz012345";
const FURL = "https://drive.google.com/drive/folders/" + FID;
const withFolder = personItems.concat([{ question: "ファイル", value: "申請書.pdf", type: "fileUpload", folderUrl: FURL }]);
eq("folderUrl 収集", C.Cho2_parseApplications_({ records: [{ id: "r1", no: 1, items: withFolder }] })[0].folderUrl, FURL);
eq("folderUrl 無し→空", C.Cho2_parseApplications_({ records: [{ id: "r1", no: 1, items: personItems }] })[0].folderUrl, "");
const twoFolders = [
  { question: "ファイルA", value: "a", type: "fileUpload", folderUrl: FURL },
  { question: "ファイルB", value: "b", type: "fileUpload", folderUrl: "https://drive.google.com/drive/folders/2zzzzzzzzzzzzzzzzzzzzzzz" },
];
eq("folderUrl 複数→先頭", C.Cho2_parseApplications_({ records: [{ id: "r1", no: 1, items: twoFolders }] })[0].folderUrl, FURL);
eq("extractFolderId /folders/", C.Cho2_extractFolderId_(FURL), FID);
eq("extractFolderId ?id=", C.Cho2_extractFolderId_("https://drive.google.com/open?id=" + FID), FID);
eq("extractFolderId 裸ID", C.Cho2_extractFolderId_(FID), FID);
eq("extractFolderId 不正→空", C.Cho2_extractFolderId_("https://example.com/x"), "");
eq("extractFolderId 空→空", C.Cho2_extractFolderId_(""), "");
ok("resolveRecordFolder 空→throw", (function () { try { C.Cho2_resolveRecordFolder_(""); return false; } catch (e) { return true; } })(), "");

// ---- 一括PDF 出力エンジンの純関数（print_kyokasyo から移植） ----
eq("printFormNameOf 様式_接尾→様式", C.Cho2_printFormNameOf_("許可証_1"), "許可証");
eq("printFormNameOf _なし→そのまま", C.Cho2_printFormNameOf_("従事者名簿"), "従事者名簿");
eq("printFormNameOf 先頭_のみ切る", C.Cho2_printFormNameOf_("従事者証_2_控"), "従事者証");
eq("printSanitize 禁止文字→_", C.Cho2_printSanitize_('a/b:c*?"<>|d'), "a_b_c______d");
eq("toBands 改ページ無し→全域", C.Cho2_toBands_([], 10), [[1, 10]]);
eq("toBands 改ページ2本", C.Cho2_toBands_([3, 7], 10), [[1, 3], [4, 7], [8, 10]]);
eq("toBands last 超は無視", C.Cho2_toBands_([3, 15], 10), [[1, 3], [4, 10]]);
eq("buildNote 失敗+空", C.Cho2_buildNote_(["A"], ["B", "C"]), "ダウンロード失敗: A ／ 空のため未出力: B, C");
eq("buildNote 空配列→空文字", C.Cho2_buildNote_([], []), "");
const _pu = C.Cho2_buildPageExportUrl_("SSX", 123, { r1: 0, c1: 0, r2: 10, c2: 5 },
  { size: "A4", orientation: "landscape", scaleMode: "fit", fitToWidth: true,
    margins: { top: 0.4, bottom: 0.4, left: 0.7, right: 0.7 }, horizontalCentered: true, gridlines: false });
ok("exportUrl ベース", _pu.indexOf("https://docs.google.com/spreadsheets/d/SSX/export?") === 0, _pu);
ok("exportUrl format=pdf", _pu.indexOf("format=pdf") >= 0, _pu);
ok("exportUrl gid", _pu.indexOf("gid=123") >= 0, _pu);
ok("exportUrl landscape→portrait=false", _pu.indexOf("portrait=false") >= 0, _pu);
ok("exportUrl fit+fitToWidth→fitw=true", _pu.indexOf("fitw=true") >= 0, _pu);
ok("exportUrl 中央寄せ", _pu.indexOf("horizontal_alignment=CENTER") >= 0, _pu);
ok("exportUrl 余白", _pu.indexOf("top_margin=0.4") >= 0, _pu);
ok("exportUrl 範囲", _pu.indexOf("r1=0") >= 0 && _pu.indexOf("c2=5") >= 0, _pu);
const _pu2 = C.Cho2_buildPageExportUrl_("SSX", 5, { r1: 0, c1: 0, r2: 3, c2: 3 },
  { size: "A4", orientation: "portrait", scaleMode: "actual", fitToWidth: false, margins: {}, horizontalCentered: false, gridlines: false });
ok("exportUrl portrait→portrait=true", _pu2.indexOf("portrait=true") >= 0, _pu2);
ok("exportUrl 等倍は fitw 無し", _pu2.indexOf("fitw=") < 0, _pu2);

console.log(`\n==== ${pass} PASS / ${fail} FAIL ====`);
process.exit(fail ? 1 : 0);
