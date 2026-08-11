/**
 * 列表 / 详情两栏布局。
 *
 * 宽屏时左右同屏，中间一条可拖拽的分隔线；窄屏时退回钻入式——
 * 390px 的屏幕上强行分栏，两边都窄到没法用。
 *
 * 分隔线本身只有 1px 宽，但通过伪元素向两侧各扩 4px 的命中区，
 * 所以细归细，鼠标和手指都抓得住（见 theme.ts 的 `.optik-splitter`）。
 */

import { createSignal, onCleanup, Show, type JSX } from 'solid-js';
import { makeDraggable } from '../platform/gesture';
import { useLayout } from '../layout';

const MIN_RATIO = 0.2;
const MAX_RATIO = 0.75;

function readRatio(key: string, fallback: number): number {
  try {
    const raw = localStorage.getItem(key);
    const value = raw ? Number(raw) : NaN;
    return Number.isFinite(value) ? Math.min(MAX_RATIO, Math.max(MIN_RATIO, value)) : fallback;
  } catch {
    return fallback;
  }
}

export interface SplitViewProps {
  /** 左栏（窄屏时作为主视图）。 */
  list: JSX.Element;
  /** 右栏（窄屏时作为钻入后的视图）。仅在 `hasDetail` 为真时读取。 */
  detail: JSX.Element;
  /** 当前是否有选中项。 */
  hasDetail: boolean;
  /** 宽屏下未选中时右栏的提示文案。 */
  placeholder: string;
  /** 分栏比例的持久化键。 */
  storageKey: string;
}

export function SplitView(props: SplitViewProps): JSX.Element {
  const layout = useLayout();
  const [ratio, setRatio] = createSignal(readRatio(props.storageKey, 0.36));

  let container: HTMLDivElement | undefined;

  const attachSplitter = (element: HTMLElement) => {
    const dispose = makeDraggable(element, {
      // 分隔线是明确的操作对象，不需要大阈值来区分「点击还是拖拽」。
      threshold: 2,
      onMove: ({ dx }) => {
        const width = container?.clientWidth ?? 0;
        if (width === 0) return;
        setRatio((previous) => Math.min(MAX_RATIO, Math.max(MIN_RATIO, previous + dx / width)));
      },
      onEnd: () => {
        try {
          localStorage.setItem(props.storageKey, String(ratio()));
        } catch {
          // 隐私模式下写不了，比例记不住而已。
        }
      },
    });
    onCleanup(dispose);
  };

  return (
    <Show
      when={layout.wide()}
      fallback={
        <Show when={props.hasDetail} fallback={props.list}>
          {props.detail}
        </Show>
      }
    >
      <div ref={container} class="flex h-full min-h-0">
        <div class="min-w-0 h-full" style={{ width: `${ratio() * 100}%` }}>
          {props.list}
        </div>

        <div
          ref={attachSplitter}
          class="optik-splitter"
          role="separator"
          aria-orientation="vertical"
          aria-label="拖动调整两栏宽度"
        />

        <div class="flex-1 min-w-0 h-full">
          <Show
            when={props.hasDetail}
            fallback={
              <div class="h-full row-center justify-center px-6 text-center text-fg-tertiary text-base not-selectable">
                {props.placeholder}
              </div>
            }
          >
            {props.detail}
          </Show>
        </div>
      </div>
    </Show>
  );
}
