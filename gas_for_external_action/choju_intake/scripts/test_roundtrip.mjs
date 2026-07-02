// 取り込みの純ロジック検証（GAS API 不要）。
//   node scripts/test_roundtrip.mjs
// 事前に fixtures が無ければ python scripts/dump_fixtures.py を自動実行する。
import fs from "node:fs";
import vm from "node:vm";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const dir = path.dirname(fileURLToPath(import.meta.url));
const fixturesPath = path.join(dir, "out", "fixtures.json");
if (!fs.existsSync(fixturesPath)) {
  execFileSync("python", [path.join(dir, "dump_fixtures.py")], { stdio: "inherit" });
}

// Combined.gs を vm で読み込み module.exports を取り出す（pure 関数のみ呼ぶ）。
const code = fs.readFileSync(path.join(dir, "..", "Combined.gs"), "utf8");
const sandbox = { module: { exports: {} }, console, Date, Math, JSON, RegExp, Number, String, Array, Object, isNaN, isFinite, parseInt, parseFloat };
vm.runInNewContext(code, sandbox);
const C = sandbox.module.exports;
const fx = JSON.parse(fs.readFileSync(fixturesPath, "utf8"));

let pass = 0, fail = 0;
const eq = (l, g, w) => { (JSON.stringify(g) === JSON.stringify(w)) ? pass++ : (fail++, console.log(`  FAIL ${l}: got=${JSON.stringify(g)} want=${JSON.stringify(w)}`)); };
const ok = (l, c, d) => { c ? pass++ : (fail++, console.log(`  FAIL ${l} ${d || ""}`)); };
const SP = "捕獲等をする鳥獣又は採取等をする鳥類の卵の種類及び数量";
const M = "捕獲等又は採取等の方法（使用する捕獲用具の名称）"; // 閉じ括弧は全角（フォーム／CHO_L_CHILD_METHOD_ と一致）

// ---- IMPORT 個人想定 ----
const impK = C.Cho_buildImport_(C.Cho_makeReader_(fx["個人"]));
eq("個人 applicantType", impK.parent.type, "個人");
ok("個人 workers>=2", impK.children.length >= 2, "got " + impK.children.length);
eq("個人 child0 氏名", impK.children[0]["氏名"], "鈴木新之助");
eq("個人 child0 キツネ頭数", impK.children[0][SP + "/キツネ/捕獲頭数"], 1);
eq("個人 child1 氏名", impK.children[1]["氏名"], "田中聡");
ok("個人 child1 銃器マーカー", impK.children[1][M + "/銃器"] === "●", JSON.stringify(impK.children[1][M + "/銃器"]));
// 番号は〇〇第xxxx号一本（接頭語フィールドは無い）。名簿 S 列の値そのまま。
const c1 = impK.children[1];
ok("個人 child1 番号接頭語なし", Object.keys(c1).every(k => !k.endsWith("番号接頭語")), "接頭語キーが残存");
const airNoKey = Object.keys(c1).find(k => k.includes("空気銃/狩猟免許") && k.endsWith("/番号"));
ok("個人 child1 空気銃 免許番号=石狩第..号", !!airNoKey && /^.+第[0-9]+号$/.test(c1[airNoKey]), airNoKey + "=" + (airNoKey && c1[airNoKey]));
// 証明書セクションは fields（保存対象）に含まれ、displayFields（表示専用）には含まれない
ok("個人 証明書 保存対象", Object.keys(impK.parent.fields).some(k => k.startsWith("証明書/")), JSON.stringify(Object.keys(impK.parent.fields).filter(k => k.startsWith("証明書"))));
ok("個人 証明書 displayFields非含有", !Object.keys(impK.parent.displayFields || {}).some(k => k.startsWith("証明書/")), JSON.stringify(Object.keys(impK.parent.displayFields || {})));
// 個人モード: 申請者情報/個人/{氏名,住所} が workers[0] から取り込まれる
const IBASE = "申請者情報/個人・法人の別/個人";
ok("個人 申請者氏名取込", impK.parent.fields[IBASE + "/氏名"] === "鈴木新之助", JSON.stringify(impK.parent.fields[IBASE + "/氏名"]));
ok("個人 申請者住所取込", typeof impK.parent.fields[IBASE + "/住所"] === "string" && impK.parent.fields[IBASE + "/住所"].length > 0, JSON.stringify(impK.parent.fields[IBASE + "/住所"]));

// ---- IMPORT 法人想定 ----
const impH = C.Cho_buildImport_(C.Cho_makeReader_(fx["法人"]));
eq("法人 applicantType", impH.parent.type, "法人");
eq("法人 法人名", impH.parent.fields["申請者情報/個人・法人の別/法人/法人名"], "株式会社ハンター協会");

// ---- 申請日（Excel 申請書 H2 から取込）/ 受付日（取り込み実行日 = nowCanonical）----
const NOW = "2026-06-28";
const impKn = C.Cho_buildImport_(C.Cho_makeReader_(fx["個人"]), "個人", NOW);
const impHn = C.Cho_buildImport_(C.Cho_makeReader_(fx["法人"]), "法人", NOW);
eq("個人 申請日(H2取込)", impKn.parent.fields["申請日"], "2026-05-30");
eq("法人 申請日(H2取込)", impHn.parent.fields["申請日"], "2026-06-10");
eq("個人 受付日(=now)", impKn.parent.fields["受付日"], NOW);
eq("法人 受付日(=now)", impHn.parent.fields["受付日"], NOW);
// nowCanonical 省略時は本日（new Date()）を canonical 化して必ず入る
ok("受付日 省略時も YYYY-MM-DD で必ず入る", /^\d{4}-\d{2}-\d{2}$/.test(impH.parent.fields["受付日"]), JSON.stringify(impH.parent.fields["受付日"]));
// 受付日の手入力（UI → Cho_parseXlsxFile_）を検証・canonical 化。不正/空は "" で本日にフォールバックさせる
eq("受付日入力 正常はそのまま", C.Cho_normalizeReceiptDate_("2026-06-30"), "2026-06-30");
eq("受付日入力 前後空白は trim", C.Cho_normalizeReceiptDate_("  2026-06-30  "), "2026-06-30");
eq("受付日入力 空は \"\"", C.Cho_normalizeReceiptDate_(""), "");
eq("受付日入力 不正は \"\"（=本日フォールバック）", C.Cho_normalizeReceiptDate_("2026/6/30"), "");
// 手入力の受付日が Cho_buildImport_ 経由で受付日フィールドへ反映される
eq("受付日 手入力値が反映", C.Cho_buildImport_(C.Cho_makeReader_(fx["個人"]), "個人", "2026-06-15").parent.fields["受付日"], "2026-06-15");

// ---- 記入日（Excel 証明書 H2 右上から取込 → 証明書/記入日 葉）----
eq("個人 証明書/記入日(H2取込)", impK.parent.fields["証明書/記入日"], "2026-06-10");
eq("法人 証明書/記入日(H2取込)", impH.parent.fields["証明書/記入日"], "2026-06-10");

// ---- 選択肢（radio/checkboxes/select）は「親パス/選択肢」葉へ ● マーカー（NFB 契約。連結→親パス書きは列なしで全滅していた）----
const MK = "●";
const PF_K = impK.parent.fields, PF_H = impH.parent.fields;
// 親: 個人/法人 ラジオ（bare 親パス連結は出さない）
eq("親 個人別=個人marker", PF_K["申請者情報/個人・法人の別/個人"], MK);
eq("親 個人別=法人marker", PF_H["申請者情報/個人・法人の別/法人"], MK);
ok("親 個人別 連結bare無し", !("申請者情報/個人・法人の別" in PF_K), JSON.stringify(PF_K["申請者情報/個人・法人の別"]));
// 親: 証明書 被害原因の鳥獣 checkboxes（F13=○キジバト, I19=○ノイヌ）
eq("親 証明書キジバトmarker", PF_K["証明書/被害原因の鳥獣/キジバト"], MK);
eq("親 証明書ノイヌmarker", PF_K["証明書/被害原因の鳥獣/ノイヌ"], MK);
ok("親 被害原因 連結bare無し", !("証明書/被害原因の鳥獣" in PF_K), JSON.stringify(PF_K["証明書/被害原因の鳥獣"]));
// 親: 証明書 被害者 select（個人fx=申請者自身→申請者, 法人fx=申請者以外）+ 申請者以外の子は従来どおり
eq("親 被害者=申請者marker(個人)", PF_K["証明書/被害者/申請者"], MK);
eq("親 被害者=申請者marker(法人)", PF_H["証明書/被害者/申請者"], MK);
// 申請者以外の子項目（住所/氏名）取込は合成フィクスチャで検証（既定サンプルは両様式とも「1.申請者自身」）。
// 親: 処置 checkboxes（個人fx E31=埋設）
eq("親 処置埋設marker", PF_K["捕獲等又は採取等をしたあとの処置/埋設"], MK);
ok("親 処置 連結bare無し", !("捕獲等又は採取等をしたあとの処置" in PF_K), JSON.stringify(PF_K["捕獲等又は採取等をしたあとの処置"]));
// 子: 種類 checkboxes（child0=鈴木新之助はキツネ頭数7を含む）+ bare 連結無し
eq("子 種類キツネmarker", impK.children[0][SP + "/キツネ"], MK);
ok("子 種類 連結bare無し", !(SP in impK.children[0]), JSON.stringify(impK.children[0][SP]));
// 子: 方法/道具/銃の種類/狩猟免許 checkboxes・select（child1=田中聡。用具=はこわな/空気銃/ライフル銃）
{
  const w1 = impK.children[1];
  eq("子 方法手捕りmarker(child0=鈴木)", impK.children[0][M + "/手捕り"], MK); // 田中聡は手捕り無し。手捕りは child0 で検証
  eq("子 方法わなmarker", w1[M + "/わな"], MK);
  eq("子 方法銃器marker", w1[M + "/銃器"], MK);
  ok("子 方法 連結bare無し", !(M in w1), JSON.stringify(w1[M]));
  eq("子 わな道具はこわなmarker", w1[M + "/わな/道具の種類/はこわな"], MK);
  ok("子 わな道具 連結bare無し", !((M + "/わな/道具の種類") in w1), JSON.stringify(w1[M + "/わな/道具の種類"]));
  eq("子 銃の種類空気銃marker", w1[M + "/銃器/銃の種類/空気銃"], MK);
  eq("子 銃の種類ライフル銃marker", w1[M + "/銃器/銃の種類/ライフル銃"], MK);
  ok("子 銃の種類 連結bare無し", !((M + "/銃器/銃の種類") in w1), JSON.stringify(w1[M + "/銃器/銃の種類"]));
  const air1 = w1[M + "/銃器/銃の種類/空気銃/狩猟免許/第一種銃猟免許"] === MK;
  const air2 = w1[M + "/銃器/銃の種類/空気銃/狩猟免許/第二種銃猟免許"] === MK;
  ok("子 空気銃狩猟免許markerどちらか一方", air1 !== air2, "第一種=" + air1 + " 第二種=" + air2);
}
// 子: 葉が立つ選択肢は必ず対応マーカーも立つ（狩猟免許 radio / 登録の有無 radio。fixtures 差異に頑健）
for (const w of impK.children) {
  for (const key of Object.keys(w)) {
    let m = key.match(/^(.*)\/狩猟免許\/あり\/免許情報\/(番号|交付年月日|都道府県)$/);
    if (m && w[key]) eq("子 免許あり葉→ありmarker", w[m[1] + "/狩猟免許/あり"], MK);
    m = key.match(/^(.*)\/狩猟者登録\/登録の有無\/あり\/(番号|交付年月日)$/);
    if (m && w[key]) eq("子 登録あり葉→ありmarker", w[m[1] + "/狩猟者登録/登録の有無/あり"], MK);
  }
}

// ---- 確認用（桃セル）取り込み: 集計値は displayFields（表示専用・保存しない）へ ----
const CONF = "確認用", CONFSP = CONF + "/種類及び数量";
const dfK = impK.parent.displayFields || {};
// 集計系（種数/卵数/捕獲方法）のみ displayFields に入る。同定系は「照合専用」化＝どこにも保存しない。
ok("個人 確認用キツネ捕獲数", dfK[CONFSP + "/キツネ捕獲数"] === 2, JSON.stringify(dfK[CONFSP + "/キツネ捕獲数"]));
ok("個人 確認用キジバト採取卵数あり", typeof dfK[CONFSP + "/キジバト採取卵数"] === "number", JSON.stringify(dfK[CONFSP + "/キジバト採取卵数"]));
ok("個人 確認用捕獲方法あり", typeof dfK[CONF + "/捕獲方法"] === "string" && dfK[CONF + "/捕獲方法"].length > 0, dfK[CONF + "/捕獲方法"]);
// 確認用は保存対象（fields）には一切入らない。
ok("個人 確認用は非保存(fields)", !Object.keys(impK.parent.fields).some((k) => k === CONF || k.startsWith(CONF + "/")), JSON.stringify(Object.keys(impK.parent.fields).filter((k) => k.startsWith(CONF))));
// 同定系（住所/氏名/生年月日/職業/証明書住所/証明書氏名）は集計でないので displayFields にも fields にも出ない。
for (const sub of ["住所", "氏名", "生年月日", "職業", "証明書住所", "証明書氏名"]) {
  ok("個人 確認用" + sub + "は非取込", !((CONF + "/" + sub) in dfK) && !((CONF + "/" + sub) in impK.parent.fields), JSON.stringify(dfK[CONF + "/" + sub]));
}
// 法人: 同定は未設定／集計・種数は取り込む（displayFields）
const dfH = impH.parent.displayFields || {};
ok("法人 確認用住所なし", !((CONF + "/住所") in dfH), dfH[CONF + "/住所"]);
ok("法人 確認用氏名なし", !((CONF + "/氏名") in dfH), dfH[CONF + "/氏名"]);
ok("法人 確認用種数あり", Object.keys(dfH).some((k) => k.startsWith(CONFSP + "/")), "法人の確認用種数が空");

// ---- forcedType（取り込み画面のラジオ選択）が自動判定を上書き ----
eq("forcedType 個人fx→法人", C.Cho_buildImport_(C.Cho_makeReader_(fx["個人"]), "法人").parent.type, "法人");
eq("forcedType 法人fx→個人", C.Cho_buildImport_(C.Cho_makeReader_(fx["法人"]), "個人").parent.type, "個人");

// ---- ISSUE 抽出: クリーン fixtures は誤検知ゼロ（種類照合は除く）----
// 想定サンプルは証明書が全捕獲種を○にしているため、種類照合(被害原因の鳥獣 照合)も含め誤検知はゼロ。
const notSpXc = (iss) => iss.filter((x) => x.label !== "被害原因の鳥獣 照合");
ok("個人 issues=0(種類照合除く)", notSpXc(impK.issues).length === 0, JSON.stringify(notSpXc(impK.issues)));
ok("法人 issues=0(種類照合除く)", notSpXc(impH.issues).length === 0, JSON.stringify(notSpXc(impH.issues)));

// ---- 合成リーダで異常検出を確認（個人/法人 fixtures を複製して特定セルだけ壊す）----
const clone = (o) => JSON.parse(JSON.stringify(o));
function setCell(vbs, sheet, a1, val) {
  const rc = C.Cho_a1ToRC_(a1); // {row, col} 1-based
  const grid = vbs[sheet] || (vbs[sheet] = []);
  while (grid.length < rc.row) grid.push([]);
  const row = grid[rc.row - 1];
  while (row.length < rc.col) row.push("");
  row[rc.col - 1] = val;
}
const impOf = (vbs) => C.Cho_buildImport_(C.Cho_makeReader_(vbs));
const cat = (iss, c) => iss.filter((x) => x.category === c);
const has = (iss, c, cell) => iss.some((x) => x.category === c && x.cell === cell);

// (1) 申請書 種数ピンクが名簿合算(キツネ=8)と不一致
{ const v = clone(fx["個人"]); setCell(v, "申請書", "F24", 9); const iss = impOf(v).issues;
  ok("(1) F24不一致→pink", has(iss, "pink_inconsistent", "F24"), JSON.stringify(cat(iss, "pink_inconsistent"))); }
// (2) 未知の種名（想定スロット キジバト と不一致）
{ const v = clone(fx["個人"]); setCell(v, "従事者名簿", "J5", "ヌートリア"); const iss = impOf(v).issues;
  ok("(2) 未知種→dropped@J5", has(iss, "dropped", "J5"), JSON.stringify(cat(iss, "dropped"))); }
// (3) 未知の用具
{ const v = clone(fx["個人"]); setCell(v, "従事者名簿", "P5", "爆竹"); const iss = impOf(v).issues;
  ok("(3) 未知用具→dropped@P5", has(iss, "dropped", "P5"), JSON.stringify(cat(iss, "dropped"))); }
// (4) 11 人目オーバーフロー（行95に氏名）
{ const v = clone(fx["個人"]); setCell(v, "従事者名簿", "G95", "溢田太郎"); const iss = impOf(v).issues;
  ok("(4) 11人目→dropped(error)", cat(iss, "dropped").some((x) => x.severity === "error"), JSON.stringify(cat(iss, "dropped"))); }
// (5) 空 actual は不一致を出さない（空F24→誤検知ゼロの回帰ガード）
{ const v = clone(fx["個人"]); setCell(v, "申請書", "F24", ""); const iss = impOf(v).issues;
  ok("(5) 空F24→pink無し", !has(iss, "pink_inconsistent", "F24"), JSON.stringify(cat(iss, "pink_inconsistent"))); }
// (6) 法人: 同定セルは照合外だが種数は照合される
{ const v = clone(fx["法人"]); setCell(v, "申請書", "F24", 99); const iss = impOf(v).issues;
  ok("(6法人) F24誤値→pink", has(iss, "pink_inconsistent", "F24"), JSON.stringify(cat(iss, "pink_inconsistent")));
  ok("(6法人) 同定セルは照合外", !has(iss, "pink_inconsistent", "F6") && !has(iss, "pink_inconsistent", "F8"), "F6/F8 が誤検知"); }
// (7) 既定 fixture: 申請者(鈴木新之助/2026-06-01)が名簿先頭にいる → 「一覧に見つかりません」pink は出ない
{ const iss = impK.issues;
  ok("(7) 申請者在籍→F8 pink無し", !has(iss, "pink_inconsistent", "F8"), JSON.stringify(cat(iss, "pink_inconsistent"))); }
// (8) 申請者氏名を名簿にいない人へ（個人モード強制）→ 本人特定できず F8 に「一覧に見つかりません」pink
//     ※氏名を変えると自動判定は法人へ転ぶため forcedType="個人"（取り込み画面のラジオ選択を模す）
{ const v = clone(fx["個人"]); setCell(v, "申請書", "F8", "存在しない太郎");
  const iss = C.Cho_buildImport_(C.Cho_makeReader_(v), "個人").issues;
  ok("(8) 名簿外申請者→F8 pink", has(iss, "pink_inconsistent", "F8"), JSON.stringify(cat(iss, "pink_inconsistent"))); }
// (9) 本人は在籍するが住所が食い違う → F6 に pink（本人と照合）
{ const v = clone(fx["個人"]); setCell(v, "申請書", "F6", "札幌市"); const iss = impOf(v).issues;
  ok("(9) 住所食い違い→F6 pink", has(iss, "pink_inconsistent", "F6"), JSON.stringify(cat(iss, "pink_inconsistent")));
  ok("(9) 本人は特定済→F8 pink無し", !has(iss, "pink_inconsistent", "F8"), JSON.stringify(cat(iss, "pink_inconsistent"))); }
// (10) 申請書 E30 を名簿用具と食い違わせる → E30 に pink（friendly 照合行は廃止、抽出レポートで検知）
{ const v = clone(fx["個人"]); setCell(v, "申請書", "E30", "手捕り"); const iss = impOf(v).issues;
  ok("(10) E30食い違い→pink", has(iss, "pink_inconsistent", "E30"), JSON.stringify(cat(iss, "pink_inconsistent"))); }
// ---- 免許なし + 免許不要の理由（従事（補助）適任者証明書）: 名簿 Q=証明書・免許情報(R/S/T)空 → 狩猟免許=なし + 理由 ----
// 田中聡ブロック(行14〜)の はこわな行(14)を「免許なし＋証明書」に差し替える（cols: Q=種類, R=都道府県, S=番号, T=交付年月日）。
{
  const v = clone(fx["個人"]);
  setCell(v, "従事者名簿", "Q14", "従事（補助）適任者証明書");
  setCell(v, "従事者名簿", "R14", ""); setCell(v, "従事者名簿", "S14", ""); setCell(v, "従事者名簿", "T14", "");
  const w = C.Cho_buildImport_(C.Cho_makeReader_(v), "個人").children.find((x) => x["氏名"] === "田中聡");
  const WB = M + "/わな/狩猟免許";
  eq("(免許なし) わな免許=なしmarker", w[WB + "/なし"], MK);
  ok("(免許なし) わな免許ありmarker無し", w[WB + "/あり"] === undefined, JSON.stringify(w[WB + "/あり"]));
  ok("(免許なし) わな免許情報を書かない", !Object.keys(w).some((k) => k.startsWith(WB + "/あり/免許情報/")), JSON.stringify(Object.keys(w).filter((k) => k.startsWith(WB + "/あり"))));
  eq("(免許なし) 理由=証明書marker",
    w[WB + "/なし/免許不要の理由（小型のはこわな限定）/従事（補助）適任者証明書（法人かつ他に免許者がいる場合に限る。）"], MK);
}
// ---- 実 fixture 側の証明書パス回帰ガード: 鈴木新之助(child0)の はこわな行(Q6=証明書・R/S/T空) が
//      わなの証明書選択肢（網とは別文言）に一致する葉へ marker を立てること ----
{
  const s = impK.children[0]; // = 鈴木新之助
  const WB = M + "/わな/狩猟免許";
  eq("(実fixture) 鈴木 わな免許=なしmarker", s[WB + "/なし"], MK);
  eq("(実fixture) 鈴木 理由=わな証明書marker",
    s[WB + "/なし/免許不要の理由（小型のはこわな限定）/従事（補助）適任者証明書（法人かつ他に免許者がいる場合に限る。）"], MK);
}
// ---- 登録なしを明示: 田中聡のはこわな行は登録(U/V/W)空 → わな 登録の有無=なし marker ----
ok("(登録なし) わな登録=なしmarker", impK.children.find((x) => x["氏名"] === "田中聡")[M + "/わな/狩猟者登録/登録の有無/なし"] === MK,
  JSON.stringify(impK.children.find((x) => x["氏名"] === "田中聡")[M + "/わな/狩猟者登録/登録の有無/なし"]));
// ---- 証明書 被害者=申請者以外: E22→区分、G22/G23→住所/氏名 を取り込む（既定サンプルに例が無いので合成）----
{
  const v = clone(fx["法人"]);
  setCell(v, "証明書", "E22", "2.申請者以外");
  setCell(v, "証明書", "G22", "小樽市X町1-1");
  setCell(v, "証明書", "G23", "被害 太郎");
  const pf = C.Cho_buildImport_(C.Cho_makeReader_(v), "法人").parent.fields;
  eq("(被害者以外) marker", pf["証明書/被害者/申請者以外"], MK);
  eq("(被害者以外) 住所取込", pf["証明書/被害者/申請者以外/住所"], "小樽市X町1-1");
  eq("(被害者以外) 氏名取込", pf["証明書/被害者/申請者以外/氏名"], "被害 太郎");
}
// ---- 証明書(被害原因の鳥獣・○) ⇔ 許可申請(名簿で個体1以上 or 卵1以上を捕獲する種) の双方向種類照合 ----
const spXc = (iss) => cat(iss, "pink_inconsistent").filter((x) => x.label === "被害原因の鳥獣 照合");
// (11) 既定サンプルは証明書が全捕獲種を○＝種類照合 pink ゼロ。1種の○を外すと「申請にあるが証明書に無い」で pink。
ok("(11a) 既定は種類照合pinkゼロ", spXc(impK.issues).length === 0, JSON.stringify(spXc(impK.issues)));
{ const v = clone(fx["個人"]); setCell(v, "証明書", "F15", ""); // スズメの○を外す（名簿ではスズメ捕獲あり）
  const iss = impOf(v).issues;
  ok("(11b) app有cert無→F15(スズメ) pink", has(iss, "pink_inconsistent", "F15"), JSON.stringify(spXc(iss))); }
// (12) 逆方向（証明書にあるが申請に無い）: 証明書○のままの キジバト の名簿捕獲を 0 に
//   （worker0=行5 / worker1=行14、キジバト off0/side L → 頭数K列・卵N列）→ F13 に pink。
{ const v = clone(fx["個人"]);
  setCell(v, "従事者名簿", "K5", "");  setCell(v, "従事者名簿", "N5", "");
  setCell(v, "従事者名簿", "K14", ""); setCell(v, "従事者名簿", "N14", "");
  const iss = impOf(v).issues;
  ok("(12) cert有app無→F13 pink", has(iss, "pink_inconsistent", "F13"), JSON.stringify(spXc(iss))); }
// (13) 整合させれば種類照合 pink はゼロ: 証明書に全11種○を立てる（双方向とも差なし）
{ const v = clone(fx["個人"]);
  ["F13","F14","F15","F16","F17","F18","F19","I19","F20","I20","F21"].forEach((c) => setCell(v, "証明書", c, "○"));
  const iss = spXc(impOf(v).issues);
  ok("(13) 全種一致→種類照合 pink ゼロ", iss.length === 0, JSON.stringify(iss)); }

// ---- 直接書き込みの純関数（Cho_resolveCell_ / Cho_buildNewRow_ / 添付 / friendly） ----
// 日付セル: canonical 文字列 → Date + yyyy/mm/dd
{
  const r = C.Cho_resolveCell_("2025-06-27");
  ok("resolveCell 日付→Date", r.value instanceof Date && !isNaN(r.value.getTime()), JSON.stringify(r));
  ok("resolveCell 日付値", r.value instanceof Date && r.value.getFullYear() === 2025 && r.value.getMonth() === 5 && r.value.getDate() === 27, String(r.value));
  eq("resolveCell 日付書式", r.numberFormat, C.NFB_SHEETS_DATE_FORMAT);
}
// 数式中和: 先頭 '=' → 先頭 ' + @
{
  const r = C.Cho_resolveCell_("=SUM(A1)");
  eq("resolveCell 数式中和", r.value, "'=SUM(A1)");
  eq("resolveCell 数式書式", r.numberFormat, C.NFB_SHEETS_TEXT_FORMAT);
}
// 通常文字列 → テキスト + @
{
  const r = C.Cho_resolveCell_("株式会社ハンター協会");
  eq("resolveCell 文字列値", r.value, "株式会社ハンター協会");
  eq("resolveCell 文字列書式", r.numberFormat, C.NFB_SHEETS_TEXT_FORMAT);
}
// 数値 → テキスト("7") + @（本体同様 number 列はテキスト保存）
{
  const r = C.Cho_resolveCell_(7);
  eq("resolveCell 数値→テキスト", r.value, "7");
  eq("resolveCell 数値書式", r.numberFormat, C.NFB_SHEETS_TEXT_FORMAT);
}
// 空 → "" + @
eq("resolveCell 空値", C.Cho_resolveCell_("").value, "");

// 新規行組み立て: メタ列 + データ列 + pid + 未知キー破棄
{
  const keyToColumn = { "氏名": 10 };            // 1-based → 0-based index 9
  const fixedColMap = { id: 0, "No.": 1, createdAt: 2, modifiedAt: 3, deletedAt: 4, createdBy: 5, modifiedBy: 6, deletedBy: 7, pid: 8 };
  const now = 1719446400000;                      // 固定 Unix ms
  const rec = { id: "r_test", pid: "r_parent", data: { "氏名": "田中聡", "存在しない項目": "x", "生年月日": "2000-01-02" } };
  const built = C.Cho_buildNewRow_(keyToColumn, fixedColMap, 12, rec, 5, now, "a@example.com");
  eq("buildNewRow id", built.rowData[0], "r_test");
  eq("buildNewRow No.", built.rowData[1], 6);
  ok("buildNewRow createdAt=Date", built.rowData[2] instanceof Date, String(built.rowData[2]));
  eq("buildNewRow createdAt書式", built.rowFormats[2], C.NFB_SHEETS_DATETIME_FORMAT);
  ok("buildNewRow modifiedAt=Date", built.rowData[3] instanceof Date, String(built.rowData[3]));
  eq("buildNewRow createdBy", built.rowData[5], "a@example.com");
  eq("buildNewRow modifiedBy", built.rowData[6], "a@example.com");
  eq("buildNewRow pid", built.rowData[8], "r_parent");
  eq("buildNewRow 氏名→列9", built.rowData[9], "田中聡");
  ok("buildNewRow 未知キー破棄", built.rowData.indexOf("x") === -1, JSON.stringify(built.rowData));
}
// 列が無い非空キーは dropped として検出（空は対象外）
{
  const dropped = C.Cho_collectDroppedKeys_({ "氏名": "田中", "存在しない": "v", "空": "" }, { "氏名": 10 });
  ok("collectDropped 検出", dropped.indexOf("存在しない") !== -1 && dropped.indexOf("氏名") === -1 && dropped.indexOf("空") === -1, JSON.stringify(dropped));
}
// 添付セル JSON（スタブ file/folder）
{
  const file = { getName: () => "様式.xlsx", getId: () => "fid123", getUrl: () => "https://drive/file" };
  const folder = { getName: () => "06_upload_files", getUrl: () => "https://drive/folder" };
  const cell = JSON.parse(C.Cho_buildUploadCell_(file, folder));
  eq("uploadCell folderName", cell.folderName, "06_upload_files");
  eq("uploadCell driveFileId", cell.files[0].driveFileId, "fid123");
  eq("uploadCell name", cell.files[0].name, "様式.xlsx");
}
// friendly 整形（個人）
{
  const fr = C.Cho_buildFriendly_(impK);
  eq("friendly type", fr.applicant.type, "個人");
  eq("friendly name", fr.applicant.name, "鈴木新之助");
  eq("friendly workers数", fr.workers.length, impK.children.length);
  eq("friendly worker0 title", fr.workers[0].title, "鈴木新之助");
  ok("friendly worker0 rows", fr.workers[0].rows.length > 0, "rows empty");
  // 確認用（displayFields・桃セル由来）の行だけ confirm:true（桃色）。証明書を含む保存データは confirm:false。
  const confRows = fr.applicant.rows.filter((r) => r.confirm);
  ok("friendly 確認用行あり", confRows.length > 0, "確認用行が無い");
  ok("friendly confirm行は確認用のみ", confRows.every((r) => r.label.startsWith("確認用")), JSON.stringify(confRows.map((r) => r.label)));
  ok("friendly 非確認用は confirm=false", fr.applicant.rows.filter((r) => !r.label.startsWith("確認用")).every((r) => r.confirm === false), "非確認用に confirm=true 混入");
  // 各従事者に「捕獲用具一覧（確認用）」= 実際の葉用具（カテゴリではない）の平坦化行が出る。
  // 田中聡(worker1) の用具は はこわな/空気銃/ライフル銃（順不同OK）。
  const tanaka = fr.workers.find((w) => w.title === "田中聡");
  ok("friendly 田中聡あり", !!tanaka, "田中聡 worker が無い");
  const toolRow = tanaka.rows.find((r) => r.label === "捕獲用具一覧（確認用）");
  ok("friendly 田中聡 用具一覧行あり", !!toolRow && toolRow.confirm === true, JSON.stringify(toolRow));
  ok("friendly 田中聡 用具一覧=葉用具", new Set(toolRow.value.split(", ")).size === 3 &&
    ["はこわな", "空気銃", "ライフル銃"].every((t) => toolRow.value.split(", ").indexOf(t) !== -1), toolRow.value);
  // 用具一覧行は表示専用: 保存される子フィールドには「捕獲用具一覧（確認用）」キーを足さない。
  ok("用具一覧は子フィールドに非混入", !("捕獲用具一覧（確認用）" in impK.children[1]), "保存フィールドに混入");
  // 全従事者の用具和集合 == 確認用 ＞ 捕獲方法（E30、順不同）。message2 の確認事項。
  const union = C.Cho_unionToolsFromImport_(impK.children).slice().sort().join(",");
  const e30 = (impK.parent.displayFields["確認用/捕獲方法"] || "").split(/[,、・]/).map((s) => s.trim()).filter(Boolean).sort().join(",");
  eq("用具和集合==確認用捕獲方法", union, e30);
  ok("E30照合 issue無し", impK.issues.filter((x) => x.cell === "E30").length === 0, JSON.stringify(impK.issues.filter((x) => x.cell === "E30")));
  // 表示専用の「捕獲方法（従事者集計）」「捕獲方法 照合」行は廃止された（E30 不一致は pink で出る）。
  ok("friendly 従事者集計行なし", !fr.applicant.rows.some((r) => r.label === "確認用 ＞ 捕獲方法（従事者集計）"), "集計行が残存");
  ok("friendly 照合行なし", !fr.applicant.rows.some((r) => r.label === "確認用 ＞ 捕獲方法 照合"), "照合行が残存");
  // 同定の確認用行（住所/氏名/生年月日/職業）は保存しないので fieldsToRows に出ない。
  ok("friendly 同定確認用行なし", !fr.applicant.rows.some((r) => /^確認用 ＞ (住所|氏名|生年月日|職業)$/.test(r.label)), JSON.stringify(fr.applicant.rows.map((r) => r.label)));
  // 証明書データは保存対象（fields）なのでプレビューに confirm=false（通常）行で出る。
  ok("friendly 証明書行あり 通常", fr.applicant.rows.some((r) => r.label.startsWith("証明書") && r.confirm === false), "証明書行が無い");
}
// relay context 抽出（外部アクション payload → 親 storage）
{
  const c = C.Cho_extractRelayContext_({ formId: "f1", storage: { spreadsheetId: "ss1", driveFileUrl: "u", sheetName: "Data" } });
  eq("relay parentSs", c.parentSpreadsheetId, "ss1");
  eq("relay formId", c.formId, "f1");
}
// 子 SS / 子シート名のリレー受け渡し: storage.childSpreadsheetId / childSheetName を抽出
{
  const c = C.Cho_extractRelayContext_({ formId: "f1", storage: { spreadsheetId: "ssP", childSpreadsheetId: "ssC", sheetName: "Data", childSheetName: "従事者" } });
  eq("relay childSs", c.childSpreadsheetId, "ssC");
  eq("relay childSheet", c.childSheetName, "従事者");
}
// 子 SS / 子シート名は storage のみから解決する（統一フォーマットで list は廃止＝旧 childFormsByRow
// フォールバックは無い）。storage に子 SS が無ければ空（＝admin 送信時のみ子 SS が載る）。
{
  // list を渡しても無視され、storage に子 SS が無ければ空のまま。
  const c = C.Cho_extractRelayContext_({ storage: { spreadsheetId: "ssP" }, list: { childFormsByRow: [[{ childSpreadsheetId: "ssFromList", childSheetName: "shtFromList" }]] } });
  eq("relay childSs list無視", c.childSpreadsheetId, "");
  eq("relay childSheet list無視", c.childSheetName, "");
  eq("relay childSs storage無し", C.Cho_extractRelayContext_({ storage: { spreadsheetId: "ssP" } }).childSpreadsheetId, "");
  eq("relay childSheet storage無し", C.Cho_extractRelayContext_({ storage: { spreadsheetId: "ssP" } }).childSheetName, "");
}
// Cho_mergeTargets_: ctx の親/子 SS・シート名が登録値を上書き、無ければ登録値にフォールバック
{
  const props = { parentSpreadsheetId: "pReg", childSpreadsheetId: "cReg", sheetName: "Data", parentUploadFieldKey: "添付", uploadFolderId: "fld" };
  const merged = C.Cho_mergeTargets_(props, { parentSpreadsheetId: "pCtx", childSpreadsheetId: "cCtx", sheetName: "Sheet2", childSheetName: "従事者シート" });
  eq("mergeTargets 親ctx優先", merged.parentSpreadsheetId, "pCtx");
  eq("mergeTargets 子ctx優先", merged.childSpreadsheetId, "cCtx");
  eq("mergeTargets sheetName ctx優先", merged.sheetName, "Sheet2");
  eq("mergeTargets childSheetName ctx優先", merged.childSheetName, "従事者シート");
  eq("mergeTargets uploadFieldKey 維持", merged.parentUploadFieldKey, "添付");
  const merged2 = C.Cho_mergeTargets_(props, null);
  eq("mergeTargets ctx無し親=登録値", merged2.parentSpreadsheetId, "pReg");
  eq("mergeTargets ctx無し子=登録値", merged2.childSpreadsheetId, "cReg");
  eq("mergeTargets ctx無しsheet=登録値", merged2.sheetName, "Data");
  // childSheetName は ctx も登録値も無ければ親 sheetName にフォールバック（従来挙動の互換）。
  eq("mergeTargets childSheet 親フォールバック", merged2.childSheetName, "Data");
  // ctx に childSheetName だけある場合は ctx を採る。
  const merged3 = C.Cho_mergeTargets_(props, { childSheetName: "C" });
  eq("mergeTargets childSheet ctxのみ", merged3.childSheetName, "C");
}
// time/datetime ガード: 取り込みは "HH:mm" 形を出さない（出すと @ テキスト誤格納になるため）
{
  const vals = [];
  const collect = (o) => { for (const k in o) { const v = o[k]; if (typeof v === "string") vals.push(v); } };
  collect(impK.parent.fields); impK.children.forEach(collect);
  collect(impH.parent.fields); impH.children.forEach(collect);
  ok("time混入なし", vals.every((v) => !/^\d{1,2}:\d{2}/.test(v)), "時刻文字列が混入");
}

// Cho_buildRecordFolderName_: 本体アプリと同じ NFB_RECORD_TEMP_<safeRecordId>_<uuid8> 命名
{
  eq("folderName 通常", C.Cho_buildRecordFolderName_("r_abc", "12345678"), "NFB_RECORD_TEMP_r_abc_12345678");
  eq("folderName 空id=record", C.Cho_buildRecordFolderName_("", "12345678"), "NFB_RECORD_TEMP_record_12345678");
  // 非 [A-Za-z0-9_-] 文字（空白・"/"・和字など）は各 1 文字ずつ "_" 化される（本体と同じ）。
  // 実運用の recordId は r_<base36>_<base36> で ASCII のみだが、サニタイズ自体を検証する。
  eq("folderName 不正文字置換", C.Cho_buildRecordFolderName_("a b/c", "12345678"), "NFB_RECORD_TEMP_a_b_c_12345678");
  // 既存の許可文字（英数・_・-）はそのまま温存。
  eq("folderName ハイフン温存", C.Cho_buildRecordFolderName_("a-b_C9", "deadbeef"), "NFB_RECORD_TEMP_a-b_C9_deadbeef");
}

console.log(`\n==== ${pass} PASS / ${fail} FAIL ====`);
process.exit(fail ? 1 : 0);
