/**
 * 差分同期マージの「新しい方を採る」決定規則について、GAS とフロントのクロスレイヤ
 * コヒーレンスを担保するテスト。
 *
 * 双子実装（層が異なる別関数群・物理統合はしない）:
 *   GAS:    gas/syncRecordsMerge.js … Sync_shouldApplyRecordToSheet_（サーバ→シート apply 判定）
 *   フロント: builder/src/app/state/recordMerge.js … mergeRecordsByModifiedAt（受信→キャッシュ map マージ）
 *
 * 共通する不変条件は「modifiedAt（unix ms）が新しい側を採用する」こと。ただし**タイブレークは
 * 意図的に相違**する:
 *   - GAS は strict `>`（同値ならシート保持＝apply しない。サーバ応答が古いシート値を不必要に上書きしない）
 *   - フロントは `>=`（同値なら incoming 採用＝サーバ確定値でキャッシュを最新化する）
 * この相違は方向（apply vs マージ）が異なるための設計上のもの。将来「不整合」として誤って一方へ
 * 揃えられるのを防ぐため、本テストで非タイ時の一致と同値時の相違の双方を固定する。
 *
 * 補足: modifiedAt の strict-unix-ms 正規化自体は tests/gas-strict-unix-ms.test.cjs が別途担保する。
 * ここでは正規化済みの現実的な unix ms 値（≥1e11）を直接与え、決定規則のみを突き合わせる。
 */

const assert = require("node:assert/strict");
const test = require("node:test");

const gas = require("../gas/syncRecordsMerge.js");

async function loadFront() {
  return import("../builder/src/app/state/recordMerge.js");
}

// GAS: 既存シート行(sheetModifiedAt) に対し incoming(cacheModifiedAt) を apply するか。
function gasApplies(existing, incoming) {
  return gas.Sync_shouldApplyRecordToSheet_({
    hasSheetRow: existing !== null,
    sheetModifiedAt: existing,
    cacheModifiedAt: incoming,
  });
}

// フロント: 既存(existing) のキャッシュへ incoming をマージした結果、incoming が採用されたか。
function frontReplaces(front, existing, incoming) {
  const existingMap = existing === null ? {} : { e: { id: "e", modifiedAtUnixMs: existing } };
  const merged = front.mergeRecordsByModifiedAt(existingMap, [{ id: "e", modifiedAtUnixMs: incoming }]);
  // incoming（modifiedAtUnixMs: incoming）に置き換わったか。existing が無ければ常に採用。
  return merged.e?.modifiedAtUnixMs === incoming;
}

// 現実的な unix ms（フロントの strict 閾値 1e11 を超える値）でケースを作る。
const T0 = Date.UTC(2026, 0, 1); // 古い
const T1 = Date.UTC(2026, 5, 1); // 新しい
const T2 = Date.UTC(2026, 11, 1); // さらに新しい

// 非タイ + existing 欠如のケース（両層が一致すべき集合）
const AGREEMENT_CASES = [
  { name: "existing 無し → 採用", existing: null, incoming: T1 },
  { name: "incoming が新しい → 採用", existing: T0, incoming: T1 },
  { name: "incoming が古い → 不採用", existing: T2, incoming: T1 },
  { name: "incoming が大幅に新しい → 採用", existing: T0, incoming: T2 },
];

test("非タイ/欠如ケース: GAS apply と フロント replace の決定が一致", async () => {
  const front = await loadFront();
  for (const c of AGREEMENT_CASES) {
    const g = gasApplies(c.existing, c.incoming);
    const f = frontReplaces(front, c.existing, c.incoming);
    assert.equal(g, f, `${c.name}: GAS=${g} front=${f}`);
  }
});

test("同値タイブレークは意図的に相違: GAS=保持(false) / フロント=採用(true)", async () => {
  const front = await loadFront();
  const tie = T1;
  assert.equal(gasApplies(tie, tie), false, "GAS は同値で apply しない（strict >）");
  assert.equal(frontReplaces(front, tie, tie), true, "フロントは同値で incoming 採用（>=）");
});

test("GAS: シート行が無い / シート modifiedAt が不正(0や非数)なら常に apply", () => {
  assert.equal(gasApplies(null, T0), true);
  assert.equal(gas.Sync_shouldApplyRecordToSheet_({ hasSheetRow: true, sheetModifiedAt: 0, cacheModifiedAt: T0 }), true);
  assert.equal(gas.Sync_shouldApplyRecordToSheet_({ hasSheetRow: true, sheetModifiedAt: NaN, cacheModifiedAt: T0 }), true);
});
