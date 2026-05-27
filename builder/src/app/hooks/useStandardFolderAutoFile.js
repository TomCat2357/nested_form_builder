import { useEffect, useState } from "react";
import { hasScriptRun, getStandardFolderAutoFile } from "../../services/gasClient.js";

// 標準フォルダの「自動整理」フラグを取得する軽量フック。
// GAS 環境でのみ取得し、モジュールレベルで 1 度だけ取得してキャッシュする
// （複数のフィールドエディタから呼ばれても google.script.run は 1 回で済ませる）。
let cachedValue = null;
let inflight = null;

export function useStandardFolderAutoFile() {
  const [autoFile, setAutoFile] = useState(cachedValue === null ? false : cachedValue);
  const [loaded, setLoaded] = useState(cachedValue !== null);

  useEffect(() => {
    if (cachedValue !== null) {
      setAutoFile(cachedValue);
      setLoaded(true);
      return undefined;
    }
    if (!hasScriptRun()) {
      setLoaded(true);
      return undefined;
    }
    let active = true;
    if (!inflight) {
      inflight = getStandardFolderAutoFile()
        .then((value) => { cachedValue = value; return value; })
        .catch(() => { cachedValue = false; return false; });
    }
    inflight.then((value) => {
      if (!active) return;
      setAutoFile(value);
      setLoaded(true);
    });
    return () => { active = false; };
  }, []);

  return { autoFile, loaded };
}
