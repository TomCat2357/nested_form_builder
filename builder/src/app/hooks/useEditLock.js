import { useCallback, useRef, useState } from "react";

export const useEditLock = () => {
  const lockRef = useRef(false);
  const [isReadLocked, setIsReadLocked] = useState(false);

  const withReadLock = useCallback(async (asyncFn) => {
    if (lockRef.current) return null;
    lockRef.current = true;
    setIsReadLocked(true);
    try {
      return await asyncFn();
    } finally {
      lockRef.current = false;
      setIsReadLocked(false);
    }
  }, []);

  return { isReadLocked, withReadLock };
};
