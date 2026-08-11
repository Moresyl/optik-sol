/**
 * 存储面板：localStorage / sessionStorage / Cookie / IndexedDB。
 *
 * 可读之外还可写——手机上改一个 token 或开关位再刷新，是排查线上问题最快的手段，
 * 否则只能改代码重新发一版。删除与清空都要求二次确认，避免误触清掉登录态。
 */

import { createSignal, createMemo, For, Show, type JSX } from 'solid-js';
import type { OptikKernel, StorageArea, StorageItem } from '@optik/core';
import type { CopyController } from './Copy';

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

export function StoragePanel(props: { kernel: OptikKernel; copier: CopyController }): JSX.Element {
  const [area, setArea] = createSignal<StorageArea>('localStorage');
  const [version, setVersion] = createSignal(0);
  const [editing, setEditing] = createSignal<{ key: string; value: string; isNew: boolean } | null>(null);
  const [query, setQuery] = createSignal('');

  /** `version` 只是一个手动刷新的种子——存储没有变更事件可订阅。 */
  const refresh = () => setVersion((n) => n + 1);

  const status = createMemo(() => {
    version();
    return props.kernel.storage.status(area());
  });

  const items = createMemo(() => {
    version();
    const needle = query().toLowerCase();
    const all = props.kernel.storage.list(area());
    if (!needle) return all;
    return all.filter(
      (item) => item.key.toLowerCase().includes(needle) || item.value.toLowerCase().includes(needle),
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
    if (!confirm(`确定删除「${item.key}」？`)) return;
    props.kernel.storage.remove(area(), item.key);
    refresh();
  };

  const clearAll = () => {
    if (!confirm(`确定清空${AREA_LABELS[area()]}的全部内容？此操作不可撤销。`)) return;
    props.kernel.storage.clear(area());
    refresh();
  };

  const exportAll = () => {
    const text = props.kernel.storage
      .list(area())
      .map((item) => `${item.key} = ${item.value}`)
      .join('\n');
    props.copier.copy(text, AREA_LABELS[area()]);
  };

  return (
    <div class="flex flex-col h-full min-h-0">
      <div class="shrink-0 border-b border-line bg-bg-elevated">
        <div class="row-center gap-1 px-2 py-1.5 overflow-x-auto no-scrollbar">
          <For each={AREAS}>
            {(candidate) => (
              <button
                class="chip shrink-0"
                classList={{ 'bg-accent text-accent-fg': area() === candidate }}
                onClick={() => {
                  setArea(candidate);
                  setEditing(null);
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
            class="flex-1 min-w-0 px-2.5 min-h-9 rounded-md bg-bg border border-line text-input selectable"
            type="search"
            inputmode="search"
            placeholder="按键或值筛选…"
            autocapitalize="off"
            autocorrect="off"
            spellcheck={false}
            value={query()}
            onInput={(event) => setQuery(event.currentTarget.value)}
          />
        </div>

        <div class="row-center gap-2 px-2 pb-1.5 text-2xs not-selectable overflow-x-auto no-scrollbar">
          <span class="text-fg-tertiary shrink-0">
            {status().itemCount} 项 · {formatBytes(status().totalBytes)}
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
          <button class="chip shrink-0" onClick={exportAll}>
            导出
          </button>
          <Show when={!readOnly()}>
            <button class="chip shrink-0 text-danger" onClick={clearAll}>
              清空
            </button>
          </Show>
        </div>
      </div>

      <Show when={editing()}>
        {(draft) => (
          <div class="shrink-0 flex flex-col gap-1.5 p-2 border-b border-line bg-bg-sunken">
            <input
              class="px-2.5 min-h-9 rounded-md bg-bg border border-line font-mono text-input selectable"
              placeholder="键"
              autocapitalize="off"
              autocorrect="off"
              spellcheck={false}
              readOnly={!draft().isNew}
              value={draft().key}
              onInput={(event) => setEditing({ ...draft(), key: event.currentTarget.value })}
            />
            <textarea
              class="px-2.5 py-2 min-h-24 rounded-md bg-bg border border-line font-mono text-input resize-y selectable"
              placeholder="值"
              autocapitalize="off"
              autocorrect="off"
              spellcheck={false}
              value={draft().value}
              onInput={(event) => setEditing({ ...draft(), value: event.currentTarget.value })}
            />
            <div class="row-center justify-end gap-2">
              <button class="btn" onClick={() => setEditing(null)}>
                取消
              </button>
              <button class="btn-primary" onClick={save}>
                保存
              </button>
            </div>
          </div>
        )}
      </Show>

      <div class="flex-1 min-h-0 overflow-y-auto [overscroll-behavior:contain] [-webkit-overflow-scrolling:touch]">
        <Show when={status().available} fallback={
          <div class="p-8 text-center text-fg-tertiary text-base not-selectable">
            当前环境不支持{AREA_LABELS[area()]}（可能处于隐私模式或被安全策略禁用）
          </div>
        }>
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
                <div class="px-3 py-2 border-b border-line">
                  <div class="row-center gap-2">
                    <span
                      class="flex-1 min-w-0 selectable wrap-anywhere font-mono text-base font-600"
                      style={{ color: 'var(--optik-token-key)' }}
                    >
                      {item.key}
                    </span>
                    <span class="text-2xs text-fg-tertiary shrink-0 not-selectable">
                      {formatBytes(item.size)}
                    </span>
                  </div>

                  <div class="selectable wrap-anywhere font-mono text-sm leading-5 text-fg-secondary max-h-32 overflow-y-auto mt-0.5">
                    {item.value}
                  </div>

                  <Show when={item.domain || item.expires || item.sameSite}>
                    <div class="text-2xs text-fg-tertiary mt-0.5 not-selectable">
                      {[
                        item.domain && `域：${item.domain}`,
                        item.path && `路径：${item.path}`,
                        item.expires && `过期：${item.expires}`,
                        item.secure && 'Secure',
                        item.httpOnly && 'HttpOnly',
                        item.sameSite && `SameSite=${item.sameSite}`,
                      ]
                        .filter(Boolean)
                        .join(' · ')}
                    </div>
                  </Show>

                  <div class="row-center gap-3 mt-1 text-2xs not-selectable">
                    <button class="text-accent py-1" onClick={() => props.copier.copy(item.value, item.key)}>
                      复制值
                    </button>
                    <Show when={!readOnly()}>
                      <button
                        class="text-fg-tertiary py-1"
                        onClick={() => setEditing({ key: item.key, value: item.value, isNew: false })}
                      >
                        编辑
                      </button>
                      <button class="text-danger py-1" onClick={() => remove(item)}>
                        删除
                      </button>
                    </Show>
                  </div>
                </div>
              )}
            </For>
          </Show>
        </Show>
      </div>
    </div>
  );
}
