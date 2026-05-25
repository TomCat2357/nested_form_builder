/**
 * alasql に渡す SQL 文字列の組み立てヘルパ。
 * 識別子のブラケット化・文字列リテラルのクォートを 1 箇所に集約し、
 * search / analytics の双方から共有する（各所へのコピーを防ぐ）。
 */

// 識別子を [col] で囲む。alasql のブラケット識別子は ] を含められないため除去する（安全な上位互換）。
export const bracketIdent = (name) => "[" + String(name).replace(/]/g, "") + "]";

// 文字列リテラルを '...' で囲む（' を '' にエスケープ）。
export const quoteString = (value) => "'" + String(value).replace(/'/g, "''") + "'";
