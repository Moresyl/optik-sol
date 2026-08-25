import { afterEach, describe, expect, it, vi } from 'vitest';
import { render } from 'solid-js/web';
import { OptikKernel, type StorageItem } from 'optik-core';
import type { CopyController } from './Copy';
import { StoragePanel } from './StoragePanel';

const cleanups: Array<() => void> = [];

afterEach(() => {
  for (const cleanup of cleanups.splice(0).reverse()) cleanup();
  vi.restoreAllMocks();
});

function panel(): {
  host: HTMLDivElement;
  kernel: OptikKernel;
  reveal: ReturnType<typeof vi.fn>;
} {
  const kernel = new OptikKernel({ capture: { console: false } });
  const reveal = vi.fn();
  const copier: CopyController = {
    copy: vi.fn(() => true),
    reveal,
    toast: () => null,
    sheet: () => null,
    closeSheet: vi.fn(),
  };
  const host = document.createElement('div');
  document.body.appendChild(host);
  const dispose = render(() => <StoragePanel kernel={kernel} copier={copier} />, host);
  cleanups.push(() => kernel.dispose(), dispose, () => host.remove());
  return { host, kernel, reveal };
}

function clickButton(host: HTMLElement, label: string): void {
  const button = [...host.querySelectorAll('button')].find(
    (candidate) => candidate.textContent?.trim() === label,
  );
  expect(button).toBeDefined();
  button!.click();
}

describe('StoragePanel', () => {
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
});
