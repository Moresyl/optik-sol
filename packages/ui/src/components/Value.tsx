/**
 * RemoteObject 渲染器：惰性展开的对象树。
 *
 * 关键点在于**没有任何一处调用 JSON.stringify**。内核在日志产生时只做了一层浅预览，
 * 真实对象留在 ObjectRegistry 里由 objectId 引用。用户点开某个节点时，
 * 才通过 `getProperties(objectId)` 取下一层。所以：
 *  - 循环引用不会栈溢出
 *  - 十万元素的数组不会卡死主线程
 *  - 函数、Symbol、BigInt、DOM 节点都能如实显示，而不是变成 `{}` 或被丢弃
 *
 * 句柄的生命周期跟着环形缓冲走：日志被挤出缓冲区时对应对象即被释放，
 * 此时展开会拿到 null，界面显示「值已释放」而不是静默失败。
 */

import { createSignal, For, Show, type JSX } from 'solid-js';
import type { OptikKernel, PropertyDescriptor, RemoteObject } from '@optik/core';

export interface ValueProps {
  value: RemoteObject;
  kernel: OptikKernel;
  /** 顶层内联渲染（日志行内）不显示展开箭头以外的缩进。 */
  depth?: number;
  /** 属性名，作为子节点渲染时显示在值前面。 */
  name?: string;
  /** 不可枚举属性以更淡的颜色显示。 */
  dim?: boolean;
  onCopy?: (text: string) => void;
}

/** 属性描述符里没有值时（例如纯 setter）用它占位。 */
const UNDEFINED_VALUE: RemoteObject = { type: 'undefined', description: 'undefined' };

/** 是否是可以继续展开的节点。 */
function isExpandable(value: RemoteObject): boolean {
  return value.type === 'object' && value.objectId !== undefined && value.subtype !== 'null';
}

/** 单行摘要文本，未展开时显示。 */
function summarize(value: RemoteObject): string {
  if (value.type === 'string') return JSON.stringify(value.value);
  if (value.description !== undefined) return value.description;
  if (value.type === 'undefined') return 'undefined';
  if (value.subtype === 'null') return 'null';
  return String(value.value);
}

export function ValueView(props: ValueProps): JSX.Element {
  const [expanded, setExpanded] = createSignal(false);
  const [children, setChildren] = createSignal<PropertyDescriptor[] | null>(null);
  const [released, setReleased] = createSignal(false);
  const [loading, setLoading] = createSignal(false);

  const depth = () => props.depth ?? 0;

  const toggle = () => {
    if (!isExpandable(props.value)) return;
    if (expanded()) {
      setExpanded(false);
      return;
    }
    setExpanded(true);
    if (children() !== null || released()) return;

    setLoading(true);
    // 取属性可能触发 getter 求值，放到下一帧避免阻塞本次点击的视觉反馈。
    requestAnimationFrame(() => {
      // 不展开原型链、也不调用 getter：在调试器里触发副作用是不可接受的，
      // getter 会以 `(...)` 占位显示，用户想看再单独求值。
      const result = props.kernel.log.getProperties(props.value.objectId!, {
        ownProperties: true,
        includeNonEnumerable: true,
        invokeGetters: false,
      });
      setLoading(false);
      if (result === null) setReleased(true);
      else setChildren(result);
    });
  };

  return (
    <div class="font-mono text-base leading-5">
      <div
        class="row-center gap-1 min-h-6 wrap-anywhere selectable"
        style={{ 'padding-left': `${depth() * 12}px` }}
      >
        <Show when={isExpandable(props.value)} fallback={<span class="w-3 shrink-0" />}>
          {/*
            展开箭头单独做成 44px 触控区（用负 margin 让视觉尺寸仍然是小三角），
            否则手机上极难点中。
          */}
          <button
            class="shrink-0 w-3 h-6 -my-2.5 py-2.5 text-fg-tertiary text-2xs not-selectable row-center justify-center"
            aria-expanded={expanded()}
            aria-label={expanded() ? '收起' : '展开'}
            onClick={toggle}
          >
            {expanded() ? '▼' : '▶'}
          </button>
        </Show>

        <Show when={props.name !== undefined}>
          <span
            class="shrink-0"
            style={{ color: props.dim ? 'var(--optik-text-tertiary)' : 'var(--optik-token-key)' }}
          >
            {props.name}
            <span class="text-fg-tertiary">: </span>
          </span>
        </Show>

        <span
          data-type={props.value.type}
          data-subtype={props.value.subtype}
          class="wrap-anywhere"
          onClick={isExpandable(props.value) ? toggle : undefined}
        >
          {summarize(props.value)}
        </span>
      </div>

      <Show when={expanded()}>
        <Show when={loading()}>
          <div class="text-fg-tertiary text-sm py-1" style={{ 'padding-left': `${(depth() + 1) * 12}px` }}>
            读取中…
          </div>
        </Show>

        <Show when={released()}>
          <div class="text-fg-tertiary text-sm py-1" style={{ 'padding-left': `${(depth() + 1) * 12}px` }}>
            值已释放（该条日志已超出缓冲区上限，原始对象不再被引用）
          </div>
        </Show>

        <For each={children() ?? []}>
          {(property) => (
            <ValueView
              value={property.value ?? UNDEFINED_VALUE}
              kernel={props.kernel}
              depth={depth() + 1}
              name={property.name}
              dim={!property.enumerable}
              onCopy={props.onCopy}
            />
          )}
        </For>

        <Show when={children()?.length === 0}>
          <div class="text-fg-tertiary text-sm py-1" style={{ 'padding-left': `${(depth() + 1) * 12}px` }}>
            无自有属性
          </div>
        </Show>
      </Show>
    </div>
  );
}

/**
 * 内联单值渲染：日志行内的多个参数横向排开，不带树结构。
 * 点击后由外层切换到展开视图。
 */
export function InlineValue(props: { value: RemoteObject }): JSX.Element {
  return (
    <span data-type={props.value.type} data-subtype={props.value.subtype} class="wrap-anywhere">
      {props.value.type === 'string' ? props.value.value as string : summarize(props.value)}
    </span>
  );
}
