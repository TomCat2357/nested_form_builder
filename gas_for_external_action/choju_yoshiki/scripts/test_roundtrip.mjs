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
    { question: "従事者情報/#1/" + M + "/わな/免許の必要性/必要/免許情報/番号接頭語", value: "石狩" },
    { question: "従事者情報/#1/" + M + "/わな/免許の必要性/必要/免許情報/番号", value: "1234" },
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
const grid = fx["個人"]["申請書"];
const oc = (a1) => { const m = a1.match(/^([A-Z])(\d+)$/); return grid[+m[2] - 1][m[1].charCodeAt(0) - 65]; };
for (const cell of ["F18", "F20", "F24", "I18"]) {
  const got = rtAp[cell] === "" ? null : rtAp[cell], orig = oc(cell);
  ok("roundtrip " + cell, String(got) === String(orig == null ? "" : orig), `got=${got} orig=${orig}`);
}

console.log(`\n==== ${pass} PASS / ${fail} FAIL ====`);
process.exit(fail ? 1 : 0);
