import assert from "node:assert/strict";
import test from "node:test";
import { detectLatField, detectLngField, detectPrefectureField } from "./geoColumnDetect.js";

test("detectLatField: lat / latitude / 緯度", () => {
  assert.equal(detectLatField(["x", "lat"]), "lat");
  assert.equal(detectLatField(["latitude", "v"]), "latitude");
  assert.equal(detectLatField(["緯度", "v"]), "緯度");
  assert.equal(detectLatField(["x", "y"]), null);
});

test("detectLngField: lng / lon / longitude / 経度", () => {
  assert.equal(detectLngField(["x", "lng"]), "lng");
  assert.equal(detectLngField(["lon"]), "lon");
  assert.equal(detectLngField(["longitude"]), "longitude");
  assert.equal(detectLngField(["経度"]), "経度");
});

test("detectPrefectureField: 列名マッチ", () => {
  assert.equal(detectPrefectureField(["都道府県", "v"]), "都道府県");
  assert.equal(detectPrefectureField(["prefecture"]), "prefecture");
});

test("detectPrefectureField: 値ベース検出 (半数以上一致)", () => {
  const rows = [
    { 居住地: "東京都" },
    { 居住地: "大阪府" },
    { 居住地: "北海道" },
    { 居住地: "海外" },
  ];
  assert.equal(detectPrefectureField(["居住地"], rows), "居住地");
});

test("detectPrefectureField: 一致が少ない列は対象外", () => {
  const rows = [
    { 名前: "山田" },
    { 名前: "佐藤" },
    { 名前: "東京都" }, // 1件だけ一致
  ];
  assert.equal(detectPrefectureField(["名前"], rows), null);
});
