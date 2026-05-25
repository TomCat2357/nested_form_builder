import { useEffect, useRef, useState } from "react";

// 検索バー用の遅延コミットフック。入力表示は即時、検索実行（onCommit）だけを遅延する。
// IME 変換中（compositionstart〜compositionend）はスケジュールせず、確定時にのみ実行する。
export function useDebouncedSearchInput({ value, onCommit, delayMs = 0 }) {
  const [inputValue, setInputValue] = useState(value);
  const composingRef = useRef(false);
  const timerRef = useRef(null);
  const lastCommittedRef = useRef(value);
  const onCommitRef = useRef(onCommit);

  useEffect(() => {
    onCommitRef.current = onCommit;
  }, [onCommit]);

  // 外部 value（URL の q など）が自分のコミット以外で変わったら表示へ同期する。
  useEffect(() => {
    if (value !== lastCommittedRef.current) {
      lastCommittedRef.current = value;
      setInputValue(value);
    }
  }, [value]);

  useEffect(() => () => {
    if (timerRef.current) clearTimeout(timerRef.current);
  }, []);

  const commit = (next) => {
    lastCommittedRef.current = next;
    onCommitRef.current?.(next);
  };

  const schedule = (next) => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    const delay = Number(delayMs) > 0 ? Number(delayMs) : 0;
    if (delay <= 0) {
      commit(next);
      return;
    }
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      commit(next);
    }, delay);
  };

  const handleChange = (next) => {
    setInputValue(next);
    if (composingRef.current) return;
    schedule(next);
  };

  const handleCompositionStart = () => {
    composingRef.current = true;
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  };

  const handleCompositionEnd = (next) => {
    composingRef.current = false;
    setInputValue(next);
    schedule(next);
  };

  return { inputValue, handleChange, handleCompositionStart, handleCompositionEnd };
}
