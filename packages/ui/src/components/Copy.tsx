/**
 * 复制能力的 UI 封装：轻提示 + 永不失败的手动兜底层。
 *
 * 设计前提是「复制一定会成功」。自动路径失败时（非安全上下文、被策略拦截、
 * WebView 阉割了 execCommand），不是弹一句「复制失败」就完事，而是直接把内容
 * 放进一个已经全选好的文本框里——用户按系统菜单里的「拷贝」即可。
 * 这条路径不依赖任何 API，物理上不可能失败。
 */

import { createSignal, Show, onCleanup, type JSX } from 'solid-js';
import { copyText } from '../platform/clipboard';

export interface CopyController {
  /** 复制文本；失败时自动弹出兜底层。 */
  copy: (text: string, label?: string) => void;
  /** 直接打开兜底层（用于「查看原文」这类主动入口）。 */
  reveal: (text: string, title?: string) => void;
  toast: () => string | null;
  sheet: () => { text: string; title: string } | null;
  closeSheet: () => void;
}

export function createCopyController(): CopyController {
  const [toast, setToast] = createSignal<string | null>(null);
  const [sheet, setSheet] = createSignal<{ text: string; title: string } | null>(null);

  let timer: ReturnType<typeof setTimeout> | undefined;

  const showToast = (message: string) => {
    setToast(message);
    clearTimeout(timer);
    timer = setTimeout(() => setToast(null), 1800);
  };

  onCleanup(() => clearTimeout(timer));

  return {
    copy(text, label = '内容') {
      if (!text) {
        showToast('没有可复制的内容');
        return;
      }
      // 必须同步调用，才能保留用户手势。
      const result = copyText(text);
      if (result.ok) showToast(`已复制${label}（${formatSize(text.length)}）`);
      else setSheet({ text, title: `手动复制${label}` });
    },

    reveal(text, title = '原文') {
      setSheet({ text, title });
    },

    toast,
    sheet,
    closeSheet: () => setSheet(null),
  };
}

function formatSize(length: number): string {
  if (length < 1000) return `${length} 字`;
  return `${(length / 1000).toFixed(1)}k 字`;
}

export function Toast(props: { message: string | null }): JSX.Element {
  return (
    <Show when={props.message}>
      {(message) => (
        <div
          role="status"
          aria-live="polite"
          class="optik-toast-anim not-selectable fixed left-1/2 bottom-20 -translate-x-1/2
                 px-4 py-2.5 rounded-lg text-base max-w-80 text-center
                 bg-[rgba(0,0,0,0.82)] text-white pointer-events-none"
          style={{ 'z-index': 'calc(var(--optik-z) + 20)' }}
        >
          {message()}
        </div>
      )}
    </Show>
  );
}

export function CopySheet(props: {
  data: { text: string; title: string } | null;
  onClose: () => void;
}): JSX.Element {
  let textarea: HTMLTextAreaElement | undefined;

  /**
   * 打开即全选。这样用户只要长按一下就能看到系统的「拷贝」菜单，少一步操作。
   * `preventScroll` 避免聚焦时页面跳动。
   */
  const selectAll = () => {
    if (!textarea) return;
    try {
      textarea.focus({ preventScroll: true });
      textarea.setSelectionRange(0, textarea.value.length);
    } catch {
      // 部分 WebView 对未完成布局的元素调用会抛错，忽略即可。
    }
  };

  return (
    <Show when={props.data}>
      {(data) => (
        <div
          class="fixed inset-0 row-center justify-center p-4 bg-[rgba(0,0,0,0.45)]"
          style={{ 'z-index': 'calc(var(--optik-z) + 30)' }}
          onClick={(event) => {
            // 只有点在遮罩本身（而非弹层内部）才关闭。
            if (event.target === event.currentTarget) props.onClose();
          }}
        >
          <div
            class="flex flex-col gap-3 w-full max-w-120 max-h-[80dvh] p-4 rounded-xl bg-bg border border-line"
            style={{ 'padding-bottom': 'calc(16px + var(--optik-safe-bottom))' }}
          >
            <div class="text-lg font-600 not-selectable">{data().title}</div>
            <div class="text-sm text-fg-secondary leading-5">
              自动复制在当前环境不可用（多为非 HTTPS 页面，此时浏览器不提供剪贴板接口）。
              内容已全选，长按下方文本选择「拷贝」即可。
            </div>
            <textarea
              readOnly
              spellcheck={false}
              autocapitalize="off"
              autocorrect="off"
              value={data().text}
              // 16px 是硬性要求：更小的字号会让 iOS Safari 在聚焦时强制缩放页面。
              class="selectable w-full flex-1 min-h-40 p-2.5 rounded-md resize-none
                     font-mono text-input bg-bg-sunken border border-line"
              ref={(element) => {
                textarea = element;
                // 等一帧，确保元素已完成布局，否则 iOS 上设置选区不生效。
                requestAnimationFrame(selectAll);
              }}
            />
            <div class="row-center justify-end gap-2">
              <button class="btn tap-target" onClick={selectAll}>
                重新全选
              </button>
              <button class="btn-primary tap-target" onClick={props.onClose}>
                完成
              </button>
            </div>
          </div>
        </div>
      )}
    </Show>
  );
}
