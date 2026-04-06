import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..", "..", "..");
const gasClientPath = path.join(__dirname, "gasClient.js");
const gasDirPath = path.join(repoRoot, "gas");

const collectGasClientFunctionCalls = () => {
  const source = fs.readFileSync(gasClientPath, "utf8");
  const pattern = /fetchGasApi\("([^"]+)"/g;
  const functions = new Set();
  let match = pattern.exec(source);

  while (match) {
    functions.add(match[1]);
    match = pattern.exec(source);
  }

  return functions;
};

const collectGasTopLevelFunctions = () => {
  const gsFiles = fs.readdirSync(gasDirPath).filter((fileName) => fileName.endsWith(".gs"));
  const functions = new Set();
  const pattern = /^\s*function\s+([A-Za-z0-9_]+)\s*\(/gm;

  gsFiles.forEach((fileName) => {
    const source = fs.readFileSync(path.join(gasDirPath, fileName), "utf8");
    let match = pattern.exec(source);
    while (match) {
      functions.add(match[1]);
      match = pattern.exec(source);
    }
  });

  return functions;
};

test("gasClient が呼ぶ GAS 関数はすべてトップレベルに定義されている", () => {
  const calledFunctions = collectGasClientFunctionCalls();
  const definedFunctions = collectGasTopLevelFunctions();

  const missingFunctions = [...calledFunctions].filter((functionName) => !definedFunctions.has(functionName));

  assert.deepEqual(
    missingFunctions,
    [],
    `gasClient.js から参照される未定義の GAS 関数があります: ${missingFunctions.join(", ")}`,
  );
});
