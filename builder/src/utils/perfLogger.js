/**
 * パフォーマンス計測とサマリー出力
 */

const resolveDefaultVerbose = () => {
  try {
    return Boolean(import.meta?.env?.DEV);
  } catch {
    return false;
  }
};

class PerformanceLogger {
  constructor({ verbose = resolveDefaultVerbose() } = {}) {
    this.verbose = !!verbose;
    this.autoSummaryTimer = null;
    this.reset();
  }

  setVerbose(enabled) {
    this.verbose = !!enabled;
  }

  isVerbose() {
    return this.verbose;
  }

  logVerbose(scope, message, payload) {
    if (!this.verbose) return;
    const prefix = scope ? `[perf][${scope}]` : "[perf]";
    if (payload === undefined) {
      console.log(`${prefix} ${message}`);
      return;
    }
    console.log(`${prefix} ${message}`, payload);
  }

  reset() {
    this.stats = {
      forms: {
        gasReads: [],
        cacheSaves: [],
        cacheHits: [],
      },
      records: {
        gasReads: [],
        cacheHits: [],
        cacheUpdates: [],
        listOperations: [],
      },
    };
  }

  // フォーム取得のGAS読み取り
  logFormGasRead(durationMs, count = 1) {
    this.stats.forms.gasReads.push({ durationMs, count, timestamp: Date.now() });
  }

  // フォームキャッシュ保存
  logFormCacheSave(durationMs, count = 1) {
    this.stats.forms.cacheSaves.push({ durationMs, count, timestamp: Date.now() });
  }

  // フォームキャッシュヒット
  logFormCacheHit(durationMs, count = 1) {
    this.stats.forms.cacheHits.push({ durationMs, count, timestamp: Date.now() });
  }

  // レコード取得のGAS読み取り
  logRecordGasRead(durationMs, entryId = null, operationType = "single") {
    this.stats.records.gasReads.push({ durationMs, entryId, operationType, timestamp: Date.now() });
  }

  // レコードキャッシュヒット
  logRecordCacheHit(durationMs, entryId = null) {
    this.stats.records.cacheHits.push({ durationMs, entryId, timestamp: Date.now() });
  }

  // レコードキャッシュ更新
  logRecordCacheUpdate(durationMs, entryId = null) {
    this.stats.records.cacheUpdates.push({ durationMs, entryId, timestamp: Date.now() });
  }

  // レコード一覧取得
  logRecordList(durationMs, count, fromCache = false) {
    this.stats.records.listOperations.push({ durationMs, count, fromCache, timestamp: Date.now() });
  }

  // 統計計算ヘルパー
  calculateStats(items, durationKey = "durationMs") {
    if (!items || items.length === 0) {
      return { count: 0, total: 0, avg: 0, min: 0, max: 0 };
    }
    const durations = items.map((item) => item[durationKey] || 0);
    const total = durations.reduce((sum, d) => sum + d, 0);
    return {
      count: items.length,
      total: Math.round(total),
      avg: Math.round(total / items.length),
      min: Math.round(Math.min(...durations)),
      max: Math.round(Math.max(...durations)),
    };
  }

  // サマリー出力
  printSummary({ force = false } = {}) {
    if (!force && !this.verbose) return;
    console.log("\n");
    console.log("╔════════════════════════════════════════════════════════╗");
    console.log("║        📊 パフォーマンスサマリー                      ║");
    console.log("╠════════════════════════════════════════════════════════╣");

    // フォーム操作
    const formGasStats = this.calculateStats(this.stats.forms.gasReads);
    const formCacheSaveStats = this.calculateStats(this.stats.forms.cacheSaves);
    const formCacheHitStats = this.calculateStats(this.stats.forms.cacheHits);

    if (formGasStats.count > 0 || formCacheHitStats.count > 0) {
      console.log("║ 📁 フォーム取得                                        ║");
      if (formGasStats.count > 0) {
        console.log(`║   ⚡ GAS読み取り: ${formGasStats.count}回 (合計 ${formGasStats.total}ms, 平均 ${formGasStats.avg}ms)`);
      }
      if (formCacheSaveStats.count > 0) {
        console.log(`║   💾 キャッシュ保存: ${formCacheSaveStats.count}回 (合計 ${formCacheSaveStats.total}ms)`);
      }
      if (formCacheHitStats.count > 0) {
        console.log(`║   ✅ キャッシュヒット: ${formCacheHitStats.count}回 (合計 ${formCacheHitStats.total}ms, 平均 ${formCacheHitStats.avg}ms)`);
      }
      console.log("╠════════════════════════════════════════════════════════╣");
    }

    // レコード操作
    const recordGasStats = this.calculateStats(this.stats.records.gasReads);
    const recordCacheHitStats = this.calculateStats(this.stats.records.cacheHits);
    const recordCacheUpdateStats = this.calculateStats(this.stats.records.cacheUpdates);
    const recordListStats = this.calculateStats(this.stats.records.listOperations);

    if (recordGasStats.count > 0 || recordCacheHitStats.count > 0 || recordListStats.count > 0) {
      console.log("║ 📝 レコード操作                                        ║");
      if (recordCacheHitStats.count > 0) {
        console.log(`║   ✅ キャッシュヒット: ${recordCacheHitStats.count}回 (合計 ${recordCacheHitStats.total}ms, 平均 ${recordCacheHitStats.avg}ms)`);
      }
      if (recordGasStats.count > 0) {
        console.log(`║   ⚡ GAS読み取り: ${recordGasStats.count}回 (合計 ${recordGasStats.total}ms, 平均 ${recordGasStats.avg}ms)`);
      }
      if (recordCacheUpdateStats.count > 0) {
        console.log(`║   💾 キャッシュ更新: ${recordCacheUpdateStats.count}回 (合計 ${recordCacheUpdateStats.total}ms, 平均 ${recordCacheUpdateStats.avg}ms)`);
      }
      if (recordListStats.count > 0) {
        console.log(`║   📋 一覧取得: ${recordListStats.count}回 (合計 ${recordListStats.total}ms, 平均 ${recordListStats.avg}ms)`);
      }
      console.log("╠════════════════════════════════════════════════════════╣");
    }

    // 合計
    const totalGasTime = formGasStats.total + recordGasStats.total;
    const totalCacheTime = formCacheSaveStats.total + formCacheHitStats.total + recordCacheHitStats.total + recordCacheUpdateStats.total;
    const totalGasCount = formGasStats.count + recordGasStats.count;
    const totalCacheCount = formCacheSaveStats.count + formCacheHitStats.count + recordCacheHitStats.count + recordCacheUpdateStats.count;
    const cacheEfficiency = totalGasCount + totalCacheCount > 0 ? Math.round((totalCacheCount / (totalGasCount + totalCacheCount)) * 100) : 0;

    console.log("║ 🎯 合計                                                ║");
    console.log(`║   GAS呼び出し: ${totalGasCount}回 (${totalGasTime}ms)`);
    console.log(`║   キャッシュ操作: ${totalCacheCount}回 (${totalCacheTime}ms)`);
    console.log(`║   キャッシュ効率: ${cacheEfficiency}%`);
    if (totalGasTime > 0 && totalCacheTime > 0) {
      const speedup = Math.round((totalGasTime / totalCacheTime) * 10) / 10;
      console.log(`║   高速化率: ${speedup}倍`);
    }
    console.log("╚════════════════════════════════════════════════════════╝");
    console.log("\n");
  }

  // ショートカット: 定期的にサマリー出力
  enableAutoSummary(intervalMs = 30000) {
    if (this.autoSummaryTimer) {
      clearInterval(this.autoSummaryTimer);
      this.autoSummaryTimer = null;
    }
    if (!this.verbose) {
      return;
    }
    this.autoSummaryTimer = setInterval(() => {
      this.printSummary();
    }, intervalMs);
  }

  disableAutoSummary() {
    if (this.autoSummaryTimer) {
      clearInterval(this.autoSummaryTimer);
      this.autoSummaryTimer = null;
    }
  }
}

// グローバルインスタンス
export const perfLogger = new PerformanceLogger();

// グローバルからアクセス可能にする
if (typeof window !== "undefined") {
  window.perfLogger = perfLogger;
  window.showPerfSummary = () => perfLogger.printSummary({ force: true });
  perfLogger.logVerbose("logger", "window.showPerfSummary() でサマリーを表示できます");
}

// 開発時に自動サマリーを有効化
if (typeof window !== "undefined" && (window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1")) {
  perfLogger.enableAutoSummary(60000); // 1分ごと
  perfLogger.logVerbose("logger", "自動サマリーを有効化しました（60秒間隔）");
}
