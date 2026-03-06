import { useState, useEffect, useRef } from 'react';

/** Tracks elapsed time (mm:ss) while active, accumulates total across sessions */
export function useActivityTimer(isActive: boolean) {
  const [elapsed, setElapsed] = useState(0);
  const [total, setTotal] = useState(0);
  const startRef = useRef<number | null>(null);

  useEffect(() => {
    if (isActive) {
      startRef.current = Date.now();
      setElapsed(0);
      const interval = setInterval(() => {
        if (startRef.current) {
          setElapsed(Math.floor((Date.now() - startRef.current) / 1000));
        }
      }, 1000);
      return () => clearInterval(interval);
    } else if (startRef.current) {
      // Just became inactive — add elapsed to total
      const sessionTime = Math.floor((Date.now() - startRef.current) / 1000);
      setTotal(prev => prev + sessionTime);
      startRef.current = null;
      setElapsed(0);
    }
  }, [isActive]);

  return { elapsed, total };
}

export function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
}
