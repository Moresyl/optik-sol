/**
 * 布局能力探测。
 *
 * 两个维度是**分开**判断的，不能合成一个「是不是桌面」：
 *
 *  - `wide`：容器够不够宽，决定列表和详情能不能同屏（分栏）。
 *    量的是**面板自己的宽度**而不是视口——面板未来可能停靠或嵌在别处，
 *    视口宽度那时就不代表可用宽度了。
 *
 *  - `dense`：指针是不是精确的。横屏手机宽度能到 932px，够分栏，
 *    但输入方式仍然是手指，行高压到 24px 就点不中了。
 *    所以紧凑排版必须由 `pointer: fine` 决定，而不是宽度。
 */

import { createContext, createSignal, onCleanup, useContext, type Accessor } from 'solid-js';

/** 低于这个宽度，左右分栏两边都太窄，不如钻入式。 */
export const SPLIT_MIN_WIDTH = 640;

export interface Layout {
  /** 容器宽度是否足以左右分栏。 */
  wide: Accessor<boolean>;
  /** 是否使用紧凑行高（仅在宽屏 + 精确指针时）。 */
  dense: Accessor<boolean>;
}

const FALLBACK: Layout = { wide: () => false, dense: () => false };

const LayoutContext = createContext<Layout>(FALLBACK);

export const LayoutProvider = LayoutContext.Provider;
export const useLayout = (): Layout => useContext(LayoutContext);

/**
 * 返回布局信号和一个 ref 回调；把 ref 挂到要观察宽度的容器上。
 */
export function createLayout(): Layout & {
  observe: (element: HTMLElement) => void;
  disconnect: () => void;
} {
  const [width, setWidth] = createSignal(0);
  let stopObservation: (() => void) | undefined;
  const disconnect = () => {
    try {
      stopObservation?.();
    } catch {
      // Cleanup must remain safe for third-party ResizeObserver shims.
    }
    stopObservation = undefined;
  };
  onCleanup(disconnect);

  let media: MediaQueryList | null = null;
  try {
    media = typeof matchMedia === 'function' ? matchMedia('(pointer: fine)') : null;
  } catch {
    // Some embedded browsers expose matchMedia but throw for unsupported queries.
  }
  const [fine, setFine] = createSignal(media?.matches ?? false);
  if (media) {
    const onChange = (event: MediaQueryListEvent) => setFine(event.matches);
    if (typeof media.addEventListener === 'function') {
      media.addEventListener('change', onChange);
      onCleanup(() => media?.removeEventListener('change', onChange));
    } else if (typeof media.addListener === 'function') {
      // Safari < 14 and older Android WebViews only implement the legacy pair.
      media.addListener(onChange);
      onCleanup(() => media?.removeListener(onChange));
    }
  }

  const observe = (element: HTMLElement) => {
    disconnect();
    const measure = () => setWidth(element.clientWidth);
    measure();

    if (typeof ResizeObserver === 'function') {
      let observer: ResizeObserver | undefined;
      try {
        observer = new ResizeObserver(measure);
        observer.observe(element);
        stopObservation = () => observer?.disconnect();
        return;
      } catch {
        try {
          observer?.disconnect();
        } catch {
          // Fall through to window events.
        }
      }
    }

    // 旧 WebView 没有 ResizeObserver；面板是全宽的，视口变化足以覆盖。
    globalThis.addEventListener('resize', measure);
    globalThis.addEventListener('orientationchange', measure);
    stopObservation = () => {
      globalThis.removeEventListener('resize', measure);
      globalThis.removeEventListener('orientationchange', measure);
    };
  };

  const wide = () => width() >= SPLIT_MIN_WIDTH;
  return { wide, dense: () => wide() && fine(), observe, disconnect };
}
