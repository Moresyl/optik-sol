/**
 * 元素面板：DOM 树浏览 + 高亮 + 样式与盒模型查看。
 *
 * 两个不太显然的设计决定：
 *
 * 1. **不预先展开整棵树**。真实页面动辄上万个节点，一次性建树会直接卡死主线程。
 *    这里每个节点只在被点开时才读取 `children`，和对象树是同一套惰性思路。
 *
 * 2. **高亮层放在明亮 DOM，而不是面板的 Shadow DOM 里**。高亮框需要覆盖在宿主页面
 *    的元素上，用 `position: fixed` + 视口坐标定位；放进 Shadow DOM 虽然也能定位，
 *    但会被面板自身的层叠上下文裁剪。同时高亮层必须 `pointer-events: none`，
 *    否则它会挡住页面本身的点击。
 *
 * 面板自身的宿主节点会被过滤掉——调试器不应该在树里看到自己。
 */

import { createSignal, createMemo, For, Show, onCleanup, type JSX } from 'solid-js';
import { CopyButton, type CopyController } from './Copy';
import { SplitView } from './SplitView';
import { useLayout } from '../layout';

/** 常看的一批属性，按 DevTools 的分组顺序排列。 */
const STYLE_GROUPS: { title: string; properties: string[] }[] = [
  {
    title: '布局',
    properties: [
      'display',
      'position',
      'top',
      'right',
      'bottom',
      'left',
      'z-index',
      'float',
      'overflow',
    ],
  },
  { title: '盒模型', properties: ['width', 'height', 'padding', 'border', 'margin', 'box-sizing'] },
  {
    title: '弹性/网格',
    properties: [
      'flex',
      'flex-direction',
      'justify-content',
      'align-items',
      'gap',
      'grid-template-columns',
    ],
  },
  {
    title: '文字',
    properties: ['font-family', 'font-size', 'font-weight', 'line-height', 'color', 'text-align'],
  },
  {
    title: '外观',
    properties: [
      'background-color',
      'background-image',
      'border-radius',
      'opacity',
      'box-shadow',
      'transform',
    ],
  },
];

/** 高亮层：四块半透明色分别对应 margin / border / padding / content。 */
export class Highlighter {
  #root: HTMLDivElement | null = null;

  #ensure(): HTMLDivElement | null {
    if (this.#root) return this.#root;
    const parent = document.body ?? document.documentElement;
    if (!parent) return null;
    const root = document.createElement('div');
    root.setAttribute('data-optik-highlight', '');
    root.style.cssText =
      'position:fixed;top:0;left:0;pointer-events:none;z-index:2147482999;display:none;';
    const margin = document.createElement('div');
    margin.dataset['part'] = 'margin';
    margin.style.cssText = 'position:absolute;background:rgba(246,178,107,0.45);';
    const content = document.createElement('div');
    content.dataset['part'] = 'content';
    content.style.cssText =
      'position:absolute;background:rgba(111,168,220,0.45);outline:1px solid rgba(111,168,220,0.9);';
    const label = document.createElement('div');
    label.dataset['part'] = 'label';
    label.style.cssText =
      'position:absolute;padding:2px 6px;border-radius:3px;background:#1c1c1e;color:#fff;' +
      'font:11px/1.4 -apple-system,sans-serif;white-space:nowrap;max-width:100vw;overflow:hidden;text-overflow:ellipsis;';
    root.append(margin, content, label);
    parent.appendChild(root);
    this.#root = root;
    return root;
  }

  show(element: Element): void {
    if (!element.isConnected) {
      this.hide();
      return;
    }
    const root = this.#ensure();
    if (!root) return;
    let rect: DOMRect;
    let style: CSSStyleDeclaration;
    try {
      rect = element.getBoundingClientRect();
      style = getComputedStyle(element);
    } catch {
      this.hide();
      return;
    }
    const margin = {
      top: parseFloat(style.marginTop) || 0,
      right: parseFloat(style.marginRight) || 0,
      bottom: parseFloat(style.marginBottom) || 0,
      left: parseFloat(style.marginLeft) || 0,
    };

    const marginBox = root.children[0] as HTMLElement;
    marginBox.style.left = `${rect.left - margin.left}px`;
    marginBox.style.top = `${rect.top - margin.top}px`;
    marginBox.style.width = `${rect.width + margin.left + margin.right}px`;
    marginBox.style.height = `${rect.height + margin.top + margin.bottom}px`;

    const contentBox = root.children[1] as HTMLElement;
    contentBox.style.left = `${rect.left}px`;
    contentBox.style.top = `${rect.top}px`;
    contentBox.style.width = `${rect.width}px`;
    contentBox.style.height = `${rect.height}px`;

    const label = root.children[2] as HTMLElement;
    label.textContent = `${describe(element)} · ${Math.round(rect.width)} × ${Math.round(rect.height)}`;
    // 元素贴着视口顶部时，标签翻到下方，否则会被裁掉。
    const above = rect.top > 24;
    label.style.left = `${Math.max(0, rect.left)}px`;
    label.style.top = above ? `${rect.top - 22}px` : `${rect.bottom + 4}px`;

    root.style.display = 'block';
  }

  hide(): void {
    if (this.#root) this.#root.style.display = 'none';
  }

  dispose(): void {
    this.#root?.remove();
    this.#root = null;
  }
}

function describe(node: Element): string {
  const tag = node.tagName.toLowerCase();
  const id = node.id ? `#${node.id}` : '';
  const className =
    typeof node.className === 'string' && node.className.trim()
      ? '.' + node.className.trim().split(/\s+/).slice(0, 3).join('.')
      : '';
  return `${tag}${id}${className}`;
}

/** 生成 CSS 选择器路径，可直接粘到 document.querySelector 里用。 */
export function selectorFor(node: Element): string {
  const parts: string[] = [];
  let current: Element | null = node;
  while (current) {
    if (current === current.ownerDocument.documentElement) {
      parts.unshift(current.tagName.toLowerCase());
      break;
    }
    let part = current.tagName.toLowerCase();
    if (current.id && hasUniqueId(current)) {
      parts.unshift(`#${escapeCssIdentifier(current.id)}`);
      break; // id 唯一，到此为止
    }
    const parent: Element | null = current.parentElement;
    if (parent) {
      const siblings = [...parent.children].filter((child) => child.tagName === current!.tagName);
      if (siblings.length > 1) part += `:nth-of-type(${siblings.indexOf(current) + 1})`;
    }
    parts.unshift(part);
    current = parent;
  }
  return parts.join(' > ');
}

function hasUniqueId(node: Element): boolean {
  try {
    if (node.ownerDocument.getElementById(node.id) !== node) return false;
    try {
      return (
        node.ownerDocument.querySelectorAll(`#${escapeCssIdentifier(node.id)}`).length === 1
      );
    } catch {
      // Some old selector engines reject valid hexadecimal escapes; compare raw ids.
    }
    let matches = 0;
    for (const candidate of node.ownerDocument.querySelectorAll('[id]')) {
      if (candidate.id === node.id && ++matches > 1) return false;
    }
    return matches === 1;
  } catch {
    return false;
  }
}

export function scrollToElement(node: Element): void {
  try {
    node.scrollIntoView({ behavior: 'smooth', block: 'center' });
  } catch {
    try {
      node.scrollIntoView();
    } catch {
      // Detached nodes and old WebViews can reject both forms.
    }
  }
}

/** CSS.escape-compatible fallback for Android WebViews that do not expose CSS.escape. */
export function escapeCssIdentifier(value: string): string {
  try {
    if (typeof CSS?.escape === 'function') return CSS.escape(value);
  } catch {
    // Use the standards-compatible fallback below.
  }

  const length = value.length;
  let escaped = '';
  for (let index = 0; index < length; index++) {
    const code = value.charCodeAt(index);
    const character = value.charAt(index);
    if (code === 0) {
      escaped += '\uFFFD';
      continue;
    }
    if (
      (code >= 1 && code <= 31) ||
      code === 127 ||
      (index === 0 && code >= 48 && code <= 57) ||
      (index === 1 && code >= 48 && code <= 57 && value.charAt(0) === '-')
    ) {
      escaped += `\\${code.toString(16)} `;
      continue;
    }
    if (index === 0 && character === '-' && length === 1) {
      escaped += '\\-';
      continue;
    }
    if (
      code >= 128 ||
      character === '-' ||
      character === '_' ||
      (code >= 48 && code <= 57) ||
      (code >= 65 && code <= 90) ||
      (code >= 97 && code <= 122)
    ) {
      escaped += character;
    } else {
      escaped += `\\${character}`;
    }
  }
  return escaped;
}

/** 面板自身的节点不出现在树里。 */
function isOwnNode(node: Element): boolean {
  return node.hasAttribute('data-optik-root') || node.hasAttribute('data-optik-highlight');
}

function TreeNode(props: {
  node: Element;
  depth: number;
  selected: () => Element | null;
  onSelect: (node: Element) => void;
}): JSX.Element {
  const [expanded, setExpanded] = createSignal(props.depth < 2);

  const children = createMemo(() => {
    if (!expanded()) return [];
    return [...props.node.children].filter((child) => !isOwnNode(child));
  });

  /** 只有一个文本子节点时直接内联显示，省掉一层无意义的展开。 */
  const inlineText = createMemo(() => {
    if (props.node.children.length > 0) return null;
    const text = props.node.textContent?.trim() ?? '';
    return text.length > 0 && text.length <= 80 ? text : null;
  });

  const hasChildren = () => [...props.node.children].some((child) => !isOwnNode(child));
  const isSelected = () => props.selected() === props.node;

  return (
    <div>
      <div
        class="row-center gap-1 min-h-7 pr-2 font-mono active:bg-bg-sunken"
        classList={{ 'bg-accent/15': isSelected() }}
        style={{ 'padding-left': `${4 + props.depth * 12}px` }}
      >
        <Show when={hasChildren()} fallback={<span class="w-3 shrink-0" />}>
          <button
            class="shrink-0 w-3 self-stretch min-h-7 text-fg-tertiary not-selectable row-center justify-center"
            aria-expanded={expanded()}
            aria-label={expanded() ? '收起' : '展开'}
            onClick={(event) => {
              event.stopPropagation();
              setExpanded(!expanded());
            }}
          >
            {expanded() ? '▼' : '▶'}
          </button>
        </Show>

        <button
          class="flex-1 min-w-0 text-left truncate py-1 not-selectable"
          onClick={() => props.onSelect(props.node)}
        >
          <span style={{ color: 'var(--optik-token-tag)' }}>
            &lt;{props.node.tagName.toLowerCase()}
          </span>
          <Show when={props.node.id}>
            <span style={{ color: 'var(--optik-token-attr)' }}> id</span>
            <span class="text-fg-tertiary">=</span>
            <span style={{ color: 'var(--optik-token-string)' }}>"{props.node.id}"</span>
          </Show>
          <Show when={typeof props.node.className === 'string' && props.node.className.trim()}>
            <span style={{ color: 'var(--optik-token-attr)' }}> class</span>
            <span class="text-fg-tertiary">=</span>
            <span style={{ color: 'var(--optik-token-string)' }}>
              "{(props.node.className as string).trim()}"
            </span>
          </Show>
          <span style={{ color: 'var(--optik-token-tag)' }}>&gt;</span>
          <Show when={inlineText()}>
            {(text) => <span class="text-fg-secondary">{text()}</span>}
          </Show>
        </button>
      </div>

      <Show when={expanded()}>
        <For each={children()}>
          {(child) => (
            <TreeNode
              node={child}
              depth={props.depth + 1}
              selected={props.selected}
              onSelect={props.onSelect}
            />
          )}
        </For>
      </Show>
    </div>
  );
}

export function ElementPanel(props: { copier: CopyController }): JSX.Element {
  const layout = useLayout();
  const [selected, setSelected] = createSignal<Element | null>(null);
  const [picking, setPicking] = createSignal(false);
  const [tab, setTab] = createSignal<'tree' | 'style' | 'attrs'>('tree');

  const highlighter = new Highlighter();
  let highlightTimer: ReturnType<typeof setTimeout> | undefined;
  onCleanup(() => {
    clearTimeout(highlightTimer);
    highlighter.dispose();
  });

  const select = (node: Element) => {
    setSelected(node);
    highlighter.show(node);
    // 高亮只是定位辅助，长时间留着会挡住阅读。
    clearTimeout(highlightTimer);
    highlightTimer = setTimeout(() => highlighter.hide(), 1600);
  };

  /**
   * 拾取模式：在页面上点哪个元素就选中哪个。
   * 用捕获阶段监听并阻断事件，避免触发页面自身的点击逻辑——
   * 调试时误触发一次下单请求可不是小事。
   */
  const togglePicking = () => {
    if (picking()) {
      stopPicking();
      return;
    }
    setPicking(true);
    document.addEventListener('click', onPick, true);
    document.addEventListener('touchstart', onPickMove, true);
    document.addEventListener('mousemove', onPickMove, true);
  };

  const stopPicking = () => {
    setPicking(false);
    highlighter.hide();
    document.removeEventListener('click', onPick, true);
    document.removeEventListener('touchstart', onPickMove, true);
    document.removeEventListener('mousemove', onPickMove, true);
  };

  const targetOf = (event: Event): Element | null => {
    const target = event.target as Element | null;
    if (!target || !(target instanceof Element)) return null;
    // 点在面板自己身上时不拾取，否则永远选不中页面元素。
    if (target.closest('[data-optik-root],[data-optik-highlight]')) return null;
    return target;
  };

  const onPickMove = (event: Event) => {
    const target = targetOf(event);
    if (target) highlighter.show(target);
  };

  const onPick = (event: Event) => {
    const target = targetOf(event);
    if (!target) return;
    event.preventDefault();
    event.stopPropagation();
    setSelected(target);
    setTab('style');
    stopPicking();
  };

  onCleanup(stopPicking);

  const attributes = createMemo(() => {
    const node = selected();
    if (!node) return [];
    return [...node.attributes].map(
      (attribute) => [attribute.name, attribute.value] as [string, string],
    );
  });

  const styles = createMemo(() => {
    const node = selected();
    if (!node) return [];
    let computed: CSSStyleDeclaration;
    try {
      computed = getComputedStyle(node);
    } catch {
      return [];
    }
    return STYLE_GROUPS.map((group) => ({
      title: group.title,
      entries: group.properties
        .map(
          (property) => [property, computed.getPropertyValue(property).trim()] as [string, string],
        )
        .filter(([, value]) => value && value !== 'none' && value !== 'normal' && value !== 'auto'),
    })).filter((group) => group.entries.length > 0);
  });

  const boxModel = createMemo(() => {
    const node = selected();
    if (!node) return null;
    let rect: DOMRect;
    let computed: CSSStyleDeclaration;
    try {
      rect = node.getBoundingClientRect();
      computed = getComputedStyle(node);
    } catch {
      return null;
    }
    const read = (property: string) =>
      Math.round(parseFloat(computed.getPropertyValue(property)) || 0);
    return {
      width: Math.round(rect.width),
      height: Math.round(rect.height),
      margin: [
        read('margin-top'),
        read('margin-right'),
        read('margin-bottom'),
        read('margin-left'),
      ],
      border: [
        read('border-top-width'),
        read('border-right-width'),
        read('border-bottom-width'),
        read('border-left-width'),
      ],
      padding: [
        read('padding-top'),
        read('padding-right'),
        read('padding-bottom'),
        read('padding-left'),
      ],
    };
  });

  /**
   * 宽屏时结构树常驻左栏，右栏就只剩样式和属性两种；
   * 窄屏时三者共用一组标签，`tree` 相当于「还没钻进去」。
   */
  const detailTab = createMemo(() => (tab() === 'tree' ? 'style' : tab()));

  const hasDetail = createMemo(() =>
    layout.wide() ? selected() !== null : selected() !== null && tab() !== 'tree',
  );

  const list = (
    <div class="flex flex-col h-full min-h-0">
      <div class="shrink-0 row-center gap-1 px-2 py-1.5 border-b border-line bg-bg-elevated overflow-x-auto no-scrollbar">
        <button
          class="chip shrink-0"
          classList={{ 'bg-accent text-accent-fg': picking() }}
          onClick={togglePicking}
        >
          {picking() ? '拾取中…点击页面' : '拾取元素'}
        </button>
        {/* 分栏时结构和样式同屏，不需要用标签互斥切换 */}
        <Show when={!layout.wide()}>
          <For
            each={
              [
                ['tree', '结构'],
                ['style', '样式'],
                ['attrs', '属性'],
              ] as const
            }
          >
            {([id, label]) => (
              <button
                class="chip shrink-0"
                classList={{ 'bg-accent text-accent-fg': tab() === id }}
                onClick={() => setTab(id)}
              >
                {label}
              </button>
            )}
          </For>
        </Show>
      </div>

      <div class="flex-1 min-h-0 overflow-auto [overscroll-behavior:contain] [-webkit-overflow-scrolling:touch]">
        <TreeNode node={document.documentElement} depth={0} selected={selected} onSelect={select} />
      </div>
    </div>
  );

  const detail = (
    <div class="flex flex-col h-full min-h-0">
      <Show when={selected()}>
        {(node) => (
          <div class="shrink-0 px-3 py-1.5 border-b border-line bg-bg-sunken">
            <div class="selectable wrap-anywhere font-mono">{selectorFor(node())}</div>
            <div class="row-center flex-wrap gap-1 mt-1 not-selectable">
              <CopyButton
                copier={props.copier}
                text={() => selectorFor(node())}
                label="选择器"
                class="min-h-9 px-2 -ml-2 text-accent"
              />
              <button class="icon-btn min-h-9 px-2" onClick={() => highlighter.show(node())}>
                高亮
              </button>
              <button
                class="icon-btn min-h-9 px-2"
                onClick={() => scrollToElement(node())}
              >
                滚动到此
              </button>
              <button
                class="icon-btn min-h-9 px-2"
                onClick={() => props.copier.reveal(node().outerHTML, '元素 HTML')}
              >
                查看 HTML
              </button>
              <Show
                when={node().parentElement && node().parentElement !== document.documentElement}
              >
                <button class="icon-btn min-h-9 px-2" onClick={() => select(node().parentElement!)}>
                  选父级
                </button>
              </Show>
            </div>
          </div>
        )}
      </Show>

      <div class="shrink-0 row-center gap-1 px-2 py-1 border-b border-line bg-bg-elevated">
        <Show when={!layout.wide()}>
          <button class="chip shrink-0" onClick={() => setTab('tree')}>
            ‹ 结构
          </button>
        </Show>
        <For
          each={
            [
              ['style', '样式'],
              ['attrs', '属性'],
            ] as const
          }
        >
          {([id, label]) => (
            <button
              class="chip shrink-0"
              classList={{ 'bg-accent text-accent-fg': detailTab() === id }}
              onClick={() => setTab(id)}
            >
              {label}
            </button>
          )}
        </For>
      </div>

      <div class="flex-1 min-h-0 overflow-auto [overscroll-behavior:contain] [-webkit-overflow-scrolling:touch]">
        <Show when={detailTab() === 'attrs'}>
          <For each={attributes()}>
            {([name, value]) => (
              <div class="px-3 py-1.5 border-b border-line selectable wrap-anywhere font-mono">
                <span style={{ color: 'var(--optik-token-attr)' }}>{name}</span>
                <span class="text-fg-tertiary"> = </span>
                <span style={{ color: 'var(--optik-token-string)' }}>{value || '""'}</span>
              </div>
            )}
          </For>
          <Show when={attributes().length === 0}>
            <div class="p-8 text-center text-fg-tertiary text-base not-selectable">
              该元素没有属性
            </div>
          </Show>
        </Show>

        <Show when={detailTab() === 'style'}>
          <Show when={boxModel()}>
            {(box) => (
              <div class="px-3 py-2 border-b border-line">
                <div class="font-600 text-fg-secondary mb-1.5 not-selectable">盒模型</div>
                {/* 三层嵌套框，从外到内是 margin / border / padding，中心是内容尺寸。 */}
                <div class="p-2 text-center bg-[rgba(246,178,107,0.25)] rounded-sm not-selectable">
                  <div class="text-fg-secondary">外边距 {box().margin.join(' / ')}</div>
                  <div class="p-2 mt-1 bg-[rgba(255,229,153,0.35)] rounded-sm">
                    <div class="text-fg-secondary">边框 {box().border.join(' / ')}</div>
                    <div class="p-2 mt-1 bg-[rgba(147,196,125,0.3)] rounded-sm">
                      <div class="text-fg-secondary">内边距 {box().padding.join(' / ')}</div>
                      <div class="p-2 mt-1 bg-[rgba(111,168,220,0.35)] rounded-sm font-mono">
                        {box().width} × {box().height}
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </Show>

          <For each={styles()}>
            {(group) => (
              <div class="border-b border-line">
                <div class="px-3 py-1.5 bg-bg-elevated font-600 text-fg-secondary not-selectable">
                  {group.title}
                </div>
                <For each={group.entries}>
                  {([property, value]) => (
                    <div class="px-3 py-1 selectable wrap-anywhere font-mono">
                      <span style={{ color: 'var(--optik-token-key)' }}>{property}</span>
                      <span class="text-fg-tertiary">: </span>
                      <span>{value}</span>
                    </div>
                  )}
                </For>
              </div>
            )}
          </For>
        </Show>
      </div>
    </div>
  );

  return (
    <SplitView
      storageKey="optik:split:element"
      placeholder="点击左侧节点或用「拾取元素」在页面上选一个"
      hasDetail={hasDetail()}
      list={list}
      detail={detail}
    />
  );
}
