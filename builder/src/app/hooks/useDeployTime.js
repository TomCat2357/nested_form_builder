import { useState, useEffect } from "react";

/**
 * デプロイ時刻を meta タグから取得するフック
 */
export function useDeployTime() {
  const [deployTime, setDeployTime] = useState("");
  useEffect(() => {
    const metaTag = document.querySelector("meta[name=\"deploy-time\"]");
    if (metaTag) {
      setDeployTime(metaTag.getAttribute("content") || "");
    }
  }, []);
  return deployTime;
}
