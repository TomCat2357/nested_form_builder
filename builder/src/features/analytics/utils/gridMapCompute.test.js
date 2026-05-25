import assert from "node:assert/strict";
import test from "node:test";
import { computeGridMap } from "./gridMapCompute.js";

test("空配列は空", () => {
  assert.deepEqual(computeGridMap([], "lat", "lng", "v", 0.1), []);
});

test("グリッドサイズ 1.0 で東京周辺の点が同セルに入る", () => {
  const rows = [
    { lat: 35.5, lng: 139.5 },
    { lat: 35.7, lng: 139.7 },
  ];
  const cells = computeGridMap(rows, "lat", "lng", "", 1.0);
  assert.equal(cells.length, 1);
  assert.equal(cells[0].count, 2);
  assert.equal(cells[0].value, 2);
});

test("valueField 指定で sum 集計", () => {
  const rows = [
    { lat: 35.5, lng: 139.5, v: 10 },
    { lat: 35.7, lng: 139.7, v: 20 },
  ];
  const cells = computeGridMap(rows, "lat", "lng", "v", 1.0);
  assert.equal(cells[0].sum, 30);
  assert.equal(cells[0].value, 30);
});

test("無効な lat/lng はスキップ", () => {
  const rows = [
    { lat: 35.5, lng: 139.5 },
    { lat: "abc", lng: null },
    { lat: 36.5, lng: 140.5 },
  ];
  const cells = computeGridMap(rows, "lat", "lng", "", 1.0);
  assert.equal(cells.length, 2);
});

test("セル境界が gridSize に揃う", () => {
  const rows = [{ lat: 35.5, lng: 139.5 }];
  const [c] = computeGridMap(rows, "lat", "lng", "", 1.0);
  assert.equal(c.south, 35);
  assert.equal(c.north, 36);
  assert.equal(c.west, 139);
  assert.equal(c.east, 140);
  assert.equal(c.centerLat, 35.5);
  assert.equal(c.centerLng, 139.5);
});
