import { dataStore } from "../../app/state/dataStore.js";
import { registerTable, resetDatabase } from "./sqlEngine.js";

const isPlainObject = (value) => value && typeof value === "object" && !Array.isArray(value);

const coerceFieldValue = (value, type) => {
  if (value === null || value === undefined) return null;
  switch (type) {
    case "number": {
      const n = Number(value);
      return Number.isFinite(n) ? n : null;
    }
    case "date": {
      if (value instanceof Date) return value;
      const parsed = Date.parse(value);
      return Number.isFinite(parsed) ? new Date(parsed) : null;
    }
    case "boolean":
      return !!value;
    default:
      return value;
  }
};

const normalizeFieldDef = (rawField) => {
  if (typeof rawField === "string") return { name: rawField, path: rawField, type: "auto" };
  if (isPlainObject(rawField)) {
    const name = rawField.name || rawField.path || "";
    return {
      name,
      path: rawField.path || name,
      type: rawField.type || "auto",
    };
  }
  return null;
};

const readFieldFromEntry = (entry, path) => {
  if (!entry) return null;
  if (entry[path] !== undefined) return entry[path];
  if (entry.data && entry.data[path] !== undefined) return entry.data[path];
  return null;
};

export function flattenEntry(entry, fieldDefs) {
  const row = {};
  for (const def of fieldDefs) {
    if (!def || !def.name) continue;
    const raw = readFieldFromEntry(entry, def.path || def.name);
    row[def.name] = coerceFieldValue(raw, def.type);
  }
  if (entry?.id !== undefined) row.id = row.id ?? entry.id;
  if (entry?.["No."] !== undefined) row["No."] = row["No."] ?? entry["No."];
  return row;
}

export function flattenEntries(entries, fields) {
  if (!Array.isArray(entries)) return [];
  const fieldDefs = (fields || []).map(normalizeFieldDef).filter(Boolean);
  return entries.map((entry) => flattenEntry(entry, fieldDefs));
}

/**
 * dataSources の各 formId について listEntries を並列で取得
 * @returns {Promise<Object>} { [formId]: entries[] }
 */
export async function fetchRecordsForDataSources(dataSources, fetcher = dataStore.listEntries.bind(dataStore)) {
  const sources = Array.isArray(dataSources) ? dataSources : [];
  const uniqueFormIds = Array.from(new Set(sources.map((ds) => ds?.formId).filter(Boolean)));
  const recordsByForm = {};
  await Promise.all(
    uniqueFormIds.map(async (formId) => {
      try {
        const result = await fetcher(formId);
        recordsByForm[formId] = Array.isArray(result?.entries) ? result.entries : [];
      } catch (err) {
        console.error(`[dataSourceLoader] failed to fetch entries for formId=${formId}:`, err);
        recordsByForm[formId] = [];
      }
    }),
  );
  return recordsByForm;
}

/**
 * dashboard.dataSources の各エイリアスを alasql テーブルとして登録
 */
export function registerDataSources(dataSources, recordsByForm, { databaseName = "nfb_dash" } = {}) {
  resetDatabase(databaseName);
  const sources = Array.isArray(dataSources) ? dataSources : [];
  const tableSummary = {};
  for (const ds of sources) {
    if (!ds || !ds.alias || !ds.formId) continue;
    const entries = recordsByForm[ds.formId] || [];
    const rows = flattenEntries(entries, ds.fields);
    try {
      registerTable(ds.alias, rows);
      tableSummary[ds.alias] = { rowCount: rows.length, formId: ds.formId };
    } catch (err) {
      console.error(`[dataSourceLoader] failed to register alasql table ${ds.alias}:`, err);
      tableSummary[ds.alias] = { rowCount: 0, formId: ds.formId, error: err.message || String(err) };
    }
  }
  return tableSummary;
}

export async function loadDashboardDataSources(dashboard, options = {}) {
  const recordsByForm = await fetchRecordsForDataSources(dashboard?.dataSources, options.fetcher);
  const tables = registerDataSources(dashboard?.dataSources, recordsByForm, options);
  return { recordsByForm, tables };
}
