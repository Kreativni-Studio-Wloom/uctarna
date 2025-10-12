'use client';

import { useCallback, useRef } from 'react';

interface TouchEventOptions {
  onTouch?: () => void;
  onClick?: () => void;
  preventDoubleTap?: boolean;
  delay?: number;
}

export const useTouchEvents = (options: TouchEventOptions = {}) => {
  const {
    onTouch,
    onClick,
    preventDoubleTap = true,
    delay = 300
  } = options;

  const lastTouchTimeRef = useRef<number>(0);
  const touchTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  const handleTouch = useCallback((e: React.TouchEvent) => {
    e.preventDefault();
    
    if (preventDoubleTap) {
      const now = Date.now();
      const timeSinceLastTouch = now - lastTouchTimeRef.current;
      
      if (timeSinceLastTouch < delay) {
        return; // Ignoruj dvojitý dotyk
      }
      
      lastTouchTimeRef.current = now;
    }

    // Clear any existing timeout
    if (touchTimeoutRef.current) {
      clearTimeout(touchTimeoutRef.current);
    }

    // Set a new timeout to handle the touch
    touchTimeoutRef.current = setTimeout(() => {
      onTouch?.();
    }, 50); // Malé zpoždění pro lepší UX
  }, [onTouch, preventDoubleTap, delay]);

  const handleClick = useCallback((e: React.MouseEvent) => {
    // Pro desktop zařízení
    if (!('ontouchstart' in window)) {
      onClick?.();
    }
  }, [onClick]);

  const handleTouchEnd = useCallback((e: React.TouchEvent) => {
    e.preventDefault();
    
    // Clear timeout if touch is cancelled
    if (touchTimeoutRef.current) {
      clearTimeout(touchTimeoutRef.current);
      touchTimeoutRef.current = null;
    }
  }, []);

  return {
    onTouchStart: handleTouch,
    onTouchEnd: handleTouchEnd,
    onClick: handleClick,
    // Pro kompatibilitu s existujícími onClick handlery
    onTouchClick: handleTouch
  };
};
