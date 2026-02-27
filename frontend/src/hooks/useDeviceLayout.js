import { useState, useEffect, useMemo } from 'react';

// Breakpoints (px, inclusive upper bounds)
const BREAKPOINTS = {
  mobile: 767,    // < 768px
  tablet: 1023,   // 768–1023px
  desktop: 1279,  // 1024–1279px
  // wide: 1280px+
};

function getLayout(width) {
  if (width <= BREAKPOINTS.mobile) return 'mobile';
  if (width <= BREAKPOINTS.tablet) return 'tablet';
  if (width <= BREAKPOINTS.desktop) return 'desktop';
  return 'wide';
}

/**
 * Returns the current device layout category and convenience booleans.
 * Uses window.matchMedia for efficient listening.
 *
 * @returns {{ layout: string, isMobile: boolean, isTablet: boolean, isDesktop: boolean, isWide: boolean }}
 */
export function useDeviceLayout() {
  const [layout, setLayout] = useState(() =>
    typeof window !== 'undefined' ? getLayout(window.innerWidth) : 'desktop'
  );

  useEffect(() => {
    let timeoutId;

    function handleResize() {
      clearTimeout(timeoutId);
      timeoutId = setTimeout(() => {
        setLayout(getLayout(window.innerWidth));
      }, 100);
    }

    window.addEventListener('resize', handleResize, { passive: true });
    return () => {
      window.removeEventListener('resize', handleResize);
      clearTimeout(timeoutId);
    };
  }, []);

  return useMemo(() => ({
    layout,
    isMobile:  layout === 'mobile',
    isTablet:  layout === 'tablet',
    isDesktop: layout === 'desktop',
    isWide:    layout === 'wide',
  }), [layout]);
}
