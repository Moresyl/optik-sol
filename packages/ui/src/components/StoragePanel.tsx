/**
 * 存储面板：localStorage / sessionStorage / Cookie / IndexedDB。
 *
 * 可读之外还可写——手机上改一个 token 或开关位再刷新，是排查线上问题最快的手段，
 * 否则只能改代码重新发一版。
 *
 * 这个面板的难点全在「读得懂」上：存储里躺的绝大多数是 JSON 字符串，
 * 原样摊出来是一坨没有换行的长文本，键和值又挨在一起，一屏扫下去分不清边界。
 * 所以这里做了三件事：值自动格式化、值单独成块、长值折叠而不是套一层滚动条。
 */

import { createSignal, createMemo, createEffect, onCleanup, For, Show, type JSX } from 'solid-js';
import type { OptikKernel, StorageArea, StorageItem } from 'optik-core';
import { CopyButton, type CopyController } from './Copy';

const AREA_LABELS: Record<StorageArea, string> = {
  localStorage: '本地存储',
  sessionStorage: '会话存储',
  cookie: 'Cookie',
  indexedDB: 'IndexedDB',
};

const AREAS: StorageArea[] = ['localStorage', 'sessionStorage', 'cookie', 'indexedDB'];

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

/**
 * 存储里存的是字符串，但写进去的东西十有八九是 JSON。
 * 先看首字符再决定要不要 parse——对满屏的纯字符串值挨个跑 try/catch 是白费。
 */
function prettify(value: string): { text: string; json: boolean } {
  const trimmed = value.trim();
  if (trimmed[0] !== '{' && trimmed[0] !== '[') return { text: value, json: false };
  try {
    return { text: JSON.stringify(JSON.parse(trimmed), null, 2), json: true };
  } catch {
    // 以 { 开头但解析不了，多半是被截断或本来就不是 JSON，按原文显示
    return { text: value, json: false };
  }
}

/** 超过这个规模就折叠。判据同时看行数和字数：一行几千字的 base64 也得折。 */
function isLong(text: string): boolean {
  return text.length > 300 || text.split('\n').length > 8;
}

/**
 * 需要二次确认的危险按钮：点第一下变成「确认…」，再点一下才真执行。
 *
 * 不用宿主页面的 `window.confirm`：它会冻住整个页面、样式完全不受我们控制，
 * 有些 WebView 干脆不弹。就地变身反而更快——手指不用移动，误触也会自己复位。
 */
function DangerButton(props: {
  label: string;
  confirmLabel: string;
  class?: string;
  onConfirm: () => void;
}): JSX.Element {
  const [armed, setArmed] = createSignal(false);
  let timer: ReturnType<typeof setTimeout> | undefined;
  onCleanup(() => clearTimeout(timer));

  return (
    <button
      class={`icon-btn text-danger ${props.class ?? ''}`}
      classList={{ 'bg-danger-bg': armed() }}
      onClick={() => {
        if (armed()) {
          clearTimeout(timer);
          setArmed(false);
          props.onConfirm();
          return;
        }
        setArmed(true);
        clearTimeout(timer);
        // 举起来就一直等着，反而容易在滑动时被误碰，几秒后自动放下
        timer = setTimeout(() => setArmed(false), 3000);
      }}
    >
      {armed() ? props.confirmLabel : props.label}
    </button>
  );
}

function StorageRow(props: {
  item: StorageItem;
  readOnly: boolean;
  copier: CopyController;
  onEdit: () => void;
  onRemove: () => void;
}): JSX.Element {
  const [expanded, setExpanded] = createSignal(false);

  const body = createMemo(() => prettify(props.item.value));
  const long = createMemo(() => isLong(body().text));
  const lines = createMemo(() => body().text.split('\n').length);

  const meta = createMemo(() =>
    [
      props.item.domain && `域：${props.item.domain}`,
      props.item.path && `路径：${props.item.path}`,
      props.item.expires && `过期：${props.item.expires}`,
      props.item.secure && 'Secure',
      props.item.httpOnly && 'HttpOnly',
      props.item.sameSite && `SameSite=${props.item.sameSite}`,
    ]
      .filter(Boolean)
      .join(' · '),
  );

  return (
    <div class="px-3 py-2 border-b border-line">
      {/* 键行：键名用 token 色，右侧挂类型与体积，和值区拉开一个层级 */}
      <div class="row-center gap-1.5">
        <span
          class="flex-1 min-w-0 selectable wrap-anywhere font-mono text-base font-600"
          style={{ color: 'var(--optik-token-key)' }}
        >
          {props.item.key}
        </span>
        <Show when={body().json}>
          <span class="shrink-0 px-1 rounded-sm bg-bg-sunken text-fg-tertiary not-selectable">
            JSON
          </span>
        </Show>
        <span class="shrink-0 text-fg-tertiary not-selectable">{formatBytes(props.item.size)}</span>
      </div>

      {/*
        值单独成块并下沉底色——这是键值分区的关键。
        折叠用 line-clamp 而不是 max-h + overflow：套一层滚动区在触屏上会和外层
        列表抢手势，滑两下才发现滑错了地方；而且 line-clamp 是按行截断的，
        不会把最后一行齐腰切一刀。
      */}
      <div
        class="selectable wrap-anywhere font-mono leading-5 text-fg-secondary
 mt-1 px-2 py-1.5 rounded-md bg-bg-sunken"
        classList={{ 'line-clamp-8': long() && !expanded() }}
      >
        {/*
          空字符串是合法的值，但一个空的灰块看上去像是渲染坏了。
          写明白它是空的——顺带把「键存在但值为空」和「键不存在」区分开，
          这两种情况在排查开关位时结论完全相反。
        */}
        <Show when={body().text} fallback={<span class="text-fg-tertiary italic">空字符串</span>}>
          {body().text}
        </Show>
      </div>

      <Show when={meta()}>
        <div class="text-fg-tertiary mt-1 not-selectable">{meta()}</div>
      </Show>

      <div class="row-center gap-1 mt-1 not-selectable">
        <Show when={long()}>
          <button class="icon-btn min-h-9 px-2" onClick={() => setExpanded(!expanded())}>
            {expanded() ? '收起' : `展开（${lines()} 行）`}
          </button>
        </Show>
        <CopyButton
          copier={props.copier}
          text={() => props.item.value}
          label={props.item.key}
          class="min-h-9 px-2 text-accent"
        />
        <Show when={!props.readOnly}>
          <button class="icon-btn min-h-9 px-2" onClick={props.onEdit}>
            编辑
          </button>
          <DangerButton
            label="删除"
            confirmLabel="确认删除"
            class="min-h-9 px-2"
            onConfirm={props.onRemove}
          />
        </Show>
      </div>
    </div>
  );
}

/**
 * 编辑层。覆盖整个面板而不是挤在列表顶部——原来的做法是表单出现在最上面，
 * 而被编辑的那一行可能在第三屏，改完根本对不上是在改谁。
 */
function EditSheet(props: {
  draft: { key: string; value: string; isNew: boolean };
  area: StorageArea;
  onChange: (draft: { key: string; value: string; isNew: boolean }) => void;
  onCancel: () => void;
  onSave: () => void;
}): JSX.Element {
  const format = () => {
    const pretty = prettify(props.draft.value);
    if (pretty.json) props.onChange({ ...props.draft, value: pretty.text });
  };

  const canFormat = createMemo(() => prettify(props.draft.value).json);

  return (
    <div class="absolute inset-0 z-20 flex flex-col bg-bg">
      <div class="shrink-0 row-center gap-2 px-2 py-1.5 border-b border-line bg-bg-elevated">
        <button class="chip shrink-0" onClick={props.onCancel}>
          ‹ 取消
        </button>
        <span class="flex-1 min-w-0 truncate not-selectable">
          {props.draft.isNew ? `新增到${AREA_LABELS[props.area]}` : `编辑 ${props.draft.key}`}
        </span>
        <button class="btn-primary shrink-0 min-h-9" onClick={props.onSave}>
          保存
        </button>
      </div>

      <div class="flex-1 min-h-0 flex flex-col gap-1 p-2 overflow-y-auto">
        <label class="text-fg-tertiary not-selectable">键</label>
        {/*
          改已有条目时键是锁死的。原来这里放的是 readOnly 的 input，
          外观和可编辑的完全一样，点上去不响应只会让人以为坏了——
          直接换成静态文本，说清楚为什么不能改。
        */}
        <Show
          when={props.draft.isNew}
          fallback={
            <>
              <div class="selectable wrap-anywhere font-mono text-input px-2.5 py-2 rounded-md bg-bg-sunken">
                {props.draft.key}
              </div>
              <div class="text-fg-tertiary not-selectable">
                键不可修改。要改键名请新增一条再删掉旧的。
              </div>
            </>
          }
        >
          <input
            class="field font-mono"
            name="optik-storage-key"
            aria-label="存储键"
            placeholder="例如 token"
            autocomplete="off"
            autocapitalize="off"
            autocorrect="off"
            spellcheck={false}
            value={props.draft.key}
            onInput={(event) => props.onChange({ ...props.draft, key: event.currentTarget.value })}
          />
        </Show>

        <div class="row-center gap-1 mt-2">
          <label class="flex-1 text-fg-tertiary not-selectable">值</label>
          {/* 手机上给一段 JSON 手动排版是不可能的，这个按钮省掉的是整件事 */}
          <Show when={canFormat()}>
            <button class="icon-btn min-h-8 px-2 text-accent" onClick={format}>
              格式化 JSON
            </button>
          </Show>
        </div>
        <textarea
          class="flex-1 min-h-40 px-2.5 py-2 rounded-md bg-bg border border-line
 font-mono text-input leading-5 resize-none selectable"
          name="optik-storage-value"
          aria-label="存储值"
          placeholder="值（字符串原样写入，不会自动加引号）"
          autocomplete="off"
          autocapitalize="off"
          autocorrect="off"
          spellcheck={false}
          value={props.draft.value}
          onInput={(event) => props.onChange({ ...props.draft, value: event.currentTarget.value })}
        />
      </div>
    </div>
  );
}

export function StoragePanel(props: { kernel: OptikKernel; copier: CopyController }): JSX.Element {
  const [area, setArea] = createSignal<StorageArea>('localStorage');
  const [version, setVersion] = createSignal(0);
  const [editing, setEditing] = createSignal<{ key: string; value: string; isNew: boolean } | null>(
    null,
  );
  const [query, setQuery] = createSignal('');
  const [indexedSnapshot, setIndexedSnapshot] = createSignal<{
    loading: boolean;
    available: boolean;
    reason?: string;
    items: StorageItem[];
  }>({ loading: false, available: true, items: [] });
  let indexedGeneration = 0;

  /** `version` 只是一个手动刷新的种子——存储没有变更事件可订阅。 */
  const refresh = () => {
    if (area() === 'indexedDB') indexedGeneration++;
    setVersion((n) => n + 1);
  };

  createEffect(() => {
    const currentArea = area();
    version();
    if (currentArea !== 'indexedDB') {
      indexedGeneration++;
      return;
    }

    const generation = ++indexedGeneration;
    setIndexedSnapshot({ loading: true, available: true, items: [] });
    void props.kernel.storage.listDatabaseItems().then(
      (items) => {
        if (generation === indexedGeneration)
          setIndexedSnapshot({ loading: false, available: true, items });
      },
      (error: unknown) => {
        if (generation === indexedGeneration) {
          setIndexedSnapshot({
            loading: false,
            available: false,
            reason: error instanceof Error ? error.message : String(error),
            items: [],
          });
        }
      },
    );
  });
  onCleanup(() => indexedGeneration++);

  const snapshot = createMemo(() => {
    version();
    const currentArea = area();
    if (currentArea !== 'indexedDB') return props.kernel.storage.snapshot(currentArea);
    const indexed = indexedSnapshot();
    return {
      items: indexed.items,
      status: {
        area: currentArea,
        available: indexed.available,
        reason: indexed.reason,
        itemCount: indexed.items.length,
        totalBytes: indexed.items.reduce((sum, item) => sum + item.size, 0),
      },
    };
  });

  const status = createMemo(() => snapshot().status);

  const items = createMemo(() => {
    version();
    const needle = query().toLowerCase();
    const all = snapshot().items;
    if (!needle) return all;
    return all.filter(
      (item) =>
        item.key.toLowerCase().includes(needle) || item.value.toLowerCase().includes(needle),
    );
  });

  /** IndexedDB 只做只读枚举：写入需要异步事务，交互成本远高于收益。 */
  const readOnly = () => area() === 'indexedDB';

  const save = () => {
    const draft = editing();
    if (!draft || !draft.key) return;
    try {
      props.kernel.storage.set(area(), draft.key, draft.value);
      setEditing(null);
      refresh();
    } catch (error) {
      props.copier.reveal(String(error), '写入失败');
    }
  };

  const remove = (item: StorageItem) => {
    try {
      props.kernel.storage.remove(area(), item.key);
      refresh();
    } catch (error) {
      props.copier.reveal(String(error), '删除失败');
    }
  };

  const exportText = () =>
    snapshot()
      .items
      .map((item) => `${item.key} = ${item.value}`)
      .join('\n');

  return (
    <div class="relative flex flex-col h-full min-h-0">
      {/*
        编辑层浮在上面时，底下的工具栏和列表都要 inert：否则 Tab 和读屏的滑动浏览
        会走进一个被盖住、看不见也点不着的列表里。
        老 WebView 不认 inert，忽略即可——退化成现在的行为，不会更糟。
      */}
      <div class="shrink-0 border-b border-line bg-bg-elevated" inert={editing() !== null}>
        <div class="row-center gap-1 px-2 py-1.5 overflow-x-auto no-scrollbar">
          <For each={AREAS}>
            {(candidate) => (
              <button
                class="chip shrink-0"
                classList={{ 'bg-accent text-accent-fg': area() === candidate }}
                onClick={() => {
                  // Invalidate an in-flight IndexedDB enumeration synchronously. Solid
                  // effects run after the event; waiting for the effect leaves a race
                  // where an old Promise can commit into the newly selected area.
                  indexedGeneration++;
                  setArea(candidate);
                  setEditing(null);
                  setQuery('');
                  refresh();
                }}
              >
                {AREA_LABELS[candidate]}
              </button>
            )}
          </For>
        </div>

        <div class="row-center gap-1.5 px-2 pb-1.5">
          <input
            class="field flex-1"
            type="search"
            name="optik-storage-filter"
            aria-label="按键或值筛选存储项"
            inputmode="search"
            placeholder="按键或值筛选…"
            autocomplete="off"
            autocapitalize="off"
            autocorrect="off"
            spellcheck={false}
            value={query()}
            onInput={(event) => setQuery(event.currentTarget.value)}
          />
        </div>

        <div class="row-center gap-1 px-2 pb-1.5 not-selectable overflow-x-auto no-scrollbar">
          <span class="text-fg-tertiary shrink-0 pr-1">
            {area() === 'indexedDB' && indexedSnapshot().loading
              ? '正在读取…'
              : `${status().itemCount} 项 · ${formatBytes(status().totalBytes)}`}
          </span>
          <button class="chip shrink-0" onClick={refresh}>
            刷新
          </button>
          <Show when={!readOnly()}>
            <button
              class="chip shrink-0 text-accent"
              onClick={() => setEditing({ key: '', value: '', isNew: true })}
            >
              新增
            </button>
          </Show>
          <CopyButton
            copier={props.copier}
            text={exportText}
            label={AREA_LABELS[area()]}
            class="shrink-0 min-h-8 px-2.5"
          />
          <Show when={!readOnly()}>
            <DangerButton
              label="清空"
              confirmLabel={`确认清空${AREA_LABELS[area()]}`}
              class="shrink-0 min-h-8 px-2.5"
              onConfirm={() => {
                try {
                  props.kernel.storage.clear(area());
                  refresh();
                } catch (error) {
                  props.copier.reveal(String(error), '清空失败');
                }
              }}
            />
          </Show>
        </div>
      </div>

      <div
        class="flex-1 min-h-0 overflow-y-auto [overscroll-behavior:contain] [-webkit-overflow-scrolling:touch]"
        inert={editing() !== null}
      >
        <Show
          when={status().available}
          fallback={
            <div class="p-8 text-center text-fg-tertiary text-base not-selectable">
              当前环境不支持{AREA_LABELS[area()]}（可能处于隐私模式或被安全策略禁用）
              <Show when={status().reason}>
                {(reason) => <div class="mt-2 font-mono wrap-anywhere">{reason()}</div>}
              </Show>
            </div>
          }
        >
          <Show
            when={items().length > 0}
            fallback={
              <div class="p-8 text-center text-fg-tertiary text-base not-selectable">
                {status().itemCount === 0 ? '暂无数据' : '没有匹配的条目'}
              </div>
            }
          >
            <For each={items()}>
              {(item) => (
                <StorageRow
                  item={item}
                  readOnly={readOnly()}
                  copier={props.copier}
                  onEdit={() => setEditing({ key: item.key, value: item.value, isNew: false })}
                  onRemove={() => remove(item)}
                />
              )}
            </For>
          </Show>
        </Show>
      </div>

      <Show when={editing()}>
        {(draft) => (
          <EditSheet
            draft={draft()}
            area={area()}
            onChange={setEditing}
            onCancel={() => setEditing(null)}
            onSave={save}
          />
        )}
      </Show>
    </div>
  );
}
