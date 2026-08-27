import { afterEach, describe, expect, it, vi } from 'vitest';
import { render } from 'solid-js/web';
import { OptikKernel, type StorageItem } from 'optik-core';
import type { CopyController } from './Copy';
import { StoragePanel } from './StoragePanel';

const cleanups: Array<() => void> = [];

afterEach(() => {
  for (const cleanup of cleanups.splice(0).reverse()) cleanup();
  localStorage.clear();
  vi.restoreAllMocks();
});

function panel(): {
  host: HTMLDivElement;
  kernel: OptikKernel;
  copy: ReturnType<typeof vi.fn>;
  reveal: ReturnType<typeof vi.fn>;
} {
  const kernel = new OptikKernel({ capture: { console: false } });
  const copy = vi.fn((_text: string, _label?: string) => true);
  const reveal = vi.fn();
  const copier: CopyController = {
    copy,
    reveal,
    toast: () => null,
    sheet: () => null,
    closeSheet: vi.fn(),
  };
  const host = document.createElement('div');
  document.body.appendChild(host);
  const dispose = render(() => <StoragePanel kernel={kernel} copier={copier} />, host);
  cleanups.push(() => kernel.dispose(), dispose, () => host.remove());
  return { host, kernel, copy, reveal };
}

function clickButton(host: HTMLElement, label: string): void {
  const button = [...host.querySelectorAll('button')].find(
    (candidate) => candidate.textContent?.trim() === label,
  );
  expect(button).toBeDefined();
  button!.click();
}

describe('StoragePanel', () => {
  it('renders stored JSON as a collapsible highlighted tree and copies the exact source', () => {
    localStorage.setItem('profile', '{"user":{"name":"Ada"},"active":true}');
    const { host, copy } = panel();

    expect(host.textContent).toContain('树形结构');
    expect(host.textContent).toContain('profile');
    clickButton(host, '全部展开');
    expect(host.textContent).toContain('"name"');
    clickButton(host, '代码');
    expect(host.querySelector('[data-code-token="boolean"]')?.textContent).toBe('true');
    host.querySelector<HTMLButtonElement>('[title="复制profile"]')!.click();
    expect(copy).toHaveBeenCalledWith('{"user":{"name":"Ada"},"active":true}', 'profile');
  });

  it('keeps short plain values compact while retaining direct copy', () => {
    localStorage.setItem('theme', 'dark');
    const { host, copy } = panel();

    expect(host.textContent).toContain('dark');
    expect(host.querySelector('[role="region"]')).toBeNull();
    host.querySelector<HTMLButtonElement>('[title="复制theme"]')!.click();
    expect(copy).toHaveBeenCalledWith('dark', 'theme');
  });

  it('renders unavailable snapshots without repeating the failing storage read', () => {
    const { host, kernel } = panel();
    const snapshot = vi.spyOn(kernel.storage, 'snapshot').mockReturnValue({
      items: [],
      status: {
        area: 'localStorage',
        available: false,
        reason: 'SecurityError: blocked',
        itemCount: 0,
        totalBytes: 0,
      },
    });
    clickButton(host, '刷新');
    expect(host.textContent).toContain('当前环境不支持本地存储');
    expect(host.textContent).toContain('SecurityError: blocked');
    expect(snapshot).toHaveBeenCalled();
  });

  it('loads and displays IndexedDB databases asynchronously', async () => {
    const { host, kernel } = panel();
    const items: StorageItem[] = [{ key: 'main', value: '版本 3', size: 12 }];
    vi.spyOn(kernel.storage, 'listDatabaseItems').mockResolvedValue(items);
    clickButton(host, 'IndexedDB');
    expect(host.textContent).toContain('正在读取…');
    await Promise.resolve();
    await Promise.resolve();
    expect(host.textContent).toContain('main');
    expect(host.textContent).toContain('版本 3');
    expect(host.textContent).toContain('1 项');
  });

  it('ignores stale async results after switching areas', async () => {
    const { host, kernel } = panel();
    let resolve!: (items: StorageItem[]) => void;
    vi.spyOn(kernel.storage, 'listDatabaseItems').mockReturnValue(
      new Promise((done) => (resolve = done)),
    );
    clickButton(host, 'IndexedDB');
    clickButton(host, '本地存储');
    resolve([{ key: 'stale-db', value: '版本 1', size: 10 }]);
    await Promise.resolve();
    await Promise.resolve();
    expect(host.textContent).not.toContain('stale-db');
  });

  it('shows database enumeration failures', async () => {
    const { host, kernel } = panel();
    vi.spyOn(kernel.storage, 'listDatabaseItems').mockRejectedValue(new Error('enumeration denied'));
    clickButton(host, 'IndexedDB');
    await Promise.resolve();
    await Promise.resolve();
    expect(host.textContent).toContain('enumeration denied');
  });

  it('contains destructive storage failures and explains them through the fallback sheet', () => {
    const { host, kernel, reveal } = panel();
    vi.spyOn(kernel.storage, 'clear').mockImplementation(() => {
      throw new DOMException('blocked', 'SecurityError');
    });
    clickButton(host, '清空');
    clickButton(host, '确认清空本地存储');
    expect(reveal).toHaveBeenCalledWith(expect.stringContaining('blocked'), '清空失败');
  });

  it('opens editing as an Escape-closeable modal and focuses the first field', () => {
    const { host } = panel();
    clickButton(host, '新增');

    const dialog = host.querySelector<HTMLElement>('[role="dialog"]')!;
    const keyInput = dialog.querySelector<HTMLInputElement>('[name="optik-storage-key"]')!;
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    expect(dialog.getAttribute('aria-label')).toBe('新增存储项');
    expect(document.activeElement).toBe(keyInput);
    dialog.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(host.querySelector('[role="dialog"]')).toBeNull();
  });
});
