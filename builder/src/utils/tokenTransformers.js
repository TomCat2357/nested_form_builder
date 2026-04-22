/**
 * パイプ変換エンジン — フロント向け薄膜ラッパー
 *
 * 実装は gas/pipeEngine.js に集約されており、GAS バックエンドと同じロジックを
 * このファイル経由で再公開する。フロントとバックで変換結果が完全に一致する
 * ことを構造的に保証するための仲介層。
 */

import pipeEngine from "../../../gas/pipeEngine.js";

export const applyPipeTransformers = pipeEngine.applyPipeTransformers;
export const formatNow = pipeEngine.formatNowLocal;
