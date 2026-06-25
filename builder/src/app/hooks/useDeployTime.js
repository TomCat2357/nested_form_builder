import { useState, useEffect } from "react";
import { getDeployInfo } from "../../services/gasClient.js";

/**
 * デプロイ時刻を取得するフック。
 * - フロント（index.html）: deploy.ps1 が焼き込む <meta name="deploy-time"> から同期的に読む。
 * - バックエンド（Bundle.gs）: nfbGetDeployInfo（GAS API）から非同期に取得する。
 *
 * GAS 環境外（ローカル dev など）ではバックエンド取得が失敗するため空のままにする。
 *
 * @returns {{ frontendDeployTime: string, backendDeployTime: string }}
 */
export function useDeployTime() {
  const [frontendDeployTime, setFrontendDeployTime] = useState("");
  const [backendDeployTime, setBackendDeployTime] = useState("");

  useEffect(() => {
    const metaTag = document.querySelector("meta[name=\"deploy-time\"]");
    if (metaTag) {
      setFrontendDeployTime(metaTag.getAttribute("content") || "");
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    getDeployInfo()
      .then((info) => {
        if (!cancelled) setBackendDeployTime(info?.backendDeployTime || "");
      })
      .catch(() => {
        // GAS 環境外・未デプロイ等では取得できない。空のままにする。
      });
    return () => { cancelled = true; };
  }, []);

  return { frontendDeployTime, backendDeployTime };
}
