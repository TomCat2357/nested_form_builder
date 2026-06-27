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
const M = "捕獲等又は採取等の方法（使用する捕獲用具の名称)";

// ---- IMPORT 個人想定 ----
const impK = C.Cho_buildImport_(C.Cho_makeReader_(fx["個人"]));
eq("個人 applicantType", impK.parent.type, "個人");
ok("個人 workers>=2", impK.children.length >= 2, "got " + impK.children.length);
eq("個人 child0 氏名", impK.children[0]["氏名"], "鈴木新之助");
eq("個人 child0 代表的個人", impK.children[0]["代表的個人"], "はい");
eq("個人 child0 キツネ頭数", impK.children[0][SP + "/キツネ/捕獲頭数"], 7);
eq("個人 child1 氏名", impK.children[1]["氏名"], "田中聡");
ok("個人 child1 銃器", (impK.children[1][M] || "").includes("銃器"), impK.children[1][M]);
// 番号は〇〇第xxxx号一本（接頭語フィールドは無い）。名簿 S 列の値そのまま。
const c1 = impK.children[1];
ok("個人 child1 番号接頭語なし", Object.keys(c1).every(k => !k.endsWith("番号接頭語")), "接頭語キーが残存");
const airNoKey = Object.keys(c1).find(k => k.includes("空気銃/免許種類") && k.endsWith("/番号"));
ok("個人 child1 空気銃 免許番号=石狩第..号", !!airNoKey && /^.+第[0-9]+号$/.test(c1[airNoKey]), airNoKey + "=" + (airNoKey && c1[airNoKey]));
// 被害の内容 (証明書セクション) が取り込まれる
ok("個人 被害の内容 取込", "証明書/被害の内容" in impK.parent.fields, JSON.stringify(Object.keys(impK.parent.fields).filter(k => k.startsWith("証明書"))));

// ---- IMPORT 法人想定 ----
const impH = C.Cho_buildImport_(C.Cho_makeReader_(fx["法人"]));
eq("法人 applicantType", impH.parent.type, "法人");
eq("法人 法人名", impH.parent.fields["申請者情報/申請者の個人・法人の別/法人/法人名"], "株式会社ハンター協会");

// ---- 確認用（桃セル）取り込み ----
const CONF = "確認用", CONFSP = CONF + "/種類及び数量";
// 個人: 同定（名簿由来）＋集計＋種数を確認用へ
eq("個人 確認用住所", impK.parent.fields[CONF + "/住所"], "小樽市");
eq("個人 確認用氏名", impK.parent.fields[CONF + "/氏名"], "鈴木新之助");
eq("個人 確認用職業", impK.parent.fields[CONF + "/職業"], "無職");
eq("個人 確認用生年月日", impK.parent.fields[CONF + "/生年月日"], "2026-06-01");
eq("個人 確認用証明書住所", impK.parent.fields[CONF + "/証明書住所"], "小樽市");
eq("個人 確認用証明書氏名", impK.parent.fields[CONF + "/証明書氏名"], "鈴木新之助");
ok("個人 確認用キツネ捕獲数", impK.parent.fields[CONFSP + "/キツネ捕獲数"] === 8, JSON.stringify(impK.parent.fields[CONFSP + "/キツネ捕獲数"]));
ok("個人 確認用キジバト採取卵数あり", typeof impK.parent.fields[CONFSP + "/キジバト採取卵数"] === "number", JSON.stringify(impK.parent.fields[CONFSP + "/キジバト採取卵数"]));
ok("個人 確認用捕獲方法あり", typeof impK.parent.fields[CONF + "/捕獲方法"] === "string" && impK.parent.fields[CONF + "/捕獲方法"].length > 0, impK.parent.fields[CONF + "/捕獲方法"]);
// 法人: 同定は重複させない（未設定）／集計・種数は取り込む
ok("法人 確認用住所なし", !(CONF + "/住所" in impH.parent.fields), impH.parent.fields[CONF + "/住所"]);
ok("法人 確認用氏名なし", !(CONF + "/氏名" in impH.parent.fields), impH.parent.fields[CONF + "/氏名"]);
ok("法人 確認用種数あり", Object.keys(impH.parent.fields).some((k) => k.startsWith(CONFSP + "/")), "法人の確認用種数が空");

// ---- forcedType（取り込み画面のラジオ選択）が自動判定を上書き ----
eq("forcedType 個人fx→法人", C.Cho_buildImport_(C.Cho_makeReader_(fx["個人"]), "法人").parent.type, "法人");
eq("forcedType 法人fx→個人", C.Cho_buildImport_(C.Cho_makeReader_(fx["法人"]), "個人").parent.type, "個人");

// ---- ISSUE 抽出: クリーン fixtures は誤検知ゼロ ----
ok("個人 issues=0", impK.issues.length === 0, JSON.stringify(impK.issues));
ok("法人 issues=0", impH.issues.length === 0, JSON.stringify(impH.issues));

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
  // 確認用（桃セル由来）の行は confirm:true で色分け対象、それ以外は confirm:false
  const confRows = fr.applicant.rows.filter((r) => r.confirm);
  ok("friendly 確認用行あり", confRows.length > 0, "確認用行が無い");
  ok("friendly 確認用行は確認用プレフィックス", confRows.every((r) => r.label.startsWith("確認用")), JSON.stringify(confRows.map((r) => r.label)));
  ok("friendly 非確認用は confirm=false", fr.applicant.rows.filter((r) => !r.label.startsWith("確認用")).every((r) => r.confirm === false), "非確認用に confirm=true 混入");
  // 各従事者に「捕獲用具一覧（確認用）」= 実際の葉用具（カテゴリではない）の平坦化行が出る。
  // 田中聡(worker1) の用具は 手捕り/はこわな/空気銃/散弾銃（順不同OK）。
  const tanaka = fr.workers.find((w) => w.title === "田中聡");
  ok("friendly 田中聡あり", !!tanaka, "田中聡 worker が無い");
  const toolRow = tanaka.rows.find((r) => r.label === "捕獲用具一覧（確認用）");
  ok("friendly 田中聡 用具一覧行あり", !!toolRow && toolRow.confirm === true, JSON.stringify(toolRow));
  ok("friendly 田中聡 用具一覧=葉用具", new Set(toolRow.value.split(", ")).size === 4 &&
    ["手捕り", "はこわな", "空気銃", "散弾銃"].every((t) => toolRow.value.split(", ").indexOf(t) !== -1), toolRow.value);
  // 用具一覧行は表示専用: 保存される子フィールドには「捕獲用具一覧（確認用）」キーを足さない。
  ok("用具一覧は子フィールドに非混入", !("捕獲用具一覧（確認用）" in impK.children[1]), "保存フィールドに混入");
  // 全従事者の用具和集合 == 確認用 ＞ 捕獲方法（E30、順不同）。message2 の確認事項。
  const union = C.Cho_unionToolsFromImport_(impK.children).slice().sort().join(",");
  const e30 = impK.parent.fields["確認用/捕獲方法"].split(/[,、・]/).map((s) => s.trim()).filter(Boolean).sort().join(",");
  eq("用具和集合==確認用捕獲方法", union, e30);
  ok("E30照合 issue無し", impK.issues.filter((x) => x.cell === "E30").length === 0, JSON.stringify(impK.issues.filter((x) => x.cell === "E30")));
  // 申請者セクションに「従事者集計（和集合）」行が常時出て、E30 と順不同一致すること。
  const sumRow = fr.applicant.rows.find((r) => r.label === "確認用 ＞ 捕獲方法（従事者集計）");
  ok("friendly 従事者集計行あり", !!sumRow && sumRow.confirm === true, JSON.stringify(sumRow));
  eq("friendly 従事者集計=和集合", sumRow.value.split(", ").slice().sort().join(","), union);
  // 照合行が常時出て、一致ケースで「一致」になること。
  const verdictRow = fr.applicant.rows.find((r) => r.label === "確認用 ＞ 捕獲方法 照合");
  ok("friendly 照合行あり", !!verdictRow && verdictRow.confirm === true, JSON.stringify(verdictRow));
  eq("friendly 照合=一致", verdictRow.value, "一致");
}
// friendly 照合行: 不一致ケース（E30 を壊す）と 申請書空ケース
{
  const cl = (o) => JSON.parse(JSON.stringify(o));
  const setC = (vbs, sheet, a1, val) => {
    const rc = C.Cho_a1ToRC_(a1);
    const grid = vbs[sheet] || (vbs[sheet] = []);
    while (grid.length < rc.row) grid.push([]);
    const row = grid[rc.row - 1];
    while (row.length < rc.col) row.push("");
    row[rc.col - 1] = val;
  };
  // E30 に余分な用具を入れて和集合と食い違わせる → 照合=不一致
  const vMis = cl(fx["個人"]); setC(vMis, "申請書", "E30", "手捕り,空気銃,散弾銃,はこわな,くくりわな");
  const frMis = C.Cho_buildFriendly_(C.Cho_buildImport_(C.Cho_makeReader_(vMis)));
  const vr = frMis.applicant.rows.find((r) => r.label === "確認用 ＞ 捕獲方法 照合");
  ok("friendly 不一致→照合=不一致", !!vr && vr.value.indexOf("不一致") === 0, JSON.stringify(vr));
  // E30 を空に → 照合スキップ
  const vEmp = cl(fx["個人"]); setC(vEmp, "申請書", "E30", "");
  const frEmp = C.Cho_buildFriendly_(C.Cho_buildImport_(C.Cho_makeReader_(vEmp)));
  const vr2 = frEmp.applicant.rows.find((r) => r.label === "確認用 ＞ 捕獲方法 照合");
  ok("friendly 申請書空→照合スキップ", !!vr2 && vr2.value.indexOf("照合スキップ") === 0, JSON.stringify(vr2));
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
// 子 SS / 子シート名フォールバック: storage 欠落時は list.childFormsByRow から最初の非空を拾う（同一オブジェクト）
{
  const c = C.Cho_extractRelayContext_({ storage: { spreadsheetId: "ssP" }, list: { childFormsByRow: [[], [{ childSpreadsheetId: "ssFromList", childSheetName: "shtFromList" }]] } });
  eq("relay childSs fallback", c.childSpreadsheetId, "ssFromList");
  eq("relay childSheet fallback", c.childSheetName, "shtFromList");
  eq("relay childSs fallback無し", C.Cho_extractRelayContext_({ storage: { spreadsheetId: "ssP" } }).childSpreadsheetId, "");
  eq("relay childSheet fallback無し", C.Cho_extractRelayContext_({ storage: { spreadsheetId: "ssP" } }).childSheetName, "");
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

console.log(`\n==== ${pass} PASS / ${fail} FAIL ====`);
process.exit(fail ? 1 : 0);
