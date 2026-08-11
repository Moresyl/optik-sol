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
  /**
   * 复制文本；失败时自动弹出兜底层。
   * 返回是否走通了自动路径——按钮据此决定要不要就地闪一个「已复制」，
   * 兜底层已经弹出来的时候再报一次成功只会让人困惑。
   */
  copy: (text: string, label?: string) => boolean;
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
        return false;
      }
      // 必须同步调用，才能保留用户手势。
      const result = copyText(text);
      if (result.ok) {
        showToast(`已复制${label}（${formatSize(text.length)}）`);
        return true;
      }
      setSheet({ text, title: `手动复制${label}` });
      return false;
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

/**
 * 全站统一的复制按钮。**面板里但凡是往剪贴板里写东西的，都必须是这个组件。**
 *
 * **文字恒为「复制」，没有参数可以改。** 这不是省事，是这个组件唯一的职责：
 * 之前它开着一个 `caption`，于是同一个动作在五个地方长出了五个名字——
 * 网络面板叫「cURL」、存储面板叫「导出」、环境面板叫「导出全部」、
 * 控制台叫「全部」和「选中 3 条」。每一个单独看都说得通，
 * 合起来的效果是用户点了「导出」，弹出来的提示写着「已复制」。
 * 名字里那点额外信息（复制的是什么、有多少）已经由长按提示、
 * 无障碍名称和复制成功的轻提示说完了，按钮本身只需要回答「点了会怎样」。
 *
 * **不配图标。** 试过内联 SVG：图标要跟旁边的中文一样高才叫对齐，
 * 写死 px 就会比字大一圈、看着像浮在文字上面；换成 em 跟着字号缩，
 * 又只剩一团勉强分辨得出的轮廓。何况剪贴板、两页纸、下载箭头，
 * 本来就没有一个是所有人都认的。
 *
 * 复制是这类操作里反馈最弱的一种——点完页面没有任何变化，用户唯一能确认的
 * 只有那句一闪而过的提示，而提示固定飘在屏幕底部，说不清是哪个按钮生效了。
 * 所以按钮自己要变：文字切成「已复制」并染成强调色，1.4 秒后复位。
 */
export function CopyButton(props: {
  copier: CopyController;
  /** 取文本要延迟到点击那一刻——序列化一整个响应体不该在每次渲染时都跑一遍。 */
  text: () => string;
  /** 只进提示语和无障碍名称，不上按钮，如「cURL 命令」。 */
  label?: string;
  class?: string;
}): JSX.Element {
  const [done, setDone] = createSignal(false);
  let timer: ReturnType<typeof setTimeout> | undefined;
  onCleanup(() => clearTimeout(timer));

  const name = () => `复制${props.label ?? '内容'}`;

  return (
    <button
      class={`icon-btn ${props.class ?? ''}`}
      classList={{ 'text-accent': done() }}
      title={name()}
      aria-label={name()}
      onClick={(event) => {
        // 行尾按钮的父元素常常也是可点的（选中该行），别让它跟着触发。
        event.stopPropagation();
        if (!props.copier.copy(props.text(), props.label)) return;
        setDone(true);
        clearTimeout(timer);
        timer = setTimeout(() => setDone(false), 1400);
      }}
    >
      {/*
        「复制」和「已复制」差一个字。直接换文字的话，按钮会在点下去的瞬间变宽，
        把右边的兄弟按钮一起推走——同一排有好几个复制按钮时，整排都在抖。

        所以两段文字都渲染，叠在同一个网格格子里，只切换谁可见：
        格子的宽度恒等于两者中较宽的那个，永远不变。
        `invisible` 是 visibility:hidden，被藏起来的那段不会进读屏的朗读序列。
      */}
      <span class="grid justify-items-center">
        <span class="[grid-area:1/1]" classList={{ invisible: done() }}>
          复制
        </span>
        <span class="[grid-area:1/1]" classList={{ invisible: !done() }}>
          已复制
        </span>
      </span>
    </button>
  );
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
          {/*
            宽度上限写死 480px，不走会被 SCALE 缩放的 max-w-* 档位：
            这是「平板上别拉成一整条」的边界，跟控件密度没有关系，
            跟着一起缩会让手动复制这个兜底弹层在小屏上白白变窄。
          */}
          <div
            class="flex flex-col gap-3 w-full max-w-[480px] max-h-[80dvh] p-4 rounded-xl bg-bg border border-line"
            style={{ 'padding-bottom': 'calc(16px + var(--optik-safe-bottom))' }}
          >
            <div class="font-600 not-selectable">{data().title}</div>
            {/*
              别把原因写成「因为不是 HTTPS」——那是错的：我们的首选路径是同步的
 execCommand，它不受安全上下文限制，普通 http 页面照样能复制成功。
              真正会走到这一层的是 WebView 阉割了 execCommand、或页面的权限策略
              把剪贴板整个关掉。这两种情况用户都改不了，所以文案不解释原因，
              只说下一步该怎么做。
            */}
            <div class="text-fg-secondary leading-5">
              当前环境不允许脚本写剪贴板。内容已全选，长按下方文本选择「拷贝」即可。
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
