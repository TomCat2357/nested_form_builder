import { useEffect, useRef, useState } from "react";

// 検索バー用の遅延コミットフック。入力表示は即時、検索実行（onCommit）だけを遅延する。
// IME 変換中（compositionstart〜compositionend）はスケジュールせず、確定時にのみ実行する。
// manual=true のときは入力では一切コミットせず、commitNow() を呼んだときだけ検索を実行する。
export function useDebouncedSearchInput({ value, onCommit, delayMs = 0, manual = false }) {
  const [inputValue, setInputValue] = useState(value);
  const composingRef = useRef(false);
  const timerRef = useRef(null);
  const lastCommittedRef = useRef(value);
  const onCommitRef = useRef(onCommit);
  const inputValueRef = useRef(value);

  const setInput = (next) => {
    inputValueRef.current = next;
    setInputValue(next);
  };

  useEffect(() => {
    onCommitRef.current = onCommit;
  }, [onCommit]);

  // 外部 value（URL の q など）が自分のコミット以外で変わったら表示へ同期する。
  useEffect(() => {
    if (value !== lastCommittedRef.current) {
      lastCommittedRef.current = value;
      setInput(value);
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

  const commitNow = () => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    commit(inputValueRef.current);
  };

  const handleChange = (next) => {
    setInput(next);
    if (manual) return;
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
    setInput(next);
    if (manual) return;
    schedule(next);
  };

  return { inputValue, handleChange, handleCompositionStart, handleCompositionEnd, commitNow };
}
