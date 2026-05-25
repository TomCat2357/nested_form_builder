import React, { useRef, useState } from "react";
import { loadLeaflet } from "../utils/cdnLoader.js";
import { useCancellable } from "../../../app/hooks/useCancellable.js";
import { findPrefecture } from "../utils/japanPrefectures.js";
import { computeGridMap } from "../utils/gridMapCompute.js";
import { formatNumber } from "../utils/formatNumber.js";

const TILE_URL = "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png";
const TILE_ATTRIBUTION = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';

// 日本全体を収めるデフォルトビュー (regionMap / 緯度経度未指定時)
const JAPAN_DEFAULT_CENTER = [37.5, 138.5];
const JAPAN_DEFAULT_ZOOM = 5;

/**
 * MapRenderer — Leaflet による pinMap / gridMap / regionMap 描画。
 * type に応じて配置するレイヤを切り替える。
 */
export default function MapRenderer({ type, viz, rows }) {
  const containerRef = useRef(null);
  const mapRef = useRef(null);
  const [error, setError] = useState("");

  useCancellable(async (isCancelled, setCleanup) => {
    let resizeObserver = null;
    setCleanup(() => {
      if (resizeObserver) {
        try { resizeObserver.disconnect(); } catch (_e) { /* noop */ }
      }
      if (mapRef.current) {
        try { mapRef.current.remove(); } catch (_e) { /* noop */ }
        mapRef.current = null;
      }
    });

    let L;
    try {
      L = await loadLeaflet();
    } catch (err) {
      if (!isCancelled()) setError(err.message || String(err));
      return;
    }
    if (isCancelled() || !containerRef.current) return;

    // 既存マップを破棄してから作り直す
    if (mapRef.current) {
      try { mapRef.current.remove(); } catch (_e) { /* noop */ }
      mapRef.current = null;
    }

    const map = L.map(containerRef.current).setView(JAPAN_DEFAULT_CENTER, JAPAN_DEFAULT_ZOOM);
    L.tileLayer(TILE_URL, { attribution: TILE_ATTRIBUTION, maxZoom: 19 }).addTo(map);
    mapRef.current = map;

    const layer = renderLayer(L, type, viz, rows);
    if (layer) {
      layer.addTo(map);
      if (typeof layer.getBounds === "function") {
        try {
          const b = layer.getBounds();
          if (b && b.isValid && b.isValid()) {
            map.fitBounds(b, { padding: [20, 20] });
          }
        } catch (_e) { /* noop */ }
      }
    }

    if (typeof ResizeObserver !== "undefined") {
      resizeObserver = new ResizeObserver(() => {
        if (mapRef.current) mapRef.current.invalidateSize();
      });
      resizeObserver.observe(containerRef.current);
    }
  }, [type, viz, rows]);

  if (error) {
    return <p className="nf-text-warning">地図描画エラー: {error}</p>;
  }
  return <div ref={containerRef} style={{ width: "100%", height: 380, borderRadius: 4, overflow: "hidden" }} />;
}

function renderLayer(L, type, viz, rows) {
  if (type === "pinMap") return renderPinMap(L, viz, rows);
  if (type === "gridMap") return renderGridMap(L, viz, rows);
  if (type === "regionMap") return renderRegionMap(L, viz, rows);
  return null;
}

function renderPinMap(L, viz, rows) {
  const cfg = viz?.geo || {};
  if (!cfg.latField || !cfg.lngField) return null;
  const valueField = cfg.valueField || "";
  const group = L.featureGroup();

  // 値の min/max を求めて半径スケーリングに使う
  const values = [];
  for (const r of rows) {
    if (!r) continue;
    if (!valueField) continue;
    const v = Number(r[valueField]);
    if (Number.isFinite(v)) values.push(v);
  }
  const vMin = values.length ? Math.min(...values) : 0;
  const vMax = values.length ? Math.max(...values) : 0;

  for (const r of rows) {
    if (!r) continue;
    const lat = Number(r[cfg.latField]);
    const lng = Number(r[cfg.lngField]);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
    const v = valueField ? Number(r[valueField]) : null;
    const radius = scaleRadius(v, vMin, vMax);
    const marker = L.circleMarker([lat, lng], {
      radius,
      color: "#4C7EFF",
      weight: 1,
      fillColor: "#4C7EFF",
      fillOpacity: 0.6,
    });
    marker.bindTooltip(buildPinTooltip(r, cfg, valueField, viz?.format));
    group.addLayer(marker);
  }
  return group;
}

function renderGridMap(L, viz, rows) {
  const cfg = viz?.geo || {};
  if (!cfg.latField || !cfg.lngField) return null;
  const cells = computeGridMap(rows, cfg.latField, cfg.lngField, cfg.valueField || "", cfg.gridSize || 0.1);
  if (cells.length === 0) return null;
  const max = Math.max(...cells.map((c) => c.value));
  const min = Math.min(...cells.map((c) => c.value));
  const group = L.featureGroup();

  for (const c of cells) {
    const intensity = max === min ? 1 : (c.value - min) / (max - min);
    const fillColor = colorFromIntensity(intensity);
    const rect = L.rectangle([[c.south, c.west], [c.north, c.east]], {
      color: fillColor,
      weight: 1,
      fillColor,
      fillOpacity: 0.55,
    });
    rect.bindTooltip(`値: ${formatNumber(c.value, viz?.format)} (${c.count} 件)`);
    group.addLayer(rect);
  }
  return group;
}

function renderRegionMap(L, viz, rows) {
  const cfg = viz?.geo || {};
  const field = cfg.regionField || "";
  if (!field) return null;
  const valueField = cfg.valueField || "";

  // 都道府県別に集計
  const byPref = new Map();
  for (const r of rows) {
    if (!r) continue;
    const pref = findPrefecture(r[field]);
    if (!pref) continue;
    let agg = byPref.get(pref.code);
    if (!agg) {
      agg = { pref, count: 0, sum: 0 };
      byPref.set(pref.code, agg);
    }
    agg.count += 1;
    if (valueField) {
      const v = Number(r[valueField]);
      if (Number.isFinite(v)) agg.sum += v;
    }
  }
  if (byPref.size === 0) return null;

  const useCount = !valueField;
  const values = Array.from(byPref.values()).map((a) => useCount ? a.count : a.sum);
  const max = Math.max(...values);
  const min = Math.min(...values);
  const group = L.featureGroup();

  for (const agg of byPref.values()) {
    const v = useCount ? agg.count : agg.sum;
    const intensity = max === min ? 1 : (v - min) / (max - min);
    const radius = 8 + intensity * 22;
    const fillColor = colorFromIntensity(intensity);
    const marker = L.circleMarker([agg.pref.lat, agg.pref.lng], {
      radius,
      color: "#fff",
      weight: 1,
      fillColor,
      fillOpacity: 0.8,
    });
    marker.bindTooltip(`${agg.pref.name}: ${formatNumber(v, viz?.format)}${useCount ? " 件" : ""}`);
    group.addLayer(marker);
  }
  return group;
}

function buildPinTooltip(r, cfg, valueField, format) {
  const parts = [];
  if (valueField) {
    parts.push(`${valueField}: ${formatNumber(r[valueField], format)}`);
  }
  parts.push(`${cfg.latField}, ${cfg.lngField}: ${r[cfg.latField]}, ${r[cfg.lngField]}`);
  return parts.join("<br/>");
}

function scaleRadius(v, min, max) {
  if (!Number.isFinite(v)) return 5;
  if (max === min) return 8;
  const t = (v - min) / (max - min);
  return 4 + t * 16;
}

// 0..1 の intensity を青→赤のグラデーションで返す。
function colorFromIntensity(t) {
  const x = Math.max(0, Math.min(1, t));
  const r = Math.round(76 + (255 - 76) * x);
  const g = Math.round(126 + (107 - 126) * x);
  const b = Math.round(255 + (107 - 255) * x);
  return `rgb(${r},${g},${b})`;
}

