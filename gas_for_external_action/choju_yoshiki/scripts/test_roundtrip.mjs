// 取り込み/書き出し/往復の純ロジック検証（GAS API 不要）。
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
const sandbox = { module: { exports: {} }, console, Date, Math, JSON, RegExp, Number, String, Array, Object, isNaN, isFinite };
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

// ---- EXPORT golden ----
const golden = {
  generatedAt: "2026-06-01T00:00:00.000Z",
  record: { no: 1, items: [
    { question: "申請者情報/申請者の個人・法人の別", value: "個人" },
    { question: "捕獲等又は採取等の目的", value: "管理（被害防止）" },
    { question: "捕獲等又は採取等の期間/開始", value: "2026-06-01" },
    { question: "捕獲等又は採取等の期間/終了", value: "2026-06-30" },
    { question: "捕獲等又は採取等の区域/所在地", value: "札幌市南区定山渓405" },
    { question: "捕獲等又は採取等をしたあとの処置", value: "埋設" },
    { question: "従事者情報/#1/代表的個人", value: "はい" },
    { question: "従事者情報/#1/氏名", value: "秋　はじめ" },
    { question: "従事者情報/#1/" + SP, value: "キツネ" },
    { question: "従事者情報/#1/" + SP + "/キツネ/捕獲頭数", value: "5" },
    { question: "従事者情報/#1/" + M, value: "わな" },
    { question: "従事者情報/#1/" + M + "/わな/道具の種類", value: "くくりわな" },
    { question: "従事者情報/#1/" + M + "/わな/免許の必要性", value: "必要" },
    { question: "従事者情報/#1/" + M + "/わな/免許の必要性/必要/免許情報/番号", value: "石狩第1234号" },
    { question: "従事者情報/#2/氏名", value: "冬村　多才" },
    { question: "従事者情報/#2/" + SP, value: "キツネ" },
    { question: "従事者情報/#2/" + SP + "/キツネ/捕獲頭数", value: "3" },
    { question: "従事者情報/#2/" + M, value: "手捕り" }
  ] }
};
const model = C.Cho_buildModel_(golden);
const ap = C.Cho_appCells_(model);
eq("export キツネ合算 F24", ap["F24"], 8);
eq("export methodText", model.methodText, "手捕り,くくりわな");
eq("export licNo join", model.workers[0].methods[0].licNo, "石狩第1234号");

// ---- ROUND-TRIP: 個人想定 import → export → 申請書セル一致 ----
const items = [];
for (const k in impK.parent.fields) items.push({ question: k, value: impK.parent.fields[k] });
impK.children.forEach((ch, i) => { for (const k in ch) items.push({ question: "従事者情報/#" + (i + 1) + "/" + k, value: ch[k] }); });
const rtAp = C.Cho_appCells_(C.Cho_buildModel_({ generatedAt: "2026-06-01T00:00:00.000Z", record: { items } }));
// 申請書の種数は名簿の集計式（キャッシュは Sheets/Excel 再計算なので fixture では空）。
// よって「取り込んだ子の合算」== 再書き出しの 申請書セル を不変条件として検証する。
const sumHead = (sp) => impK.children.reduce((a, ch) => a + (Number(ch[SP + "/" + sp + "/捕獲頭数"]) || 0), 0);
const sumEgg = (sp) => impK.children.reduce((a, ch) => a + (Number(ch[SP + "/" + sp + "/採取卵数"]) || 0), 0);
eq("roundtrip キジバト頭数=F18", rtAp["F18"] || 0, sumHead("キジバト"));
eq("roundtrip スズメ頭数=F20", rtAp["F20"] || 0, sumHead("スズメ"));
eq("roundtrip キツネ頭数=F24", rtAp["F24"] || 0, sumHead("キツネ"));
eq("roundtrip キジバト卵数=I18", rtAp["I18"] || 0, sumEgg("キジバト"));

console.log(`\n==== ${pass} PASS / ${fail} FAIL ====`);
process.exit(fail ? 1 : 0);
