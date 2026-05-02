import alasql from "alasql";

const PARAM_RE = /@([A-Za-z_][A-Za-z0-9_]*)/g;

const formatLiteral = (value) => {
  if (value === null || value === undefined) return "NULL";
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return "NULL";
    return String(value);
  }
  if (typeof value === "boolean") return value ? "TRUE" : "FALSE";
  if (value instanceof Date) {
    const ts = value.getTime();
    if (!Number.isFinite(ts)) return "NULL";
    return String(ts);
  }
  return `'${String(value).replace(/'/g, "''")}'`;
};

export function substituteParams(sql, params = {}) {
  if (typeof sql !== "string") throw new Error("SQL は文字列で指定してください");
  return sql.replace(PARAM_RE, (match, name) => {
    if (!Object.prototype.hasOwnProperty.call(params, name)) {
      throw new Error(`パラメータ "${name}" が指定されていません`);
    }
    return formatLiteral(params[name]);
  });
}

export function resetDatabase(databaseName = "nfb_dash") {
  const safeName = String(databaseName).replace(/[^A-Za-z0-9_]/g, "_");
  try { alasql(`DETACH DATABASE ${safeName}`); } catch (_err) { /* not attached */ }
  alasql(`CREATE DATABASE ${safeName}`);
  alasql(`USE ${safeName}`);
  return safeName;
}

export function registerTable(alias, rows) {
  if (typeof alias !== "string" || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(alias)) {
    throw new Error(`不正なテーブルエイリアスです: ${alias}`);
  }
  alasql(`DROP TABLE IF EXISTS ${alias}`);
  alasql(`CREATE TABLE ${alias}`);
  alasql.tables[alias].data = Array.isArray(rows) ? rows : [];
}

export function executeQuery(sql, params = {}) {
  const finalSql = substituteParams(sql, params);
  const result = alasql(finalSql);
  return Array.isArray(result) ? result : [];
}

export function executeQueries(queries = [], params = {}) {
  const results = {};
  const errors = [];
  for (const query of queries) {
    if (!query || !query.id || !query.sql) continue;
    try {
      const queryParams = { ...params };
      if (Array.isArray(query.params)) {
        for (const def of query.params) {
          if (!def || !def.name) continue;
          if (!Object.prototype.hasOwnProperty.call(queryParams, def.name)) {
            queryParams[def.name] = def.default;
          }
        }
      }
      results[query.id] = executeQuery(query.sql, queryParams);
    } catch (err) {
      errors.push({ queryId: query.id, error: err.message || String(err) });
      results[query.id] = [];
    }
  }
  return { results, errors };
}

export { alasql };
