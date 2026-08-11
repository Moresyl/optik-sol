/**
 * 手势层：拖拽与长按。
 *
 * 移动端调试面板最常见的两个体验 bug，根源都在这里：
 *
 *  1. **长按选不中文字。** 拖拽实现如果在 `touchstart` 里无条件 `preventDefault()`，
 *     iOS 的原生"长按选择 → 弹出拷贝菜单"就被彻底杀死。正确做法是先不阻止默认行为，
 *     等指针位移超过阈值、确认这是一次拖拽之后再接管。
 *
 *  2. **点一下就飘走。** 没有位移阈值时，手指的微小抖动会被当成拖拽，
 *     于是"点击打开面板"变成"把按钮拖到别处"。
 *
 * 这里统一用 Pointer Events，并通过 `setPointerCapture` 保证手指滑出元素后仍能收到
 * 事件；不支持 Pointer Events 的老旧 WebView 自动降级到 Touch Events。
 */

export interface DragState {
  x: number;
  y: number;
  dx: number;
  dy: number;
}

export interface DraggableOptions {
  /** 超过该位移（px）才判定为拖拽，在此之前不阻止默认行为。 */
  threshold?: number;
  onStart?: (state: DragState) => void;
  onMove: (state: DragState) => void;
  onEnd?: (state: DragState, wasDrag: boolean) => void;
}

export function makeDraggable(element: HTMLElement, options: DraggableOptions): () => void {
  const { threshold = 6, onStart, onMove, onEnd } = options;

  let pointerId: number | null = null;
  let startX = 0;
  let startY = 0;
  let lastX = 0;
  let lastY = 0;
  let dragging = false;

  const begin = (id: number, clientX: number, clientY: number) => {
    pointerId = id;
    startX = lastX = clientX;
    startY = lastY = clientY;
    dragging = false;
  };

  const move = (clientX: number, clientY: number, event: Event): boolean => {
    const dx = clientX - startX;
    const dy = clientY - startY;

    if (!dragging) {
      if (Math.hypot(dx, dy) < threshold) return false;
      dragging = true;
      onStart?.({ x: clientX, y: clientY, dx: 0, dy: 0 });
    }

    // 只有确认是拖拽之后才阻止默认行为：在此之前，长按选择和滚动都必须能正常工作。
    if (event.cancelable) event.preventDefault();

    const state: DragState = { x: clientX, y: clientY, dx: clientX - lastX, dy: clientY - lastY };
    lastX = clientX;
    lastY = clientY;
    onMove(state);
    return true;
  };

  const finish = (clientX: number, clientY: number) => {
    const wasDrag = dragging;
    onEnd?.({ x: clientX, y: clientY, dx: 0, dy: 0 }, wasDrag);
    pointerId = null;
    dragging = false;
  };

  const teardown: Array<() => void> = [];

  if (typeof PointerEvent === 'function') {
    const onPointerDown = (event: PointerEvent) => {
      if (pointerId !== null) return; // 忽略多指
      begin(event.pointerId, event.clientX, event.clientY);
      try {
        element.setPointerCapture(event.pointerId);
      } catch {
        // 某些 WebView 不支持捕获；退化为普通事件流。
      }
    };

    const onPointerMove = (event: PointerEvent) => {
      if (pointerId !== event.pointerId) return;
      move(event.clientX, event.clientY, event);
    };

    const onPointerUp = (event: PointerEvent) => {
      if (pointerId !== event.pointerId) return;
      try {
        element.releasePointerCapture(event.pointerId);
      } catch {
        // 已自动释放。
      }
      finish(event.clientX, event.clientY);
    };

    element.addEventListener('pointerdown', onPointerDown);
    element.addEventListener('pointermove', onPointerMove);
    element.addEventListener('pointerup', onPointerUp);
    element.addEventListener('pointercancel', onPointerUp);

    teardown.push(() => {
      element.removeEventListener('pointerdown', onPointerDown);
      element.removeEventListener('pointermove', onPointerMove);
      element.removeEventListener('pointerup', onPointerUp);
      element.removeEventListener('pointercancel', onPointerUp);
    });
  } else {
    const onTouchStart = (event: TouchEvent) => {
      const touch = event.changedTouches[0];
      if (!touch || pointerId !== null) return;
      begin(touch.identifier, touch.clientX, touch.clientY);
    };
    const onTouchMove = (event: TouchEvent) => {
      const touch = findTouch(event.changedTouches, pointerId);
      if (!touch) return;
      move(touch.clientX, touch.clientY, event);
    };
    const onTouchEnd = (event: TouchEvent) => {
      const touch = findTouch(event.changedTouches, pointerId);
      if (!touch) return;
      finish(touch.clientX, touch.clientY);
    };

    // passive:false 是必须的——只有非 passive 监听器才允许在确认拖拽后调用 preventDefault。
    element.addEventListener('touchstart', onTouchStart, { passive: true });
    element.addEventListener('touchmove', onTouchMove, { passive: false });
    element.addEventListener('touchend', onTouchEnd);
    element.addEventListener('touchcancel', onTouchEnd);

    teardown.push(() => {
      element.removeEventListener('touchstart', onTouchStart);
      element.removeEventListener('touchmove', onTouchMove);
      element.removeEventListener('touchend', onTouchEnd);
      element.removeEventListener('touchcancel', onTouchEnd);
    });
  }

  return () => {
    for (const fn of teardown) fn();
    teardown.length = 0;
  };
}

function findTouch(list: TouchList, id: number | null): Touch | undefined {
  if (id === null) return undefined;
  for (let i = 0; i < list.length; i++) {
    const touch = list[i];
    if (touch && touch.identifier === id) return touch;
  }
  return undefined;
}

export interface LongPressOptions {
  /** 触发时长（毫秒）。iOS 原生长按约 500ms，这里保持一致以免手感割裂。 */
  duration?: number;
  /** 手指移动超过该距离则取消，避免与滚动冲突。 */
  tolerance?: number;
  onLongPress: (event: { clientX: number; clientY: number; target: EventTarget | null }) => void;
}

/**
 * 长按检测。
 *
 * 关键点：**绝不调用 `preventDefault()`**。这个监听器只是"观察"，
 * 原生的长按选中与拷贝菜单必须继续正常工作——我们是在它之上追加菜单，而不是取代它。
 */
export function onLongPress(element: HTMLElement, options: LongPressOptions): () => void {
  const { duration = 500, tolerance = 10, onLongPress: handler } = options;

  let timer: ReturnType<typeof setTimeout> | null = null;
  let startX = 0;
  let startY = 0;

  const cancel = () => {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
  };

  const start = (clientX: number, clientY: number, target: EventTarget | null) => {
    cancel();
    startX = clientX;
    startY = clientY;
    timer = setTimeout(() => {
      timer = null;
      handler({ clientX, clientY, target });
    }, duration);
  };

  const maybeCancel = (clientX: number, clientY: number) => {
    if (Math.hypot(clientX - startX, clientY - startY) > tolerance) cancel();
  };

  const onPointerDown = (event: PointerEvent) => start(event.clientX, event.clientY, event.target);
  const onPointerMove = (event: PointerEvent) => maybeCancel(event.clientX, event.clientY);

  // 全部 passive：这个模块永远不干预默认行为。
  element.addEventListener('pointerdown', onPointerDown, { passive: true });
  element.addEventListener('pointermove', onPointerMove, { passive: true });
  element.addEventListener('pointerup', cancel, { passive: true });
  element.addEventListener('pointercancel', cancel, { passive: true });
  element.addEventListener('scroll', cancel, { passive: true, capture: true });

  return () => {
    cancel();
    element.removeEventListener('pointerdown', onPointerDown);
    element.removeEventListener('pointermove', onPointerMove);
    element.removeEventListener('pointerup', cancel);
    element.removeEventListener('pointercancel', cancel);
    element.removeEventListener('scroll', cancel, true);
  };
}
