import { useRef, useEffect } from 'react';

/**
 * 最新の値を常に保持するRefを返すカスタムフック
 * 冗長な useEffect + useRef のボイラープレートを削減します。
 */
export function useLatestRef(value) {
  const ref = useRef(value);
  useEffect(() => {
    ref.current = value;
  }, [value]);
  return ref;
}
